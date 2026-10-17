import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Context, Next } from "hono";
import { one } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me-in-prod";
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("[nanter-api] JWT_SECRET is required in production");
}
const TOKEN_TTL = "30d";

export interface AuthUser {
  id: string;
  phone: string;
  /** Incrementado no logout — invalida todos os tokens emitidos antes. */
  tokenVersion?: number;
}

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export function signToken(user: AuthUser) {
  return jwt.sign({ sub: user.id, phone: user.phone, tv: user.tokenVersion ?? 0 }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      sub: string;
      phone: string;
      tv?: number;
      scope?: string;
    };
    if (decoded.scope) return null; // token de realtime não serve para a API
    return { id: decoded.sub, phone: decoded.phone, tokenVersion: decoded.tv ?? 0 };
  } catch {
    return null;
  }
}

// Token efémero só para o EventSource do realtime. Vai no URL (o EventSource
// não suporta headers), por isso tem TTL curto e scope próprio — o token
// principal de 30 dias nunca aparece em logs/histórico do browser.
export function signRealtimeToken(user: AuthUser) {
  return jwt.sign({ sub: user.id, phone: user.phone, scope: "realtime" }, JWT_SECRET, {
    expiresIn: "5m",
  });
}

export function verifyRealtimeToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      sub: string;
      phone: string;
      scope?: string;
    };
    if (decoded.scope !== "realtime") return null;
    return { id: decoded.sub, phone: decoded.phone };
  } catch {
    return null;
  }
}

export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const user = verifyToken(token);
  if (!user) return c.json({ error: "invalid token" }, 401);
  const dbUser = await one<{
    id: string;
    phone: string;
    token_version: number;
    suspended_at: Date | null;
  }>("SELECT id, phone, token_version, suspended_at FROM users WHERE id = $1", [user.id]);
  if (!dbUser) return c.json({ error: "user not found" }, 401);
  if (dbUser.token_version !== user.tokenVersion) return c.json({ error: "invalid token" }, 401);
  if (dbUser.suspended_at) return c.json({ error: "account suspended" }, 401);
  c.set("user", { id: dbUser.id, phone: dbUser.phone, tokenVersion: dbUser.token_version });
  await next();
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}
