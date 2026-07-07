import { Hono } from "hono";
import { one, query, pool } from "../db.js";
import { requireAuth } from "../auth.js";
import { chargeBet, refundBet, InsufficientBalanceError } from "../lib/wallet.js";

const app = new Hono();

app.use("*", requireAuth);

const COLORS = ["red", "blue", "green", "yellow"] as const;

async function loadRoomWithPlayers(id: string) {
  const room = await one<any>("SELECT * FROM rooms WHERE id = $1", [id]);
  if (!room) return null;
  const players = await query<any>(
    "SELECT * FROM room_players WHERE room_id = $1 ORDER BY player_index",
    [id],
  );
  return { ...room, players };
}

// Listagem pública — exclui salas privadas (só acessíveis por código)
app.get("/", async (c) => {
  const status = c.req.query("status") || "waiting";
  const rooms = await query<any>(
    "SELECT * FROM rooms WHERE status = $1 AND is_private = false ORDER BY created_at DESC",
    [status],
  );
  if (rooms.length === 0) return c.json({ rooms: [] });
  const ids = rooms.map((r: any) => r.id);
  const players = await query<any>(
    "SELECT * FROM room_players WHERE room_id = ANY($1::uuid[]) ORDER BY player_index",
    [ids],
  );
  const byRoom: Record<string, any[]> = {};
  for (const p of players) {
    (byRoom[p.room_id] ||= []).push(p);
  }
  return c.json({
    rooms: rooms.map((r: any) => ({ ...r, players: byRoom[r.id] || [] })),
  });
});

// Criar sala — debita aposta do criador atomicamente
app.post("/", async (c) => {
  const u = c.get("user");
  const body = await c.req.json<{ bet_amount?: number; is_private?: boolean }>();
  const bet = Math.floor(body.bet_amount ?? 100);
  const isPrivate = !!body.is_private;
  if (bet <= 0) return c.json({ error: "bad bet_amount" }, 400);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const roomRes = await client.query<any>(
      "INSERT INTO rooms (host_id, bet_amount, is_private) VALUES ($1, $2, $3) RETURNING *",
      [u.id, bet, isPrivate],
    );
    const room = roomRes.rows[0];
    await client.query(
      "INSERT INTO room_players (room_id, user_id, player_index, color, is_bot) VALUES ($1, $2, 0, $3, false)",
      [room.id, u.id, "red"],
    );
    try {
      await chargeBet(client, u.id, room.id, bet, `Aposta na sala ${room.code}`);
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof InsufficientBalanceError) {
        return c.json(
          { error: "insufficient balance", required: err.required, available: err.available },
          400,
        );
      }
      console.error("[rooms.create] chargeBet failed:", err);
      return c.json({ error: "charge failed" }, 500);
    }
    await client.query("COMMIT");
    const full = await loadRoomWithPlayers(room.id);
    return c.json({ room: full });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return c.json({ error: "create failed" }, 500);
  } finally {
    client.release();
  }
});

app.get("/by-code/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const room = await one<any>("SELECT * FROM rooms WHERE code = $1 AND status = 'waiting'", [code]);
  if (!room) return c.json({ error: "not found" }, 404);
  const full = await loadRoomWithPlayers(room.id);
  return c.json({ room: full });
});

app.get("/:id", async (c) => {
  const full = await loadRoomWithPlayers(c.req.param("id"));
  if (!full) return c.json({ error: "not found" }, 404);
  return c.json({ room: full });
});

