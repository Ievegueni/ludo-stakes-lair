import { Hono } from 'hono';
import { z } from 'zod';
import { one, query } from '../db.js';
import { requireAuth } from '../auth.js';

/**
 * Endpoints de denúncias do JOGO.
 *
 *   POST /api/reports         — autenticado, submete denúncia
 *   GET  /api/reports/mine    — autenticado, lista as próprias denúncias
 *
 * Anti-abuso:
 *   - Não pode denunciar-se a si próprio (constraint em DB também)
 *   - O reportedId tem de existir
 *   - O gameId opcional tem de pertencer ao reporter (ou ao reported)
 *   - Cooldown: máximo 3 denúncias por hora por reporter (rate limit em memória)
 *   - Unique partial index na DB impede duplicados pendentes para o mesmo par
 */

const CATEGORIES = ['cheating', 'abuse', 'spam', 'harassment', 'other'] as const;

const submitSchema = z.object({
  reportedId: z.string().uuid(),
  gameId: z.string().uuid().optional(),
  category: z.enum(CATEGORIES),
  reason: z.string().min(3).max(1000),
});

// Rate limiter em memória — suficiente para um único processo. Se um dia
// houver multi-instance, mover para Redis (igual ao backoffice).
const recentReports = new Map<string, number[]>(); // reporterId → timestamps (ms)
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1h
const RATE_MAX = 3;

function checkRate(reporterId: string): boolean {
  const now = Date.now();
  const arr = recentReports.get(reporterId)?.filter((t) => now - t < RATE_WINDOW_MS) ?? [];
  if (arr.length >= RATE_MAX) {
    recentReports.set(reporterId, arr);
    return false;
  }
  arr.push(now);
  recentReports.set(reporterId, arr);
  return true;
}

const reportsRoutes = new Hono();

reportsRoutes.post('/', requireAuth, async (c) => {
  const reporter = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid input', details: parsed.error.flatten() }, 400);
  }
  const { reportedId, gameId, category, reason } = parsed.data;

  if (reportedId === reporter.id) {
    return c.json({ error: 'cannot report self' }, 400);
  }

  // Rate limit
  if (!checkRate(reporter.id)) {
    return c.json(
      { error: 'rate limited', message: 'Limite de denúncias por hora atingido.' },
      429,
    );
  }

  // Existência do reportedId
  const reported = await one<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [reportedId]);
  if (!reported) {
    return c.json({ error: 'reported user not found' }, 404);
  }

  // Se gameId, valida que reporter ou reportedId esteve nessa sala
  if (gameId) {
    const ok = await one<{ id: string }>(
      `SELECT g.id FROM games g
       JOIN room_players rp ON rp.room_id = g.room_id
       WHERE g.id = $1 AND rp.user_id IN ($2, $3)
       LIMIT 1`,
      [gameId, reporter.id, reportedId],
    );
    if (!ok) {
      return c.json({ error: 'game not associated with parties' }, 400);
    }
  }

  try {
    const inserted = await one<{ id: string; created_at: string }>(
      `INSERT INTO reports (reporter_id, reported_id, game_id, category, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [reporter.id, reportedId, gameId ?? null, category, reason],
    );
    return c.json({ ok: true, id: inserted!.id, createdAt: inserted!.created_at });
  } catch (err) {
    const msg = (err as Error).message;
    if (/idx_reports_unique_pending|duplicate key/.test(msg)) {
      return c.json(
        { error: 'duplicate', message: 'Já tens uma denúncia pendente contra este jogador.' },
        409,
      );
    }
    if (/reports_no_self/.test(msg)) {
      return c.json({ error: 'cannot report self' }, 400);
    }
    throw err;
  }
});

reportsRoutes.get('/mine', requireAuth, async (c) => {
  const me = c.get('user');
  const rows = await query<{
    id: string;
    reported_id: string;
    category: string;
    reason: string;
    status: string;
    created_at: string;
  }>(
    `SELECT id, reported_id, category, reason, status, created_at
     FROM reports
     WHERE reporter_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [me.id],
  );
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      reportedId: r.reported_id,
      category: r.category,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
    })),
  });
});

export default reportsRoutes;
