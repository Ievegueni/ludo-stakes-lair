import { Hono } from 'hono';
import { one, query } from '../db.js';
import {
  hashPassword,
  signToken,
  verifyPassword,
  requireAuth,
} from '../auth.js';

const app = new Hono();

const normalizePhone = (raw: string) => raw.replace(/\D/g, '');

app.post('/signup', async (c) => {
  const body = await c.req.json<{ phone?: string; password?: string }>();
  const phone = normalizePhone(body.phone || '');
  const password = body.password || '';
  if (phone.length < 7) return c.json({ error: 'invalid phone' }, 400);
  if (password.length < 4 || password.length > 64) {
    return c.json({ error: 'invalid password' }, 400);
  }
  const existing = await one('SELECT id FROM users WHERE phone = $1', [phone]);
  if (existing) return c.json({ error: 'phone already registered' }, 409);

  const hash = await hashPassword(password);
  const user = await one<{ id: string; phone: string }>(
    'INSERT INTO users (phone, password_hash) VALUES ($1, $2) RETURNING id, phone',
    [phone, hash],
  );
  if (!user) return c.json({ error: 'create failed' }, 500);
  const token = signToken({ id: user.id, phone: user.phone });
  return c.json({ token, user });
});

app.post('/signin', async (c) => {
  const body = await c.req.json<{ phone?: string; password?: string }>();
  const phone = normalizePhone(body.phone || '');
  const password = body.password || '';
  const user = await one<{
    id: string;
    phone: string;
    password_hash: string;
  }>('SELECT id, phone, password_hash FROM users WHERE phone = $1', [phone]);
  if (!user) return c.json({ error: 'invalid credentials' }, 401);
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return c.json({ error: 'invalid credentials' }, 401);
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const token = signToken({ id: user.id, phone: user.phone });
  return c.json({ token, user: { id: user.id, phone: user.phone } });
});

app.get('/me', requireAuth, async (c) => {
  const u = c.get('user');
  return c.json({ user: u });
});

export default app;
