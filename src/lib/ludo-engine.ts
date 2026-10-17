// Ludo game engine - handles all game logic

export type PlayerColor = "red" | "blue" | "green" | "yellow";

export interface Piece {
  id: number;
  color: PlayerColor;
  position: number; // -1 = home, 0-51 = board, 52-56 = final stretch, 57 = finished
  isFinished: boolean;
}

export interface Player {
  id: string;
  name: string;
  color: PlayerColor;
  pieces: Piece[];
  isBot: boolean;
  avatarUrl?: string;
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
  /** Multiplayer: epoch ms (relógio do servidor) em que o servidor age sozinho. */
  turnDeadline?: number | null;
  /** Multiplayer: humanos em auto-play — o servidor joga por eles. */
  autoPlay?: string[];
}

// Starting positions for each color on the 52-cell main track
export const START_POSITIONS: Record<PlayerColor, number> = {
  red: 0,
  blue: 13,
  green: 26,
  yellow: 39,
};

// Entry to final home stretch
export const HOME_ENTRY: Record<PlayerColor, number> = {
  red: 50,
  blue: 11,
  green: 24,
  yellow: 37,
};

// Safe positions on board
export const SAFE_POSITIONS = [0, 8, 13, 21, 26, 34, 39, 47];

export function createInitialPieces(color: PlayerColor): Piece[] {
  return [0, 1, 2, 3].map((id) => ({
    id,
    color,
    position: -1,
    isFinished: false,
  }));
}

export function createPlayer(
  id: string,
  name: string,
  color: PlayerColor,
  isBot: boolean,
  avatarUrl?: string,
): Player {
  return {
    id,
    name,
    color,
    pieces: createInitialPieces(color),
    isBot,
    avatarUrl,
  };
}

export function rollDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

// Convert a piece's internal position to absolute board position (0-51)
export function getAbsolutePosition(piece: Piece): number {
  if (piece.position < 0 || piece.position > 51) return -1;
  const start = START_POSITIONS[piece.color];
  return (piece.position + start) % 52;
}

// Get relative position from absolute for a specific color
export function getRelativePosition(absolutePos: number, color: PlayerColor): number {
  const start = START_POSITIONS[color];
  return (absolutePos - start + 52) % 52;
}

