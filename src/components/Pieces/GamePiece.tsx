import { motion } from 'framer-motion';
import type { PlayerColor } from '@/lib/ludo-engine';

/**
 * Peça do Ludo — SVG único com:
 *  - corpo circular com gradient radial (definido em <defs> do SVG-pai com id `g-piece-<cor>`)
 *  - sombra elíptica inferior
 *  - coroa estilizada no topo
 *  - highlight (verniz) superior
 *  - halo pulsante quando movível
 *  - hitbox 60% maior quando movível
 *  - movimento via Framer Motion (spring)
 *
 * O componente é renderizado dentro de um `<svg viewBox="0 0 100 100">`
 * pelo que `cx`, `cy` e `r` são em "unidades de viewBox" (cellSize ≈ 6.66).
 *
 * Não altera lógica do jogo — apenas apresentação.
 */

export type PieceState = 'idle' | 'turn' | 'movable' | 'finished';

interface GamePieceProps {
  color: PlayerColor;
  cx: number;
  cy: number;
  r: number;
  state: PieceState;
  onClick?: () => void;
}

const SHADOW = 'rgba(0,0,0,0.55)';

export function GamePiece({ color, cx, cy, r, state, onClick }: GamePieceProps) {
  const isMovable = state === 'movable';
  const isTurn = state === 'turn';

  return (
    <motion.g
      initial={false}
      animate={{ x: cx, y: cy }}
      transition={{ type: 'spring', stiffness: 320, damping: 22, mass: 0.6 }}
      style={{ cursor: isMovable ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      {/* Sombra projectada por baixo da peça (independente do filter) */}
      <ellipse
        cx={0}
        cy={r * 0.78}
        rx={r * 0.78}
        ry={r * 0.20}
        fill={SHADOW}
        pointerEvents="none"
      />

      {/* Halo pulsante quando movível */}
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
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          pointerEvents="none"
        />
      )}

      {/* Glow estático quando é a vez do jogador (não movível) */}
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

      {/* Corpo principal — gradient radial via id no <defs> do parent svg */}
      <circle
        cx={0}
        cy={0}
        r={r}
        fill={`url(#g-piece-${color})`}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={r * 0.08}
      />

      {/* Anel interno claro (faux-3D) */}
      <circle
        cx={0}
        cy={0}
        r={r * 0.78}
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={r * 0.05}
        pointerEvents="none"
      />

      {/* Highlight superior (verniz) */}
      <ellipse
        cx={-r * 0.32}
        cy={-r * 0.4}
        rx={r * 0.45}
        ry={r * 0.28}
        fill="rgba(255,255,255,0.55)"
        pointerEvents="none"
      />

      {/* Coroa estilizada (3 pontos) — escalada para o tamanho da peça */}
      <g
        transform={`translate(0, ${-r * 0.05}) scale(${r * 0.32})`}
        pointerEvents="none"
      >
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

      {/* Hitbox invisível maior — facilita toque em mobile */}
      {isMovable && (
        <circle cx={0} cy={0} r={r * 1.7} fill="transparent" />
      )}
    </motion.g>
  );
}
