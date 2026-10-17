import { pool, query } from "../db.js";
import { type GameState, botChoosePiece } from "../game/engine.js";
import {
  isAuto,
  movePieceFor,
  passTurn,
  rollDiceFor,
  saveState,
  settleGame,
} from "../game/actions.js";

/**
 * Conduz os jogos quando o prazo da vez (`state.turnDeadline`) expira:
 *  - bot ou humano em auto-play → o servidor lança/move por ele
 *  - humano que deixou o tempo acabar → entra em auto-play e passa a vez
 *
 * Substitui o antigo "bot driver" no browser: o jogo continua mesmo que
 * todos os clientes desliguem, e nenhum cliente joga por outro.
 * FOR UPDATE SKIP LOCKED torna-o seguro com várias instâncias.
 */

const TICK_MS = 500;

async function step(gameId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{ state: GameState; room_id: string; updated_at: Date }>(
      `SELECT state, room_id, updated_at FROM games
       WHERE id = $1 AND settled = false FOR UPDATE SKIP LOCKED`,
      [gameId],
    );
    const game = cur.rows[0];
    const state = game?.state;
    // Jogos antigos (sem turnDeadline) usam updated_at + 30s
    const deadline = state?.turnDeadline ?? (game ? game.updated_at.getTime() + 30_000 : 0);
    if (!state || state.winner || Date.now() < deadline) {
      await client.query("ROLLBACK");
      return;
    }

    const player = state.players[state.currentPlayerIndex];
    let ns: GameState;
    if (!player || player.resigned) {
      ns = passTurn(state);
    } else if (isAuto(state, player.id)) {
      if (state.phase === "moving" && state.diceValue) {
        const pieceId = botChoosePiece(player, state.diceValue, state);
        ns = (pieceId >= 0 && movePieceFor(state, pieceId)?.ns) || passTurn(state);
      } else {
        ns = (await rollDiceFor(gameId, state)).ns;
      }
    } else {
      // Tempo esgotado: auto-play para este jogador e passa a vez
      ns = passTurn({ ...state, autoPlay: [...(state.autoPlay ?? []), player.id] });
    }

    await saveState(client, gameId, ns);
    if (ns.winner) await settleGame(client, gameId, game.room_id, ns);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`[game-ticker] game=${gameId}`, err);
  } finally {
    client.release();
  }
}

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const due = await query<{ id: string }>(
      `SELECT id FROM games
       WHERE settled = false
         AND COALESCE(state->>'winner', '') = ''
         AND COALESCE((state->>'turnDeadline')::bigint,
                      (extract(epoch FROM updated_at) * 1000)::bigint + 30000) <= $1
       LIMIT 100`,
      [Date.now()],
    );
    for (const g of due) await step(g.id);
  } catch (err) {
    console.error("[game-ticker]", err);
  } finally {
    running = false;
  }
}

export function startGameTicker() {
  setInterval(tick, TICK_MS);
  console.log("[game-ticker] started");
}
