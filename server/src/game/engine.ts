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
