import { Hono } from "hono";
import type { PoolClient } from "pg";
import { one, query, pool } from "../db.js";
import { requireAuth } from "../auth.js";
import { chargeBet, InsufficientBalanceError } from "../lib/wallet.js";
import { type GameState, type PlayerColor } from "../game/engine.js";
import {
  movePieceFor,
  passTurn,
  rollDiceFor,
  saveState,
  settleGame,
  withDeadline,
} from "../game/actions.js";
import { bumpMission } from "../game/missions.js";

const app = new Hono();

app.use("*", requireAuth);

function buildInitialState(
  players: Array<{
    id: string;
    name: string;
    color: PlayerColor;
    isBot: boolean;
  }>,
): GameState {
  return withDeadline({
    players: players.map((p) => ({
      ...p,
      pieces: Array.from({ length: 4 }, (_, i) => ({
        id: i,
        position: -1,
        color: p.color,
        isFinished: false,
      })),
    })),
    currentPlayerIndex: 0,
    diceValue: null,
    isRolling: false,
    winner: null,
    turnTimer: 15,
    consecutiveSixes: 0,
    phase: "rolling",
    autoPlay: [],
  });
}

/**
 * Só o próprio jogador age na sua vez. Bots, auto-play e timeouts são
 * conduzidos pelo servidor (workers/game-ticker.ts) — nenhum cliente joga
 * por outro.
 */
function isMyTurn(state: GameState, userId: string): boolean {
  const cur = state.players[state.currentPlayerIndex];
  return !!cur && !cur.isBot && !cur.resigned && cur.id === userId;
}

/** O jogador voltou a agir — sai do auto-play. */
function clearAutoPlay(state: GameState, userId: string): GameState {
  return state.autoPlay?.includes(userId)
    ? { ...state, autoPlay: state.autoPlay.filter((id) => id !== userId) }
    : state;
}

// Start a game for a room (host only). Atomically: create game + set room status.
app.post("/start/:roomId", async (c) => {
  const u = c.get("user");
  const roomId = c.req.param("roomId");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const roomRes = await client.query<any>("SELECT * FROM rooms WHERE id = $1 FOR UPDATE", [
      roomId,
    ]);
    const room = roomRes.rows[0];
    if (!room) {
      await client.query("ROLLBACK");
      return c.json({ error: "room not found" }, 404);
    }
    if (room.host_id !== u.id) {
      await client.query("ROLLBACK");
      return c.json({ error: "only host can start" }, 403);
    }

    // Already started? return existing
    const existing = await client.query<any>("SELECT * FROM games WHERE room_id = $1", [roomId]);
    if (existing.rows[0]) {
      await client.query("COMMIT");
      const g = existing.rows[0];
      return c.json({ game: { ...g, state: g.state } });
    }

    const playersRes = await client.query<any>(
      "SELECT * FROM room_players WHERE room_id = $1 ORDER BY player_index",
      [roomId],
    );
    if (playersRes.rows.length < 2) {
      await client.query("ROLLBACK");
      return c.json({ error: "need at least 2 players" }, 400);
    }

    // Safeguard: nenhum jogo arranca sem TODOS os humanos terem pago.
    // Se algum tiver `bet_paid=false` (sala legacy ou bug histórico),
    // tenta fazer backfill da cobrança AGORA. Se algum não tiver saldo,
    // recusa o start com erro detalhado (o host vê quem falhou).
    const isPractice = Number(room.bet_amount) === 0;
    if (!isPractice && playersRes.rows.some((p: any) => p.is_bot)) {
      await client.query("ROLLBACK");
      return c.json({ error: "bots only in practice rooms" }, 400);
    }
    const unpaidHumans = isPractice
      ? []
      : playersRes.rows.filter((p: any) => !p.is_bot && p.user_id && !p.bet_paid);
    if (unpaidHumans.length > 0) {
      console.warn(
        `[games.start] ${unpaidHumans.length} unpaid players in room ${room.code} — attempting backfill`,
      );
      for (const p of unpaidHumans) {
        try {
          await chargeBet(
            client,
            p.user_id,
            roomId,
            Number(room.bet_amount),
            `Aposta na sala ${room.code} (backfill no start)`,
          );
        } catch (err) {
          await client.query("ROLLBACK");
          if (err instanceof InsufficientBalanceError) {
            return c.json(
              {
                error: "unpaid players",
                message:
                  "Um ou mais jogadores não têm saldo suficiente para a aposta. O jogo não pode iniciar.",
                userId: p.user_id,
                required: err.required,
                available: err.available,
              },
              400,
            );
          }
          console.error("[games.start] backfill chargeBet failed:", err);
          return c.json({ error: "start failed" }, 500);
        }
      }
    }

    // Nomes dos humanos. O avatar NÃO entra no estado: é um data URL de
    // dezenas de KB e o pg_notify do realtime rejeita payloads >= 8000 bytes
    // (o /start falhava). O cliente busca avatares via /api/profiles.
    const humanIds = playersRes.rows
      .filter((p: any) => !p.is_bot && p.user_id)
      .map((p: any) => p.user_id);
    const nameMap: Record<string, string> = {};
    if (humanIds.length > 0) {
      const profRes = await client.query<{ id: string; display_name: string }>(
        "SELECT id, display_name FROM profiles WHERE id = ANY($1::uuid[])",
        [humanIds],
      );
      profRes.rows.forEach((p) => {
        nameMap[p.id] = p.display_name;
      });
    }

    const gamePlayers = playersRes.rows.map((p: any) => ({
      id: p.is_bot ? `bot-${p.id}` : p.user_id,
      name: p.is_bot ? p.bot_name || "Bot" : nameMap[p.user_id] || "Jogador",
      color: p.color,
      isBot: p.is_bot,
    }));

    const initialState = buildInitialState(gamePlayers);

    const gameRes = await client.query<any>(
      `INSERT INTO games (room_id, host_id, state, version) VALUES ($1, $2, $3::jsonb, 1) RETURNING *`,
      [roomId, u.id, JSON.stringify(initialState)],
    );
    await client.query("UPDATE rooms SET status = 'playing' WHERE id = $1", [roomId]);
    await client.query("COMMIT");
    return c.json({ game: gameRes.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`[games.start] FAILED room=${roomId} user=${u.id}:`, err);
    return c.json({ error: "start failed" }, 500);
  } finally {
    client.release();
  }
});

