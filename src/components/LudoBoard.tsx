import { useState, useEffect, useCallback, useRef } from 'react';
import {
  type GameState,
  type Player,
  type PlayerColor,
  rollDice,
  getMovablePieces,
  movePiece,
  botChoosePiece,
  generateBoardPath,
  generateHomeStretch,
  START_POSITIONS,
  SAFE_POSITIONS,
} from '@/lib/ludo-engine';
import { Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, MessageSquare, Settings, Trophy, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GameChat } from '@/components/GameChat';
import { api } from '@/lib/api';
import { toast } from 'sonner';

const COLORS: Record<PlayerColor, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#facc15',
};

const COLOR_BG: Record<PlayerColor, string> = {
  red: 'rgba(239,68,68,0.3)',
  blue: 'rgba(59,130,246,0.3)',
  green: 'rgba(34,197,94,0.3)',
  yellow: 'rgba(250,204,21,0.3)',
};

const COLOR_LABELS: Record<PlayerColor, string> = {
  red: 'VERMELHO',
  blue: 'AZUL',
  green: 'VERDE',
  yellow: 'AMARELO',
};

const PIECE_PREFIX: Record<PlayerColor, string> = {
  red: 'R',
  blue: 'B',
  green: 'G',
  yellow: 'Y',
};

const BOARD_PATH = generateBoardPath();
const HOME_STRETCH = generateHomeStretch();

const DiceIcon = ({ value, className = 'w-8 h-8' }: { value: number; className?: string }) => {
  const props = { className };
  switch (value) {
    case 1: return <Dice1 {...props} />;
    case 2: return <Dice2 {...props} />;
    case 3: return <Dice3 {...props} />;
    case 4: return <Dice4 {...props} />;
    case 5: return <Dice5 {...props} />;
    case 6: return <Dice6 {...props} />;
    default: return <Dice1 {...props} />;
  }
};

interface LogEntry {
  id: number;
  color: PlayerColor;
  text: string;
  highlight?: boolean;
}

interface MultiplayerInfo {
  gameId: string;
  isHost: boolean;
  initialState: GameState;
  version: number;
}

interface LudoBoardProps {
  players: Player[];
  betAmount?: number;
  balance: number;
  onBalanceChange: (newBalance: number) => void;
  onGameEnd?: (winnerId: string) => void;
  currentUserId?: string;
  multiplayer?: MultiplayerInfo | null;
}

