/**
 * Acções de jogo partilhadas pelos endpoints (/roll, /move, /resign) e pelo
 * game-ticker. O servidor é o único que decide o dado, joga pelos bots e
 * pelos humanos em auto-play, e passa a vez quando o tempo acaba.
 */
import type { PoolClient } from "pg";
import {
  type GameState,
  getMovablePieces,
  canMovePiece,
  movePiece,
  nextActiveIdx,
} from "./engine.js";
import { smartRollDice, loadSmartDiceConfig } from "./smart-dice.js";

export const HUMAN_ROLL_SECONDS = 15;
export const HUMAN_MOVE_SECONDS = 30;
// Folga para latência de rede antes de o servidor passar a vez a um humano.
const HUMAN_GRACE_MS = 1000;

/** Tempo de reacção estável por bot (0.7x rápido a 1.4x pensativo). */
function botTempo(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return 0.7 + (h % 100) / 140;
}

export function isAuto(state: GameState, playerId: string): boolean {
  const p = state.players.find((x) => x.id === playerId);
  return !!p && (p.isBot || !!state.autoPlay?.includes(playerId));
}

/** Calcula o prazo da vez actual. Chamar em TODAS as transições de estado. */
export function withDeadline(state: GameState): GameState {
  if (state.winner || state.phase === "finished") return { ...state, turnDeadline: null };
  const p = state.players[state.currentPlayerIndex];
  const secs = state.phase === "moving" ? HUMAN_MOVE_SECONDS : HUMAN_ROLL_SECONDS;
  if (p && isAuto(state, p.id)) {
    const base =
      state.phase === "rolling" ? 1000 + Math.random() * 1500 : 800 + Math.random() * 1200;
    const tempo = p.isBot ? botTempo(p.id) : 0.6;
    return { ...state, turnTimer: secs, turnDeadline: Date.now() + Math.round(base * tempo) };
  }
  return { ...state, turnTimer: secs, turnDeadline: Date.now() + secs * 1000 + HUMAN_GRACE_MS };
}

/** Passa a vez ao próximo jogador activo. */
export function passTurn(state: GameState): GameState {
  return withDeadline({
    ...state,
    currentPlayerIndex: nextActiveIdx(state.players, state.currentPlayerIndex),
    diceValue: null,
    phase: "rolling",
    consecutiveSixes: 0,
  });
}

export async function rollDiceFor(
  gameId: string,
  state: GameState,
): Promise<{ ns: GameState; dice: number; movable: number[] }> {
  const idx = state.currentPlayerIndex;
  const config = await loadSmartDiceConfig();
  const dice = smartRollDice(gameId, state, idx, config);
  const movable = getMovablePieces(state.players[idx], dice);
  const ns =
    movable.length === 0
      ? // Sem jogadas possíveis — mostra o dado e passa a vez
        { ...passTurn(state), diceValue: dice }
      : withDeadline({ ...state, diceValue: dice, phase: "moving" });
  return { ns, dice, movable };
}

/** Aplica o movimento e as regras de turno (6 ou captura repete; 3 seises perde a vez). */
export function movePieceFor(
  state: GameState,
  pieceId: number,
): { ns: GameState; captured: boolean; dice: number } | null {
  const idx = state.currentPlayerIndex;
  const player = state.players[idx];
  const dice = state.diceValue;
  const piece = player?.pieces[pieceId];
  if (!dice || !piece || !canMovePiece(piece, dice, player.color)) return null;

  const { newState, captured } = movePiece(state, idx, pieceId, dice);
  if (newState.winner) {
    return {
      ns: { ...newState, diceValue: null, phase: "finished", turnDeadline: null },
      captured,
      dice,
    };
  }
  const sixes = dice === 6 ? newState.consecutiveSixes + 1 : 0;
  const ns =
    sixes >= 3 || (dice !== 6 && !captured)
      ? passTurn(newState)
      : withDeadline({ ...newState, diceValue: null, phase: "rolling", consecutiveSixes: sixes });
  return { ns, captured, dice };
}

export async function saveState(client: PoolClient, gameId: string, ns: GameState) {
  const r = await client.query<any>(
    `UPDATE games SET state = $1::jsonb, version = version + 1, updated_at = now() WHERE id = $2 RETURNING *`,
    [JSON.stringify(ns), gameId],
  );
  return r.rows[0];
}

/**
 * Liquida um jogo terminado: credita o prémio (pot × 0.95) ao vencedor
 * humano e marca o jogo/sala como finalizados. Idempotente via flag
 * `settled` (o caller deve garantir FOR UPDATE na linha do jogo).
 */
export async function settleGame(
  client: PoolClient,
  gameId: string,
  roomId: string,
  state: GameState,
): Promise<void> {
  const roomRes = await client.query<{ bet_amount: string }>(
    "SELECT bet_amount FROM rooms WHERE id = $1",
    [roomId],
  );
  const betAmount = Number(roomRes.rows[0]?.bet_amount ?? 0);
  const paidRes = await client.query<{ user_id: string }>(
    "SELECT user_id FROM room_players WHERE room_id = $1 AND bet_paid = true AND user_id IS NOT NULL",
    [roomId],
  );
  const paidUserIds = paidRes.rows.map((r) => r.user_id);
  const pot = betAmount * paidUserIds.length;
  const prize = Math.floor(pot * 0.95);

  const winnerId = state.winner!;
  const winnerPlayer = state.players.find((p) => p.id === winnerId);
  const winnerIsBot = !!winnerPlayer?.isBot;

  if (!winnerIsBot && paidUserIds.includes(winnerId) && prize > 0) {
    await client.query(
      "UPDATE wallets SET balance = balance + $1, updated_at = now() WHERE user_id = $2",
      [prize, winnerId],
    );
    await client.query(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)",
      [winnerId, "win", prize, `Vitória — prémio de ${prize.toLocaleString()} Kz`],
    );
  }

  await client.query(
    `UPDATE games SET settled = true, settled_at = now(), winner_user_id = $1, prize = $2 WHERE id = $3`,
    [winnerIsBot ? null : winnerId, prize, gameId],
  );
  await client.query("UPDATE rooms SET status = 'finished' WHERE id = $1", [roomId]);

  // Ledger da casa: pot/prémio/rake por jogo — base do cálculo de RTP real.
  // Se o vencedor é bot, o pot inteiro é rake (a casa fica com tudo).
  const paidOut = !winnerIsBot && paidUserIds.includes(winnerId) ? prize : 0;
  await client.query(
    `INSERT INTO house_ledger (game_id, room_id, pot, prize, rake, winner_user_id, winner_is_bot)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (game_id) DO NOTHING`,
    [gameId, roomId, pot, paidOut, pot - paidOut, winnerIsBot ? null : winnerId, winnerIsBot],
  );
}
