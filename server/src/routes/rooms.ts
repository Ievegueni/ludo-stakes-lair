import { Hono } from 'hono';
import { one, query } from '../db.js';
import { requireAuth } from '../auth.js';

const app = new Hono();

app.use('*', requireAuth);

const COLORS = ['red', 'blue', 'green', 'yellow'] as const;

async function loadRoomWithPlayers(id: string) {
  const room = await one<any>('SELECT * FROM rooms WHERE id = $1', [id]);
  if (!room) return null;
  const players = await query<any>(
    'SELECT * FROM room_players WHERE room_id = $1 ORDER BY player_index',
    [id],
  );
  return { ...room, players };
}

app.get('/', async (c) => {
  const status = c.req.query('status') || 'waiting';
  const rooms = await query<any>(
    'SELECT * FROM rooms WHERE status = $1 ORDER BY created_at DESC',
    [status],
  );
  if (rooms.length === 0) return c.json({ rooms: [] });
  const ids = rooms.map((r: any) => r.id);
  const players = await query<any>(
    'SELECT * FROM room_players WHERE room_id = ANY($1::uuid[]) ORDER BY player_index',
    [ids],
  );
  const byRoom: Record<string, any[]> = {};
  for (const p of players) {
    (byRoom[p.room_id] ||= []).push(p);
  }
  return c.json({
    rooms: rooms.map((r: any) => ({ ...r, players: byRoom[r.id] || [] })),
  });
});

app.post('/', async (c) => {
  const u = c.get('user');
  const body = await c.req.json<{ bet_amount?: number }>();
  const bet = Math.floor(body.bet_amount ?? 100);
  if (bet <= 0) return c.json({ error: 'bad bet_amount' }, 400);
  const room = await one<any>(
    'INSERT INTO rooms (host_id, bet_amount) VALUES ($1, $2) RETURNING *',
    [u.id, bet],
  );
  if (!room) return c.json({ error: 'create failed' }, 500);
  await query(
    'INSERT INTO room_players (room_id, user_id, player_index, color, is_bot) VALUES ($1, $2, 0, $3, false)',
    [room.id, u.id, 'red'],
  );
  const full = await loadRoomWithPlayers(room.id);
  return c.json({ room: full });
});

app.get('/by-code/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const room = await one<any>(
    "SELECT * FROM rooms WHERE code = $1 AND status = 'waiting'",
    [code],
  );
  if (!room) return c.json({ error: 'not found' }, 404);
  const full = await loadRoomWithPlayers(room.id);
  return c.json({ room: full });
});

app.get('/:id', async (c) => {
  const full = await loadRoomWithPlayers(c.req.param('id'));
  if (!full) return c.json({ error: 'not found' }, 404);
  return c.json({ room: full });
});

app.patch('/:id', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json<{ status?: string }>();
  const room = await one<{ host_id: string }>(
    'SELECT host_id FROM rooms WHERE id = $1',
    [id],
  );
  if (!room) return c.json({ error: 'not found' }, 404);
  if (room.host_id !== u.id) return c.json({ error: 'forbidden' }, 403);
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (body.status && ['waiting', 'playing', 'finished'].includes(body.status)) {
    fields.push(`status = $${i++}`);
    values.push(body.status);
  }
  if (fields.length === 0) return c.json({ error: 'nothing to update' }, 400);
  values.push(id);
  const updated = await one(
    `UPDATE rooms SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );
  return c.json({ room: updated });
});

app.post('/:id/join', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const full = await loadRoomWithPlayers(id);
  if (!full) return c.json({ error: 'not found' }, 404);
  if (full.players.some((p: any) => p.user_id === u.id)) {
    return c.json({ room: full });
  }
  if (full.players.length >= full.max_players) {
    return c.json({ error: 'room full' }, 400);
  }
  const usedColors = new Set(full.players.map((p: any) => p.color));
  const usedIndices = new Set(full.players.map((p: any) => p.player_index));
  const color = COLORS.find((c) => !usedColors.has(c));
  const idx = [0, 1, 2, 3].find((i) => !usedIndices.has(i));
  if (!color || idx === undefined) {
    return c.json({ error: 'room full' }, 400);
  }
  await query(
    'INSERT INTO room_players (room_id, user_id, player_index, color, is_bot) VALUES ($1, $2, $3, $4, false)',
    [id, u.id, idx, color],
  );
  const updated = await loadRoomWithPlayers(id);
  return c.json({ room: updated });
});

app.post('/:id/bots', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json<{ bot_name?: string }>();
  const full = await loadRoomWithPlayers(id);
  if (!full) return c.json({ error: 'not found' }, 404);
  if (full.host_id !== u.id) return c.json({ error: 'forbidden' }, 403);
  if (full.players.length >= full.max_players) {
    return c.json({ error: 'room full' }, 400);
  }
  const usedColors = new Set(full.players.map((p: any) => p.color));
  const usedIndices = new Set(full.players.map((p: any) => p.player_index));
  const color = COLORS.find((c) => !usedColors.has(c));
  const idx = [0, 1, 2, 3].find((i) => !usedIndices.has(i));
  if (!color || idx === undefined) {
    return c.json({ error: 'room full' }, 400);
  }
  await query(
    'INSERT INTO room_players (room_id, user_id, player_index, color, is_bot, bot_name, is_ready) VALUES ($1, NULL, $2, $3, true, $4, true)',
    [id, idx, color, body.bot_name || 'Bot'],
  );
  const updated = await loadRoomWithPlayers(id);
  return c.json({ room: updated });
});

app.post('/:id/leave', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  await query(
    'DELETE FROM room_players WHERE room_id = $1 AND user_id = $2',
    [id, u.id],
  );
  return c.json({ ok: true });
});

export default app;
