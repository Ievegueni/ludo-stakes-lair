import { one } from "../db.js";

/** Configuração gerida no backoffice (tabela game_settings, linha 'default'). */
export interface GameConfig {
  minStake: number;
  maxStake: number;
  rakePct: number;
  maintenance: boolean;
  maintenanceMessage: string | null;
}

const DEFAULTS: GameConfig = {
  minStake: 500,
  maxStake: 10_000_000,
  rakePct: 5,
  maintenance: false,
  maintenanceMessage: null,
};

let cached = DEFAULTS;
let expires = 0;

export async function loadGameConfig(): Promise<GameConfig> {
  if (Date.now() < expires) return cached;
  try {
    const row = await one<{
      min_stake: string;
      max_stake: string;
      rake_percentage: string;
      maintenance_mode: boolean;
      maintenance_message: string | null;
    }>(
      `SELECT min_stake, max_stake, rake_percentage, maintenance_mode, maintenance_message
       FROM game_settings WHERE id = 'default'`,
    );
    cached = row
      ? {
          minStake: Number(row.min_stake),
          maxStake: Number(row.max_stake),
          rakePct: Number(row.rake_percentage),
          maintenance: row.maintenance_mode,
          maintenanceMessage: row.maintenance_message,
        }
      : DEFAULTS;
  } catch {
    cached = DEFAULTS; // backoffice ainda não criou a tabela
  }
  expires = Date.now() + 15_000;
  return cached;
}

/** Prémio do vencedor para um pote, com a taxa da sala. */
export function prizeFor(pot: number, rakePct: number): number {
  return Math.floor((pot * (100 - rakePct)) / 100);
}
