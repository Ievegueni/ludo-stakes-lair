import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import pg from "pg";

const { Client } = pg;

interface RealtimeEvent {
  table: string;
  event: "INSERT" | "UPDATE" | "DELETE";
  row: Record<string, unknown>;
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

export function realtimeHandler(c: Context) {
  return streamSSE(c, async (stream) => {
    const listener: Listener = (ev) => {
      stream.writeSSE({ data: JSON.stringify(ev), event: "change" }).catch(() => {});
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
