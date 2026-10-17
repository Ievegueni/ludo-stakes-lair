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

// Depósito SIMULADO — não há gateway de pagamento ainda. Créditos (win,
// refund, bet) são exclusivos do servidor; o cliente só pode pedir um
// depósito fictício, e só fora de produção ou com ALLOW_FAKE_DEPOSITS=true.
// Gifts têm endpoint próprio (/api/games/:id/gift).
const fakeDepositsAllowed =
  process.env.NODE_ENV !== "production" || process.env.ALLOW_FAKE_DEPOSITS === "true";
const MAX_TX_AMOUNT = 10_000_000; // 10M Kz

app.post("/transactions", async (c) => {
  const u = c.get("user");
  const body = await c.req.json<{ type?: string; amount?: number; description?: string }>();
  if (body.type !== "deposit") return c.json({ error: "bad type" }, 400);
  if (!fakeDepositsAllowed) return c.json({ error: "deposits disabled" }, 403);
  const amount = Math.floor(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_TX_AMOUNT) {
    return c.json({ error: "bad amount" }, 400);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const wallet = await client.query<{ balance: string }>(
      "UPDATE wallets SET balance = balance + $1, updated_at = now() WHERE user_id = $2 RETURNING balance",
      [amount, u.id],
    );
    const txRes = await client.query(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'deposit', $2, $3) RETURNING id, type, amount, description, created_at",
      [u.id, amount, `Depósito simulado de ${amount.toLocaleString()} Kz`],
    );
    await client.query("COMMIT");
    const tx = txRes.rows[0];
    return c.json({
      transaction: { ...tx, amount: Number(tx.amount) },
      balance: Number(wallet.rows[0]?.balance ?? 0),
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
