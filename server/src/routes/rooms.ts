import { Hono } from "hono";
import { one, query, pool } from "../db.js";
import { requireAuth } from "../auth.js";
import { chargeBet, refundBet, InsufficientBalanceError } from "../lib/wallet.js";
import { levelFromXp } from "../game/missions.js";
import { loadGameConfig } from "../game/config.js";

const app = new Hono();

app.use("*", requireAuth);

const maintenanceError = (msg: string | null) => ({
  error: "maintenance",
  message: msg || "O NANTER está em manutenção. Volta daqui a pouco.",
});

const COLORS = ["red", "blue", "green", "yellow"] as const;
const BOT_NAMES = ["Kiala", "Nzinga", "Mbala", "Lueji"] as const;

/** Jogadores das salas, com o nível dos humanos (para o matchmaking/UI). */
async function playersOf(roomIds: string[]) {
  const rows = await query<any>(
    `SELECT rp.*, p.xp, p.equipped_frame FROM room_players rp
     LEFT JOIN profiles p ON p.id = rp.user_id
     WHERE rp.room_id = ANY($1::uuid[]) ORDER BY rp.player_index`,
    [roomIds],
  );
  return rows.map(({ xp, ...p }) => ({ ...p, level: p.is_bot ? null : levelFromXp(xp ?? 0) }));
}

async function loadRoomWithPlayers(id: string) {
  const room = await one<any>("SELECT * FROM rooms WHERE id = $1", [id]);
  if (!room) return null;
  return { ...room, players: await playersOf([id]) };
}

// Listagem pública — exclui salas privadas (só acessíveis por código)
app.get("/", async (c) => {
  const status = c.req.query("status") || "waiting";
  const rooms = await query<any>(
    "SELECT * FROM rooms WHERE status = $1 AND is_private = false ORDER BY created_at DESC",
    [status],
  );
  if (rooms.length === 0) return c.json({ rooms: [] });
  const players = await playersOf(rooms.map((r: any) => r.id));
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
  const bet = Math.floor(Number(body.bet_amount));
  // bet 0 = sala de treino (contra bots, sem dinheiro); nunca listada
  const isPractice = bet === 0;
  const isPrivate = isPractice || !!body.is_private;
  const cfg = await loadGameConfig();
  if (cfg.maintenance) return c.json(maintenanceError(cfg.maintenanceMessage), 503);
  if (!Number.isFinite(bet) || (!isPractice && (bet < cfg.minStake || bet > cfg.maxStake))) {
    return c.json({ error: "bad bet_amount", minStake: cfg.minStake, maxStake: cfg.maxStake }, 400);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const roomRes = await client.query<any>(
      "INSERT INTO rooms (host_id, bet_amount, is_private, rake_pct) VALUES ($1, $2, $3, $4) RETURNING *",
      [u.id, bet, isPrivate, cfg.rakePct],
    );
    const room = roomRes.rows[0];
    await client.query(
      "INSERT INTO room_players (room_id, user_id, player_index, color, is_bot) VALUES ($1, $2, 0, $3, false)",
      [room.id, u.id, "red"],
    );
    try {
      if (!isPractice) await chargeBet(client, u.id, room.id, bet, `Aposta na sala ${room.code}`);
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

// Jogo rápido: a sala pública em espera com a mesma aposta cujos jogadores
// têm o nível mais próximo do meu. O cliente entra com /join (ou cria uma
// sala se não houver nenhuma).
app.get("/match", async (c) => {
  const u = c.get("user");
  const bet = Math.floor(Number(c.req.query("bet")));
  if (!Number.isFinite(bet) || bet <= 0) return c.json({ error: "bad bet" }, 400);
  const me = await one<{ xp: number }>("SELECT xp FROM profiles WHERE id = $1", [u.id]);
  const room = await one<{ id: string }>(
    `SELECT r.id FROM rooms r
     JOIN room_players rp ON rp.room_id = r.id
     LEFT JOIN profiles p ON p.id = rp.user_id
     WHERE r.status = 'waiting' AND r.is_private = false AND r.bet_amount = $1
     GROUP BY r.id
     HAVING count(*) < max(r.max_players) AND bool_and(rp.user_id IS DISTINCT FROM $2)
     ORDER BY abs(sqrt(coalesce(avg(p.xp), 0)) - sqrt($3::float)), min(r.created_at)
     LIMIT 1`,
    [bet, u.id, me?.xp ?? 0],
  );
  return c.json({ roomId: room?.id ?? null });
});

app.get("/by-code/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const room = await one<any>("SELECT * FROM rooms WHERE code = $1 AND status = 'waiting'", [code]);
  if (!room) return c.json({ error: "not found" }, 404);
  const full = await loadRoomWithPlayers(room.id);
  return c.json({ room: full });
});

app.get("/:id", async (c) => {
  const u = c.get("user");
  const full = await loadRoomWithPlayers(c.req.param("id"));
  // Sala privada só é visível a quem lá está (o código é o convite)
  const isMember = full?.players.some((p: any) => p.user_id === u.id);
  if (!full || (full.is_private && !isMember)) return c.json({ error: "not found" }, 404);
  return c.json({ room: full });
});

// Entrar na sala — debita aposta do jogador atomicamente
app.post("/:id/join", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const cfg = await loadGameConfig();
  if (cfg.maintenance) return c.json(maintenanceError(cfg.maintenanceMessage), 503);

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
      if (Number(room.bet_amount) > 0) {
        await chargeBet(client, u.id, id, Number(room.bet_amount), `Aposta na sala ${room.code}`);
      }
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

// Adicionar bot — só em salas de treino (bet 0). Em salas a dinheiro os
// adversários são sempre humanos que pagaram a aposta.
app.post("/:id/bots", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const full = await loadRoomWithPlayers(id);
  if (!full) return c.json({ error: "not found" }, 404);
  if (full.host_id !== u.id) return c.json({ error: "forbidden" }, 403);
  if (Number(full.bet_amount) > 0) return c.json({ error: "bots only in practice rooms" }, 400);
  if (full.status !== "waiting") return c.json({ error: "room not joinable" }, 400);
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
    [id, idx, color, `Bot ${BOT_NAMES[idx]}`],
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
          id,
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
        } else if (room.host_id === u.id) {
          // O host saiu mas há humanos: passa o host ao seguinte (senão
          // ninguém conseguia iniciar o jogo e a sala ficava presa).
          await client.query(
            `UPDATE rooms SET host_id = (
               SELECT user_id FROM room_players
               WHERE room_id = $1 AND is_bot = false AND user_id IS NOT NULL
               ORDER BY player_index LIMIT 1
             ) WHERE id = $1`,
            [id],
          );
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
