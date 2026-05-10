import { Hono } from 'hono';
import { one, query, pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { chargeBet, InsufficientBalanceError } from '../lib/wallet.js';

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

/**
 * Determina o "bot driver" — o cliente humano responsável por avançar a
 * vez de bots e timeouts. Algoritmo determinístico: primeiro humano
 * não-bot e não-resigned na ordem do array. Todos os clientes calculam
 * a mesma resposta a partir do mesmo `state`.
 *
 * Se o host original sai/desiste, o seguinte humano herda automaticamente
 * o papel de bot driver — sem necessidade de reeleição.
 */
function getBotDriverId(state: GameState): string | null {
  const humans = state.players.filter(
    (p: any) => !p.isBot && !p.resigned && !!p.id,
  );
  return humans.length > 0 ? humans[0].id : null;
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

    // Safeguard: nenhum jogo arranca sem TODOS os humanos terem pago.
    // Se algum tiver `bet_paid=false` (sala legacy ou bug histórico),
    // tenta fazer backfill da cobrança AGORA. Se algum não tiver saldo,
    // recusa o start com erro detalhado (o host vê quem falhou).
    const unpaidHumans = playersRes.rows.filter(
      (p: any) => !p.is_bot && p.user_id && !p.bet_paid,
    );
    if (unpaidHumans.length > 0) {
      console.warn(
        `[games.start] ${unpaidHumans.length} unpaid players in room ${room.code} — attempting backfill`,
      );
      for (const p of unpaidHumans) {
        try {
          await chargeBet(
            client,
            p.user_id,
            roomId,
            Number(room.bet_amount),
            `Aposta na sala ${room.code} (backfill no start)`,
          );
        } catch (err) {
          await client.query('ROLLBACK');
          if (err instanceof InsufficientBalanceError) {
            return c.json(
              {
                error: 'unpaid players',
                message:
                  'Um ou mais jogadores não têm saldo suficiente para a aposta. O jogo não pode iniciar.',
                userId: p.user_id,
                required: err.required,
                available: err.available,
              },
              400,
            );
          }
          console.error('[games.start] backfill chargeBet failed:', err);
          return c.json({ error: 'start failed' }, 500);
        }
      }
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

/**
 * Devolve o jogo em curso onde o utilizador está como jogador, se existir.
 * Usado para re-entrar num jogo após reload/disconnect.
 */
app.get('/active', async (c) => {
  const u = c.get('user');
  // Filtros adicionais via JSON do state:
  //  - winner deve ser NULL (jogo não terminado)
  //  - este utilizador NÃO pode estar marcado como resigned no array de players
  const game = await one<any>(
    `SELECT g.* FROM games g
     INNER JOIN rooms r ON r.id = g.room_id
     INNER JOIN room_players rp ON rp.room_id = r.id
     WHERE r.status = 'playing'
       AND g.settled = false
       AND rp.user_id = $1
       AND COALESCE(g.state->>'winner', '') = ''
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(g.state->'players') AS p
         WHERE p->>'id' = $1::text AND (p->>'resigned')::boolean = true
       )
     ORDER BY g.created_at DESC
     LIMIT 1`,
    [u.id],
  );
  if (!game) return c.json({ game: null });
  return c.json({ game });
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
//
// Settle automático: se o estado novo introduz um `winner` que ainda não tinha
// sido contabilizado, o servidor credita o prémio (pot × 0.95) ao vencedor
// humano. Se o vencedor é bot, todo o pot vai para a casa (rake total).
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
      room_id: string;
      settled: boolean;
    }>(
      'SELECT host_id, state, version, room_id, settled FROM games WHERE id = $1 FOR UPDATE',
      [id],
    );
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
    const driverId = getBotDriverId(cur_state);
    const isDriver = driverId === u.id;
    const isCurrentPlayer = currentPlayer && currentPlayer.id === u.id;
    const isBotTurn = currentPlayer?.isBot;

    // Pode empurrar:
    //  - O jogador da vez (jogada própria)
    //  - O bot driver (vez de bot ou timeout)
    if (!isCurrentPlayer && !isDriver) {
      await client.query('ROLLBACK');
      return c.json({ error: 'not your turn' }, 403);
    }
    if (isBotTurn && !isDriver) {
      await client.query('ROLLBACK');
      return c.json({ error: 'bot turn — driver only' }, 403);
    }

    // Detectar transição para vencedor (settle uma única vez)
    const wasFinished = !!cur_state.winner;
    const isFinished = !!body.state.winner;
    const justFinished = !wasFinished && isFinished && !game.settled;

    const updated = await client.query<any>(
      `UPDATE games SET state = $1::jsonb, version = version + 1, updated_at = now() WHERE id = $2 RETURNING *`,
      [JSON.stringify(body.state), id],
    );

    if (justFinished) {
      // Calcular pot: soma das apostas pagas (apenas humanos pagam)
      const roomRes = await client.query<{ bet_amount: string }>(
        'SELECT bet_amount FROM rooms WHERE id = $1',
        [game.room_id],
      );
      const betAmount = Number(roomRes.rows[0]?.bet_amount ?? 0);
      const paidRes = await client.query<{ user_id: string }>(
        'SELECT user_id FROM room_players WHERE room_id = $1 AND bet_paid = true AND user_id IS NOT NULL',
        [game.room_id],
      );
      const paidUserIds = paidRes.rows.map((r) => r.user_id);
      const pot = betAmount * paidUserIds.length;
      const prize = Math.floor(pot * 0.95);

      const winnerId = body.state.winner!;
      const winnerPlayer = body.state.players.find((p) => p.id === winnerId);
      const winnerIsBot = !!winnerPlayer?.isBot;

      // Creditar ao vencedor humano (se aplicável)
      if (!winnerIsBot && paidUserIds.includes(winnerId) && prize > 0) {
        await client.query(
          'UPDATE wallets SET balance = balance + $1, updated_at = now() WHERE user_id = $2',
          [prize, winnerId],
        );
        await client.query(
          'INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)',
          [winnerId, 'win', prize, `Vitória — prémio de ${prize.toLocaleString()} Kz`],
        );
      }

      await client.query(
        `UPDATE games SET settled = true, settled_at = now(), winner_user_id = $1, prize = $2 WHERE id = $3`,
        [winnerIsBot ? null : winnerId, prize, id],
      );
      // Marca a sala como finished
      await client.query(
        "UPDATE rooms SET status = 'finished' WHERE id = $1",
        [game.room_id],
      );
    }

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
