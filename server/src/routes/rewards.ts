import { Hono } from "hono";
import type { PoolClient } from "pg";
import { pool, query, one } from "../db.js";
import { requireAuth } from "../auth.js";
import { creditBonus } from "../lib/wallet.js";
import { MISSIONS, TODAY_SQL, levelFromXp, type MissionId } from "../game/missions.js";

const app = new Hono();
app.use("*", requireAuth);

// --- Missões diárias ---

app.get("/missions", async (c) => {
  const u = c.get("user");
  const rows = await query<{ mission: string; progress: number; claimed_at: string | null }>(
    `SELECT mission, progress, claimed_at FROM mission_progress
     WHERE user_id = $1 AND day = ${TODAY_SQL}`,
    [u.id],
  );
  const byId = Object.fromEntries(rows.map((r) => [r.mission, r]));
  return c.json({
    missions: Object.entries(MISSIONS).map(([id, m]) => ({
      id,
      ...m,
      progress: Math.min(m.goal, byId[id]?.progress ?? 0),
      claimed: !!byId[id]?.claimed_at,
    })),
  });
});

app.post("/missions/:id/claim", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id") as MissionId;
  const mission = MISSIONS[id];
  if (!mission) return c.json({ error: "bad mission" }, 400);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // UPDATE condicional: só um claim passa, mesmo com pedidos em paralelo
    const r = await client.query(
      `UPDATE mission_progress SET claimed_at = now()
       WHERE user_id = $1 AND day = ${TODAY_SQL} AND mission = $2
         AND progress >= $3 AND claimed_at IS NULL`,
      [u.id, id, mission.goal],
    );
    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return c.json({ error: "not claimable" }, 400);
    }
    await creditBonus(client, u.id, mission.reward, `Missão: ${mission.label}`);
    await client.query("COMMIT");
    return c.json({ ok: true, reward: mission.reward });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[missions.claim]", err);
    return c.json({ error: "claim failed" }, 500);
  } finally {
    client.release();
  }
});

// --- Ranking semanal (segunda 00:00 → domingo 23:59, hora de Luanda) ---

export const WEEKLY_PRIZES = [5000, 3000, 2000] as const;

const WEEK_START_SQL =
  "(date_trunc('week', now() AT TIME ZONE 'Africa/Luanda') AT TIME ZONE 'Africa/Luanda')";

interface RankRow {
  user_id: string;
  wins: number;
  won: string;
  rank: string;
  display_name: string;
  equipped_frame: string | null;
  xp: number;
}

/** Ranking por vitórias (desempate: total ganho) a partir do ledger da casa. */
export async function weekRanking(
  db: Pick<PoolClient, "query">,
  startSql: string,
  userId: string | null,
  limit: number,
): Promise<RankRow[]> {
  const r = await db.query<RankRow>(
    `WITH ranked AS (
       SELECT winner_user_id AS user_id, count(*)::int AS wins,
              sum(prize + bonus_prize)::bigint AS won,
              row_number() OVER (
                ORDER BY count(*) DESC, sum(prize + bonus_prize) DESC, winner_user_id
              ) AS rank
       FROM house_ledger
       WHERE winner_user_id IS NOT NULL
         AND created_at >= ${startSql} AND created_at < ${startSql} + interval '1 week'
       GROUP BY winner_user_id
     )
     SELECT r.*, p.display_name, p.equipped_frame, p.xp
     FROM ranked r JOIN profiles p ON p.id = r.user_id
     WHERE r.rank <= $1 OR r.user_id = $2
     ORDER BY r.rank`,
    [limit, userId],
  );
  return r.rows;
}

app.get("/leaderboard", async (c) => {
  const u = c.get("user");
  const rows = await weekRanking(pool, WEEK_START_SQL, u.id, 20);
  const ends = await one<{ ends_at: string }>(
    `SELECT ${WEEK_START_SQL} + interval '1 week' AS ends_at`,
  );
  const fmt = (r: RankRow) => ({
    userId: r.user_id,
    name: r.display_name,
    frame: r.equipped_frame,
    level: levelFromXp(r.xp),
    wins: r.wins,
    won: Number(r.won),
    rank: Number(r.rank),
  });
  return c.json({
    top: rows.filter((r) => Number(r.rank) <= 20).map(fmt),
    me: rows.find((r) => r.user_id === u.id) ? fmt(rows.find((r) => r.user_id === u.id)!) : null,
    prizes: WEEKLY_PRIZES,
    endsAt: ends?.ends_at,
  });
});