/**
 * Devolve o jogo em curso onde o utilizador está como jogador, se existir.
 * Usado para re-entrar num jogo após reload/disconnect.
 */
app.get("/active", async (c) => {
  const u = c.get("user");
  // Filtros adicionais via JSON do state:
  //  - winner deve ser NULL (jogo não terminado)
  //  - este utilizador NÃO pode estar marcado como resigned no array de players
  const game = await one<any>(
    `SELECT g.* FROM games g
     INNER JOIN rooms r ON r.id = g.room_id
     INNER JOIN room_players rp ON rp.room_id = r.id
     WHERE r.status = 'playing'
       AND g.settled = false
       AND rp.user_id = $1
       AND COALESCE(g.state->>'winner', '') = ''
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(g.state->'players') AS p
         WHERE p->>'id' = $1::text AND (p->>'resigned')::boolean = true
       )
     ORDER BY g.created_at DESC
     LIMIT 1`,
    [u.id],
  );
  if (!game) return c.json({ game: null });
  return c.json({ game });
});

// Só jogadores do jogo o podem ler (o estado e o chat não são públicos)
const isPlayer = (game: { state: GameState } | null, userId: string) =>
  !!game?.state.players.some((p) => p.id === userId);

app.get("/by-room/:roomId", async (c) => {
  const game = await one<any>("SELECT * FROM games WHERE room_id = $1", [c.req.param("roomId")]);
  if (!isPlayer(game, c.get("user").id)) return c.json({ error: "no game" }, 404);
  return c.json({ game });
});

app.get("/:id", async (c) => {
  const game = await one<any>("SELECT * FROM games WHERE id = $1", [c.req.param("id")]);
  if (!isPlayer(game, c.get("user").id)) return c.json({ error: "not found" }, 404);
  return c.json({ game });
});

// --- Acções de jogo autoritárias ---
// O dado é lançado NO SERVIDOR (smart-dice com config do backoffice) e os
// movimentos são validados/aplicados pelo motor do servidor. O cliente
// apenas anima o que o servidor decidiu — impossível forjar dados,
// movimentos ou vitórias a partir do browser.

