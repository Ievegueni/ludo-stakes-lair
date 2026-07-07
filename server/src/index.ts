import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { secureHeaders } from "hono/secure-headers";
import { pool } from "./db.js";
import { runMigrations } from "./migrate.js";
import { startRealtime, realtimeHandler } from "./realtime.js";
import { verifyRealtimeToken } from "./auth.js";
import { startRoomsCleanup } from "./workers/rooms-cleanup.js";
import authRoutes from "./routes/auth.js";
import profileRoutes from "./routes/profiles.js";
import walletRoutes from "./routes/wallet.js";
import roomRoutes from "./routes/rooms.js";
import gameRoutes from "./routes/games.js";
import settingsRoutes from "./routes/settings.js";
import reportsRoutes from "./routes/reports.js";

const app = new Hono();

// Compressão (gzip/deflate). Reduz HTML SSR + JS chunks em ~60–70%
// — ganho mais visível em conexões móveis e em Railway.
app.use("*", compress());

// Headers de segurança (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc.)
app.use(
  "*",
  secureHeaders({
    crossOriginResourcePolicy: false, // assets servidos ao próprio domínio
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);

// CORS: em produção só aceita as origens definidas em ALLOWED_ORIGINS
// (lista separada por vírgulas). Em dev aceita qualquer origem local.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return origin; // same-origin / curl
      if (process.env.NODE_ENV !== "production") return origin;
      if (allowedOrigins.length === 0) return origin; // fallback: sem config, comporta-se como antes
      return allowedOrigins.includes(origin) ? origin : "";
    },
    allowHeaders: ["Authorization", "Content-Type"],
  }),
);

// Logging leve de pedidos lentos (>500ms) para detectar gargalos em produção
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const dur = Date.now() - start;
  if (dur > 500) {
    console.warn(`[slow] ${c.req.method} ${c.req.path} ${dur}ms`);
  }
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/auth", authRoutes);
app.route("/api/profiles", profileRoutes);
app.route("/api/wallet", walletRoutes);
app.route("/api/rooms", roomRoutes);
app.route("/api/games", gameRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/reports", reportsRoutes);

// Só aceita o token efémero de scope 'realtime' — antes este endpoint
// estava completamente aberto (qualquer um via os eventos da BD).
app.get("/api/realtime", (c) => {
  const token = c.req.query("token");
  const user = token ? verifyRealtimeToken(token) : null;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return realtimeHandler(c);
});

// In production, serve static assets and SSR via TanStack Start
if (process.env.NODE_ENV === "production") {
  // 1) Hashed assets (Vite build output) — nomes incluem hash, são imutáveis.
  //    Cache "forever" no browser e CDN.
  app.use("/assets/*", async (c, next) => {
    await next();
    if (c.res.status < 400) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    }
  });
  app.use("/assets/*", serveStatic({ root: "./dist/client" }));

  // 2) Public files (background.png, sounds/, animations/, favicon, etc.).
  //    Cache moderado — podem ser actualizados sem hash no nome.
  app.use("/*", async (c, next) => {
    await next();
    if (c.res.status < 400 && c.req.path !== "/" && !c.req.path.startsWith("/api/")) {
      c.header("Cache-Control", "public, max-age=86400");
    }
  });
  app.use("/*", serveStatic({ root: "./dist/client" }));

  // 3) SSR fallback — módulo é pré-carregado no boot (ver `prewarmSSR` abaixo).
  app.get("*", async (c) => {
    const mod = await loadSSR();
    const res = await mod.default.fetch(c.req.raw);
    return res;
  });
}

// Pré-carrega o módulo SSR uma única vez no boot. Sem isto, o primeiro
// request pós-boot paga a importação ESM completa (centenas de ms a vários
// segundos consoante o tamanho do bundle).
let ssrModulePromise: Promise<{ default: { fetch: (req: Request) => Promise<Response> } }> | null =
  null;
function loadSSR(): Promise<{ default: { fetch: (req: Request) => Promise<Response> } }> {
  if (!ssrModulePromise) {
    // @ts-expect-error built only in production
    ssrModulePromise = import("../../dist/server/index.js");
  }
  return ssrModulePromise;
}

async function prewarmSSR(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  try {
    const t = Date.now();
    await loadSSR();
    console.log(`[nanter-api] SSR module prewarmed in ${Date.now() - t}ms`);
  } catch (err) {
    console.warn("[nanter-api] SSR prewarm failed:", err);
  }
}

/** Acelera o primeiro pedido com DB — abre 1 conexão e devolve-a ao pool. */
async function prewarmDb(): Promise<void> {
  try {
    const t = Date.now();
    const c = await pool.connect();
    await c.query("SELECT 1");
    c.release();
    console.log(`[nanter-api] DB pool prewarmed in ${Date.now() - t}ms`);
  } catch (err) {
    console.warn("[nanter-api] DB prewarm failed:", err);
  }
}

const port = Number(process.env.PORT || 3001);

async function main() {
  await runMigrations();
  await startRealtime();
  startRoomsCleanup();
  // Pré-aquecimento em paralelo — não bloqueia o serve
  void Promise.all([prewarmSSR(), prewarmDb()]);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[nanter-api] listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error("[nanter-api] fatal", err);
  process.exit(1);
});