export function canMovePiece(piece: Piece, diceValue: number, color: PlayerColor): boolean {
  if (piece.isFinished) return false;

  // Piece is at home - needs 6 to come out
  if (piece.position === -1) {
    return diceValue === 6;
  }

  // Check if move would go past finish
  const newPos = piece.position + diceValue;

  // In final stretch (52-56), check bounds
  if (piece.position >= 52) {
    return newPos <= 57;
  }

  // About to enter final stretch
  const homeEntry = HOME_ENTRY[color];
  const relativePos = piece.position;
  if (relativePos + diceValue > 51) {
    // Check if passes through home entry
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
    // Move out of home
    piece.position = 0;
  } else if (piece.position >= 52) {
    // Moving in final stretch
    piece.position += diceValue;
    if (piece.position >= 57) {
      piece.position = 57;
      piece.isFinished = true;
    }
  } else {
    const newRelPos = piece.position + diceValue;
    if (newRelPos > 51) {
      // Enter final stretch
      const stepsToHome = 51 - piece.position;
      const remaining = diceValue - stepsToHome - 1;
      piece.position = 52 + remaining;
      if (piece.position >= 57) {
        piece.position = 57;
        piece.isFinished = true;
      }
    } else {
      piece.position = newRelPos;

      // Check for capture
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

  // Check win condition
  if (player.pieces.every((p) => p.isFinished)) {
    newState.winner = player.id;
    newState.phase = "finished";
  }

  return { newState, captured };
}

/**
 * Peças adversárias que o jogador `idx` pode comer no próximo lançamento.
 * Só apresentação: simula cada dado com o próprio motor, não mexe no dado.
 * Devolve `${color}-${pieceId}` → valores do dado que a comem.
 */
export function captureThreats(state: GameState, idx: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const player = state.players[idx];
  if (!player) return out;
  for (let d = 1; d <= 6; d++) {
    for (const pid of getMovablePieces(player, d)) {
      const { newState, captured } = movePiece(state, idx, pid, d);
      if (!captured) continue;
      newState.players.forEach((op, oi) => {
        if (oi === idx) return;
        op.pieces.forEach((pc, k) => {
          if (pc.position !== -1 || state.players[oi].pieces[k].position < 0) return;
          const key = `${op.color}-${pc.id}`;
          const dice = out.get(key) ?? [];
          if (!dice.includes(d)) out.set(key, [...dice, d]);
        });
      });
    }
  }
  return out;
}

// Bot AI: choose best piece to move
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

// Board cell coordinates for rendering (15x15 grid)
export interface CellCoord {
  row: number;
  col: number;
  type: "path" | "home-red" | "home-blue" | "home-green" | "home-yellow" | "center" | "safe";
  absolutePosition?: number;
  homeStretchColor?: PlayerColor;
  homeStretchIndex?: number;
}

// Generate the board path cells (main track of 52 cells)
export function generateBoardPath(): CellCoord[] {
  const cells: CellCoord[] = [];

  // The main track goes clockwise. We map absolute positions 0-51 to grid coordinates.
  // Top row (left to right): positions 0-4 -> row 6, col 1-5
  // Right column going up: positions 5-10 -> row 5-0, col 6
  // Top-right corner and down: etc.

  // This is a standard Ludo board layout on a 15x15 grid
  const pathCoords: [number, number][] = [
    // Red start area path (going up from row 6)
    [6, 1],
    [6, 2],
    [6, 3],
    [6, 4],
    [6, 5], // 0-4
    [5, 6],
    [4, 6],
    [3, 6],
    [2, 6],
    [1, 6],
    [0, 6], // 5-10
    [0, 7],
    [0, 8], // 11-12
    // Blue start area path (going down from col 8)
    [1, 8],
    [2, 8],
    [3, 8],
    [4, 8],
    [5, 8], // 13-17
    [6, 9],
    [6, 10],
    [6, 11],
    [6, 12],
    [6, 13],
    [6, 14], // 18-23
    [7, 14],
    [8, 14], // 24-25
    // Green start area path (going left from row 8)
    [8, 13],
    [8, 12],
    [8, 11],
    [8, 10],
    [8, 9], // 26-30
    [9, 8],
    [10, 8],
    [11, 8],
    [12, 8],
    [13, 8],
    [14, 8], // 31-36
    [14, 7],
    [14, 6], // 37-38
    // Yellow start area path (going up from col 6)
    [13, 6],
    [12, 6],
    [11, 6],
    [10, 6],
    [9, 6], // 39-43
    [8, 5],
    [8, 4],
    [8, 3],
    [8, 2],
    [8, 1],
    [8, 0], // 44-49
    [7, 0],
    [6, 0], // 50-51
  ];

  for (let i = 0; i < pathCoords.length; i++) {
    const [row, col] = pathCoords[i];
    cells.push({
      row,
      col,
      type: SAFE_POSITIONS.includes(i) ? "safe" : "path",
      absolutePosition: i,
    });
  }

  return cells;
}

// Home stretch cells (the colored paths leading to center)
export function generateHomeStretch(): CellCoord[] {
  const cells: CellCoord[] = [];

  // Red home stretch: row 7, col 1-5 (positions 52-56)
  for (let i = 0; i < 5; i++) {
    cells.push({ row: 7, col: 1 + i, type: "path", homeStretchColor: "red", homeStretchIndex: i });
  }
  // Blue home stretch: row 1-5, col 7 (positions 52-56)
  for (let i = 0; i < 5; i++) {
    cells.push({ row: 1 + i, col: 7, type: "path", homeStretchColor: "blue", homeStretchIndex: i });
  }
  // Green home stretch: row 7, col 13-9 (positions 52-56)
  for (let i = 0; i < 5; i++) {
    cells.push({
      row: 7,
      col: 13 - i,
      type: "path",
      homeStretchColor: "green",
      homeStretchIndex: i,
    });
  }
  // Yellow home stretch: row 13-9, col 7 (positions 52-56)
  for (let i = 0; i < 5; i++) {
    cells.push({
      row: 13 - i,
      col: 7,
      type: "path",
      homeStretchColor: "yellow",
      homeStretchIndex: i,
    });
  }

  return cells;
}