// Lançar o dado. Só o jogador da vez (ou o bot driver, pelas vezes de
// bots/auto-play). Devolve o valor e o estado actualizado.
app.post("/:id/roll", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{
      state: GameState;
      version: number;
      room_id: string;
      settled: boolean;
    }>("SELECT state, version, room_id, settled FROM games WHERE id = $1 FOR UPDATE", [id]);
    const game = cur.rows[0];
    if (!game) {
      await client.query("ROLLBACK");
      return c.json({ error: "not found" }, 404);
    }
    if (game.settled || game.state.winner) {
      await client.query("ROLLBACK");
      return c.json({ error: "game finished" }, 400);
    }
    const state = game.state;
    if (state.phase !== "rolling") {
      await client.query("ROLLBACK");
      return c.json({ error: "not rolling phase", currentVersion: game.version }, 409);
    }
    if (!isMyTurn(state, u.id)) {
      await client.query("ROLLBACK");
      return c.json({ error: "not your turn" }, 403);
    }

    const { ns, dice, movable } = await rollDiceFor(id, clearAutoPlay(state, u.id));
    const updated = await saveState(client, id, ns);
    await client.query("COMMIT");
    return c.json({ game: updated, dice, movable });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[roll]", err);
    return c.json({ error: "roll failed" }, 500);
  } finally {
    client.release();
  }
});

// Mover uma peça. Valida com o motor do servidor e aplica as regras de
// turno (6 ou captura repete; 3 seises seguidos passa a vez).
app.post("/:id/move", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{ pieceId?: number }>();
  const pieceId = body.pieceId;
  if (!Number.isInteger(pieceId) || pieceId! < 0 || pieceId! > 3) {
    return c.json({ error: "bad pieceId" }, 400);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{
      state: GameState;
      version: number;
      room_id: string;
      settled: boolean;
    }>("SELECT state, version, room_id, settled FROM games WHERE id = $1 FOR UPDATE", [id]);
    const game = cur.rows[0];
    if (!game) {
      await client.query("ROLLBACK");
      return c.json({ error: "not found" }, 404);
    }
    if (game.settled || game.state.winner) {
      await client.query("ROLLBACK");
      return c.json({ error: "game finished" }, 400);
    }
    const state = game.state;
    if (state.phase !== "moving" || !state.diceValue) {
      await client.query("ROLLBACK");
      return c.json({ error: "not moving phase", currentVersion: game.version }, 409);
    }
    if (!isMyTurn(state, u.id)) {
      await client.query("ROLLBACK");
      return c.json({ error: "not your turn" }, 403);
    }

    const result = movePieceFor(clearAutoPlay(state, u.id), pieceId!);
    if (!result) {
      await client.query("ROLLBACK");
      return c.json({ error: "illegal move" }, 400);
    }
    const { ns, captured, dice } = result;
    const updated = await saveState(client, id, ns);
    if (captured) {
      const r = await client.query<{ bet_amount: string }>(
        "SELECT bet_amount FROM rooms WHERE id = $1",
        [game.room_id],
      );
      if (Number(r.rows[0]?.bet_amount ?? 0) > 0) await bumpMission(client, u.id, "capture5");
    }
    if (ns.winner) await settleGame(client, id, game.room_id, ns);

    await client.query("COMMIT");
    return c.json({ game: updated, captured, dice });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[move]", err);
    return c.json({ error: "move failed" }, 500);
  } finally {
    client.release();
  }
});

// Ligar/desligar o auto-play do PRÓPRIO jogador. Substitui o antigo PATCH
// de estado (que permitia escolher o dado e saltar vezes).
app.post("/:id/autoplay", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{ enabled?: boolean }>();
  const enabled = body.enabled === true;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{ state: GameState; settled: boolean }>(
      "SELECT state, settled FROM games WHERE id = $1 FOR UPDATE",
      [id],
    );
    const game = cur.rows[0];
    const me = game?.state.players.find((p) => p.id === u.id && !p.isBot && !p.resigned);
    if (!game || game.settled || !me) {
      await client.query("ROLLBACK");
      return c.json({ error: "not in this game" }, 400);
    }
    const others = (game.state.autoPlay ?? []).filter((x) => x !== u.id);
    let ns: GameState = { ...game.state, autoPlay: enabled ? [...others, u.id] : others };
    // Se é a vez dele, o prazo muda (auto joga já; manual recebe tempo novo)
    if (game.state.players[game.state.currentPlayerIndex]?.id === u.id) ns = withDeadline(ns);
    const updated = await saveState(client, id, ns);
    await client.query("COMMIT");
    return c.json({ game: updated });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[autoplay]", err);
    return c.json({ error: "autoplay failed" }, 500);
  } finally {
    client.release();
  }
});