/**
 * Paga os prémios da semana anterior aos 3 primeiros (em bónus). Idempotente
 * pela PK de weekly_prizes; seguro com várias instâncias.
 */
export async function payWeeklyPrizes(): Promise<void> {
  const prevStart = `(${WEEK_START_SQL} - interval '1 week')`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const top = await weekRanking(client, prevStart, null, WEEKLY_PRIZES.length);
    for (const row of top) {
      const rank = Number(row.rank);
      const amount = WEEKLY_PRIZES[rank - 1];
      if (!amount) continue;
      const ins = await client.query(
        `INSERT INTO weekly_prizes (week_start, rank, user_id, wins, amount)
         VALUES ((${prevStart} AT TIME ZONE 'Africa/Luanda')::date, $1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [rank, row.user_id, row.wins, amount],
      );
      if (ins.rowCount) {
        await creditBonus(client, row.user_id, amount, `Ranking semanal — ${rank}º lugar`);
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[weekly-prizes]", err);
  } finally {
    client.release();
  }
}

// --- Loja de cosméticos (molduras de avatar) ---

export const SHOP: Record<string, { name: string; price: number }> = {
  gold: { name: "Moldura Dourada", price: 1500 },
  neon: { name: "Neon", price: 2000 },
  fire: { name: "Chama", price: 3000 },
  diamond: { name: "Diamante", price: 6000 },
};

app.get("/shop", async (c) => {
  const u = c.get("user");
  const owned = await query<{ item_id: string }>(
    "SELECT item_id FROM user_items WHERE user_id = $1",
    [u.id],
  );
  const prof = await one<{ equipped_frame: string | null; xp: number }>(
    "SELECT equipped_frame, xp FROM profiles WHERE id = $1",
    [u.id],
  );
  const wallet = await one<{ balance: string; bonus_balance: string }>(
    "SELECT balance, bonus_balance FROM wallets WHERE user_id = $1",
    [u.id],
  );
  const ownedSet = new Set(owned.map((o) => o.item_id));
  return c.json({
    items: Object.entries(SHOP).map(([id, it]) => ({ id, ...it, owned: ownedSet.has(id) })),
    equipped: prof?.equipped_frame ?? null,
    level: levelFromXp(prof?.xp ?? 0),
    xp: prof?.xp ?? 0,
    balance: Number(wallet?.balance ?? 0),
    bonus: Number(wallet?.bonus_balance ?? 0),
  });
});

// Compra: paga primeiro com bónus, o resto com saldo real.
app.post("/shop/:id/buy", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const item = SHOP[id];
  if (!item) return c.json({ error: "bad item" }, 400);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      "INSERT INTO user_items (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [u.id, id],
    );
    if (!ins.rowCount) {
      await client.query("ROLLBACK");
      return c.json({ error: "already owned" }, 400);
    }
    const w = await client.query<{ balance: string; bonus_balance: string }>(
      "SELECT balance, bonus_balance FROM wallets WHERE user_id = $1 FOR UPDATE",
      [u.id],
    );
    const balance = Number(w.rows[0]?.balance ?? 0);
    const bonus = Number(w.rows[0]?.bonus_balance ?? 0);
    if (balance + bonus < item.price) {
      await client.query("ROLLBACK");
      return c.json({ error: "insufficient balance" }, 400);
    }
    const fromBonus = Math.min(bonus, item.price);
    await client.query(
      `UPDATE wallets SET balance = balance - $1, bonus_balance = bonus_balance - $2,
         updated_at = now() WHERE user_id = $3`,
      [item.price - fromBonus, fromBonus, u.id],
    );
    await client.query(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'purchase', $2, $3)",
      [u.id, item.price, `Loja: ${item.name}`],
    );
    await client.query("UPDATE profiles SET equipped_frame = $1 WHERE id = $2", [id, u.id]);
    await client.query("COMMIT");
    return c.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[shop.buy]", err);
    return c.json({ error: "buy failed" }, 500);
  } finally {
    client.release();
  }
});

// Equipar (ou "none" para tirar). Só itens comprados.
app.post("/shop/:id/equip", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  if (id !== "none") {
    const owned = await one("SELECT 1 FROM user_items WHERE user_id = $1 AND item_id = $2", [
      u.id,
      id,
    ]);
    if (!owned) return c.json({ error: "not owned" }, 400);
  }
  await query("UPDATE profiles SET equipped_frame = $1 WHERE id = $2", [
    id === "none" ? null : id,
    u.id,
  ]);
  return c.json({ ok: true });
});

export default app;
