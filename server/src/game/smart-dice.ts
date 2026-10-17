/**
 * Smart Dice do servidor — o ÚNICO gerador de dados em jogos com apostas.
 *
 * Port do módulo do cliente, com duas diferenças:
 *  - a config é lida da BD (backoffice) com cache curto, nunca exposta ao cliente;
 *  - a history de mercy é keyed por gameId explícito (multi-jogo em simultâneo).
 *
 * Como corre no servidor, o botBias/targetRTP é real: o jogador não consegue
 * inspeccionar nem manipular os pesos.
 */

import { randomInt } from "node:crypto";
import { one } from "../db.js";
import { type GameState, getAbsolutePosition, SAFE_POSITIONS } from "./engine.js";

export interface SmartDiceConfig {
  enabled: boolean;
  mercy: {
    enabled: boolean;
    turnsWithoutSixThreshold: number;
    maxBoostPercent: number;
  };
  clutch: {
    enabled: boolean;
    captureBoostPercent: number;
    finishBoostPercent: number;
    maxRange: number;
  };
  comeback: {
    enabled: boolean;
    maxBoostPercent: number;
  };
  manipulationRate: number;
  botBias?: {
    enabled: boolean;
    scope: "bot-games-only" | "all-games";
    targetRTP: number;
  };
}

export const DEFAULT_CONFIG: SmartDiceConfig = {
  enabled: true,
  mercy: { enabled: true, turnsWithoutSixThreshold: 3, maxBoostPercent: 45 },
  clutch: { enabled: true, captureBoostPercent: 14, finishBoostPercent: 12, maxRange: 5 },
  comeback: { enabled: true, maxBoostPercent: 12 },
  manipulationRate: 0.5,
  botBias: { enabled: false, scope: "bot-games-only", targetRTP: 1.0 },
};

// --- Config da BD com cache de 15s (mesma tabela que o backoffice gere) ---

let cachedConfig: SmartDiceConfig = DEFAULT_CONFIG;
let cacheExpiry = 0;

export async function loadSmartDiceConfig(): Promise<SmartDiceConfig> {
  const now = Date.now();
  if (now < cacheExpiry) return cachedConfig;
  try {
    const row = await one<{ smart_dice: unknown }>(
      `SELECT smart_dice FROM game_settings WHERE id = 'default' LIMIT 1`,
    );
    if (row?.smart_dice && typeof row.smart_dice === "object") {
      // Merge por secção: uma config parcial do backoffice (ex.: `mercy` sem
      // `maxBoostPercent`) dava pesos NaN com um spread raso.
      const cfg = row.smart_dice as Partial<SmartDiceConfig>;
      cachedConfig = {
        ...DEFAULT_CONFIG,
        ...cfg,
        mercy: { ...DEFAULT_CONFIG.mercy, ...cfg.mercy },
        clutch: { ...DEFAULT_CONFIG.clutch, ...cfg.clutch },
        comeback: { ...DEFAULT_CONFIG.comeback, ...cfg.comeback },
        botBias: { ...DEFAULT_CONFIG.botBias!, ...cfg.botBias },
      };
    } else {
      cachedConfig = DEFAULT_CONFIG;
    }
  } catch {
    // Tabela ainda não migrada — usa defaults
    cachedConfig = DEFAULT_CONFIG;
  }
  cacheExpiry = now + 15_000;
  return cachedConfig;
}

// --- History de mercy por (gameId, playerId) ---

interface PlayerDiceHistory {
  turnsWithoutSix: number;
  lastTouch: number;
}

const histories = new Map<string, PlayerDiceHistory>();

function getHistory(gameId: string, playerId: string): PlayerDiceHistory {
  const key = `${gameId}:${playerId}`;
  let h = histories.get(key);
  if (!h) {
    h = { turnsWithoutSix: 0, lastTouch: Date.now() };
    histories.set(key, h);
  }
  h.lastTouch = Date.now();
  return h;
}

// Limpeza periódica de histories de jogos terminados/abandonados
setInterval(
  () => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2h sem actividade
    for (const [key, h] of histories) {
      if (h.lastTouch < cutoff) histories.delete(key);
    }
  },
  30 * 60 * 1000,
).unref?.();

// --- Análise de estado ---

function calcPlayerProgress(state: GameState, playerIndex: number): number {
  const player = state.players[playerIndex];
  if (!player) return 0;
  let progress = 0;
  for (const piece of player.pieces) {
    if (piece.isFinished) {
      progress += 60;
    } else if (piece.position >= 52) {
      progress += 52 + (piece.position - 52);
    } else if (piece.position >= 0) {
      progress += piece.position;
    }
  }
  return progress;
}

function findCaptureNumbers(state: GameState, playerIndex: number): Set<number> {
  const player = state.players[playerIndex];
  const captureNums = new Set<number>();

  for (const piece of player.pieces) {
    if (piece.position < 0 || piece.position > 51 || piece.isFinished) continue;
    const absPos = getAbsolutePosition(piece);

    for (const other of state.players) {
      if (other.color === player.color) continue;
      for (const otherPiece of other.pieces) {
        if (otherPiece.position < 0 || otherPiece.position > 51 || otherPiece.isFinished) continue;
        const otherAbs = getAbsolutePosition(otherPiece);
        if (SAFE_POSITIONS.includes(otherAbs)) continue;
        const dist = (otherAbs - absPos + 52) % 52;
        if (dist >= 1 && dist <= 6) captureNums.add(dist);
      }
    }
  }
  return captureNums;
}

