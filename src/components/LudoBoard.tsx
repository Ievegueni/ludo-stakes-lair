import { useState, useEffect, useCallback, useRef } from "react";
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
} from "@/lib/ludo-engine";
import {
  smartRollDice,
  resetHistory as resetSmartDiceHistory,
  setActiveGame as setSmartDiceGame,
  pruneOldGames as pruneSmartDiceGames,
  DEFAULT_CONFIG as SMART_DICE_DEFAULT,
  type SmartDiceConfig,
} from "@/lib/smart-dice";
import { MessageSquare, Trophy, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GameChat } from "@/components/GameChat";
import { GamePiece, type PieceState, type Waypoint } from "@/components/Pieces/GamePiece";
import { CaptureBurst } from "@/components/Pieces/CaptureBurst";
import { Dice } from "@/components/Dice/Dice";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { VictoryModal } from "@/components/Victory/VictoryModal";
import { playSound } from "@/utils/sound";
import { hapticTurn, hapticCaptureSuccess, hapticCaptureLoss } from "@/utils/haptics";
import { notify } from "@/utils/notifications";
import { api } from "@/lib/api";
import { toast } from "sonner";

const COLORS: Record<PlayerColor, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#facc15",
};

const COLOR_BG: Record<PlayerColor, string> = {
  red: "rgba(239,68,68,0.3)",
  blue: "rgba(59,130,246,0.3)",
  green: "rgba(34,197,94,0.3)",
  yellow: "rgba(250,204,21,0.3)",
};

const COLOR_LABELS: Record<PlayerColor, string> = {
  red: "VERMELHO",
  blue: "AZUL",
  green: "VERDE",
  yellow: "AMARELO",
};

const PIECE_PREFIX: Record<PlayerColor, string> = {
  red: "R",
  blue: "B",
  green: "G",
  yellow: "Y",
};

const BOARD_PATH = generateBoardPath();
const HOME_STRETCH = generateHomeStretch();

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
  /** Chamado quando o user clica "Voltar ao Lobby" no modal de vitória. */
  onLeaveGame?: () => void;
  currentUserId?: string;
  multiplayer?: MultiplayerInfo | null;
}

