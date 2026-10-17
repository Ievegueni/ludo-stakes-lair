/**
 * Motor de Ludo do servidor — fonte de verdade das regras.
 *
 * Port do motor do cliente (`src/lib/ludo-engine.ts`). O cliente mantém a
 * sua cópia apenas para renderização e para o modo local sem apostas;
 * qualquer jogada com dinheiro é validada e aplicada AQUI.
 */

export type PlayerColor = "red" | "blue" | "green" | "yellow";

export interface Piece {
  id: number;
  color: PlayerColor;
  position: number; // -1 = casa, 0-51 = tabuleiro, 52-56 = recta final, 57 = terminada
  isFinished: boolean;
}

export interface Player {
  id: string;
  name: string;
  color: PlayerColor;
  pieces: Piece[];
  isBot: boolean;
  avatarUrl?: string | null;
  resigned?: boolean;
}

export interface GameState {
  players: Player[];
  currentPlayerIndex: number;
  diceValue: number | null;
  isRolling: boolean;
  winner: string | null;
  turnTimer: number;
  consecutiveSixes: number;
  phase: "waiting" | "rolling" | "moving" | "finished";
  /** Epoch ms em que o servidor age sozinho (bot, auto-play ou timeout). */
  turnDeadline?: number | null;
  /** Humanos em auto-play — o servidor joga por eles. */
  autoPlay?: string[];
  /** Taxa da casa (%) fixada na criação da sala. */
  rakePct?: number;
}

export const START_POSITIONS: Record<PlayerColor, number> = {
  red: 0,
  blue: 13,
  green: 26,
  yellow: 39,
};

export const HOME_ENTRY: Record<PlayerColor, number> = {
  red: 50,
  blue: 11,
  green: 24,
  yellow: 37,
};

export const SAFE_POSITIONS = [0, 8, 13, 21, 26, 34, 39, 47];

export function getAbsolutePosition(piece: Piece): number {
  if (piece.position < 0 || piece.position > 51) return -1;
  const start = START_POSITIONS[piece.color];
  return (piece.position + start) % 52;
}

export function canMovePiece(piece: Piece, diceValue: number, color: PlayerColor): boolean {
  if (piece.isFinished) return false;

  // Peça na casa — precisa de 6 para sair
  if (piece.position === -1) {
    return diceValue === 6;
  }

  const newPos = piece.position + diceValue;

  // Na recta final (52-56), verificar limites
  if (piece.position >= 52) {
    return newPos <= 57;
  }

  // Prestes a entrar na recta final
  const relativePos = piece.position;
  if (relativePos + diceValue > 51) {
    const stepsToHome = 51 - relativePos;
    const remaining = diceValue - stepsToHome - 1;
    return remaining >= 0 && 52 + remaining <= 57;
  }

  return true;
}

export function getMovablePieces(player: Player, diceValue: number): number[] {
  return player.pieces.filter((p) => canMovePiece(p, diceValue, player.color)).map((p) => p.id);
}

export function movePiece(
  state: GameState,
  playerIndex: number,
  pieceId: number,
  diceValue: number,
): { newState: GameState; captured: boolean } {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  const player = newState.players[playerIndex];
  const piece = player?.pieces[pieceId];
  if (!piece || piece.isFinished) {
    return { newState: state, captured: false };
  }
  let captured = false;

  if (piece.position === -1) {
    piece.position = 0;
  } else if (piece.position >= 52) {
    piece.position += diceValue;
    if (piece.position >= 57) {
      piece.position = 57;
      piece.isFinished = true;
    }
  } else {
    const newRelPos = piece.position + diceValue;
    if (newRelPos > 51) {
      const stepsToHome = 51 - piece.position;
      const remaining = diceValue - stepsToHome - 1;
      piece.position = 52 + remaining;
      if (piece.position >= 57) {
        piece.position = 57;
        piece.isFinished = true;
      }
    } else {
      piece.position = newRelPos;

      // Captura
      const absPos = getAbsolutePosition(piece);
      if (!SAFE_POSITIONS.includes(absPos)) {
        for (const otherPlayer of newState.players) {
          if (otherPlayer.color === player.color) continue;
          for (const otherPiece of otherPlayer.pieces) {
            if (otherPiece.position >= 0 && otherPiece.position <= 51) {
              const otherAbsPos = getAbsolutePosition(otherPiece);
              if (otherAbsPos === absPos) {
                otherPiece.position = -1;
                captured = true;
              }
            }
          }
        }
      }
    }
  }

  // Vitória
  if (player.pieces.every((p) => p.isFinished)) {
    newState.winner = player.id;
    newState.phase = "finished";
  }

  return { newState, captured };
}