// --- Chat ---
app.get("/:id/chat", async (c) => {
  const game = await one<{ state: GameState }>("SELECT state FROM games WHERE id = $1", [
    c.req.param("id"),
  ]);
  if (!isPlayer(game, c.get("user").id)) return c.json({ error: "not found" }, 404);
  const rows = await query<any>(
    `SELECT id, user_id, author_name, color, text, gift_emoji, gift_name, gift_price,
            gift_to_name, gift_to_color, created_at
     FROM chat_messages WHERE game_id = $1 ORDER BY created_at ASC LIMIT 200`,
    [c.req.param("id")],
  );
  return c.json({
    messages: rows.map((r: any) => ({
      ...r,
      gift_price: r.gift_price === null ? null : Number(r.gift_price),
    })),
  });
});

// Nome/cor do autor vêm SEMPRE do estado do jogo — nunca do body.
app.post("/:id/chat", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{ text?: string }>();
  const text = (body.text ?? "").trim();
  if (!text) return c.json({ error: "empty message" }, 400);
  if (text.length > 500) return c.json({ error: "message too long" }, 400);

  const game = await one<{ state: GameState }>("SELECT state FROM games WHERE id = $1", [id]);
  if (!game) return c.json({ error: "game not found" }, 404);
  const me = game.state.players.find((p) => p.id === u.id);
  if (!me) return c.json({ error: "not in this game" }, 403);

  const inserted = await one<any>(
    `INSERT INTO chat_messages (game_id, user_id, author_name, color, text)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, author_name, color, text,
               gift_emoji, gift_name, gift_price, gift_to_name, gift_to_color, created_at`,
    [id, u.id, me.name, me.color, text],
  );
  return c.json({ message: { ...inserted, gift_price: null } });
});

// Catálogo de gifts — fonte de verdade dos preços (o cliente só envia o id).
const GIFTS: Record<string, { emoji: string; name: string; price: number }> = {
  rose: { emoji: "🌹", name: "Rosa", price: 50 },
  choco: { emoji: "🍫", name: "Chocolate", price: 100 },
  beer: { emoji: "🍻", name: "Cerveja", price: 200 },
  cake: { emoji: "🎂", name: "Bolo", price: 500 },
  fire: { emoji: "🔥", name: "Em Chamas", price: 750 },
  diamond: { emoji: "💎", name: "Diamante", price: 1000 },
  car: { emoji: "🚗", name: "Carro", price: 2000 },
  rocket: { emoji: "🚀", name: "Foguete", price: 5000 },
  crown: { emoji: "👑", name: "Coroa", price: 10000 },
};

// Enviar gift: debita quem envia, credita o destinatário (humano no mesmo
// jogo) e publica a mensagem no chat — tudo numa transacção.
app.post("/:id/gift", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{ giftId?: string; toPlayerId?: string }>();
  const gift = GIFTS[body.giftId ?? ""];
  if (!gift) return c.json({ error: "bad gift" }, 400);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const g = await client.query<{ state: GameState }>("SELECT state FROM games WHERE id = $1", [
      id,
    ]);
    const state = g.rows[0]?.state;
    const me = state?.players.find((p) => p.id === u.id);
    const to = state?.players.find((p) => p.id === body.toPlayerId);
    if (!state || !me) {
      await client.query("ROLLBACK");
      return c.json({ error: "not in this game" }, 403);
    }
    if (!to || to.isBot || to.id === u.id) {
      await client.query("ROLLBACK");
      return c.json({ error: "bad recipient" }, 400);
    }

    const debit = await client.query<{ balance: string }>(
      "UPDATE wallets SET balance = balance - $1, updated_at = now() WHERE user_id = $2 AND balance >= $1 RETURNING balance",
      [gift.price, u.id],
    );
    if (!debit.rows[0]) {
      await client.query("ROLLBACK");
      return c.json({ error: "insufficient balance" }, 400);
    }
    await client.query(
      "UPDATE wallets SET balance = balance + $1, updated_at = now() WHERE user_id = $2",
      [gift.price, to.id],
    );
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, description)
       VALUES ($1, 'gift', $3, $4), ($2, 'gift_received', $3, $5)`,
      [
        u.id,
        to.id,
        gift.price,
        `Gift ${gift.emoji} ${gift.name} → ${to.name}`,
        `Gift ${gift.emoji} ${gift.name} de ${me.name}`,
      ],
    );
    await client.query(
      `INSERT INTO chat_messages
         (game_id, user_id, author_name, color, gift_emoji, gift_name, gift_price, gift_to_name, gift_to_color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, u.id, me.name, me.color, gift.emoji, gift.name, gift.price, to.name, to.color],
    );
    await client.query("COMMIT");
    return c.json({ balance: Number(debit.rows[0].balance) });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[gift]", err);
    return c.json({ error: "gift failed" }, 500);
  } finally {
    client.release();
  }
});

