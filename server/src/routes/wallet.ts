import { Hono } from "hono";
import { one, query, pool } from "../db.js";
import { requireAuth } from "../auth.js";

const app = new Hono();

app.use("*", requireAuth);

app.get("/", async (c) => {
  const u = c.get("user");
  const wallet = await one<{ balance: string }>("SELECT balance FROM wallets WHERE user_id = $1", [
    u.id,
  ]);
  return c.json({ balance: wallet ? Number(wallet.balance) : 0 });
});

app.get("/transactions", async (c) => {
  const u = c.get("user");
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);
  const rows = await query(
    "SELECT id, type, amount, description, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    [u.id, limit],
  );
  return c.json({
    transactions: rows.map((r: any) => ({ ...r, amount: Number(r.amount) })),
  });
});

app.post("/transactions", async (c) => {
  const u = c.get("user");
  const body = await c.req.json<{
    type: "deposit" | "withdraw" | "bet" | "win" | "refund" | "gift";
    amount: number;
    description?: string;
  }>();
  const allowed = ["deposit", "withdraw", "bet", "win", "refund", "gift"];
  if (!allowed.includes(body.type)) return c.json({ error: "bad type" }, 400);
  if (!Number.isFinite(body.amount) || body.amount <= 0) {
    return c.json({ error: "bad amount" }, 400);
  }
  // Limite máximo por transacção — evita valores absurdos/overflow
  const MAX_TX_AMOUNT = 10_000_000; // 10M Kz
  if (body.amount > MAX_TX_AMOUNT) {
    return c.json({ error: "amount exceeds maximum" }, 400);
  }

  const debitTypes = ["withdraw", "bet", "gift"];
  const isDebit = debitTypes.includes(body.type);
  const delta = isDebit ? -Math.floor(body.amount) : Math.floor(body.amount);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const wallet = await client.query<{ balance: string }>(
      "SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE",
      [u.id],
    );
    const balance = Number(wallet.rows[0]?.balance ?? 0);
    if (isDebit && balance + delta < 0) {
      await client.query("ROLLBACK");
      return c.json({ error: "insufficient balance" }, 400);
    }
    await client.query(
      "UPDATE wallets SET balance = balance + $1, updated_at = now() WHERE user_id = $2",
      [delta, u.id],
    );
    const txRes = await client.query(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4) RETURNING id, type, amount, description, created_at",
      [u.id, body.type, Math.floor(body.amount), body.description ?? null],
    );
    await client.query("COMMIT");
    const tx = txRes.rows[0];
    return c.json({
      transaction: { ...tx, amount: Number(tx.amount) },
      balance: balance + delta,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return c.json({ error: "transaction failed" }, 500);
  } finally {
    client.release();
  }
});

export default app;
