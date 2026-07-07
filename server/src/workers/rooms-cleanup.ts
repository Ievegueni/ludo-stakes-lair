import { pool } from "../db.js";

/**
 * Worker que limpa salas órfãs:
 *  - Salas `finished` há mais de 1 hora → DELETE
 *  - Salas `waiting` sem jogadores humanos há mais de 30 minutos → DELETE
 *  - Salas `playing` sem jogadores humanos não-desistidos → marca `finished`
 *    (o `games.state.winner` já cobre os casos onde alguém desistiu, mas se
 *    houve disconnects e ninguém empurrou um update, a sala fica presa)
 *
 * Corre a cada 5 minutos.
 */

const FIVE_MIN = 5 * 60 * 1000;

async function runOnce() {
  const client = await pool.connect();
  try {
    // 1) Salas finished antigas
    const r1 = await client.query(
      `DELETE FROM rooms WHERE status = 'finished' AND created_at < now() - INTERVAL '1 hour' RETURNING id`,
    );
    if (r1.rowCount && r1.rowCount > 0) {
      console.log(`[cleanup] removed ${r1.rowCount} old finished rooms`);
    }

    // 2) Salas waiting sem humanos há > 30min
    const r2 = await client.query(`
      DELETE FROM rooms
      WHERE status = 'waiting'
        AND created_at < now() - INTERVAL '30 minutes'
        AND id NOT IN (
          SELECT DISTINCT room_id FROM room_players WHERE is_bot = false
        )
      RETURNING id
    `);
    if (r2.rowCount && r2.rowCount > 0) {
      console.log(`[cleanup] removed ${r2.rowCount} stale waiting rooms`);
    }

    // 3) Salas playing sem nenhum humano activo (todos resigned ou ausentes)
    //    Aqui só forçamos status=finished — o admin/operação pode investigar
    const r3 = await client.query(`
      UPDATE rooms r SET status = 'finished'
      WHERE r.status = 'playing'
        AND r.id NOT IN (
          SELECT DISTINCT rp.room_id FROM room_players rp WHERE rp.is_bot = false
        )
      RETURNING r.id
    `);
    if (r3.rowCount && r3.rowCount > 0) {
      console.log(`[cleanup] forced ${r3.rowCount} ghost playing rooms to finished`);
    }
  } catch (err) {
    console.error("[cleanup] error", err);
  } finally {
    client.release();
  }
}

let started = false;

export function startRoomsCleanup() {
  if (started) return;
  started = true;
  // Primeira execução em 30s para não correr concorrente com migrations
  setTimeout(() => {
    runOnce();
    setInterval(runOnce, FIVE_MIN);
  }, 30_000);
  console.log("[cleanup] rooms-cleanup worker scheduled (every 5 min)");
}
