import pg from "pg";

const { Pool } = pg;

// BIGINT (valores em Kz, count(*)) e NUMERIC (taxa) chegavam como strings e
// comparações como `bet_amount === 0` falhavam no cliente. Kz cabe em Number.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://nanter:nanter@127.0.0.1:54322/nanter",
  max: 10,
});

export async function query<T = any>(sql: string, params?: unknown[]) {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

export async function one<T = any>(sql: string, params?: unknown[]) {
  const rows = await query<T>(sql, params);
  return (rows[0] ?? null) as T | null;
}
