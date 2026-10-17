import { Hono, type Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
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

// Rate limiting em memória, janela de 15min: máx 5 tentativas por TELEFONE
// (qualquer IP — a senha é um PIN de 6 dígitos, por isso o limite por conta
// é o que impede força bruta) e máx 30 por IP (impede varrer muitas contas).
// ponytail: em memória — numa só instância chega; multi-instância → Redis/PG.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const PHONE_MAX_ATTEMPTS = 5;
const IP_MAX_ATTEMPTS = 30;
const attempts = new Map<string, { count: number; windowStart: number }>();

function rateLimited(key: string, max: number): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > max;
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

// X-Forwarded-For só é fiável atrás de um proxy nosso (nginx/Caddy) —
// exposto directamente, o cliente põe lá o que quiser e fugia ao limite.
function clientIp(c: Context): string {
  if (process.env.TRUST_PROXY === "true") {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  return getConnInfo(c).remote.address || "unknown";
}

function limited(c: Context, phone: string): boolean {
  // Avalia os dois (sem curto-circuito) para ambos contarem a tentativa
  const byPhone = rateLimited(`phone:${phone}`, PHONE_MAX_ATTEMPTS);
  const byIp = rateLimited(`ip:${clientIp(c)}`, IP_MAX_ATTEMPTS);
  return byPhone || byIp;
}

app.post("/signup", async (c) => {
  const body = await c.req.json<{ phone?: string; password?: string }>();
  const phone = normalizePhone(body.phone || "");
  const password = body.password || "";
  if (phone.length < 7) return c.json({ error: "invalid phone" }, 400);
  if (!/^\d{6}$/.test(password)) {
    return c.json({ error: "password must be exactly 6 digits" }, 400);
  }
  if (limited(c, phone)) {
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
  if (limited(c, phone)) {
    return c.json({ error: "too many attempts, try again later" }, 429);
  }
  const user = await one<{
    id: string;
    phone: string;
    password_hash: string;
    token_version: number;
  }>("SELECT id, phone, password_hash, token_version FROM users WHERE phone = $1", [phone]);
  if (!user) return c.json({ error: "invalid credentials" }, 401);
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return c.json({ error: "invalid credentials" }, 401);
  clearAttempts(`phone:${phone}`);
  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
  const token = signToken({ id: user.id, phone: user.phone, tokenVersion: user.token_version });
  return c.json({ token, user: { id: user.id, phone: user.phone } });
});

app.get("/me", requireAuth, async (c) => {
  const u = c.get("user");
  return c.json({ user: { id: u.id, phone: u.phone } });
});

// Logout no servidor: invalida TODOS os tokens deste utilizador (todos os
// dispositivos). Antes o token continuava válido 30 dias após sair.
app.post("/logout", requireAuth, async (c) => {
  await query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [
    c.get("user").id,
  ]);
  return c.json({ ok: true });
});

// Token curto (5min) para abrir o EventSource sem expor o token principal no URL
app.post("/realtime-token", requireAuth, async (c) => {
  const u = c.get("user");
  return c.json({ token: signRealtimeToken(u) });
});

export default app;
