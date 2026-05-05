import { Hono } from 'hono';
import { one, query } from '../db.js';
import { requireAuth } from '../auth.js';

const app = new Hono();

app.use('*', requireAuth);

app.get('/me', async (c) => {
  const u = c.get('user');
  const profile = await one(
    'SELECT id, phone, display_name, avatar_url, created_at FROM profiles WHERE id = $1',
    [u.id],
  );
  return c.json({ profile });
});

app.patch('/me', async (c) => {
  const u = c.get('user');
  const body = await c.req.json<{
    display_name?: string;
    avatar_url?: string | null;
  }>();
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (typeof body.display_name === 'string') {
    fields.push(`display_name = $${i++}`);
    values.push(body.display_name.trim());
  }
  if (typeof body.avatar_url !== 'undefined') {
    fields.push(`avatar_url = $${i++}`);
    values.push(body.avatar_url);
  }
  if (fields.length === 0) return c.json({ error: 'nothing to update' }, 400);
  values.push(u.id);
  const profile = await one(
    `UPDATE profiles SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, phone, display_name, avatar_url, created_at`,
    values,
  );
  return c.json({ profile });
});

app.get('/', async (c) => {
  const idsParam = c.req.query('ids') || '';
  const ids = idsParam.split(',').filter(Boolean);
  if (ids.length === 0) return c.json({ profiles: [] });
  const rows = await query(
    'SELECT id, display_name, avatar_url FROM profiles WHERE id = ANY($1::uuid[])',
    [ids],
  );
  return c.json({ profiles: rows });
});

export default app;
