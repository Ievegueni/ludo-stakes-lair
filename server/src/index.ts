import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { runMigrations } from './migrate.js';
import { startRealtime, realtimeHandler } from './realtime.js';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profiles.js';
import walletRoutes from './routes/wallet.js';
import roomRoutes from './routes/rooms.js';
import gameRoutes from './routes/games.js';

const app = new Hono();

app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'] }));

app.get('/api/health', (c) => c.json({ ok: true }));

app.route('/api/auth', authRoutes);
app.route('/api/profiles', profileRoutes);
app.route('/api/wallet', walletRoutes);
app.route('/api/rooms', roomRoutes);
app.route('/api/games', gameRoutes);

app.get('/api/realtime', realtimeHandler);

// In production, serve static assets and SSR via TanStack Start
if (process.env.NODE_ENV === 'production') {
  // 1) Hashed assets (Vite build output)
  app.use('/assets/*', serveStatic({ root: './dist/client' }));

  // 2) Public files copied verbatim by Vite (background.png, sounds/, animations/, favicon, etc.)
  //    serveStatic só serve se o ficheiro existir; senão passa para o handler seguinte.
  app.use('/*', serveStatic({ root: './dist/client' }));

  // 3) SSR fallback para rotas da app
  app.get('*', async (c) => {
    // @ts-expect-error built only in production
    const mod: any = await import('../../dist/server/index.js');
    const res = await mod.default.fetch(c.req.raw);
    return res;
  });
}

const port = Number(process.env.PORT || 3001);

async function main() {
  await runMigrations();
  await startRealtime();
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[nanter-api] listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error('[nanter-api] fatal', err);
  process.exit(1);
});
