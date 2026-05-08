import { Hono } from 'hono';
import { one, query, pool } from '../db.js';
import { requireAuth } from '../auth.js';

const app = new Hono();

app.use('*', requireAuth);

interface GamePiece {
  id: number;
  position: number;
  color: string;
  isFinished: boolean;
}

interface GamePlayer {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  avatarUrl?: string | null;
  pieces: GamePiece[];
}

interface GameState {
  players: GamePlayer[];
  currentPlayerIndex: number;
  diceValue: number | null;
  isRolling: boolean;
  winner: string | null;
  turnTimer: number;
  consecutiveSixes: number;
  phase: 'rolling' | 'moving' | 'finished';
}

function buildInitialState(
  players: Array<{ id: string; name: string; color: string; isBot: boolean; avatarUrl?: string | null }>,
): GameState {
  return {
    players: players.map((p) => ({
      ...p,
      pieces: Array.from({ length: 4 }, (_, i) => ({
        id: i,
        position: -1,
        color: p.color,
        isFinished: false,
      })),
    })),
    currentPlayerIndex: 0,
    diceValue: null,
    isRolling: false,
    winner: null,
    turnTimer: 30,
    consecutiveSixes: 0,
    phase: 'rolling',
  };
}

// Start a game for a room (host only). Atomically: create game + set room status.
app.post('/start/:roomId', async (c) => {
  const u = c.get('user');
  const roomId = c.req.param('roomId');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roomRes = await client.query<any>(
      'SELECT * FROM rooms WHERE id = $1 FOR UPDATE',
      [roomId],
    );
    const room = roomRes.rows[0];
    if (!room) {
      await client.query('ROLLBACK');
      return c.json({ error: 'room not found' }, 404);
    }
    if (room.host_id !== u.id) {
      await client.query('ROLLBACK');
      return c.json({ error: 'only host can start' }, 403);
    }

    // Already started? return existing
    const existing = await client.query<any>(
      'SELECT * FROM games WHERE room_id = $1',
      [roomId],
    );
    if (existing.rows[0]) {
      await client.query('COMMIT');
      const g = existing.rows[0];
      return c.json({ game: { ...g, state: g.state } });
    }

    const playersRes = await client.query<any>(
      'SELECT * FROM room_players WHERE room_id = $1 ORDER BY player_index',
      [roomId],
    );
    if (playersRes.rows.length < 2) {
      await client.query('ROLLBACK');
      return c.json({ error: 'need at least 2 players' }, 400);
    }

    // Resolve human profile names + avatar URLs
    const humanIds = playersRes.rows
      .filter((p: any) => !p.is_bot && p.user_id)
      .map((p: any) => p.user_id);
    let nameMap: Record<string, string> = {};
    let avatarMap: Record<string, string | null> = {};
    if (humanIds.length > 0) {
      const profRes = await client.query<{ id: string; display_name: string; avatar_url: string | null }>(
        'SELECT id, display_name, avatar_url FROM profiles WHERE id = ANY($1::uuid[])',
        [humanIds],
      );
      profRes.rows.forEach((p) => {
        nameMap[p.id] = p.display_name;
        avatarMap[p.id] = p.avatar_url;
      });
    }

    const gamePlayers = playersRes.rows.map((p: any) => ({
      id: p.is_bot ? `bot-${p.id}` : p.user_id,
      name: p.is_bot
        ? p.bot_name || 'Bot'
        : nameMap[p.user_id] || 'Jogador',
      color: p.color,
      isBot: p.is_bot,
      avatarUrl: p.is_bot ? null : avatarMap[p.user_id] || null,
    }));

    const initialState = buildInitialState(gamePlayers);

    const gameRes = await client.query<any>(
      `INSERT INTO games (room_id, host_id, state, version) VALUES ($1, $2, $3::jsonb, 1) RETURNING *`,
      [roomId, u.id, JSON.stringify(initialState)],
    );
    await client.query("UPDATE rooms SET status = 'playing' WHERE id = $1", [
      roomId,
    ]);
    await client.query('COMMIT');
    return c.json({ game: gameRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return c.json({ error: 'start failed' }, 500);
  } finally {
    client.release();
  }
});

app.get('/by-room/:roomId', async (c) => {
  const game = await one<any>('SELECT * FROM games WHERE room_id = $1', [
    c.req.param('roomId'),
  ]);
  if (!game) return c.json({ error: 'no game' }, 404);
  return c.json({ game });
});

app.get('/:id', async (c) => {
  const game = await one<any>('SELECT * FROM games WHERE id = $1', [
    c.req.param('id'),
  ]);
  if (!game) return c.json({ error: 'not found' }, 404);
  return c.json({ game });
});

// Apply a state update. Server-side checks: only player whose turn it is (or
// the host, who controls bots' turns) can push. Uses optimistic concurrency
// via `version` to avoid lost updates.
app.patch('/:id', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json<{ state: GameState; baseVersion: number }>();
  if (!body.state || typeof body.baseVersion !== 'number') {
    return c.json({ error: 'bad input' }, 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<{
      host_id: string;
      state: GameState;
      version: number;
    }>('SELECT host_id, state, version FROM games WHERE id = $1 FOR UPDATE', [
      id,
    ]);
    const game = cur.rows[0];
    if (!game) {
      await client.query('ROLLBACK');
      return c.json({ error: 'not found' }, 404);
    }
    if (game.version !== body.baseVersion) {
      await client.query('ROLLBACK');
      return c.json(
        { error: 'version conflict', currentVersion: game.version },
        409,
      );
    }

    const cur_state = game.state;
    const currentPlayer = cur_state.players[cur_state.currentPlayerIndex];
    const isHost = game.host_id === u.id;
    const isCurrentPlayer = currentPlayer && currentPlayer.id === u.id;
    const isBotTurn = currentPlayer?.isBot;

    // Only the player whose turn it is OR the host (for bot turns or timeouts) can push
    if (!isCurrentPlayer && !isHost) {
      await client.query('ROLLBACK');
      return c.json({ error: 'not your turn' }, 403);
    }
    // Bots: only host applies
    if (isBotTurn && !isHost) {
      await client.query('ROLLBACK');
      return c.json({ error: 'bot turn — host only' }, 403);
    }

    const updated = await client.query<any>(
      `UPDATE games SET state = $1::jsonb, version = version + 1, updated_at = now() WHERE id = $2 RETURNING *`,
      [JSON.stringify(body.state), id],
    );
    await client.query('COMMIT');
    return c.json({ game: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return c.json({ error: 'update failed' }, 500);
  } finally {
    client.release();
  }
});

// --- Chat ---
app.get('/:id/chat', async (c) => {
  const rows = await query<any>(
    `SELECT id, user_id, author_name, color, text, gift_emoji, gift_name, gift_price,
            gift_to_name, gift_to_color, created_at
     FROM chat_messages WHERE game_id = $1 ORDER BY created_at ASC LIMIT 200`,
    [c.req.param('id')],
  );
  return c.json({
    messages: rows.map((r: any) => ({
      ...r,
      gift_price: r.gift_price === null ? null : Number(r.gift_price),
    })),
  });
});

app.post('/:id/chat', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json<{
    text?: string;
    color: string;
    author_name: string;
    gift?: {
      emoji: string;
      name: string;
      price: number;
      toName: string;
      toColor: string;
    };
  }>();

  // Verify the user is part of the game
  const game = await one<{ state: any }>(
    'SELECT state FROM games WHERE id = $1',
    [id],
  );
  if (!game) return c.json({ error: 'game not found' }, 404);
  const inGame = game.state.players.some((p: any) => p.id === u.id);
  if (!inGame) return c.json({ error: 'not in this game' }, 403);

  if (!body.gift && !body.text?.trim()) {
    return c.json({ error: 'empty message' }, 400);
  }

  const inserted = await one<any>(
    `INSERT INTO chat_messages
       (game_id, user_id, author_name, color, text,
        gift_emoji, gift_name, gift_price, gift_to_name, gift_to_color)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, user_id, author_name, color, text,
               gift_emoji, gift_name, gift_price, gift_to_name, gift_to_color, created_at`,
    [
      id,
      u.id,
      body.author_name,
      body.color,
      body.text ?? null,
      body.gift?.emoji ?? null,
      body.gift?.name ?? null,
      body.gift?.price ?? null,
      body.gift?.toName ?? null,
      body.gift?.toColor ?? null,
    ],
  );
  return c.json({
    message: {
      ...inserted,
      gift_price: inserted?.gift_price === null ? null : Number(inserted?.gift_price),
    },
  });
});

export default app;