/** Próximo jogador activo (não-resigned), a partir de fromIdx. */
export function nextActiveIdx(players: Player[], fromIdx: number): number {
  const total = players.length;
  for (let i = 1; i <= total; i++) {
    const idx = (fromIdx + i) % total;
    if (!players[idx].resigned) return idx;
  }
  return fromIdx;
}

// Bot AI — cópia de src/lib/ludo-engine.ts (o servidor joga pelos bots e auto-play).
// Avalia cada peca movivel com um sistema de pontuacao para criar um bot
// que parece humano — varia entre agressivo, defensivo e oportunista.

function scorePieceMove(
  player: Player,
  pieceId: number,
  diceValue: number,
  state: GameState,
  playerIndex: number,
): number {
  const piece = player.pieces[pieceId];
  if (!piece) return -Infinity;

  let score = 0;

  // --- Sair de casa (6) ---
  if (piece.position === -1) {
    const piecesOut = player.pieces.filter((p) => p.position >= 0 && !p.isFinished).length;
    // Mais valioso sair quando temos poucas pecas fora
    score += piecesOut === 0 ? 60 : piecesOut === 1 ? 40 : 20;
    return score;
  }

  // Simular o movimento para analise
  const simState = JSON.parse(JSON.stringify(state)) as GameState;
  const { newState, captured } = movePiece(simState, playerIndex, pieceId, diceValue);

  // --- Capturar adversario (prioridade maxima) ---
  if (captured) {
    score += 80;
  }

  // --- Terminar peca (chegar ao fim) ---
  const simPiece = newState.players[playerIndex].pieces[pieceId];
  if (simPiece.isFinished) {
    score += 90;
  }

  // --- Entrar na home stretch (seguro) ---
  if (piece.position < 52 && simPiece.position >= 52) {
    score += 50;
  }

  // --- Ir para posicao segura ---
  if (piece.position >= 0 && piece.position <= 51) {
    const newAbsPos =
      simPiece.position <= 51 ? (simPiece.position + START_POSITIONS[piece.color]) % 52 : -1;
    if (newAbsPos >= 0 && SAFE_POSITIONS.includes(newAbsPos)) {
      score += 25;
    }
  }

  // --- Fugir de perigo (peca em risco de ser capturada) ---
  if (piece.position >= 0 && piece.position <= 51) {
    const absPos = getAbsolutePosition(piece);
    if (!SAFE_POSITIONS.includes(absPos)) {
      let inDanger = false;
      for (const other of state.players) {
        if (other.color === player.color) continue;
        for (const op of other.pieces) {
          if (op.position < 0 || op.position > 51 || op.isFinished) continue;
          const otherAbs = getAbsolutePosition(op);
          const dist = (absPos - otherAbs + 52) % 52;
          if (dist >= 1 && dist <= 6) {
            inDanger = true;
            break;
          }
        }
        if (inDanger) break;
      }
      if (inDanger) {
        score += 35; // Fugir de perigo e valioso
      }
    }
  }

  // --- Progresso geral (preferir pecas mais avancadas) ---
  if (piece.position >= 0) {
    score += piece.position * 0.3;
  }

  // --- Evitar posicoes perigosas apos mover ---
  if (simPiece.position >= 0 && simPiece.position <= 51) {
    const newAbs = (simPiece.position + START_POSITIONS[piece.color]) % 52;
    if (!SAFE_POSITIONS.includes(newAbs)) {
      for (const other of state.players) {
        if (other.color === player.color) continue;
        for (const op of other.pieces) {
          if (op.position < 0 || op.position > 51 || op.isFinished) continue;
          const otherAbs = getAbsolutePosition(op);
          const dist = (newAbs - otherAbs + 52) % 52;
          if (dist >= 1 && dist <= 6) {
            score -= 15; // Penalizar mover para posicao perigosa
            break;
          }
        }
      }
    }
  }

  return score;
}

export function botChoosePiece(player: Player, diceValue: number, state: GameState): number {
  const movable = getMovablePieces(player, diceValue);
  if (movable.length === 0) return -1;
  if (movable.length === 1) return movable[0];

  const playerIndex = state.players.indexOf(player);

  // Pontuar cada peca
  const scored = movable.map((id) => ({
    id,
    score: scorePieceMove(player, id, diceValue, state, playerIndex),
  }));

  // Ordenar por pontuacao (maior primeiro)
  scored.sort((a, b) => b.score - a.score);

  // Adicionar variacao humana: 15% de chance de escolher a 2a melhor opcao
  // para o bot nao parecer perfeito
  if (scored.length >= 2 && Math.random() < 0.15) {
    return scored[1].id;
  }

  return scored[0].id;
}