function findFinishNumbers(state: GameState, playerIndex: number): Set<number> {
  const player = state.players[playerIndex];
  const finishNums = new Set<number>();
  for (const piece of player.pieces) {
    if (piece.isFinished) continue;
    if (piece.position >= 52 && piece.position < 57) {
      const needed = 57 - piece.position;
      if (needed >= 1 && needed <= 6) finishNums.add(needed);
    }
  }
  return finishNums;
}

// --- Weighted roll ---

function weightedRoll(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = (randomInt(0, 1_000_000) / 1_000_000) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i + 1;
  }
  return 6;
}

function pureRoll(): number {
  return randomInt(1, 7);
}

function applyBotBias(
  weights: number[],
  state: GameState,
  playerIndex: number,
  config: SmartDiceConfig,
): void {
  const bias = config.botBias;
  if (!bias || !bias.enabled) return;
  if (bias.targetRTP >= 1) return;

  const players = state.players;
  const hasBots = players.some((p) => p.isBot);
  const hasHumans = players.some((p) => !p.isBot && !p.resigned);
  if (bias.scope === "bot-games-only" && !(hasBots && hasHumans)) return;

  const houseEdge = Math.max(0, Math.min(0.5, 1 - bias.targetRTP));
  if (houseEdge <= 0) return;

  const player = players[playerIndex];
  if (!player) return;

  const boostFactor = houseEdge * 8; // 0..4

  if (player.isBot) {
    const captureNums = findCaptureNumbers(state, playerIndex);
    for (const n of captureNums) {
      if (n <= 6) weights[n - 1] += boostFactor;
    }
    const finishNums = findFinishNumbers(state, playerIndex);
    for (const n of finishNums) {
      weights[n - 1] += boostFactor * 0.8;
    }
    weights[5] += boostFactor * 0.4;
  } else if (hasBots) {
    const captureNums = findCaptureNumbers(state, playerIndex);
    for (const n of captureNums) {
      if (n <= 6) {
        weights[n - 1] = Math.max(0.2, weights[n - 1] - boostFactor * 0.5);
      }
    }
  }
}

function updateHistory(gameId: string, state: GameState, playerIndex: number, result: number) {
  const player = state.players[playerIndex];
  if (!player) return;
  const history = getHistory(gameId, player.id);
  if (result === 6) history.turnsWithoutSix = 0;
  else history.turnsWithoutSix++;
}

// --- API principal ---

export function smartRollDice(
  gameId: string,
  state: GameState,
  playerIndex: number,
  config: SmartDiceConfig,
): number {
  if (!config.enabled) return pureRoll();

  if (Math.random() > config.manipulationRate) {
    const result = pureRoll();
    updateHistory(gameId, state, playerIndex, result);
    return result;
  }

  const weights = [1, 1, 1, 1, 1, 1];
  const player = state.players[playerIndex];
  if (!player) return pureRoll();

  const history = getHistory(gameId, player.id);

  // Mercy
  if (config.mercy.enabled && history.turnsWithoutSix >= config.mercy.turnsWithoutSixThreshold) {
    const extraTurns = history.turnsWithoutSix - config.mercy.turnsWithoutSixThreshold;
    const ramp = Math.min((extraTurns + 1) / 5, 1.0);
    const boostFactor = ramp * (config.mercy.maxBoostPercent / 100);
    weights[5] += 6 * boostFactor;
  }

  // Clutch
  if (config.clutch.enabled) {
    const captureNums = findCaptureNumbers(state, playerIndex);
    for (const n of captureNums) {
      if (n <= config.clutch.maxRange) {
        weights[n - 1] += 6 * (config.clutch.captureBoostPercent / 100);
      }
    }
    const finishNums = findFinishNumbers(state, playerIndex);
    for (const n of finishNums) {
      weights[n - 1] += 6 * (config.clutch.finishBoostPercent / 100);
    }
  }

  // Comeback
  if (config.comeback.enabled && state.players.length > 1) {
    const progresses = state.players.map((_, i) => calcPlayerProgress(state, i));
    const maxProgress = Math.max(...progresses);
    const myProgress = progresses[playerIndex];
    if (maxProgress > 0 && myProgress < maxProgress) {
      const deficit = (maxProgress - myProgress) / maxProgress;
      const boost = deficit * (config.comeback.maxBoostPercent / 100);
      weights[3] += 6 * boost * 0.3;
      weights[4] += 6 * boost * 0.3;
      weights[5] += 6 * boost * 0.4;
    }
  }

  // Bot bias (house edge) — só faz efeito aqui, no servidor
  applyBotBias(weights, state, playerIndex, config);

  const result = weightedRoll(weights);
  updateHistory(gameId, state, playerIndex, result);
  return result;
}