app.patch("/:id", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{ status?: string }>();
  const room = await one<{ host_id: string }>("SELECT host_id FROM rooms WHERE id = $1", [id]);
  if (!room) return c.json({ error: "not found" }, 404);
  if (room.host_id !== u.id) return c.json({ error: "forbidden" }, 403);
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (body.status && ["waiting", "playing", "finished"].includes(body.status)) {
    fields.push(`status = $${i++}`);
    values.push(body.status);
  }
  if (fields.length === 0) return c.json({ error: "nothing to update" }, 400);
  values.push(id);
  const updated = await one(
    `UPDATE rooms SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values,
  );
  return c.json({ room: updated });
});

// Entrar na sala — debita aposta do jogador atomicamente
app.post("/:id/join", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const roomRes = await client.query<any>("SELECT * FROM rooms WHERE id = $1 FOR UPDATE", [id]);
    const room = roomRes.rows[0];
    if (!room) {
      await client.query("ROLLBACK");
      return c.json({ error: "not found" }, 404);
    }
    if (room.status !== "waiting") {
      await client.query("ROLLBACK");
      return c.json({ error: "room not joinable" }, 400);
    }
    const playersRes = await client.query<any>(
      "SELECT * FROM room_players WHERE room_id = $1 ORDER BY player_index",
      [id],
    );
    const players = playersRes.rows;
    if (players.some((p: any) => p.user_id === u.id)) {
      await client.query("ROLLBACK");
      const full = await loadRoomWithPlayers(id);
      return c.json({ room: full });
    }
    if (players.length >= room.max_players) {
      await client.query("ROLLBACK");
      return c.json({ error: "room full" }, 400);
    }
    const usedColors = new Set(players.map((p: any) => p.color));
    const usedIndices = new Set(players.map((p: any) => p.player_index));
    const color = COLORS.find((c) => !usedColors.has(c));
    const idx = [0, 1, 2, 3].find((i) => !usedIndices.has(i));
    if (!color || idx === undefined) {
      await client.query("ROLLBACK");
      return c.json({ error: "room full" }, 400);
    }
    await client.query(
      "INSERT INTO room_players (room_id, user_id, player_index, color, is_bot) VALUES ($1, $2, $3, $4, false)",
      [id, u.id, idx, color],
    );
    try {
      await chargeBet(client, u.id, id, Number(room.bet_amount), `Aposta na sala ${room.code}`);
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof InsufficientBalanceError) {
        return c.json(
          { error: "insufficient balance", required: err.required, available: err.available },
          400,
        );
      }
      console.error("[rooms.join] chargeBet failed:", err);
      return c.json({ error: "charge failed" }, 500);
    }
    await client.query("COMMIT");
    const updated = await loadRoomWithPlayers(id);
    return c.json({ room: updated });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return c.json({ error: "join failed" }, 500);
  } finally {
    client.release();
  }
});

// Adicionar bot — bots NÃO pagam aposta
app.post("/:id/bots", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{ bot_name?: string }>();
  const full = await loadRoomWithPlayers(id);
  if (!full) return c.json({ error: "not found" }, 404);
  if (full.host_id !== u.id) return c.json({ error: "forbidden" }, 403);
  if (full.players.length >= full.max_players) {
    return c.json({ error: "room full" }, 400);
  }
  const usedColors = new Set(full.players.map((p: any) => p.color));
  const usedIndices = new Set(full.players.map((p: any) => p.player_index));
  const color = COLORS.find((c) => !usedColors.has(c));
  const idx = [0, 1, 2, 3].find((i) => !usedIndices.has(i));
  if (!color || idx === undefined) {
    return c.json({ error: "room full" }, 400);
  }
  await query(
    "INSERT INTO room_players (room_id, user_id, player_index, color, is_bot, bot_name, is_ready) VALUES ($1, NULL, $2, $3, true, $4, true)",
    [id, idx, color, body.bot_name || "Bot"],
  );
  const updated = await loadRoomWithPlayers(id);
  return c.json({ room: updated });
});

// Sair da sala. Refund APENAS se cumprir TODAS as condições:
//   1. A sala ainda está em 'waiting' (jogo nunca arrancou)
//   2. NÃO existe nenhum game record associado à sala
//      (defesa em profundidade contra status drift)
//   3. O jogador tem `bet_paid = true`
//
// Em qualquer outro cenário — incluindo "desistir durante o jogo" e "voltar
// ao lobby após resign" — a aposta fica perdida (vai para o pot do vencedor
// ou, se o vencedor for bot, para a casa). É a regra do jogo: desistir =
// perder.
app.post("/:id/leave", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const roomRes = await client.query<any>("SELECT * FROM rooms WHERE id = $1 FOR UPDATE", [id]);
    const room = roomRes.rows[0];
    if (!room) {
      await client.query("ROLLBACK");
      return c.json({ ok: true });
    }
    const playerRes = await client.query<{ bet_paid: boolean }>(
      "SELECT bet_paid FROM room_players WHERE room_id = $1 AND user_id = $2",
      [id, u.id],
    );
    const player = playerRes.rows[0];

    // Belt-and-suspenders: se já existe um game record para a sala, NUNCA
    // há refund — mesmo que `status` esteja por algum motivo em 'waiting'.
    // Cobre o caso em que o jogo arrancou mas o status não actualizou (bug).
    const gameRes = await client.query<{ id: string }>(
      "SELECT id FROM games WHERE room_id = $1 LIMIT 1",
      [id],
    );
    const gameExists = gameRes.rows.length > 0;

    let refunded = false;
    if (player) {
      const eligibleForRefund = room.status === "waiting" && !gameExists && player.bet_paid;

      if (eligibleForRefund) {
        await refundBet(
          client,
          u.id,
          Number(room.bet_amount),
          `Reembolso (saiu da sala ${room.code} antes do jogo iniciar)`,
        );
        refunded = true;
      } else if (player.bet_paid && (room.status !== "waiting" || gameExists)) {
        // Logging — útil para auditoria. Se vires isto e o user reclamar,
        // confirma que houve resign e não refund por design.
        console.log(
          `[rooms.leave] no refund — user=${u.id} room=${room.code} status=${room.status} gameExists=${gameExists} (aposta perdida por desistência)`,
        );
      }

      await client.query("DELETE FROM room_players WHERE room_id = $1 AND user_id = $2", [
        id,
        u.id,
      ]);
      // Se a sala em 'waiting' ficou sem humanos, apaga (cleanup imediato)
      if (room.status === "waiting" && !gameExists) {
        const remainRes = await client.query<{ count: string }>(
          "SELECT count(*) FROM room_players WHERE room_id = $1 AND is_bot = false",
          [id],
        );
        if (Number(remainRes.rows[0]?.count ?? 0) === 0) {
          await client.query("DELETE FROM rooms WHERE id = $1", [id]);
        }
      }
    }
    await client.query("COMMIT");
    // Sinaliza ao cliente se houve refund — ele decide a UI (toast + balance refresh)
    return c.json({ ok: true, refunded });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return c.json({ error: "leave failed" }, 500);
  } finally {
    client.release();
  }
});

export default app;
