import { Hono } from "hono";
import { one, query } from "../db.js";
import {
  hashPassword,
  signToken,
  signRealtimeToken,
  verifyPassword,
  requireAuth,
} from "../auth.js";

const app = new Hono();

const normalizePhone = (raw: string) => raw.replace(/\D/g, "");

// Rate limiting em memória por telefone+IP: máx 5 tentativas por janela de 15min.
// Suficiente para uma instância única; para multi-instância mover para Redis/PG.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; windowStart: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_MAX_ATTEMPTS;
}

function clearAttempts(key: string) {
  attempts.delete(key);
}

// Limpeza periódica para não crescer indefinidamente
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now - entry.windowStart > RATE_WINDOW_MS) attempts.delete(key);
  }
}, RATE_WINDOW_MS).unref?.();

function clientKey(c: { req: { header: (n: string) => string | undefined } }, phone: string) {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";
  return `${phone}:${ip}`;
}

app.post("/signup", async (c) => {
  const body = await c.req.json<{ phone?: string; password?: string }>();
  const phone = normalizePhone(body.phone || "");
  const password = body.password || "";
  if (phone.length < 7) return c.json({ error: "invalid phone" }, 400);
  if (!/^\d{6}$/.test(password)) {
    return c.json({ error: "password must be exactly 6 digits" }, 400);
  }
  if (rateLimited(clientKey(c, phone))) {
    return c.json({ error: "too many attempts, try again later" }, 429);
  }
  const existing = await one("SELECT id FROM users WHERE phone = $1", [phone]);
  if (existing) return c.json({ error: "phone already registered" }, 409);

  const hash = await hashPassword(password);
  const user = await one<{ id: string; phone: string }>(
    "INSERT INTO users (phone, password_hash) VALUES ($1, $2) RETURNING id, phone",
    [phone, hash],
  );
  if (!user) return c.json({ error: "create failed" }, 500);
  const token = signToken({ id: user.id, phone: user.phone });
  return c.json({ token, user });
});

app.post("/signin", async (c) => {
  const body = await c.req.json<{ phone?: string; password?: string }>();
  const phone = normalizePhone(body.phone || "");
  const password = body.password || "";
  const key = clientKey(c, phone);
  if (rateLimited(key)) {
    return c.json({ error: "too many attempts, try again later" }, 429);
  }
  const user = await one<{
    id: string;
    phone: string;
    password_hash: string;
  }>("SELECT id, phone, password_hash FROM users WHERE phone = $1", [phone]);
  if (!user) return c.json({ error: "invalid credentials" }, 401);
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return c.json({ error: "invalid credentials" }, 401);
  clearAttempts(key);
  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
  const token = signToken({ id: user.id, phone: user.phone });
  return c.json({ token, user: { id: user.id, phone: user.phone } });
});

app.get("/me", requireAuth, async (c) => {
  const u = c.get("user");
  return c.json({ user: u });
});

// Token curto (5min) para abrir o EventSource sem expor o token principal no URL
app.post("/realtime-token", requireAuth, async (c) => {
  const u = c.get("user");
  return c.json({ token: signRealtimeToken(u) });
});

export default app;