// --- Resign ---
// Aplica a desistência NO SERVIDOR: marca o jogador como resigned, avança a
// vez se era dele, e se só restar um jogador activo declara-o vencedor e
// liquida o pot. O cliente já não empurra estado de desistência.
app.post("/:id/resign", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const gameRes = await client.query<{ state: GameState; room_id: string; settled: boolean }>(
      "SELECT state, room_id, settled FROM games WHERE id = $1 FOR UPDATE",
      [id],
    );
    const game = gameRes.rows[0];
    if (!game) {
      await client.query("ROLLBACK");
      return c.json({ error: "game not found" }, 404);
    }
    if (game.settled) {
      await client.query("ROLLBACK");
      return c.json({ error: "game already finished" }, 400);
    }

    const inGame = game.state.players.some((p) => p.id === u.id && !p.isBot && !p.resigned);
    if (!inGame) {
      await client.query("ROLLBACK");
      return c.json({ error: "not in this game or already resigned" }, 400);
    }

    // Buscar bet_amount para o log
    const roomRes = await client.query<{ bet_amount: string }>(
      "SELECT bet_amount FROM rooms WHERE id = $1",
      [game.room_id],
    );
    const betLost = Number(roomRes.rows[0]?.bet_amount ?? 0);

    // Actualizar contagem (analytics only, sem cooldown)
    await client.query(
      `UPDATE profiles
       SET resign_count = resign_count + 1,
           last_resign_at = now()
       WHERE id = $1`,
      [u.id],
    );

    // Registar no log
    await client.query(
      "INSERT INTO resign_log (user_id, game_id, room_id, bet_lost) VALUES ($1, $2, $3, $4)",
      [u.id, id, game.room_id, betLost],
    );

    // Aplicar a desistência ao estado do jogo
    const state = JSON.parse(JSON.stringify(game.state)) as GameState;
    const resignerIdx = state.players.findIndex((p) => p.id === u.id);
    state.players[resignerIdx].resigned = true;

    const active = state.players.filter((p) => !p.resigned);
    const activeHumans = active.filter((p) => !p.isBot);
    let ns: GameState;
    if (active.length === 1 || activeHumans.length === 0) {
      // O jogo termina se sobra apenas um jogador OU se já não há humanos
      // activos (só restam bots, que ninguém conduz). O vencedor é o
      // primeiro jogador activo — se for bot, o settle envia o pot à casa.
      // Sem esta 2ª condição, a sala ficava presa em 'playing' para sempre.
      ns = {
        ...state,
        winner: active[0]?.id ?? null,
        diceValue: null,
        phase: "finished",
        turnDeadline: null,
      };
    } else {
      // Se era a vez do desistente, avança
      const wasCurrent = state.currentPlayerIndex === resignerIdx;
      ns = wasCurrent ? passTurn(state) : state;
    }

    await saveState(client, id, ns);

    if (ns.winner) {
      await settleGame(client, id, game.room_id, ns);
    }

    await client.query("COMMIT");

    return c.json({
      ok: true,
      resignStreak: 0,
      cooldownMinutes: 0,
      cooldownUntil: null,
      betLost,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[resign]", err);
    return c.json({ error: "resign failed" }, 500);
  } finally {
    client.release();
  }
});

export default app;
