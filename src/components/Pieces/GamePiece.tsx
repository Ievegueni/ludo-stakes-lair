import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import type { PlayerColor } from "@/lib/ludo-engine";
import { playSound } from "@/utils/sound";

export type PieceState = "idle" | "turn" | "movable" | "finished";

export interface Waypoint {
  x: number;
  y: number;
}

interface GamePieceProps {
  color: PlayerColor;
  cx: number;
  cy: number;
  r: number;
  state: PieceState;
  onClick?: () => void;
  waypoints?: Waypoint[];
  /** Pode ser comida no próximo lançamento — anel vermelho pulsante. */
  threatened?: boolean;
}

const SHADOW = "rgba(0,0,0,0.55)";

// Tempo entre cada casa (ms). Ajustar aqui para mais rapido/lento.
const STEP_DELAY = 160;

export function GamePiece({
  color,
  cx,
  cy,
  r,
  state,
  onClick,
  waypoints,
  threatened,
}: GamePieceProps) {
  const isMovable = state === "movable";
  const isTurn = state === "turn";

  // Posicao visual actual (o que o framer-motion anima)
  const [visualPos, setVisualPos] = useState({ x: cx, y: cy });
  // Incrementa a cada passo para re-disparar o "hop" (salto por casa)
  const [stepTick, setStepTick] = useState(0);
  const queueRef = useRef<Waypoint[]>([]);
  const processingRef = useRef(false);
  const prevTargetRef = useRef(`${cx},${cy}`);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      processingRef.current = false;
      // Aterragem — bounce final (stepTick 0 desliga o hop, o spring trata do resto)
      setStepTick(0);
      return;
    }
    processingRef.current = true;
    const next = queueRef.current.shift()!;
    setVisualPos(next);
    setStepTick((t) => t + 1);
    playSound("piece-step");
    timerRef.current = setTimeout(processNext, STEP_DELAY);
  }, []);

  useEffect(() => {
    const targetKey = `${cx},${cy}`;
    if (targetKey === prevTargetRef.current) return;
    prevTargetRef.current = targetKey;

    // Cancelar animacao em curso
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    processingRef.current = false;

    const hasWaypoints = waypoints && waypoints.length > 0;

    if (!hasWaypoints) {
      // Sem waypoints — mover directo (spring animation do framer-motion)
      queueRef.current = [];
      setVisualPos({ x: cx, y: cy });
      return;
    }

    // Com waypoints — enfileirar todos os pontos + destino final
    queueRef.current = [...waypoints, { x: cx, y: cy }];
    processNext();
  }, [cx, cy, waypoints, processNext]);

  // Cleanup no unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Transicao: rapida entre casas (waypoints), spring para saltos directos
  const hasQueue = processingRef.current || queueRef.current.length > 0;
  const transition = hasQueue
    ? { duration: STEP_DELAY / 1000, ease: "easeOut" as const }
    : { type: "spring" as const, stiffness: 280, damping: 22, mass: 0.7 };

  return (
    <motion.g
      initial={false}
      animate={{ x: visualPos.x, y: visualPos.y }}
      transition={transition}
      style={{ cursor: isMovable ? "pointer" : "default" }}
      onClick={onClick}
    >
      {/* Sombra — fica no chão enquanto a peça salta */}
      <ellipse cx={0} cy={r * 0.78} rx={r * 0.78} ry={r * 0.2} fill={SHADOW} pointerEvents="none" />

      {/* Hop: a cada casa a peça dá um pequeno salto (sobe e escala) */}
      <motion.g
        key={stepTick}
        initial={stepTick > 0 ? { y: 0, scale: 1 } : false}
        animate={
          stepTick > 0 ? { y: [0, -r * 0.55, 0], scale: [1, 1.12, 1] } : { y: 0, scale: [1.15, 1] }
        }
        transition={
          stepTick > 0
            ? { duration: STEP_DELAY / 1000, ease: "easeOut", times: [0, 0.45, 1] }
            : { duration: 0.25, ease: "easeOut" }
        }
      >
        {/* Halo pulsante quando movivel */}
        {isMovable && (
          <motion.circle
            cx={0}
            cy={0}
            r={r * 1.35}
            fill="none"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth={r * 0.14}
            initial={{ opacity: 0.35, scale: 0.85 }}
            animate={{ opacity: [0.35, 0.85, 0.35], scale: [0.85, 1.1, 0.85] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            pointerEvents="none"
          />
        )}

        {threatened && (
          <motion.circle
            cx={0}
            cy={0}
            r={r * 1.3}
            fill="none"
            stroke="#ef4444"
            strokeWidth={r * 0.16}
            animate={{ opacity: [0.25, 1, 0.25], scale: [0.95, 1.15, 0.95] }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
            pointerEvents="none"
          />
        )}

        {/* Glow quando e a vez */}
        {isTurn && (
          <circle
            cx={0}
            cy={0}
            r={r * 1.15}
            fill="none"
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={r * 0.1}
            pointerEvents="none"
          />
        )}

        {/* Corpo principal */}
        <circle
          cx={0}
          cy={0}
          r={r}
          fill={`url(#g-piece-${color})`}
          stroke="rgba(0,0,0,0.45)"
          strokeWidth={r * 0.08}
        />

        {/* Anel interno */}
        <circle
          cx={0}
          cy={0}
          r={r * 0.78}
          fill="none"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={r * 0.05}
          pointerEvents="none"
        />

        {/* Highlight (verniz) */}
        <ellipse
          cx={-r * 0.32}
          cy={-r * 0.4}
          rx={r * 0.45}
          ry={r * 0.28}
          fill="rgba(255,255,255,0.55)"
          pointerEvents="none"
        />

        {/* Coroa */}
        <g transform={`translate(0, ${-r * 0.05}) scale(${r * 0.32})`} pointerEvents="none">
          <path
            d="M -1.1 0.2 L -0.7 -0.7 L -0.3 -0.25 L 0 -0.95 L 0.3 -0.25 L 0.7 -0.7 L 1.1 0.2 Z"
            fill="#fde68a"
            stroke="rgba(120,80,0,0.55)"
            strokeWidth="0.08"
            strokeLinejoin="round"
          />
          <circle cx="-0.7" cy="-0.7" r="0.13" fill="#f59e0b" />
          <circle cx="0" cy="-0.95" r="0.14" fill="#f59e0b" />
          <circle cx="0.7" cy="-0.7" r="0.13" fill="#f59e0b" />
        </g>
      </motion.g>

      {/* Hitbox maior para mobile */}
      {isMovable && <circle cx={0} cy={0} r={r * 1.7} fill="transparent" />}
    </motion.g>
  );
}