export function LudoBoard({ players, betAmount = 0, balance, onBalanceChange, onGameEnd, currentUserId, multiplayer }: LudoBoardProps) {
  const isMultiplayer = !!multiplayer;
  const isHost = multiplayer?.isHost ?? true;
  const myUserId = currentUserId || (players.find((p) => !p.isBot)?.id);
  const versionRef = useRef<number>(multiplayer?.version ?? 0);
  const lastPushedRef = useRef<string | null>(null);
  const pushingRef = useRef<boolean>(false);

  const [gameState, setGameState] = useState<GameState>(() =>
    multiplayer?.initialState
      ? (multiplayer.initialState as GameState)
      : {
          players,
          currentPlayerIndex: 0,
          diceValue: null,
          isRolling: false,
          winner: null,
          turnTimer: 30,
          consecutiveSixes: 0,
          phase: 'rolling',
        },
  );

  const [animatingDice, setAnimatingDice] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [gameLog, setGameLog] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const botTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const potTotal = betAmount * gameState.players.length;

  // Find next non-resigned player index
  const nextActiveIdx = useCallback((playersArr: Player[], fromIdx: number) => {
    const total = playersArr.length;
    for (let i = 1; i <= total; i++) {
      const idx = (fromIdx + i) % total;
      if (!playersArr[idx].resigned) return idx;
    }
    return fromIdx;
  }, []);

  const prevResignedRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((color: PlayerColor, text: string, highlight = false) => {
    logIdRef.current++;
    setGameLog((prev) => [{ id: logIdRef.current, color, text, highlight }, ...prev].slice(0, 30));
  }, []);

  const showNotification = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2500);
  }, []);

  // Notify when a player resigns (visible to ALL clients via realtime sync)
  useEffect(() => {
    const currentResigned = new Set(
      gameState.players.filter((p) => p.resigned).map((p) => p.id),
    );
    gameState.players.forEach((p) => {
      if (p.resigned && !prevResignedRef.current.has(p.id)) {
        showNotification(`${p.name.toUpperCase()} DESISTIU`);
        addLog(p.color, `${p.name} desistiu do jogo`, true);
      }
    });
    prevResignedRef.current = currentResigned;
  }, [gameState.players, showNotification, addLog]);

  // Push state to server (multiplayer only). Caller decides when to call.
  const pushState = useCallback(async (newState: GameState) => {
    if (!isMultiplayer || !multiplayer) return;
    const serialized = JSON.stringify(newState);
    if (lastPushedRef.current === serialized) return;
    lastPushedRef.current = serialized;
    pushingRef.current = true;
    try {
      const r = await api.games.update(multiplayer.gameId, newState, versionRef.current);
      versionRef.current = r.version;
    } catch (err: any) {
      // Version conflict: pull latest
      if (err?.status === 409) {
        try {
          const fresh = await api.games.get(multiplayer.gameId);
          versionRef.current = fresh.version;
          setGameState(fresh.state as GameState);
        } catch {}
      } else {
        console.error('pushState failed', err);
      }
    } finally {
      pushingRef.current = false;
    }
  }, [isMultiplayer, multiplayer]);

  // Subscribe to realtime updates (multiplayer only). Whenever the game row
  // changes, sync local state — unless we are the ones who just pushed it.
  useEffect(() => {
    if (!isMultiplayer || !multiplayer) return;
    const off = api.realtime.subscribe((ev) => {
      if (ev.table !== 'games') return;
      if (ev.row?.id !== multiplayer.gameId) return;
      if (ev.event === 'DELETE') return;
      const incomingVersion = (ev.row as any).version;
      const incomingState = (ev.row as any).state as GameState;
      if (typeof incomingVersion !== 'number' || !incomingState) return;
      if (incomingVersion <= versionRef.current && !pushingRef.current) return;
      versionRef.current = incomingVersion;
      lastPushedRef.current = JSON.stringify(incomingState);
      setGameState(incomingState);
    });
    return off;
  }, [isMultiplayer, multiplayer]);

  // Turn timer — in multiplayer, only the host ticks.
  useEffect(() => {
    if (gameState.phase === 'finished') return;
    if (isMultiplayer && !isHost) return;
    timerRef.current = setInterval(() => {
      setGameState((prev) => {
        if (prev.phase === 'finished') return prev;
        if (prev.turnTimer <= 1) {
          const next = nextActiveIdx(prev.players, prev.currentPlayerIndex);
          const ns = { ...prev, currentPlayerIndex: next, turnTimer: 30, diceValue: null, phase: 'rolling' as const, consecutiveSixes: 0 };
          if (isMultiplayer) pushState(ns);
          return ns;
        }
        const ns = { ...prev, turnTimer: prev.turnTimer - 1 };
        // don't push every tick — bandwidth waste
        return ns;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameState.phase, gameState.currentPlayerIndex, isMultiplayer, isHost, pushState]);

  // Bot auto-play — in multiplayer, only the host drives bots.
  useEffect(() => {
    if (gameState.phase === 'finished') return;
    if (!currentPlayer?.isBot) return;
    if (isMultiplayer && !isHost) return;
    if (gameState.phase === 'rolling') {
      botTimeoutRef.current = setTimeout(() => handleRollDice(), 1000 + Math.random() * 1500);
    } else if (gameState.phase === 'moving' && gameState.diceValue) {
      botTimeoutRef.current = setTimeout(() => {
        const pieceId = botChoosePiece(currentPlayer, gameState.diceValue!, gameState);
        if (pieceId >= 0) {
          handleMovePiece(pieceId);
        } else {
          nextTurn();
        }
      }, 800 + Math.random() * 1200);
    }
    return () => { if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current); };
  }, [gameState.currentPlayerIndex, gameState.phase, gameState.diceValue, isMultiplayer, isHost]);

  const handleRollDice = useCallback(() => {
    if (gameState.phase !== 'rolling') return;
    // In multiplayer, only the player whose turn it is can roll.
    const cur = gameState.players[gameState.currentPlayerIndex];
    if (isMultiplayer && cur && !cur.isBot && cur.id !== myUserId) return;
    if (isMultiplayer && cur?.isBot && !isHost) return;

    setAnimatingDice(true);
    let count = 0;
    const animInterval = setInterval(() => {
      setGameState((prev) => ({ ...prev, diceValue: rollDice() }));
      count++;
      if (count > 8) {
        clearInterval(animInterval);
        const finalValue = rollDice();
        setAnimatingDice(false);
        setGameState((prev) => {
          const cp = prev.players[prev.currentPlayerIndex];
          addLog(cp.color, `${cp.name} lançou um ${finalValue}${finalValue === 6 ? '!' : ''}`, finalValue === 6);
          const movable = getMovablePieces(cp, finalValue);
          let ns: GameState;
          if (movable.length === 0) {
            const next = nextActiveIdx(prev.players, prev.currentPlayerIndex);
            ns = { ...prev, diceValue: finalValue, phase: 'rolling' as const, currentPlayerIndex: next, turnTimer: 30, consecutiveSixes: 0 };
          } else {
            ns = { ...prev, diceValue: finalValue, phase: 'moving' as const, turnTimer: 30 };
          }
          if (isMultiplayer) pushState(ns);
          return ns;
        });
      }
    }, 100);
  }, [gameState.phase, gameState.players, gameState.currentPlayerIndex, addLog, isMultiplayer, isHost, myUserId, pushState]);

  const handleMovePiece = useCallback((pieceId: number) => {
    if (gameState.phase !== 'moving' || !gameState.diceValue) return;
    const cp = gameState.players[gameState.currentPlayerIndex];
    if (isMultiplayer && cp && !cp.isBot && cp.id !== myUserId) return;
    if (isMultiplayer && cp?.isBot && !isHost) return;

    const { newState, captured } = movePiece(gameState, gameState.currentPlayerIndex, pieceId, gameState.diceValue);

    if (captured) {
      showNotification('CAPTURASTE UMA PEÇA!');
      addLog(cp.color, `${cp.name} CAPTUROU uma peça!`, true);
    } else {
      addLog(cp.color, `${cp.name} moveu uma peça`);
    }

    if (newState.winner) {
      setGameState(newState);
      if (isMultiplayer) pushState(newState);
      onGameEnd?.(newState.winner);
      return;
    }

    const gotSix = gameState.diceValue === 6;
    const newConsecutiveSixes = gotSix ? newState.consecutiveSixes + 1 : 0;

    let ns: GameState;
    if (newConsecutiveSixes >= 3) {
      const next = nextActiveIdx(newState.players, newState.currentPlayerIndex);
      ns = { ...newState, currentPlayerIndex: next, diceValue: null, phase: 'rolling' as const, turnTimer: 30, consecutiveSixes: 0 };
    } else if (gotSix || captured) {
      ns = { ...newState, diceValue: null, phase: 'rolling' as const, turnTimer: 30, consecutiveSixes: newConsecutiveSixes };
    } else {
      const next = nextActiveIdx(newState.players, newState.currentPlayerIndex);
      ns = { ...newState, currentPlayerIndex: next, diceValue: null, phase: 'rolling' as const, turnTimer: 30, consecutiveSixes: 0 };
    }
    setGameState(ns);
    if (isMultiplayer) pushState(ns);
  }, [gameState, onGameEnd, addLog, showNotification, isMultiplayer, isHost, myUserId, pushState]);

  const handleResign = useCallback(async () => {
    const me = gameState.players.find((p) => !p.isBot && p.id === myUserId)
      || gameState.players.find((p) => !p.isBot);
    if (!me || me.resigned) return;

    if (betAmount > 0) {
      try {
        const r = await api.wallet.createTransaction({
          type: 'bet',
          amount: betAmount,
          description: `Desistência (sala) - perda de ${betAmount.toLocaleString()} Kz`,
        });
        onBalanceChange(r.balance);
      } catch (err: any) {
        toast.error(err?.message || 'Erro ao processar desistência');
      }
    }

    const newPlayers = gameState.players.map((p) =>
      p.id === me.id ? { ...p, resigned: true } : p,
    );
    const stillActive = newPlayers.filter((p) => !p.resigned);

    let ns: GameState;
    if (stillActive.length <= 1) {
      // Last man standing wins (or no winner if all left somehow)
      const winnerId = stillActive[0]?.id ?? null;
      if (timerRef.current) clearInterval(timerRef.current);
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
      ns = { ...gameState, players: newPlayers, winner: winnerId, phase: 'finished' };
      setGameState(ns);
      if (isMultiplayer) pushState(ns);
      if (winnerId) onGameEnd?.(winnerId);
    } else {
      // Game continues without me. If it was my turn, advance to next active.
      let nextIdx = gameState.currentPlayerIndex;
      if (newPlayers[nextIdx].resigned) {
        nextIdx = nextActiveIdx(newPlayers, nextIdx);
      }
      ns = {
        ...gameState,
        players: newPlayers,
        currentPlayerIndex: nextIdx,
        diceValue: null,
        phase: 'rolling' as const,
        turnTimer: 30,
        consecutiveSixes: 0,
      };
      setGameState(ns);
      if (isMultiplayer) pushState(ns);
    }
    setShowResignConfirm(false);
  }, [gameState, onGameEnd, betAmount, onBalanceChange, myUserId, isMultiplayer, pushState, nextActiveIdx]);

  const nextTurn = useCallback(() => {
    setGameState((prev) => {
      const next = nextActiveIdx(prev.players, prev.currentPlayerIndex);
      const ns = { ...prev, currentPlayerIndex: next, diceValue: null, phase: 'rolling' as const, turnTimer: 30, consecutiveSixes: 0 };
      if (isMultiplayer) pushState(ns);
      return ns;
    });
  }, [isMultiplayer, pushState]);

  const movablePieces = gameState.phase === 'moving' && gameState.diceValue
    ? getMovablePieces(currentPlayer, gameState.diceValue)
    : [];

  const cellSize = 100 / 15;

  const getPieceScreenPos = (piece: { position: number; color: PlayerColor; isFinished: boolean }) => {
    if (piece.isFinished) return { x: 7.5 * cellSize, y: 7.5 * cellSize };
    if (piece.position === -1) return null;
    if (piece.position >= 52) {
      const idx = piece.position - 52;
      const cell = HOME_STRETCH.find((c) => c.homeStretchColor === piece.color && c.homeStretchIndex === idx);
      if (cell) return { x: cell.col * cellSize + cellSize / 2, y: cell.row * cellSize + cellSize / 2 };
      return { x: 7.5 * cellSize, y: 7.5 * cellSize };
    }
    const absPos = (piece.position + START_POSITIONS[piece.color]) % 52;
    const cell = BOARD_PATH.find((c) => c.absolutePosition === absPos);
    if (cell) return { x: cell.col * cellSize + cellSize / 2, y: cell.row * cellSize + cellSize / 2 };
    return { x: 50, y: 50 };
  };

  const timerPercent = gameState.turnTimer / 30;
  const timerCircumference = 2 * Math.PI * 24;

  return (
    <div className="flex flex-col lg:flex-row gap-3 lg:gap-4 w-full max-w-[1200px] mx-auto lg:h-[calc(100vh-2rem)] relative pb-4">
      {/* Notification banner */}
      {notification && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-50 bg-yellow-500 text-black font-bold px-6 py-2 rounded-b-xl flex items-center gap-2 text-sm animate-bounce shadow-lg">
          ⚔️ {notification}
        </div>
      )}

      {/* MOBILE compact header (players row + pot) */}
      <div className="flex lg:hidden gap-2 items-stretch">
        <div className="flex-1 bg-card rounded-xl border border-border p-2 overflow-x-auto">
          <div className="flex gap-2">
            {gameState.players.map((p, i) => {
              const isActive = i === gameState.currentPlayerIndex;
              const finishedCount = p.pieces.filter((pc) => pc.isFinished).length;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg shrink-0 transition-all ${
                    isActive ? 'bg-secondary' : 'opacity-60'
                  }`}
                  style={{
                    border: `1.5px solid ${isActive ? COLORS[p.color] : 'transparent'}`,
                  }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: COLORS[p.color] }}
                  />
                  <span
                    className="text-[11px] font-bold truncate max-w-[70px]"
                    style={{ color: COLORS[p.color] }}
                  >
                    {p.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {finishedCount}/4
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {betAmount > 0 && (
          <div className="bg-card rounded-xl border border-border px-3 py-2 flex flex-col items-center justify-center shrink-0">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Pot</span>
            <span className="text-sm font-bold text-primary leading-tight">
              {potTotal.toLocaleString()} Kz
            </span>
          </div>
        )}
      </div>

      {/* LEFT SIDEBAR - Players (desktop) */}
      <div className="hidden lg:flex w-64 flex-shrink-0 flex-col gap-3">
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-foreground tracking-wider uppercase">Jogadores</span>
            <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded font-bold">EM JOGO</span>
          </div>
          <div className="space-y-2">
            {gameState.players.map((p, i) => {
              const isActive = i === gameState.currentPlayerIndex;
              const pieceDots = p.pieces.map((pc) => pc.isFinished ? 'finished' : pc.position >= 0 ? 'out' : 'home');
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                    isActive ? 'ring-2 bg-card shadow-lg' : 'opacity-70'
                  }`}
                  style={{ borderColor: isActive ? COLORS[p.color] : 'transparent' }}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2"
                    style={{ backgroundColor: COLOR_BG[p.color], borderColor: COLORS[p.color], color: COLORS[p.color] }}
                  >
                    {p.isBot ? '🤖' : '👤'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate" style={{ color: COLORS[p.color] }}>
                      {p.name.toUpperCase()} ({COLOR_LABELS[p.color]})
                    </p>
                    <div className="flex gap-1 mt-0.5">
                      {pieceDots.map((s, di) => (
                        <div
                          key={di}
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: s === 'finished' ? '#fff' : s === 'out' ? COLORS[p.color] : 'rgba(255,255,255,0.2)',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Next player indicator */}
        <div className="bg-card rounded-xl border border-border p-3 mt-auto">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Próximo a Jogar</span>
          <div className="flex items-center gap-2 mt-1">
            <span style={{ color: COLORS[currentPlayer?.color || 'red'] }}>▶▶</span>
            <span className="text-sm font-bold text-foreground">{currentPlayer?.name?.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* CENTER - Board + Dice */}
      <div className="flex-1 flex flex-col items-center gap-3 min-w-0 w-full">
        {/* Board */}
        <div className="relative w-full max-w-[540px] aspect-square rounded-xl overflow-hidden border border-border/50 shadow-2xl"
          style={{ background: 'linear-gradient(135deg, rgba(30,30,30,0.9), rgba(15,15,15,0.95))' }}
        >
          {/* Player name chips on corners (matches the home base of each color) */}
          {([
            { pos: 'top-2 left-2', color: 'red' as PlayerColor },
            { pos: 'top-2 right-2', color: 'blue' as PlayerColor },
            { pos: 'bottom-2 left-2', color: 'yellow' as PlayerColor },
            { pos: 'bottom-2 right-2', color: 'green' as PlayerColor },
          ]).map(({ pos, color }) => {
            const player = gameState.players.find((p) => p.color === color);
            const isActive = player && gameState.players.indexOf(player) === gameState.currentPlayerIndex && !player.resigned;
            const text = player ? player.name : '';
            return (
              <div
                key={color}
                className={`absolute ${pos} text-[10px] font-bold px-1.5 py-0.5 rounded z-10 max-w-[90px] truncate ${
                  isActive ? 'ring-1 ring-white/60' : ''
                } ${player?.resigned ? 'line-through opacity-50' : ''}`}
                style={{
                  backgroundColor: COLOR_BG[color],
                  color: COLORS[color],
                  border: `1px solid ${COLORS[color]}`,
                }}
                title={text}
              >
                {text || '—'}
              </div>
            );
          })}

          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Home bases — aligned with engine: red TL, blue TR, yellow BL, green BR */}
            {/* Red (top-left) */}
            <rect x={0.5 * cellSize} y={0.5 * cellSize} width={5 * cellSize} height={5 * cellSize} rx="1.5" fill={COLOR_BG.red} stroke={COLORS.red} strokeWidth="0.4" />
            {/* Blue (top-right) */}
            <rect x={9.5 * cellSize} y={0.5 * cellSize} width={5 * cellSize} height={5 * cellSize} rx="1.5" fill={COLOR_BG.blue} stroke={COLORS.blue} strokeWidth="0.4" />
            {/* Yellow (bottom-left) */}
            <rect x={0.5 * cellSize} y={9.5 * cellSize} width={5 * cellSize} height={5 * cellSize} rx="1.5" fill={COLOR_BG.yellow} stroke={COLORS.yellow} strokeWidth="0.4" />
            {/* Green (bottom-right) */}
            <rect x={9.5 * cellSize} y={9.5 * cellSize} width={5 * cellSize} height={5 * cellSize} rx="1.5" fill={COLOR_BG.green} stroke={COLORS.green} strokeWidth="0.4" />

            {/* Center trophy */}
            <rect x={6 * cellSize} y={6 * cellSize} width={3 * cellSize} height={3 * cellSize} rx="1" fill="rgba(234,179,8,0.15)" stroke="rgba(234,179,8,0.3)" strokeWidth="0.3" />
            <text x={7.5 * cellSize} y={7.5 * cellSize + 2} textAnchor="middle" fontSize="5" fill="rgba(234,179,8,0.7)">🏆</text>

            {/* Path cells */}
            {BOARD_PATH.map((cell, i) => (
              <rect
                key={`path-${i}`}
                x={cell.col * cellSize + 0.2}
                y={cell.row * cellSize + 0.2}
                width={cellSize - 0.4}
                height={cellSize - 0.4}
                rx="0.4"
                fill={cell.type === 'safe' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="0.15"
              />
            ))}

            {/* Star on safe spots */}
            {BOARD_PATH.filter((c) => c.type === 'safe').map((cell, i) => (
              <text
                key={`safe-${i}`}
                x={cell.col * cellSize + cellSize / 2}
                y={cell.row * cellSize + cellSize / 2 + 1.2}
                textAnchor="middle"
                fontSize="3"
                fill="rgba(234,179,8,0.6)"
              >
                ☆
              </text>
            ))}

            {/* Home stretch cells */}
            {HOME_STRETCH.map((cell, i) => (
              <rect
                key={`hs-${i}`}
                x={cell.col * cellSize + 0.2}
                y={cell.row * cellSize + 0.2}
                width={cellSize - 0.4}
                height={cellSize - 0.4}
                rx="0.4"
                fill={COLORS[cell.homeStretchColor!]}
                opacity="0.25"
                stroke={COLORS[cell.homeStretchColor!]}
                strokeWidth="0.15"
                strokeOpacity="0.4"
              />
            ))}

            {/* Home base pieces (position === -1) */}
            {gameState.players.filter((pp) => !pp.resigned).map((player) => {
              const homePositions: Record<PlayerColor, [number, number][]> = {
                red: [[2, 2], [2, 4], [4, 2], [4, 4]],
                blue: [[2, 11], [2, 13], [4, 11], [4, 13]],
                yellow: [[11, 2], [11, 4], [13, 2], [13, 4]],
                green: [[11, 11], [11, 13], [13, 11], [13, 13]],
              };

              return player.pieces
                .filter((p) => p.position === -1 && !p.isFinished)
                .map((piece, idx) => {
                  const positions = homePositions[player.color];
                  const [row, col] = positions[idx] || positions[0];
                  const isMovable = movablePieces.includes(piece.id) &&
                    gameState.currentPlayerIndex === gameState.players.indexOf(player) &&
                    !player.isBot &&
                    (!isMultiplayer || player.id === myUserId);
                  const cx = col * cellSize + cellSize / 2;
                  const cy = row * cellSize + cellSize / 2;
                  const r = cellSize / 2.5;

                  return (
                    <g
                      key={`${player.color}-home-${piece.id}`}
                      className={isMovable ? 'cursor-pointer' : ''}
                      onClick={() => isMovable && handleMovePiece(piece.id)}
                      style={isMovable ? { filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.6))' } : { filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.5))' }}
                    >
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill={COLORS[player.color]}
                        stroke={isMovable ? '#fff' : 'rgba(0,0,0,0.4)'}
                        strokeWidth={isMovable ? '0.6' : '0.3'}
                      />
                      <ellipse cx={cx - r * 0.3} cy={cy - r * 0.35} rx={r * 0.45} ry={r * 0.3} fill="rgba(255,255,255,0.55)" pointerEvents="none" />
                      {isMovable && (
                        <circle cx={cx} cy={cy} r={r * 1.4} fill="transparent" />
                      )}
                    </g>
                  );
                });
            })}

            {/* Board pieces (position >= 0) */}
            {gameState.players.filter((pp) => !pp.resigned).map((player) =>
              player.pieces
                .filter((p) => p.position >= 0 && !p.isFinished)
                .map((piece) => {
                  const pos = getPieceScreenPos(piece);
                  if (!pos) return null;
                  const isMovable = movablePieces.includes(piece.id) &&
                    gameState.currentPlayerIndex === gameState.players.indexOf(player) &&
                    !player.isBot &&
                    (!isMultiplayer || player.id === myUserId);
                  const r = cellSize / 2.8;

                  return (
                    <g
                      key={`${player.color}-${piece.id}`}
                      className={`transition-all duration-500 ${isMovable ? 'cursor-pointer' : ''}`}
                      onClick={() => isMovable && handleMovePiece(piece.id)}
                      style={isMovable ? { filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.6))' } : { filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.5))' }}
                    >
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={r}
                        fill={COLORS[player.color]}
                        stroke={isMovable ? '#fff' : 'rgba(0,0,0,0.4)'}
                        strokeWidth={isMovable ? '0.6' : '0.3'}
                      />
                      <ellipse cx={pos.x - r * 0.3} cy={pos.y - r * 0.35} rx={r * 0.45} ry={r * 0.3} fill="rgba(255,255,255,0.55)" pointerEvents="none" />
                      {isMovable && (
                        <circle cx={pos.x} cy={pos.y} r={r * 1.4} fill="transparent" />
                      )}
                    </g>
                  );
                })
            )}

            {/* Finished pieces in center */}
            {gameState.players.filter((pp) => !pp.resigned).map((player) => {
              const finished = player.pieces.filter((p) => p.isFinished);
              return finished.map((piece, idx) => (
                <circle
                  key={`fin-${player.color}-${piece.id}`}
                  cx={7.5 * cellSize + (idx - 1.5) * 1.5}
                  cy={7.5 * cellSize}
                  r={cellSize / 4}
                  fill={COLORS[player.color]}
                  stroke="rgba(255,255,255,0.5)"
                  strokeWidth="0.3"
                />
              ));
            })}
          </svg>
        </div>

        {/* Bottom dice area */}
        <div className="flex items-center justify-center gap-6 w-full max-w-[540px]">
          <span className="text-primary text-xs font-bold bg-primary/10 px-2 py-1 rounded">Kz</span>

          {/* Dice with circular timer */}
          <div className="relative flex flex-col items-center">
            <div className="relative w-16 h-16">
              {/* Circular timer ring */}
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(234,179,8,0.2)" strokeWidth="3" />
                <circle
                  cx="28" cy="28" r="24"
                  fill="none"
                  stroke="#eab308"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={timerCircumference}
                  strokeDashoffset={timerCircumference * (1 - timerPercent)}
                  className="transition-all duration-1000 ease-linear"
                />
              </svg>
              {/* Dice in center */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className={`bg-card border border-border rounded-lg p-1.5 ${animatingDice ? 'animate-spin' : ''}`}>
                  {gameState.diceValue ? (
                    <DiceIcon value={gameState.diceValue} className="w-6 h-6 text-foreground" />
                  ) : (
                    <Dice6 className="w-6 h-6 text-muted-foreground" />
                  )}
                </div>
              </div>
            </div>
            <span className={`text-xs font-mono font-bold mt-1 ${gameState.turnTimer <= 5 ? 'text-destructive' : 'text-yellow-400'}`}>
              {gameState.turnTimer}s
            </span>
          </div>

          {/* Roll button */}
          {(() => {
            const myTurn = currentPlayer && !currentPlayer.isBot && (!isMultiplayer || currentPlayer.id === myUserId);
            const canRoll = gameState.phase === 'rolling' && myTurn && !animatingDice;
            return (
              <button
                onClick={handleRollDice}
                disabled={!canRoll}
                className={`px-8 py-3 rounded-full font-bold text-sm uppercase tracking-wider transition-all ${
                  canRoll
                    ? 'bg-yellow-500 hover:bg-yellow-400 text-black cursor-pointer active:scale-95 shadow-lg shadow-yellow-500/30'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                }`}
              >
                {currentPlayer?.isBot ? 'Bot a jogar...' : myTurn ? 'Lançar Dado' : `Vez de ${currentPlayer?.name}`}
              </button>
            );
          })()}

          <span className="text-primary text-xs font-bold bg-primary/10 px-2 py-1 rounded">Kz</span>
        </div>

        {/* Bottom buttons */}
        <div className="flex items-center justify-end gap-2 w-full max-w-[540px]">
          {/* CHAT toggle (desktop only — on mobile chat is always visible) */}
          <Button variant="outline" size="sm" className="gap-1.5 text-xs hidden lg:inline-flex" onClick={() => setShowChat((s) => !s)}>
            <MessageSquare className="w-3.5 h-3.5" />
            CHAT
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowResignConfirm(true)}
            disabled={gameState.phase === 'finished'}
            className="gap-1.5 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Flag className="w-3.5 h-3.5" />
            DESISTIR
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">
            <Settings className="w-3.5 h-3.5" />
            OPÇÕES
          </Button>
        </div>

        {/* Chat — always visible on mobile, toggleable on desktop */}
        <div className={`w-full max-w-[540px] block ${showChat ? 'lg:block' : 'lg:hidden'}`}>
          <GameChat
            players={gameState.players}
            currentUserId={myUserId || gameState.players.find((p) => !p.isBot)?.id || gameState.players[0].id}
            balance={balance}
            onBalanceChange={onBalanceChange}
            gameId={multiplayer?.gameId}
          />
        </div>
      </div>

      {/* RIGHT SIDEBAR - Pot + History (desktop) */}
      <div className="hidden lg:flex w-64 flex-shrink-0 flex-col gap-3">
        {/* Pot */}
        {betAmount > 0 && (
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-muted-foreground uppercase">Pot Total</span>
              <span className="text-[10px] text-muted-foreground">RAKE: 5%</span>
            </div>
            <p className="text-2xl font-bold text-primary">
              Kz {potTotal.toLocaleString('pt-AO', { minimumFractionDigits: 2 })}
            </p>
          </div>
        )}

        {/* History */}
        <div className="bg-card rounded-xl border border-border p-3 flex-1 overflow-hidden flex flex-col">
          <span className="text-xs font-bold text-foreground tracking-wider uppercase mb-2">Histórico</span>
          <div className="flex-1 overflow-y-auto space-y-1.5 scrollbar-thin">
            {gameLog.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">O jogo vai começar...</p>
            ) : (
              gameLog.map((entry) => (
                <div
                  key={entry.id}
                  className={`text-xs p-2 rounded-lg flex items-start gap-2 ${
                    entry.highlight
                      ? 'bg-primary/15 border border-primary/30'
                      : 'bg-secondary/30'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full mt-0.5 flex-shrink-0" style={{ backgroundColor: COLORS[entry.color] }} />
                  <span className={entry.highlight ? 'font-bold text-foreground' : 'text-muted-foreground'}>
                    {entry.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Resign confirmation */}
      {showResignConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl p-6 text-center max-w-sm border border-border shadow-2xl">
            <div className="text-5xl mb-3">🏳️</div>
            <h2 className="text-xl font-bold text-foreground mb-2">Desistir do jogo?</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {betAmount > 0
                ? `Vais perder esta partida e a tua aposta de ${betAmount.toLocaleString()} Kz.`
                : 'Vais perder esta partida.'}
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setShowResignConfirm(false)} className="flex-1">
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleResign} className="flex-1">
                Desistir
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Winner modal */}
      {gameState.winner && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl p-8 text-center max-w-sm border border-yellow-500/30 shadow-2xl shadow-yellow-500/10">
            <div className="text-6xl mb-4">🏆</div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Vitória!</h2>
            <p className="text-muted-foreground mb-2">
              {gameState.players.find((p) => p.id === gameState.winner)?.name} ganhou o jogo!
            </p>
            {betAmount > 0 && (
              <p className="text-xl font-bold text-primary mb-6">
                +{Math.floor(potTotal * 0.95).toLocaleString()} Kz
              </p>
            )}
            <Button onClick={() => window.location.reload()} className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-bold">
              Voltar ao Lobby
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}