export function LudoBoard({
  players,
  betAmount = 0,
  balance,
  onBalanceChange,
  onGameEnd,
  onLeaveGame,
  currentUserId,
  multiplayer,
}: LudoBoardProps) {
  const isMultiplayer = !!multiplayer;
  const myUserId = currentUserId || players.find((p) => !p.isBot)?.id;
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
          turnTimer: 15,
          consecutiveSixes: 0,
          phase: "rolling",
        },
  );

  const [animatingDice, setAnimatingDice] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showEmojiBar, setShowEmojiBar] = useState(false);
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [gameLog, setGameLog] = useState<LogEntry[]>([]);
  const [bursts, setBursts] = useState<
    Array<{ id: number; cx: number; cy: number; color: PlayerColor }>
  >([]);
  const [autoPlay, setAutoPlay] = useState<Set<string>>(new Set());
  const [showAutoPlayBanner, setShowAutoPlayBanner] = useState(false);
  const burstIdRef = useRef(0);
  const logIdRef = useRef(0);
  // Guard: impede useEffect de duplicar sons que ja tocaram via accao local
  const localSoundRef = useRef(false);
  // Evita acções duplicadas enquanto uma chamada roll/move está em curso
  const actionPendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const botTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const potTotal = betAmount * gameState.players.length;

  // Rotação do tabuleiro: a cor do utilizador local fica sempre em
  // bottom-left (frente). Cada cliente roda independentemente — o engine
  // continua igual, só a apresentação visual muda.
  //   red    está em top-left      → rodar 270° (anti-horário)
  //   blue   está em top-right     → rodar 180°
  //   yellow está em bottom-left   → 0°
  //   green  está em bottom-right  → rodar 90°
  const myColor = (() => {
    const me = gameState.players.find((p) => !p.isBot && p.id === myUserId);
    return me?.color ?? null;
  })();
  const boardRotation = (() => {
    switch (myColor) {
      case "green":
        return 90;
      case "blue":
        return 180;
      case "red":
        return 270;
      case "yellow":
      default:
        return 0;
    }
  })();

  // Bot driver dinâmico: primeiro humano não-resigned. Substitui o conceito
  // de "host" para processar bots e timeouts — assim o jogo continua mesmo
  // que o host original saia ou desista.
  const botDriverId = (() => {
    const humans = gameState.players.filter((p) => !p.isBot && !p.resigned && !!p.id);
    return humans.length > 0 ? humans[0].id : null;
  })();
  const isBotDriver = !isMultiplayer || (myUserId !== undefined && myUserId === botDriverId);

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

  // Smart Dice config — carregada do backoffice via endpoint público.
  // Começa com defaults locais para o primeiro lançamento nunca ficar bloqueado.
  const [smartDiceConfig, setSmartDiceConfig] = useState<SmartDiceConfig>(SMART_DICE_DEFAULT);
  const smartDiceConfigRef = useRef<SmartDiceConfig>(SMART_DICE_DEFAULT);
  useEffect(() => {
    smartDiceConfigRef.current = smartDiceConfig;
  }, [smartDiceConfig]);

  // Isolar smart-dice history por jogo. Usa o gameId do multiplayer ou
  // um id unico para jogos locais — history nunca contamina entre jogos.
  const localGameId = useRef(`local-${Date.now()}`);
  const gameId = multiplayer?.gameId ?? localGameId.current;

  useEffect(() => {
    setSmartDiceGame(gameId);
    pruneSmartDiceGames(gameId);
    // Fetch config — silencioso em caso de erro (mantém defaults).
    (async () => {
      try {
        const cfg = await api.settings.smartDice();
        if (cfg) setSmartDiceConfig(cfg);
      } catch {}
    })();
    return () => {
      resetSmartDiceHistory();
    };
  }, [gameId]);

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
    const currentResigned = new Set(gameState.players.filter((p) => p.resigned).map((p) => p.id));
    gameState.players.forEach((p) => {
      if (p.resigned && !prevResignedRef.current.has(p.id)) {
        showNotification(`${p.name.toUpperCase()} DESISTIU`);
        addLog(p.color, `${p.name} desistiu do jogo`, true);
      }
    });
    prevResignedRef.current = currentResigned;
  }, [gameState.players, showNotification, addLog]);

  // Sound effects + push notifications — derivados do diff de gameState.
  // Funciona em multiplayer porque o estado sincroniza via SSE.
  const prevStateRef = useRef<GameState | null>(null);
  const prevTurnIdxRef = useRef<number>(-1);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = gameState;

    // Detecta passagem para a minha vez de jogar
    const isMyTurnNow =
      !!myUserId &&
      gameState.players[gameState.currentPlayerIndex]?.id === myUserId &&
      prevTurnIdxRef.current !== gameState.currentPlayerIndex &&
      prevTurnIdxRef.current !== -1; // ignora mount inicial

    if (isMyTurnNow) {
      // Vibração subtil — funciona contra bots E em multiplayer
      hapticTurn();
      // Notificação push só faz sentido em multiplayer e em background
      if (isMultiplayer) {
        notify("🎲 É a tua vez!", {
          body: "Volta ao jogo para lançar o dado.",
          tag: "nanter-turn",
        });
      }
    }
    prevTurnIdxRef.current = gameState.currentPlayerIndex;

    if (!prev) return;

    // 1) Dice rolled (diceValue null → number) — so toca para eventos remotos
    if (prev.diceValue == null && gameState.diceValue != null && !localSoundRef.current) {
      playSound("dice-roll");
    }

    // 2) Piece moved + capture detection (tocar som + disparar burst visual)
    let captured = false;
    let moved = false;
    // Para haptics: distinguir "eu comi" de "fui comido". A captura acontece
    // durante a vez do `currentPlayerIndex` do estado ANTERIOR (o jogador
    // que mexeu). A vítima é o player `pi` cuja peça voltou para -1.
    const attacker = prev.players[prev.currentPlayerIndex];
    let iCaptured = false; // EU comi alguém
    let iWasCaptured = false; // A MINHA peça foi comida
    const newBursts: Array<{ id: number; cx: number; cy: number; color: PlayerColor }> = [];
    for (let pi = 0; pi < gameState.players.length; pi++) {
      const p1 = prev.players[pi];
      const p2 = gameState.players[pi];
      if (!p1 || !p2) continue;
      for (let i = 0; i < p2.pieces.length; i++) {
        const pos1 = p1.pieces[i]?.position;
        const pos2 = p2.pieces[i]?.position;
        if (pos1 !== pos2) {
          moved = true;
          // Capture: piece was active on track (>=0 && <52) and is now back to home (-1)
          if (pos1 !== undefined && pos1 >= 0 && pos1 < 52 && pos2 === -1) {
            captured = true;
            // Atribuição: a vítima é p2 (cujo position foi para -1), o atacante é o currentPlayer anterior
            if (myUserId) {
              if (p2.id === myUserId) iWasCaptured = true;
              if (attacker && attacker.id === myUserId && p2.id !== myUserId) iCaptured = true;
            }
            // Calcular coordenadas da posição original (cellSize aqui = 100/15)
            const cs = 100 / 15;
            const absPos = (pos1 + START_POSITIONS[p2.color as PlayerColor]) % 52;
            const cell = BOARD_PATH.find((c) => c.absolutePosition === absPos);
            if (cell) {
              burstIdRef.current++;
              newBursts.push({
                id: burstIdRef.current,
                cx: cell.col * cs + cs / 2,
                cy: cell.row * cs + cs / 2,
                color: p2.color as PlayerColor,
              });
            }
          }
        }
      }
    }
    if (newBursts.length > 0) {
      setBursts((b) => [...b, ...newBursts]);
    }
    if (captured) {
      if (!localSoundRef.current) playSound("piece-capture");
      // Haptics: padrões diferentes consoante o papel. "Fui comido" tem
      // prioridade sobre "eu comi" no caso (raro) de captura mútua.
      if (iWasCaptured) hapticCaptureLoss();
      else if (iCaptured) hapticCaptureSuccess();
    } else if (moved) {
      if (!localSoundRef.current) playSound("piece-move");
    }
    // Reset guard apos processar
    localSoundRef.current = false;

    // 3) Timer tick — só nos últimos 5s
    if (
      gameState.turnTimer > 0 &&
      gameState.turnTimer <= 5 &&
      gameState.turnTimer < prev.turnTimer
    ) {
      playSound("timer-tick");
    }
  }, [gameState, isMultiplayer, myUserId]);

  // Push state to server (multiplayer only). Caller decides when to call.
  const pushState = useCallback(
    async (newState: GameState) => {
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
          console.error("pushState failed", err);
        }
      } finally {
        pushingRef.current = false;
      }
    },
    [isMultiplayer, multiplayer],
  );

  // Subscribe to realtime updates (multiplayer only). Whenever the game row
  // changes, sync local state — unless we are the ones who just pushed it.
  useEffect(() => {
    if (!isMultiplayer || !multiplayer) return;
    const off = api.realtime.subscribe((ev) => {
      if (ev.table !== "games") return;
      if (ev.row?.id !== multiplayer.gameId) return;
      if (ev.event === "DELETE") return;
      const incomingVersion = (ev.row as any).version;
      const incomingState = (ev.row as any).state as GameState;
      if (typeof incomingVersion !== "number" || !incomingState) return;
      if (incomingVersion <= versionRef.current && !pushingRef.current) return;
      versionRef.current = incomingVersion;
      lastPushedRef.current = JSON.stringify(incomingState);
      setGameState(incomingState);
    });
    return off;
  }, [isMultiplayer, multiplayer]);

  // Turn timer — in multiplayer, only the host ticks.
  // Quando o tempo expira, o jogador entra em AUTO-PLAY (bot joga por ele).
  useEffect(() => {
    if (gameState.phase === "finished") return;
    if (isMultiplayer && !isBotDriver) return;
    timerRef.current = setInterval(() => {
      setGameState((prev) => {
        if (prev.phase === "finished") return prev;
        if (prev.turnTimer <= 1) {
          // Activar auto-play para o jogador que deixou o tempo expirar
          const timedOutPlayer = prev.players[prev.currentPlayerIndex];
          if (timedOutPlayer && !timedOutPlayer.isBot && !timedOutPlayer.resigned) {
            setAutoPlay((s) => {
              const ns = new Set(s);
              ns.add(timedOutPlayer.id);
              return ns;
            });
            setShowAutoPlayBanner(true);
          }
          // Avanca vez (o auto-play trata da proxima vez deste jogador)
          const next = nextActiveIdx(prev.players, prev.currentPlayerIndex);
          const ns = {
            ...prev,
            currentPlayerIndex: next,
            turnTimer: 15,
            diceValue: null,
            phase: "rolling" as const,
            consecutiveSixes: 0,
          };
          if (isMultiplayer) pushState(ns);
          return ns;
        }
        const ns = { ...prev, turnTimer: prev.turnTimer - 1 };
        return ns;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [
    gameState.phase,
    gameState.currentPlayerIndex,
    isMultiplayer,
    isBotDriver,
    pushState,
    nextActiveIdx,
  ]);

  const handleRollDice = useCallback(() => {
    if (gameState.phase !== "rolling") return;
    // In multiplayer, only the player whose turn it is can roll.
    const cur = gameState.players[gameState.currentPlayerIndex];
    if (isMultiplayer && cur && !cur.isBot && cur.id !== myUserId) return;
    if (isMultiplayer && cur?.isBot && !isBotDriver) return;
    if (actionPendingRef.current) return;

    // --- Multiplayer: o dado é lançado NO SERVIDOR (anti-batota + RTP real).
    // O cliente anima valores aleatórios enquanto espera e revela o valor
    // que o servidor decidiu.
    if (isMultiplayer && multiplayer) {
      actionPendingRef.current = true;
      localSoundRef.current = true;
      playSound("dice-roll");
      setAnimatingDice(true);
      const startedAt = Date.now();
      const animInterval = setInterval(() => {
        setGameState((prev) =>
          prev.phase === "rolling" ? { ...prev, diceValue: rollDice() } : prev,
        );
      }, 100);
      const stopAnim = () => {
        clearInterval(animInterval);
        setAnimatingDice(false);
      };

      api.games
        .roll(multiplayer.gameId)
        .then((r) => {
          // Bloquear já o eco do realtime (a animação ainda vai a meio)
          versionRef.current = r.game.version;
          lastPushedRef.current = JSON.stringify(r.game.state);
          const reveal = () => {
            stopAnim();
            setGameState(r.game.state as GameState);
            addLog(
              cur.color,
              `${cur.name} lançou um ${r.dice}${r.dice === 6 ? "!" : ""}`,
              r.dice === 6,
            );
            actionPendingRef.current = false;
          };
          // Animação mínima de ~900ms para o dado "rolar" de forma credível
          setTimeout(reveal, Math.max(0, 900 - (Date.now() - startedAt)));
        })
        .catch(async (err: any) => {
          stopAnim();
          actionPendingRef.current = false;
          // Dessincronizado (409/403) — re-sincroniza com o servidor
          try {
            const fresh = await api.games.get(multiplayer.gameId);
            versionRef.current = fresh.version;
            lastPushedRef.current = JSON.stringify(fresh.state);
            setGameState(fresh.state as GameState);
          } catch {}
          if (err?.status !== 409 && err?.status !== 403) {
            toast.error("Falha ao lançar o dado — tenta novamente");
          }
        });
      return;
    }

    // --- Modo local (sem apostas): lógica original no cliente.
    const finalValue = smartRollDice(
      gameState,
      gameState.currentPlayerIndex,
      smartDiceConfigRef.current,
    );
    localSoundRef.current = true;
    playSound("dice-roll");
    setAnimatingDice(true);
    let count = 0;
    const animInterval = setInterval(() => {
      count++;
      // Durante a animação mostra valores aleatórios que NÃO são o final;
      // no último frame fixa o `finalValue` para o utilizador ver o que o
      // engine vai realmente aplicar.
      const intermediate = count > 8 ? finalValue : rollDice();
      setGameState((prev) => ({ ...prev, diceValue: intermediate }));
      if (count > 8) {
        clearInterval(animInterval);
        setAnimatingDice(false);
        setGameState((prev) => {
          const cp = prev.players[prev.currentPlayerIndex];
          addLog(
            cp.color,
            `${cp.name} lançou um ${finalValue}${finalValue === 6 ? "!" : ""}`,
            finalValue === 6,
          );
          const movable = getMovablePieces(cp, finalValue);
          let ns: GameState;
          if (movable.length === 0) {
            const next = nextActiveIdx(prev.players, prev.currentPlayerIndex);
            ns = {
              ...prev,
              diceValue: finalValue,
              phase: "rolling" as const,
              currentPlayerIndex: next,
              turnTimer: 15,
              consecutiveSixes: 0,
            };
          } else {
            ns = { ...prev, diceValue: finalValue, phase: "moving" as const, turnTimer: 30 };
          }
          return ns;
        });
      }
    }, 100);
  }, [gameState, addLog, isMultiplayer, multiplayer, isBotDriver, myUserId, nextActiveIdx]);

  const handleMovePiece = useCallback(
    (pieceId: number) => {
      if (gameState.phase !== "moving" || !gameState.diceValue) return;
      const cp = gameState.players[gameState.currentPlayerIndex];
      if (isMultiplayer && cp && !cp.isBot && cp.id !== myUserId) return;
      if (isMultiplayer && cp?.isBot && !isBotDriver) return;
      if (actionPendingRef.current) return;

      // --- Multiplayer: o movimento é validado e aplicado NO SERVIDOR.
      if (isMultiplayer && multiplayer) {
        actionPendingRef.current = true;
        // Som imediato na acção — feedback táctil sem esperar pela rede
        const movedPiece = cp.pieces[pieceId];
        const wasHome = movedPiece?.position === -1;
        localSoundRef.current = true;
        playSound(wasHome ? "piece-out" : "piece-move");
        api.games
          .move(multiplayer.gameId, pieceId)
          .then((r) => {
            versionRef.current = r.game.version;
            lastPushedRef.current = JSON.stringify(r.game.state);
            const serverState = r.game.state as GameState;
            const idx = gameState.currentPlayerIndex;
            const postPiece = serverState.players[idx]?.pieces[pieceId];
            if (r.captured) {
              playSound("piece-capture");
              showNotification("CAPTURASTE UMA PEÇA!");
              addLog(cp.color, `${cp.name} CAPTUROU uma peça!`, true);
            } else {
              addLog(cp.color, `${cp.name} moveu uma peça`);
            }
            if (postPiece?.isFinished && !movedPiece?.isFinished) {
              playSound("piece-finish");
            }
            setGameState(serverState);
            actionPendingRef.current = false;
            if (serverState.winner) {
              onGameEnd?.(serverState.winner);
            }
          })
          .catch(async (err: any) => {
            actionPendingRef.current = false;
            try {
              const fresh = await api.games.get(multiplayer.gameId);
              versionRef.current = fresh.version;
              lastPushedRef.current = JSON.stringify(fresh.state);
              setGameState(fresh.state as GameState);
            } catch {}
            if (err?.status !== 409 && err?.status !== 403) {
              toast.error("Falha ao mover a peça — tenta novamente");
            }
          });
        return;
      }

      // --- Modo local (sem apostas): lógica original no cliente.
      const preMovePiece = cp.pieces[pieceId];
      const cameFromHome = preMovePiece?.position === -1;
      const { newState, captured } = movePiece(
        gameState,
        gameState.currentPlayerIndex,
        pieceId,
        gameState.diceValue,
      );
      const localPostPiece = newState.players[gameState.currentPlayerIndex]?.pieces[pieceId];

      // Som imediato na accao — sincronizado com o toque
      localSoundRef.current = true;
      if (captured) {
        playSound("piece-capture");
        showNotification("CAPTURASTE UMA PEÇA!");
        addLog(cp.color, `${cp.name} CAPTUROU uma peça!`, true);
      } else {
        playSound(cameFromHome ? "piece-out" : "piece-move");
        addLog(cp.color, `${cp.name} moveu uma peça`);
      }
      if (localPostPiece?.isFinished && !preMovePiece?.isFinished) {
        playSound("piece-finish");
      }

      if (newState.winner) {
        setGameState(newState);
        onGameEnd?.(newState.winner);
        return;
      }

      const gotSix = gameState.diceValue === 6;
      const newConsecutiveSixes = gotSix ? newState.consecutiveSixes + 1 : 0;

      let ns: GameState;
      if (newConsecutiveSixes >= 3) {
        const next = nextActiveIdx(newState.players, newState.currentPlayerIndex);
        ns = {
          ...newState,
          currentPlayerIndex: next,
          diceValue: null,
          phase: "rolling" as const,
          turnTimer: 15,
          consecutiveSixes: 0,
        };
      } else if (gotSix || captured) {
        ns = {
          ...newState,
          diceValue: null,
          phase: "rolling" as const,
          turnTimer: 15,
          consecutiveSixes: newConsecutiveSixes,
        };
      } else {
        const next = nextActiveIdx(newState.players, newState.currentPlayerIndex);
        ns = {
          ...newState,
          currentPlayerIndex: next,
          diceValue: null,
          phase: "rolling" as const,
          turnTimer: 15,
          consecutiveSixes: 0,
        };
      }
      setGameState(ns);
    },
    [
      gameState,
      onGameEnd,
      addLog,
      showNotification,
      isMultiplayer,
      multiplayer,
      isBotDriver,
      myUserId,
      nextActiveIdx,
    ],
  );

  const handleResign = useCallback(async () => {
    // Fechar o modal de confirmação imediatamente — evita user clicar 2 vezes
    setShowResignConfirm(false);

    const me =
      gameState.players.find((p) => !p.isBot && p.id === myUserId) ||
      gameState.players.find((p) => !p.isBot);
    if (!me || me.resigned) {
      console.warn("[resign] sem jogador local ou já resigned", { myUserId, me });
      // Fallback: sair para o lobby de qualquer maneira
      onLeaveGame?.();
      return;
    }

    // Multiplayer: o servidor aplica a desistência ao estado (resigned flag,
    // avanço de vez, vitória por abandono + settle). O cliente só sai.
    if (isMultiplayer && multiplayer?.gameId) {
      try {
        await api.games.resign(multiplayer.gameId);
      } catch (err) {
        console.error("[resign] falhou", err);
      }
      if (betAmount > 0) {
        toast.info(`Desististe — aposta de ${betAmount.toLocaleString()} Kz perdida.`);
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
      setTimeout(() => onLeaveGame?.(), 250);
      return;
    }

    if (betAmount > 0) {
      toast.info(`Desististe — aposta de ${betAmount.toLocaleString()} Kz perdida.`);
    }

    const newPlayers = gameState.players.map((p) =>
      p.id === me.id ? { ...p, resigned: true } : p,
    );
    const stillActive = newPlayers.filter((p) => !p.resigned);

    // Verificar se o jogo termina ou continua (humanos restantes).
    // Bots não contam como "vencedor humano" — se sobrar só bot, jogo acaba.
    const stillActiveHumans = stillActive.filter((p) => !p.isBot);
    const willEnd = stillActive.length <= 1 || stillActiveHumans.length === 0;

    let ns: GameState;
    if (willEnd) {
      // Único restante (humano ou bot) é declarado vencedor pelo servidor no settle.
      const winnerId = stillActive[0]?.id ?? null;
      if (timerRef.current) clearInterval(timerRef.current);
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
      ns = { ...gameState, players: newPlayers, winner: winnerId, phase: "finished" };
      setGameState(ns);
      if (winnerId) onGameEnd?.(winnerId);
      // Se o vencedor é bot (jogo de single-player), o user humano sai para
      // o lobby — a vitória do bot é apenas processada no servidor (rake)
      // e não há modal de "Vitória" para um bot.
      const winnerIsBot = !!stillActive[0]?.isBot;
      if (winnerIsBot) {
        setTimeout(() => onLeaveGame?.(), 250);
      }
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
        phase: "rolling" as const,
        turnTimer: 15,
        consecutiveSixes: 0,
      };
      setGameState(ns);
      // O user que desistiu sai imediatamente para o lobby (modo local).
      setTimeout(() => onLeaveGame?.(), 250);
    }
  }, [
    gameState,
    onGameEnd,
    onLeaveGame,
    betAmount,
    myUserId,
    isMultiplayer,
    multiplayer,
    nextActiveIdx,
  ]);

  const nextTurn = useCallback(() => {
    setGameState((prev) => {
      const next = nextActiveIdx(prev.players, prev.currentPlayerIndex);
      const ns = {
        ...prev,
        currentPlayerIndex: next,
        diceValue: null,
        phase: "rolling" as const,
        turnTimer: 15,
        consecutiveSixes: 0,
      };
      if (isMultiplayer) pushState(ns);
      return ns;
    });
  }, [isMultiplayer, pushState, nextActiveIdx]);

  // Personalidade do bot: cada bot tem um "tempo de reacção" próprio e
  // estável (0.7x rápido a 1.4x pensativo), derivado do id — parece mais
  // humano do que todos os bots reagirem ao mesmo ritmo.
  const botTempo = (id: string) => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
    return 0.7 + (h % 100) / 140;
  };

  // Bot auto-play — in multiplayer, only the host drives bots.
  useEffect(() => {
    if (gameState.phase === "finished") return;
    if (!currentPlayer?.isBot) return;
    if (isMultiplayer && !isBotDriver) return;
    const tempo = botTempo(currentPlayer.id);
    if (gameState.phase === "rolling") {
      botTimeoutRef.current = setTimeout(
        () => handleRollDice(),
        (1000 + Math.random() * 1500) * tempo,
      );
    } else if (gameState.phase === "moving" && gameState.diceValue) {
      botTimeoutRef.current = setTimeout(
        () => {
          const pieceId = botChoosePiece(currentPlayer, gameState.diceValue!, gameState);
          if (pieceId >= 0) {
            handleMovePiece(pieceId);
          } else {
            nextTurn();
          }
        },
        (800 + Math.random() * 1200) * tempo,
      );
    }
    return () => {
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    };
  }, [
    gameState,
    currentPlayer,
    isMultiplayer,
    isBotDriver,
    handleRollDice,
    handleMovePiece,
    nextTurn,
  ]);

  // Auto-play: quando um humano esta em auto-play, o bot AI joga por ele.
  const autoPlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (gameState.phase === "finished") return;
    if (!currentPlayer || currentPlayer.isBot || currentPlayer.resigned) return;
    if (!autoPlay.has(currentPlayer.id)) return;
    if (isMultiplayer && !isBotDriver) return;

    if (gameState.phase === "rolling") {
      autoPlayTimeoutRef.current = setTimeout(() => handleRollDice(), 600 + Math.random() * 800);
    } else if (gameState.phase === "moving" && gameState.diceValue) {
      autoPlayTimeoutRef.current = setTimeout(
        () => {
          const pieceId = botChoosePiece(currentPlayer, gameState.diceValue!, gameState);
          if (pieceId >= 0) {
            handleMovePiece(pieceId);
          } else {
            nextTurn();
          }
        },
        500 + Math.random() * 600,
      );
    }
    return () => {
      if (autoPlayTimeoutRef.current) clearTimeout(autoPlayTimeoutRef.current);
    };
  }, [
    gameState,
    currentPlayer,
    autoPlay,
    isMultiplayer,
    isBotDriver,
    handleRollDice,
    handleMovePiece,
    nextTurn,
  ]);

  const movablePieces =
    gameState.phase === "moving" && gameState.diceValue
      ? getMovablePieces(currentPlayer, gameState.diceValue)
      : [];

  const cellSize = 100 / 15;

  // --- Waypoint system: rastreia posicoes anteriores para gerar caminho casa-a-casa ---
  // Usa um ref "snapshot" que so e actualizado APOS o render via useEffect.
  // Assim, durante o render actual, `prevPositionsRef` contem os valores do render anterior.
  const prevPositionsRef = useRef<Map<string, number>>(new Map());
  const pendingPositionsRef = useRef<Map<string, number>>(new Map());

  // Copiar pending → prev APOS o render (layout effect seria melhor mas useEffect basta)
  useEffect(() => {
    prevPositionsRef.current = new Map(pendingPositionsRef.current);
  });

  /** Coordenadas de ecra para uma posicao interna do ludo. */
  const screenPos = (pos: number, color: PlayerColor): { x: number; y: number } | null => {
    if (pos < 0) return null;
    if (pos >= 57) return { x: 7.5 * cellSize, y: 7.5 * cellSize };
    if (pos >= 52) {
      const idx = pos - 52;
      const cell = HOME_STRETCH.find(
        (c) => c.homeStretchColor === color && c.homeStretchIndex === idx,
      );
      if (cell)
        return { x: cell.col * cellSize + cellSize / 2, y: cell.row * cellSize + cellSize / 2 };
      return { x: 7.5 * cellSize, y: 7.5 * cellSize };
    }
    const absPos = (pos + START_POSITIONS[color]) % 52;
    const cell = BOARD_PATH.find((c) => c.absolutePosition === absPos);
    if (cell)
      return { x: cell.col * cellSize + cellSize / 2, y: cell.row * cellSize + cellSize / 2 };
    return { x: 50, y: 50 };
  };

  /** Gera waypoints entre oldPos e newPos (apenas avancos). */
  const buildWaypoints = (oldPos: number, newPos: number, color: PlayerColor): Waypoint[] => {
    if (oldPos < 0 || newPos <= oldPos) return [];
    const pts: Waypoint[] = [];
    for (let p = oldPos + 1; p < newPos && pts.length < 6; p++) {
      const pt = screenPos(p, color);
      if (pt) pts.push(pt);
    }
    return pts;
  };

  const getPieceScreenPos = (piece: {
    position: number;
    color: PlayerColor;
    isFinished: boolean;
  }) => {
    if (piece.isFinished) return { x: 7.5 * cellSize, y: 7.5 * cellSize };
    if (piece.position === -1) return null;
    if (piece.position >= 52) {
      const idx = piece.position - 52;
      const cell = HOME_STRETCH.find(
        (c) => c.homeStretchColor === piece.color && c.homeStretchIndex === idx,
      );
      if (cell)
        return { x: cell.col * cellSize + cellSize / 2, y: cell.row * cellSize + cellSize / 2 };
      return { x: 7.5 * cellSize, y: 7.5 * cellSize };
    }
    const absPos = (piece.position + START_POSITIONS[piece.color]) % 52;
    const cell = BOARD_PATH.find((c) => c.absolutePosition === absPos);
    if (cell)
      return { x: cell.col * cellSize + cellSize / 2, y: cell.row * cellSize + cellSize / 2 };
    return { x: 50, y: 50 };
  };

  const TURN_SECONDS = 15;
  const timerPercent = gameState.turnTimer / TURN_SECONDS;
  const timerCircumference = 2 * Math.PI * 24;
  const ringColor = timerPercent > 0.5 ? "#22c55e" : timerPercent > 0.2 ? "#facc15" : "#ef4444";
  const isUrgent = gameState.turnTimer <= 5;

  // ---------------------------------------------------------------------------
  // Corner mapping — cada jogador no canto da sua cor (apos rotacao do board)
  // Original: red=TL(0), blue=TR(1), green=BR(2), yellow=BL(3)
  // Visual: 0=TL, 1=TR, 2=BR, 3=BL
  // ---------------------------------------------------------------------------
  const cornerPlayers = (() => {
    const ORIG: Record<PlayerColor, number> = { red: 0, blue: 1, green: 2, yellow: 3 };
    const steps = boardRotation / 90;
    const result: (Player | undefined)[] = [undefined, undefined, undefined, undefined];
    for (const p of gameState.players) {
      const visual = (ORIG[p.color] + steps) % 4;
      result[visual] = p;
    }
    return result; // [TL, TR, BR, BL]
  })();

  /** Widget de canto — avatar + nome + dado com timer ring (so na vez do jogador) */
  const renderCorner = (player: Player | undefined, align: "left" | "right") => {
    if (!player) return <div className="w-[100px]" />;

    const idx = gameState.players.indexOf(player);
    const isCurrent = idx === gameState.currentPlayerIndex && !player.resigned;
    const isMe = player.id === myUserId;
    const isInAutoPlay = autoPlay.has(player.id);
    const canRollThis =
      gameState.phase === "rolling" &&
      isCurrent &&
      isMe &&
      !animatingDice &&
      !player.isBot &&
      !isInAutoPlay;
    const showDice = isCurrent && !player.resigned;

    const handleClick = () => {
      if (!canRollThis) return;
      handleRollDice();
    };

    return (
      <div
        className={`flex items-center gap-1.5 transition-opacity ${
          isCurrent ? "" : "opacity-60"
        } ${player.resigned ? "grayscale opacity-30" : ""} ${
          align === "right" ? "flex-row-reverse text-right" : ""
        }`}
      >
        <PlayerAvatar
          name={player.name}
          color={player.color}
          avatarUrl={player.avatarUrl}
          size={38}
          isActive={isCurrent}
          isBot={player.isBot}
          resigned={player.resigned}
        />
        <div className="leading-tight min-w-0">
          <p
            className={`text-[11px] font-bold truncate max-w-[80px] ${player.resigned ? "line-through" : ""}`}
            style={{ color: COLORS[player.color] }}
          >
            {isMe ? "Tu" : player.name}
          </p>
          <p
            className={`text-[9px] uppercase tracking-wider font-bold ${
              isCurrent ? "text-amber-300" : "text-muted-foreground"
            }`}
          >
            {player.resigned ? "Saiu" : isCurrent ? "A jogar..." : "Aguarda"}
          </p>
        </div>
        {showDice && (
          <button
            type="button"
            onClick={handleClick}
            disabled={!canRollThis}
            className={`relative outline-none shrink-0 transition-transform ${
              canRollThis
                ? "cursor-pointer hover:scale-110 active:scale-95 anim-pulse-glow"
                : "cursor-default"
            }`}
            style={{
              filter: canRollThis
                ? "drop-shadow(0 0 14px #fbbf24cc)"
                : `drop-shadow(0 0 4px ${ringColor}88)`,
            }}
          >
            <div className="relative w-[52px] h-[52px]">
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 56 56">
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="3"
                />
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={timerCircumference}
                  strokeDashoffset={timerCircumference * (1 - timerPercent)}
                  style={{ transition: "stroke-dashoffset 1s linear, stroke 240ms" }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <Dice
                  value={gameState.diceValue || 1}
                  isRolling={animatingDice}
                  size={30}
                  theme="gold"
                />
              </div>
            </div>
            <span
              className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-mono font-extrabold px-1 rounded-sm ${
                isUrgent ? "animate-pulse" : ""
              }`}
              style={{
                color: ringColor,
                background: `${ringColor}1a`,
                border: `1px solid ${ringColor}44`,
              }}
            >
              {gameState.turnTimer}s
            </span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col lg:flex-row lg:gap-4 w-full lg:max-w-[1200px] mx-auto h-[100dvh] lg:h-[calc(100vh-2rem)] relative overflow-hidden">
      {/* Notification banner */}
      {notification && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-50 bg-yellow-500 text-black font-bold px-6 py-2 rounded-b-xl flex items-center gap-2 text-sm animate-bounce shadow-lg">
          ⚔️ {notification}
        </div>
      )}

      {/* POT fixo no topo (mobile) */}
      {betAmount > 0 && (
        <div className="flex lg:hidden justify-center pt-1">
          <div
            className="rounded-full px-4 py-0.5 flex items-center gap-1.5 shadow"
            style={{
              background: "var(--grad-pot)",
              boxShadow: "0 3px 10px rgba(245,158,11,0.30), inset 0 1px 0 rgba(255,255,255,0.4)",
            }}
          >
            <span className="text-[8px] uppercase tracking-wider font-bold text-amber-950/85">
              Pot
            </span>
            <span className="text-sm font-extrabold text-amber-950 leading-none">
              {potTotal.toLocaleString()} Kz
            </span>
          </div>
        </div>
      )}

      {/* TOP row — jogadores TL + TR (estilo Ludo Star) */}
      <div className="flex lg:hidden items-end justify-between w-full px-1">
        {renderCorner(cornerPlayers[0], "left")}
        {renderCorner(cornerPlayers[1], "right")}
      </div>

      {/* LEFT SIDEBAR - Players (desktop) */}
      <div className="hidden lg:flex w-64 flex-shrink-0 flex-col gap-3">
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-foreground tracking-wider uppercase">
              Jogadores
            </span>
            <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded font-bold">
              EM JOGO
            </span>
          </div>
          <div className="space-y-2">
            {gameState.players.map((p, i) => {
              const isActive = i === gameState.currentPlayerIndex && !p.resigned;
              const pieceDots = p.pieces.map((pc) =>
                pc.isFinished ? "finished" : pc.position >= 0 ? "out" : "home",
              );
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 p-2 rounded-lg transition-all ${
                    isActive ? "bg-secondary/60 shadow-md" : "opacity-70"
                  }`}
                >
                  <PlayerAvatar
                    name={p.name}
                    color={p.color}
                    avatarUrl={p.avatarUrl}
                    size={36}
                    isActive={isActive}
                    isBot={p.isBot}
                    resigned={p.resigned}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate" style={{ color: COLORS[p.color] }}>
                      {p.name.toUpperCase()}
                    </p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                      {COLOR_LABELS[p.color]}
                      {p.resigned ? " · DESISTIU" : ""}
                    </p>
                    <div className="flex gap-1 mt-1">
                      {pieceDots.map((s, di) => (
                        <div
                          key={di}
                          className="w-2 h-2 rounded-full transition-colors"
                          style={{
                            backgroundColor:
                              s === "finished"
                                ? "#fde68a"
                                : s === "out"
                                  ? COLORS[p.color]
                                  : "rgba(255,255,255,0.18)",
                            boxShadow: s === "finished" ? "0 0 4px rgba(253,230,138,0.7)" : "none",
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
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Próximo a Jogar
          </span>
          <div className="flex items-center gap-2 mt-1">
            <span style={{ color: COLORS[currentPlayer?.color || "red"] }}>▶▶</span>
            <span className="text-sm font-bold text-foreground">
              {currentPlayer?.name?.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* CENTER - Board + corners + buttons */}
      <div className="flex-1 flex flex-col items-center min-w-0 w-full min-h-0">
        {/* Board outer (mantém background + shadow; não roda) */}
        <div
          className="relative w-full lg:max-w-[640px] aspect-square rounded-2xl lg:rounded-2xl overflow-hidden"
          style={{
            background: "var(--grad-board)",
            boxShadow:
              "inset 0 2px 6px rgba(0,0,0,0.55), inset 0 -2px 6px rgba(255,255,255,0.04), 0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)",
          }}
        >
          {/* Inner — roda o conteúdo (svg + chips) para a cor do user ficar em baixo */}
          <div
            className="absolute inset-0"
            style={{
              transform: `rotate(${boardRotation}deg)`,
              transformOrigin: "50% 50%",
              transition: "transform 600ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* Os nomes dos jogadores estão agora nos PlayerSlot top/bottom (fora do tabuleiro). */}

            <svg viewBox="0 0 100 100" className="w-full h-full">
              <defs>
                {/* Per-color gradients for home bases (radial, lighter at center) */}
                <radialGradient id="g-home-red" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0.85" />
                </radialGradient>
                <radialGradient id="g-home-blue" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0.85" />
                </radialGradient>
                <radialGradient id="g-home-yellow" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="#facc15" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#854d0e" stopOpacity="0.85" />
                </radialGradient>
                <radialGradient id="g-home-green" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#14532d" stopOpacity="0.85" />
                </radialGradient>

                {/* Inner pad of home base (where pieces sit) */}
                <radialGradient id="g-home-pad" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="rgba(0,0,0,0.55)" />
                  <stop offset="100%" stopColor="rgba(0,0,0,0.78)" />
                </radialGradient>

                {/* Center "trophy" gold gradient */}
                <radialGradient id="g-center-gold" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="#fde68a" stopOpacity="0.85" />
                  <stop offset="55%" stopColor="#f59e0b" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#78350f" stopOpacity="0.55" />
                </radialGradient>

                {/* Star glow filter */}
                <filter id="f-star-glow" x="-100%" y="-100%" width="300%" height="300%">
                  <feGaussianBlur stdDeviation="0.6" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                {/* Per-color piece gradients (radial, light → base → dark) */}
                <radialGradient id="g-piece-red" cx="35%" cy="30%" r="65%">
                  <stop offset="0%" stopColor="#fecaca" />
                  <stop offset="55%" stopColor="#ef4444" />
                  <stop offset="100%" stopColor="#7f1d1d" />
                </radialGradient>
                <radialGradient id="g-piece-blue" cx="35%" cy="30%" r="65%">
                  <stop offset="0%" stopColor="#bfdbfe" />
                  <stop offset="55%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#1e3a8a" />
                </radialGradient>
                <radialGradient id="g-piece-yellow" cx="35%" cy="30%" r="65%">
                  <stop offset="0%" stopColor="#fef3c7" />
                  <stop offset="55%" stopColor="#facc15" />
                  <stop offset="100%" stopColor="#854d0e" />
                </radialGradient>
                <radialGradient id="g-piece-green" cx="35%" cy="30%" r="65%">
                  <stop offset="0%" stopColor="#bbf7d0" />
                  <stop offset="55%" stopColor="#22c55e" />
                  <stop offset="100%" stopColor="#14532d" />
                </radialGradient>

                {/* Subtle inner-shadow for board */}
                <filter id="f-inner-shadow">
                  <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" />
                  <feOffset dx="0" dy="0.6" result="offsetblur" />
                  <feFlood floodColor="#000" floodOpacity="0.65" />
                  <feComposite in2="offsetblur" operator="in" />
                  <feComposite
                    in2="SourceAlpha"
                    operator="arithmetic"
                    k2="-1"
                    k3="1"
                    result="inner"
                  />
                  <feMerge>
                    <feMergeNode in="SourceGraphic" />
                    <feMergeNode in="inner" />
                  </feMerge>
                </filter>
              </defs>

              {/* Outer board surface — soft inner shadow vinette */}
              <rect
                x="0.2"
                y="0.2"
                width="99.6"
                height="99.6"
                rx="3.5"
                fill="rgba(255,255,255,0.025)"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="0.18"
              />

              {/* Home bases with radial gradients + inner pad */}
              {/* Red (top-left) */}
              <rect
                x={0.5 * cellSize}
                y={0.5 * cellSize}
                width={5 * cellSize}
                height={5 * cellSize}
                rx="2"
                fill="url(#g-home-red)"
                stroke={COLORS.red}
                strokeWidth="0.45"
              />
              <rect
                x={1.5 * cellSize}
                y={1.5 * cellSize}
                width={3 * cellSize}
                height={3 * cellSize}
                rx="1.4"
                fill="url(#g-home-pad)"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="0.18"
              />
              {/* Blue (top-right) */}
              <rect
                x={9.5 * cellSize}
                y={0.5 * cellSize}
                width={5 * cellSize}
                height={5 * cellSize}
                rx="2"
                fill="url(#g-home-blue)"
                stroke={COLORS.blue}
                strokeWidth="0.45"
              />
              <rect
                x={10.5 * cellSize}
                y={1.5 * cellSize}
                width={3 * cellSize}
                height={3 * cellSize}
                rx="1.4"
                fill="url(#g-home-pad)"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="0.18"
              />
              {/* Yellow (bottom-left) */}
              <rect
                x={0.5 * cellSize}
                y={9.5 * cellSize}
                width={5 * cellSize}
                height={5 * cellSize}
                rx="2"
                fill="url(#g-home-yellow)"
                stroke={COLORS.yellow}
                strokeWidth="0.45"
              />
              <rect
                x={1.5 * cellSize}
                y={10.5 * cellSize}
                width={3 * cellSize}
                height={3 * cellSize}
                rx="1.4"
                fill="url(#g-home-pad)"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="0.18"
              />
              {/* Green (bottom-right) */}
              <rect
                x={9.5 * cellSize}
                y={9.5 * cellSize}
                width={5 * cellSize}
                height={5 * cellSize}
                rx="2"
                fill="url(#g-home-green)"
                stroke={COLORS.green}
                strokeWidth="0.45"
              />
              <rect
                x={10.5 * cellSize}
                y={10.5 * cellSize}
                width={3 * cellSize}
                height={3 * cellSize}
                rx="1.4"
                fill="url(#g-home-pad)"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="0.18"
              />

              {/* Center "trophy" zone — gold gradient diamond */}
              <polygon
                points={`${7.5 * cellSize},${6 * cellSize} ${9 * cellSize},${7.5 * cellSize} ${7.5 * cellSize},${9 * cellSize} ${6 * cellSize},${7.5 * cellSize}`}
                fill="url(#g-center-gold)"
                stroke="#f59e0b"
                strokeWidth="0.25"
                strokeOpacity="0.5"
              />
              {/* Troféu SVG inline — renderização consistente em todos os browsers */}
              <g
                transform={`translate(${7.5 * cellSize}, ${7.5 * cellSize}) scale(0.045)`}
                style={{ filter: "drop-shadow(0 0.5px 1px rgba(0,0,0,0.55))" }}
              >
                {/* Pegas laterais */}
                <path
                  d="M -28 -28 Q -42 -28 -42 -16 Q -42 -4 -28 -4"
                  stroke="#fbbf24"
                  strokeWidth="6"
                  fill="none"
                  strokeLinecap="round"
                />
                <path
                  d="M 28 -28 Q 42 -28 42 -16 Q 42 -4 28 -4"
                  stroke="#fbbf24"
                  strokeWidth="6"
                  fill="none"
                  strokeLinecap="round"
                />
                {/* Taça */}
                <path
                  d="M -32 -38 L 32 -38 L 28 14 Q 24 26 0 26 Q -24 26 -28 14 Z"
                  fill="#fbbf24"
                  stroke="#7c2d12"
                  strokeWidth="1.5"
                />
                {/* Borda superior brilhante */}
                <rect
                  x="-34"
                  y="-42"
                  width="68"
                  height="8"
                  rx="2"
                  fill="#fde68a"
                  stroke="#92400e"
                  strokeWidth="1"
                />
                {/* Estrela central */}
                <path
                  d="M 0 -22 L 4 -10 L 16 -10 L 6 -2 L 10 10 L 0 3 L -10 10 L -6 -2 L -16 -10 L -4 -10 Z"
                  fill="#fef3c7"
                  stroke="#92400e"
                  strokeWidth="1"
                />
                {/* Coluna */}
                <rect
                  x="-9"
                  y="26"
                  width="18"
                  height="14"
                  fill="#fbbf24"
                  stroke="#7c2d12"
                  strokeWidth="1"
                />
                {/* Base superior */}
                <rect
                  x="-22"
                  y="40"
                  width="44"
                  height="8"
                  rx="2"
                  fill="#fbbf24"
                  stroke="#7c2d12"
                  strokeWidth="1"
                />
                {/* Base inferior */}
                <rect x="-30" y="48" width="60" height="10" rx="2" fill="#92400e" />
                <rect x="-30" y="48" width="60" height="3" rx="1" fill="#fde68a" />
              </g>

              {/* Path cells */}
              {BOARD_PATH.map((cell, i) => {
                const isStart =
                  SAFE_POSITIONS.slice(0, 4).includes(cell.absolutePosition!) &&
                  [0, 13, 26, 39].includes(cell.absolutePosition!);
                const startColor =
                  cell.absolutePosition === 0
                    ? COLORS.red
                    : cell.absolutePosition === 13
                      ? COLORS.blue
                      : cell.absolutePosition === 26
                        ? COLORS.green
                        : cell.absolutePosition === 39
                          ? COLORS.yellow
                          : null;
                return (
                  <rect
                    key={`path-${i}`}
                    x={cell.col * cellSize + 0.18}
                    y={cell.row * cellSize + 0.18}
                    width={cellSize - 0.36}
                    height={cellSize - 0.36}
                    rx="0.5"
                    fill={
                      isStart && startColor
                        ? `${startColor}33`
                        : cell.type === "safe"
                          ? "rgba(255,255,255,0.10)"
                          : "rgba(255,255,255,0.04)"
                    }
                    stroke={isStart && startColor ? `${startColor}88` : "rgba(255,255,255,0.08)"}
                    strokeWidth="0.18"
                  />
                );
              })}

              {/* Stars on safe spots (NOT start cells — those get a globe) */}
              {BOARD_PATH.filter(
                (c) => c.type === "safe" && ![0, 13, 26, 39].includes(c.absolutePosition!),
              ).map((cell, i) => {
                const cx = cell.col * cellSize + cellSize / 2;
                const cy = cell.row * cellSize + cellSize / 2;
                const r = 1.4;
                // 5-point star polygon
                const pts: string[] = [];
                for (let k = 0; k < 10; k++) {
                  const angle = (Math.PI / 5) * k - Math.PI / 2;
                  const rr = k % 2 === 0 ? r : r * 0.45;
                  pts.push(`${cx + Math.cos(angle) * rr},${cy + Math.sin(angle) * rr}`);
                }
                return (
                  <polygon
                    key={`safe-${i}`}
                    points={pts.join(" ")}
                    fill="#fde68a"
                    stroke="#f59e0b"
                    strokeWidth="0.18"
                    filter="url(#f-star-glow)"
                    opacity="0.85"
                  />
                );
              })}

              {/* Globe markers on the 4 start cells */}
              {BOARD_PATH.filter((c) => [0, 13, 26, 39].includes(c.absolutePosition!)).map(
                (cell, i) => {
                  const cx = cell.col * cellSize + cellSize / 2;
                  const cy = cell.row * cellSize + cellSize / 2;
                  const startColor =
                    cell.absolutePosition === 0
                      ? COLORS.red
                      : cell.absolutePosition === 13
                        ? COLORS.blue
                        : cell.absolutePosition === 26
                          ? COLORS.green
                          : COLORS.yellow;
                  return (
                    <g key={`globe-${i}`} opacity="0.9">
                      <circle
                        cx={cx}
                        cy={cy}
                        r={1.6}
                        fill="rgba(255,255,255,0.95)"
                        stroke={startColor}
                        strokeWidth="0.25"
                      />
                      <ellipse
                        cx={cx}
                        cy={cy}
                        rx="1.6"
                        ry="0.55"
                        fill="none"
                        stroke={startColor}
                        strokeWidth="0.18"
                      />
                      <line
                        x1={cx - 1.6}
                        y1={cy}
                        x2={cx + 1.6}
                        y2={cy}
                        stroke={startColor}
                        strokeWidth="0.16"
                      />
                      <line
                        x1={cx}
                        y1={cy - 1.6}
                        x2={cx}
                        y2={cy + 1.6}
                        stroke={startColor}
                        strokeWidth="0.16"
                      />
                    </g>
                  );
                },
              )}

              {/* Home stretch cells — gradient towards the center */}
              {HOME_STRETCH.map((cell, i) => (
                <rect
                  key={`hs-${i}`}
                  x={cell.col * cellSize + 0.18}
                  y={cell.row * cellSize + 0.18}
                  width={cellSize - 0.36}
                  height={cellSize - 0.36}
                  rx="0.5"
                  fill={COLORS[cell.homeStretchColor!]}
                  opacity={0.18 + (cell.homeStretchIndex || 0) * 0.07}
                  stroke={COLORS[cell.homeStretchColor!]}
                  strokeWidth="0.18"
                  strokeOpacity="0.5"
                />
              ))}

              {/* Unified piece rendering — single GamePiece per (player, piece)
                with stable key so Framer Motion animates moves between
                home / track / home-stretch / finished positions.
                Peças que partilham a mesma casa do tabuleiro recebem um
                pequeno offset para ficarem visíveis (não se sobrepõem). */}
              {(() => {
                const homePositions: Record<PlayerColor, [number, number][]> = {
                  red: [
                    [2, 2],
                    [2, 4],
                    [4, 2],
                    [4, 4],
                  ],
                  blue: [
                    [2, 11],
                    [2, 13],
                    [4, 11],
                    [4, 13],
                  ],
                  yellow: [
                    [11, 2],
                    [11, 4],
                    [13, 2],
                    [13, 4],
                  ],
                  green: [
                    [11, 11],
                    [11, 13],
                    [13, 11],
                    [13, 13],
                  ],
                };

                // 1) Agrupar peças que estão na mesma célula do tabuleiro/home-stretch
                //    Key = "path-<absPos>" ou "hs-<color>-<index>"
                const cellGroups = new Map<string, Array<{ playerId: string; pieceId: number }>>();
                gameState.players.forEach((p) => {
                  if (p.resigned) return;
                  p.pieces.forEach((piece) => {
                    if (piece.isFinished || piece.position === -1) return;
                    let key: string;
                    if (piece.position >= 52) {
                      key = `hs-${p.color}-${piece.position - 52}`;
                    } else {
                      const absPos = (piece.position + START_POSITIONS[p.color]) % 52;
                      key = `path-${absPos}`;
                    }
                    if (!cellGroups.has(key)) cellGroups.set(key, []);
                    cellGroups.get(key)!.push({ playerId: p.id, pieceId: piece.id });
                  });
                });

                // 2) Helper de offset baseado no nº total e índice na célula
                const getStackOffset = (
                  idx: number,
                  total: number,
                  rBase: number,
                ): { dx: number; dy: number; rScale: number } => {
                  if (total <= 1) return { dx: 0, dy: 0, rScale: 1 };
                  if (total === 2) {
                    const off = rBase * 0.55;
                    return { dx: idx === 0 ? -off : off, dy: 0, rScale: 0.82 };
                  }
                  if (total === 3) {
                    // triângulo: 2 em cima, 1 em baixo
                    const off = rBase * 0.55;
                    if (idx === 0) return { dx: -off, dy: -off * 0.5, rScale: 0.72 };
                    if (idx === 1) return { dx: off, dy: -off * 0.5, rScale: 0.72 };
                    return { dx: 0, dy: off * 0.7, rScale: 0.72 };
                  }
                  // 4+: quadrado
                  const positions = [
                    { dx: -rBase * 0.5, dy: -rBase * 0.5 },
                    { dx: rBase * 0.5, dy: -rBase * 0.5 },
                    { dx: -rBase * 0.5, dy: rBase * 0.5 },
                    { dx: rBase * 0.5, dy: rBase * 0.5 },
                  ];
                  return { ...(positions[idx] ?? positions[0]!), rScale: 0.65 };
                };

                return gameState.players
                  .filter((pp) => !pp.resigned)
                  .flatMap((player) =>
                    player.pieces.map((piece) => {
                      let cx: number, cy: number, r: number;
                      let stackKey: string | null = null;

                      if (piece.isFinished) {
                        // Stack finished pieces in the center (ordered by id)
                        cx = 7.5 * cellSize + (piece.id - 1.5) * 1.5;
                        cy = 7.5 * cellSize;
                        r = cellSize / 4;
                      } else if (piece.position === -1) {
                        // In home base (4 slots per color)
                        const [row, col] =
                          homePositions[player.color][piece.id] || homePositions[player.color][0];
                        cx = col * cellSize + cellSize / 2;
                        cy = row * cellSize + cellSize / 2;
                        r = cellSize / 2.5;
                      } else {
                        const pos = getPieceScreenPos(piece);
                        if (!pos) return null;
                        cx = pos.x;
                        cy = pos.y;
                        r = cellSize / 2.8;
                        stackKey =
                          piece.position >= 52
                            ? `hs-${player.color}-${piece.position - 52}`
                            : `path-${(piece.position + START_POSITIONS[player.color]) % 52}`;
                      }

                      // Aplicar offset se partilhar célula
                      if (stackKey) {
                        const group = cellGroups.get(stackKey) ?? [];
                        if (group.length > 1) {
                          const idxInGroup = group.findIndex(
                            (g) => g.playerId === player.id && g.pieceId === piece.id,
                          );
                          const { dx, dy, rScale } = getStackOffset(idxInGroup, group.length, r);
                          cx += dx;
                          cy += dy;
                          r *= rScale;
                        }
                      }

                      const isMovable =
                        !piece.isFinished &&
                        movablePieces.includes(piece.id) &&
                        gameState.currentPlayerIndex === gameState.players.indexOf(player) &&
                        !player.isBot &&
                        (!isMultiplayer || player.id === myUserId) &&
                        !autoPlay.has(player.id);

                      const isPlayerTurn =
                        !piece.isFinished &&
                        gameState.currentPlayerIndex === gameState.players.indexOf(player);

                      let state: PieceState = "idle";
                      if (piece.isFinished) state = "finished";
                      else if (isMovable) state = "movable";
                      else if (isPlayerTurn) state = "turn";

                      // Waypoints: gerar caminho casa-a-casa
                      const pieceKey = `${player.color}-${piece.id}`;
                      const prevPos = prevPositionsRef.current.get(pieceKey);
                      const curPos = piece.position;
                      // Gravar posicao actual (sera copiada para prev apos este render)
                      pendingPositionsRef.current.set(pieceKey, curPos);

                      let waypoints: Waypoint[] | undefined;
                      if (prevPos !== undefined && curPos > prevPos && prevPos >= 0) {
                        const wp = buildWaypoints(prevPos, curPos, player.color);
                        if (wp.length > 0) waypoints = wp;
                      }

                      return (
                        <GamePiece
                          key={pieceKey}
                          color={player.color}
                          cx={cx}
                          cy={cy}
                          r={r}
                          state={state}
                          onClick={isMovable ? () => handleMovePiece(piece.id) : undefined}
                          waypoints={waypoints}
                        />
                      );
                    }),
                  );
              })()}

              {/* Capture bursts — visualizam capturas no sítio onde aconteceram */}
              {bursts.map((b) => (
                <CaptureBurst
                  key={b.id}
                  cx={b.cx}
                  cy={b.cy}
                  color={b.color}
                  onDone={() => setBursts((arr) => arr.filter((x) => x.id !== b.id))}
                />
              ))}
            </svg>
          </div>
        </div>

        {/* BOTTOM row — jogadores BL + BR (estilo Ludo Star) */}
        <div className="flex lg:hidden items-start justify-between w-full px-1 gap-1">
          {renderCorner(cornerPlayers[3], "left")}
          {renderCorner(cornerPlayers[2], "right")}
        </div>

        {/* AUTO-PLAY banner — aparece quando o jogador entra em modo auto */}
        {showAutoPlayBanner && myUserId && autoPlay.has(myUserId) && (
          <div
            className="w-full lg:max-w-[640px] rounded-xl px-4 py-2.5 flex items-center gap-3 border"
            style={{
              background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(168,85,247,0.15))",
              borderColor: "rgba(168,85,247,0.5)",
              boxShadow: "0 4px 16px rgba(139,92,246,0.2)",
            }}
          >
            <span className="text-lg">🤖</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-purple-200">
                Sempre que perdes um turno, a jogada é feita automaticamente.
              </p>
              <p className="text-[10px] text-purple-300/70 mt-0.5">
                Podes desativar o AUTO quando quiseres.
              </p>
            </div>
            <button
              onClick={() => {
                setAutoPlay((s) => {
                  const ns = new Set(s);
                  ns.delete(myUserId!);
                  return ns;
                });
                setShowAutoPlayBanner(false);
                toast.success("Modo AUTO desativado. Jogas tu agora!");
              }}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 active:scale-95"
              style={{
                background: "rgba(168,85,247,0.35)",
                border: "1px solid rgba(168,85,247,0.6)",
                color: "#e9d5ff",
              }}
            >
              <span
                className="w-4 h-4 rounded border-2 flex items-center justify-center"
                style={{
                  borderColor: "#a855f7",
                  background: "rgba(168,85,247,0.5)",
                }}
              >
                <span className="text-[10px] text-white font-bold">✓</span>
              </span>
              AUTO
            </button>
          </div>
        )}

        {/* Linha de botões — EMOJI / CHAT / AUTO / DESISTIR */}
        <div className="flex items-center justify-center gap-2 w-full lg:max-w-[640px] flex-wrap">
          {/* AUTO toggle button — sempre visivel para o jogador local */}
          {myUserId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAutoPlay((s) => {
                  const ns = new Set(s);
                  if (ns.has(myUserId!)) {
                    ns.delete(myUserId!);
                    setShowAutoPlayBanner(false);
                    toast.success("Modo AUTO desativado");
                  } else {
                    ns.add(myUserId!);
                    setShowAutoPlayBanner(true);
                    toast.info("Modo AUTO ativado — o bot joga por ti");
                  }
                  return ns;
                });
              }}
              className={`gap-1.5 text-xs font-bold border-purple-500/50 transition-transform hover:scale-105 active:scale-95 shadow-md ${
                autoPlay.has(myUserId)
                  ? "bg-purple-500/30 text-purple-200 ring-1 ring-purple-400/50"
                  : "bg-white/5 hover:bg-white/10 border-white/10"
              }`}
            >
              <span
                className="w-3.5 h-3.5 rounded border-2 flex items-center justify-center"
                style={{
                  borderColor: autoPlay.has(myUserId) ? "#a855f7" : "#64748b",
                  background: autoPlay.has(myUserId) ? "rgba(168,85,247,0.5)" : "transparent",
                }}
              >
                {autoPlay.has(myUserId) && (
                  <span className="text-[8px] text-white font-bold leading-none">✓</span>
                )}
              </span>
              AUTO
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowEmojiBar((s) => !s)}
            className={`gap-1.5 text-xs font-bold border-white/10 bg-white/5 hover:bg-white/10 hover:scale-105 active:scale-95 transition-transform shadow-md ${
              showEmojiBar ? "ring-1 ring-amber-400/50" : ""
            }`}
            aria-label="Toggle emoji bar"
          >
            <span className="text-base leading-none">😀</span>
            EMOJI
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowChat((s) => !s)}
            className={`gap-1.5 text-xs font-bold border-white/10 bg-white/5 hover:bg-white/10 hover:scale-105 active:scale-95 transition-transform shadow-md ${
              showChat ? "ring-1 ring-primary/50" : ""
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            CHAT
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowResignConfirm(true)}
            disabled={gameState.phase === "finished"}
            className="gap-1.5 text-xs font-bold border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive hover:scale-105 active:scale-95 transition-transform shadow-md"
          >
            <Flag className="w-3.5 h-3.5" />
            DESISTIR
          </Button>
        </div>

        {/* Quick emoji bar (separada do chat) */}
        {showEmojiBar && (
          <div
            className="w-full lg:max-w-[640px] rounded-xl p-2 border border-white/10 backdrop-blur"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            <div className="flex gap-1 overflow-x-auto">
              {[
                "😂",
                "😎",
                "🔥",
                "💀",
                "🤡",
                "👑",
                "🎲",
                "🏆",
                "😭",
                "🤣",
                "👏",
                "💪",
                "🤔",
                "😱",
                "🥶",
                "🫡",
              ].map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    // Envia ao chat directamente como mensagem de emoji
                    setShowChat(true);
                    // Vai disparar como mensagem do user via GameChat (visível). Truque:
                    // simulamos um envio pelo handler do chat. Para simplicidade,
                    // copiamos o emoji para clipboard como fallback.
                    const ev = new CustomEvent("nanter-quick-emoji", { detail: e });
                    window.dispatchEvent(ev);
                  }}
                  className="shrink-0 text-2xl hover:scale-125 transition-transform p-1"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat — escondido por defeito em todos os ecrãs; só aparece ao clicar no botão CHAT */}
        <div className={`w-full lg:max-w-[640px] ${showChat ? "block" : "hidden"}`}>
          <GameChat
            players={gameState.players}
            currentUserId={
              myUserId || gameState.players.find((p) => !p.isBot)?.id || gameState.players[0].id
            }
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
          <div
            className="rounded-xl p-4 relative overflow-hidden"
            style={{
              background: "var(--grad-pot)",
              boxShadow: "0 8px 30px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.4)",
            }}
          >
            {/* shine sweep */}
            <span
              aria-hidden
              className="absolute top-0 left-0 h-full w-1/3 pointer-events-none"
              style={{
                background:
                  "linear-gradient(110deg, transparent, rgba(255,255,255,0.45), transparent)",
                animation: "nanter-coin-shine 3.5s ease-in-out infinite",
              }}
            />
            <div className="flex items-center justify-between mb-1 relative z-10">
              <span className="text-xs font-bold uppercase text-amber-950/80 tracking-wider">
                Pot Total
              </span>
              <span className="text-[10px] text-amber-950/70 font-semibold">RAKE 5%</span>
            </div>
            <p className="text-2xl font-extrabold text-amber-950 relative z-10 tracking-tight">
              Kz {potTotal.toLocaleString("pt-AO", { minimumFractionDigits: 2 })}
            </p>
          </div>
        )}

        {/* History */}
        <div className="bg-card rounded-xl border border-border p-3 flex-1 overflow-hidden flex flex-col">
          <span className="text-xs font-bold text-foreground tracking-wider uppercase mb-2">
            Histórico
          </span>
          <div className="flex-1 overflow-y-auto space-y-1.5 scrollbar-thin">
            {gameLog.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                O jogo vai começar...
              </p>
            ) : (
              gameLog.map((entry) => (
                <div
                  key={entry.id}
                  className={`text-xs p-2 rounded-lg flex items-start gap-2 ${
                    entry.highlight ? "bg-primary/15 border border-primary/30" : "bg-secondary/30"
                  }`}
                >
                  <div
                    className="w-2 h-2 rounded-full mt-0.5 flex-shrink-0"
                    style={{ backgroundColor: COLORS[entry.color] }}
                  />
                  <span
                    className={
                      entry.highlight ? "font-bold text-foreground" : "text-muted-foreground"
                    }
                  >
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
            {betAmount > 0 ? (
              <>
                <p className="text-sm text-muted-foreground mb-2">
                  Vais perder esta partida e a tua aposta de{" "}
                  <span className="font-extrabold text-rose-300">
                    {betAmount.toLocaleString()} Kz
                  </span>
                  .
                </p>
                <p className="text-xs font-bold mb-6" style={{ color: "#fda4af" }}>
                  ⚠ Sem reembolso. A aposta vai para o pot do vencedor.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground mb-6">Vais perder esta partida.</p>
            )}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowResignConfirm(false)}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleResign} className="flex-1">
                Desistir
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Victory modal — confetti + Trophy + count-up + sound */}
      {(() => {
        const winnerPlayer = gameState.winner
          ? gameState.players.find((p) => p.id === gameState.winner)
          : null;
        const isMe = !!(winnerPlayer && winnerPlayer.id === myUserId);
        return (
          <VictoryModal
            open={!!gameState.winner}
            winnerName={winnerPlayer?.name || "Jogador"}
            winnerColor={winnerPlayer?.color}
            winnerId={gameState.winner}
            pot={betAmount > 0 ? potTotal : undefined}
            betAmount={betAmount}
            players={gameState.players}
            myUserId={myUserId}
            isMe={isMe}
            onClose={() => {
              if (onLeaveGame) onLeaveGame();
              else window.location.reload();
            }}
          />
        );
      })()}
    </div>
  );
}
