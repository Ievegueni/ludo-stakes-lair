/**
 * Smart Dice System — motor de dados com manipulação inteligente.
 *
 * Este módulo substitui o `rollDice()` puro por um sistema que analisa
 * o estado do jogo e ajusta subtilmente as probabilidades para criar
 * momentos de tensão, comebacks e jogadas "clutch" que tornam o jogo
 * mais envolvente e viciante.
 *
 * IMPORTANTE: todas as manipulações são subtis — o jogador nunca deve
 * sentir que o dado é "viciado", apenas que o jogo é emocionante.
 *
 * Uso futuro:
 *   import { smartRollDice } from './smart-dice';
 *   const value = smartRollDice(gameState, playerIndex);
 */

import type { GameState, PlayerColor } from './ludo-engine';
import { getAbsolutePosition, HOME_ENTRY, SAFE_POSITIONS } from './ludo-engine';

// ---------------------------------------------------------------------------
// Configuracao global — podes ajustar estes valores sem tocar na logica
// ---------------------------------------------------------------------------

export interface SmartDiceConfig {
  enabled: boolean;

  // Mercy: se um jogador nao tira 6 ha N jogadas seguidas,
  // a probabilidade de sair 6 sobe progressivamente.
  mercy: {
    enabled: boolean;
    turnsWithoutSixThreshold: number; // apos quantas jogadas sem 6 comecar a ajudar
    maxBoostPercent: number;          // boost maximo na probabilidade do 6 (ex: 15 = +15%)
  };

  // Clutch: quando uma peca esta a 1-3 casas de comer outra ou de chegar
  // ao fim, ha uma leve probabilidade extra de sair o numero certo.
  clutch: {
    enabled: boolean;
    captureBoostPercent: number;  // boost quando pode comer (ex: 12 = +12%)
    finishBoostPercent: number;   // boost quando pode terminar (ex: 10 = +10%)
    maxRange: number;             // distancia maxima em casas para activar (1-6)
  };

  // Comeback: jogadores que estao atrasados recebem dados ligeiramente melhores.
  // "Atrasado" = menos pecas fora de casa ou menos progresso total.
  comeback: {
    enabled: boolean;
    maxBoostPercent: number; // boost maximo para o jogador mais atrasado
  };

  // RTP (Return to Player): percentagem geral de jogadas onde o sistema
  // tenta ajudar vs jogadas puramente aleatorias.
  // Ex: 0.35 = 35% das jogadas sao "assistidas", 65% sao puro random.
  manipulationRate: number;

  // Bot bias — lever de receita da casa.
  // Em salas com bots, favorece subtilmente os bots quando targetRTP < 1.
  // targetRTP = 1.0 → sem manipulacao
  // targetRTP = 0.80 → casa tem +20% de edge nesses jogos
  // scope = "bot-games-only" → so aplica se houver bots E humanos na sala
  // scope = "all-games" → aplica sempre (afecta tambem jogos so humanos)
  botBias?: {
    enabled: boolean;
    scope: 'bot-games-only' | 'all-games';
    targetRTP: number;
  };
}

export const DEFAULT_CONFIG: SmartDiceConfig = {
  enabled: true,
  mercy: {
    enabled: true,
    turnsWithoutSixThreshold: 4,
    maxBoostPercent: 18,
  },
  clutch: {
    enabled: true,
    captureBoostPercent: 12,
    finishBoostPercent: 10,
    maxRange: 4,
  },
  comeback: {
    enabled: true,
    maxBoostPercent: 10,
  },
  manipulationRate: 0.35,
  botBias: {
    enabled: false,
    scope: 'bot-games-only',
    targetRTP: 1.0,
  },
};

// ---------------------------------------------------------------------------
// Estado de tracking por jogador (nao persiste entre jogos)
// ---------------------------------------------------------------------------

interface PlayerDiceHistory {
  turnsWithoutSix: number;
}

const playerHistory = new Map<string, PlayerDiceHistory>();

function getHistory(playerId: string): PlayerDiceHistory {
  if (!playerHistory.has(playerId)) {
    playerHistory.set(playerId, { turnsWithoutSix: 0 });
  }
  return playerHistory.get(playerId)!;
}

export function resetHistory(): void {
  playerHistory.clear();
}

// ---------------------------------------------------------------------------
// Analise de estado
// ---------------------------------------------------------------------------

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
    // position === -1 (em casa) = 0 progresso
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

        // Distancia no sentido horario
        const dist = (otherAbs - absPos + 52) % 52;
        if (dist >= 1 && dist <= 6) {
          captureNums.add(dist);
        }
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
      if (needed >= 1 && needed <= 6) {
        finishNums.add(needed);
      }
    }
  }
  return finishNums;
}

// ---------------------------------------------------------------------------
// Weighted roll — o coracao do sistema
// ---------------------------------------------------------------------------

function weightedRoll(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i + 1; // faces 1-6
  }
  return 6;
}

function pureRoll(): number {
  return Math.floor(Math.random() * 6) + 1;
}

// ---------------------------------------------------------------------------
// API principal
// ---------------------------------------------------------------------------

