import pg from "pg";

const { Pool } = pg;

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
