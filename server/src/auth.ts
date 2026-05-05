import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Context, Next } from 'hono';
import { one } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me-in-prod';
const TOKEN_TTL = '30d';

export interface AuthUser {
  id: string;
  phone: string;
}

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export function signToken(user: AuthUser) {
  return jwt.sign({ sub: user.id, phone: user.phone }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      sub: string;
      phone: string;
    };
    return { id: decoded.sub, phone: decoded.phone };
  } catch {
    return null;
  }
}

export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header('Authorization');
  let token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) token = c.req.query('token');
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const user = verifyToken(token);
  if (!user) return c.json({ error: 'invalid token' }, 401);
  const dbUser = await one<{ id: string; phone: string }>(
    'SELECT id, phone FROM users WHERE id = $1',
    [user.id],
  );
  if (!dbUser) return c.json({ error: 'user not found' }, 401);
  c.set('user', dbUser);
  await next();
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}