export function smartRollDice(
  state: GameState,
  playerIndex: number,
  config: SmartDiceConfig = DEFAULT_CONFIG,
): number {
  if (!config.enabled) return pureRoll();

  // Decidir se esta jogada e "assistida" ou puro random
  if (Math.random() > config.manipulationRate) {
    const result = pureRoll();
    updateHistory(state, playerIndex, result);
    return result;
  }

  // Pesos base iguais (16.67% cada)
  const weights = [1, 1, 1, 1, 1, 1];
  const player = state.players[playerIndex];
  if (!player) return pureRoll();

  const history = getHistory(player.id);

  // --- Mercy: boost no 6 se nao sai ha muito tempo ---
  if (config.mercy.enabled && history.turnsWithoutSix >= config.mercy.turnsWithoutSixThreshold) {
    const extraTurns = history.turnsWithoutSix - config.mercy.turnsWithoutSixThreshold;
    const boostFactor = Math.min(extraTurns + 1, config.mercy.maxBoostPercent) / 100;
    weights[5] += 6 * boostFactor; // index 5 = face 6
  }

  // --- Clutch: boost em numeros que permitem captura ---
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

  // --- Comeback: boost geral para jogadores atrasados ---
  if (config.comeback.enabled && state.players.length > 1) {
    const progresses = state.players.map((_, i) => calcPlayerProgress(state, i));
    const maxProgress = Math.max(...progresses);
    const myProgress = progresses[playerIndex];

    if (maxProgress > 0 && myProgress < maxProgress) {
      const deficit = (maxProgress - myProgress) / maxProgress; // 0..1
      const boost = deficit * (config.comeback.maxBoostPercent / 100);
      // Boost distribuido pelos numeros mais altos (4, 5, 6)
      weights[3] += 6 * boost * 0.3;
      weights[4] += 6 * boost * 0.3;
      weights[5] += 6 * boost * 0.4;
    }
  }

  // --- Bot bias: house edge knob ---
  // Aplicado apos as outras camadas. Quanto mais baixo o targetRTP, mais
  // os bots sao favorecidos (e mais os humanos prejudicados em capturas).
  applyBotBias(weights, state, playerIndex, config);

  const result = weightedRoll(weights);
  updateHistory(state, playerIndex, result);
  return result;
}

/**
 * Aplica o vies pro-casa (bot bias). Modifica `weights` in-place.
 *
 * Estrategia:
 *   - Calcula `houseEdge = 1 - targetRTP` (clamped 0..0.5)
 *   - Se o jogador actual e BOT: boost agressivo nas faces que permitem
 *     captura ou finish (multiplica por factor proporcional ao edge)
 *   - Se o jogador actual e HUMANO num jogo com bots: REDUZ o peso das
 *     faces de captura/finish (humano captura menos vezes)
 *
 * Em jogos so entre humanos com `scope = "bot-games-only"`, nao mexe nada.
 */
function applyBotBias(
  weights: number[],
  state: GameState,
  playerIndex: number,
  config: SmartDiceConfig,
): void {
  const bias = config.botBias;
  if (!bias || !bias.enabled) return;
  if (bias.targetRTP >= 1) return; // 1.0 ou maior = sem manipulacao

  // Determina se o scope se aplica
  const players = state.players;
  const hasBots = players.some((p) => p.isBot);
  const hasHumans = players.some((p) => !p.isBot && !p.resigned);

  if (bias.scope === 'bot-games-only' && !(hasBots && hasHumans)) {
    return; // exigimos pelo menos 1 bot E 1 humano
  }

  const houseEdge = Math.max(0, Math.min(0.5, 1 - bias.targetRTP));
  if (houseEdge <= 0) return;

  const player = players[playerIndex];
  if (!player) return;

  // Magnitude do efeito — escala com o edge desejado.
  // Em targetRTP=0.50 (edge 0.5), o boost atinge cerca de 4x peso base.
  const boostFactor = houseEdge * 8; // 0..4

  if (player.isBot) {
    // Reforca clutch — bot mais provavel de capturar/terminar
    const captureNums = findCaptureNumbers(state, playerIndex);
    for (const n of captureNums) {
      if (n <= 6) weights[n - 1] += boostFactor;
    }
    const finishNums = findFinishNumbers(state, playerIndex);
    for (const n of finishNums) {
      weights[n - 1] += boostFactor * 0.8;
    }
    // E uns 6 a mais (mais turnos)
    weights[5] += boostFactor * 0.4;
  } else if (hasBots) {
    // Humano contra bots — penaliza ligeiramente capturas
    const captureNums = findCaptureNumbers(state, playerIndex);
    for (const n of captureNums) {
      if (n <= 6) {
        weights[n - 1] = Math.max(0.2, weights[n - 1] - boostFactor * 0.5);
      }
    }
  }
}

function updateHistory(state: GameState, playerIndex: number, result: number): void {
  const player = state.players[playerIndex];
  if (!player) return;
  const history = getHistory(player.id);

  if (result === 6) {
    history.turnsWithoutSix = 0;
  } else {
    history.turnsWithoutSix++;
  }
}
