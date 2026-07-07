import { motion } from "framer-motion";
import type { PlayerColor } from "@/lib/ludo-engine";

const COLORS: Record<PlayerColor, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#facc15",
};

interface BurstProps {
  /** Coordenadas em viewBox 0-100 */
  cx: number;
  cy: number;
  /** Cor da peça capturada */
  color: PlayerColor;
  onDone?: () => void;
}

/**
 * Explosão que aparece no sítio onde uma peça foi capturada.
 *  - Anel branco que expande e fade
 *  - 12 partículas pequenas voando para fora na cor da peça
 *  - Estrela "X" de 4 raios brilhante a fechar
 *
 * Renderizada DENTRO do SVG do tabuleiro (viewBox 0-100). Auto-destroi-se
 * após 700ms via `onDone`.
 */
export function CaptureBurst({ cx, cy, color, onDone }: BurstProps) {
  const PARTICLES = 12;
  return (
    <motion.g
      initial={{ opacity: 1 }}
      animate={{ opacity: [1, 1, 0] }}
      transition={{ duration: 0.7, times: [0, 0.6, 1] }}
      onAnimationComplete={() => onDone?.()}
      style={{ pointerEvents: "none" }}
    >
      {/* Flash central */}
      <motion.circle
        cx={cx}
        cy={cy}
        r={1.5}
        fill="#fff"
        initial={{ r: 1, opacity: 1 }}
        animate={{ r: 5, opacity: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      />

      {/* Anel expansivo */}
      <motion.circle
        cx={cx}
        cy={cy}
        r={2}
        fill="none"
        stroke={COLORS[color]}
        strokeWidth={0.5}
        initial={{ r: 1, opacity: 0.85, strokeWidth: 0.8 }}
        animate={{ r: 7, opacity: 0, strokeWidth: 0.1 }}
        transition={{ duration: 0.65, ease: "easeOut" }}
      />

      {/* Partículas radiais */}
      {Array.from({ length: PARTICLES }).map((_, i) => {
        const angle = (i / PARTICLES) * Math.PI * 2;
        const distance = 4.5 + Math.random() * 2;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        const size = 0.4 + Math.random() * 0.5;
        return (
          <motion.circle
            key={i}
            cx={cx}
            cy={cy}
            r={size}
            fill={COLORS[color]}
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{ x: dx, y: dy, opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            style={{ filter: `drop-shadow(0 0 1px ${COLORS[color]})` }}
          />
        );
      })}

      {/* Estrelas de "impacto" — 4 raios em cruz */}
      {[0, 90, 180, 270].map((a) => (
        <motion.line
          key={a}
          x1={cx}
          y1={cy}
          x2={cx + Math.cos((a * Math.PI) / 180) * 4}
          y2={cy + Math.sin((a * Math.PI) / 180) * 4}
          stroke="#fde68a"
          strokeWidth={0.4}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0.95 }}
          animate={{ pathLength: 1, opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      ))}
    </motion.g>
  );
}
