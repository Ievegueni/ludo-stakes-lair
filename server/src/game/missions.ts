import type { PoolClient } from "pg";

/**
 * Missões diárias. Só contam jogos a dinheiro (treino contra bots não conta),
 * senão o bónus seria grátis e ilimitado com contas novas.
 */
export const MISSIONS = {
  play3: { label: "Joga 3 partidas a dinheiro", goal: 3, reward: 200 },
  capture5: { label: "Come 5 peças adversárias", goal: 5, reward: 250 },
  win1: { label: "Ganha 1 partida", goal: 1, reward: 300 },
} as const;

export type MissionId = keyof typeof MISSIONS;

/** Dia corrente no fuso de Luanda — as missões renovam à meia-noite local. */
export const TODAY_SQL = "(now() AT TIME ZONE 'Africa/Luanda')::date";

export async function bumpMission(client: PoolClient, userId: string, mission: MissionId) {
  await client.query(
    `INSERT INTO mission_progress (user_id, day, mission, progress)
     VALUES ($1, ${TODAY_SQL}, $2, 1)
     ON CONFLICT (user_id, day, mission)
     DO UPDATE SET progress = mission_progress.progress + 1`,
    [userId, mission],
  );
}

/** Nível a partir do XP: 1, 2 (50xp), 3 (200xp), 4 (450xp)... */
export function levelFromXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
}

export const XP_PER_GAME = 10;
export const XP_PER_WIN = 25;
