import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import pg from "pg";
import { one } from "./db.js";

const { Client } = pg;

interface RealtimeEvent {
  table: string;
  event: "INSERT" | "UPDATE" | "DELETE";
  row: Record<string, any>;
  truncated?: boolean;
}

type Listener = (ev: RealtimeEvent) => void;
const listeners = new Set<Listener>();

let started = false;

export async function startRealtime() {
  if (started) return;
  started = true;
  const client = new Client({
    connectionString: process.env.DATABASE_URL || "postgres://nanter:nanter@127.0.0.1:54322/nanter",
  });
  await client.connect();
  await client.query("LISTEN nanter_realtime");
  client.on("notification", (msg) => {
    if (!msg.payload) return;
    try {
      const ev = JSON.parse(msg.payload) as RealtimeEvent;
      if (ev.table === "games" && ev.row.state) rememberMembers(ev.row.id, ev.row.state);
      for (const l of listeners) l(ev);
    } catch (err) {
      console.error("[realtime] bad payload", err);
    }
  });
  client.on("error", (err) => {
    console.error("[realtime] client error", err);
  });
  console.log("[realtime] listening on nanter_realtime");
}

// Quem pode ver cada jogo (e o seu chat). Alimentado pelos próprios eventos
// de `games`; após um restart, cai para a BD na primeira consulta.
// ponytail: cache sem limite de tamanho — limpa-se ao terminar o jogo.
const gameMembers = new Map<string, Set<string>>();

function rememberMembers(gameId: string, state: { players?: { id: string }[]; winner?: unknown }) {
  if (state.winner) gameMembers.delete(gameId);
  else gameMembers.set(gameId, new Set((state.players ?? []).map((p) => p.id)));
}

async function membersOf(gameId: string): Promise<Set<string>> {
  const cached = gameMembers.get(gameId);
  if (cached) return cached;
  const g = await one<{ state: { players?: { id: string }[] } }>(
    "SELECT state FROM games WHERE id = $1",
    [gameId],
  );
  const set = new Set((g?.state.players ?? []).map((p) => p.id));
  if (g) gameMembers.set(gameId, set);
  return set;
}

/** Devolve o evento como este utilizador o pode ver, ou null para não enviar. */
async function visibleTo(ev: RealtimeEvent, userId: string): Promise<RealtimeEvent | null> {
  switch (ev.table) {
    case "games":
      if (ev.truncated || ev.event === "DELETE") return ev; // só o id
      return ev.row.state?.players?.some((p: { id: string }) => p.id === userId) ? ev : null;
    case "chat_messages":
      return (await membersOf(ev.row.game_id)).has(userId) ? ev : null;
    case "rooms":
      // O código de uma sala privada é o "convite" — só o host o recebe
      if (ev.row.is_private && ev.row.host_id !== userId) {
        return { ...ev, row: { ...ev.row, code: null } };
      }
      return ev;
    default:
      return ev;
  }
}

export function realtimeHandler(c: Context, userId: string) {
  return streamSSE(c, async (stream) => {
    const listener: Listener = (ev) => {
      visibleTo(ev, userId)
        .then((out) =>
          out ? stream.writeSSE({ data: JSON.stringify(out), event: "change" }) : undefined,
        )
        .catch(() => {});
    };
    listeners.add(listener);
    await stream.writeSSE({ data: "ok", event: "ready" });

    const ping = setInterval(() => {
      stream.writeSSE({ data: ".", event: "ping" }).catch(() => {});
    }, 25_000);

    stream.onAbort(() => {
      clearInterval(ping);
      listeners.delete(listener);
    });

    await new Promise<void>(() => {});
  });
}
