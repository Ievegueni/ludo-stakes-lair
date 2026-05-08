import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Crown } from 'lucide-react';
import { Trophy } from './Trophy';
import { playSound } from '@/utils/sound';
import type { PlayerColor } from '@/lib/ludo-engine';

const COLOR_HEX: Record<PlayerColor, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#facc15',
};

interface VictoryModalProps {
  open: boolean;
  winnerName: string;
  winnerColor?: PlayerColor;
  pot?: number;
  isMe?: boolean;
  onClose: () => void;
}

/** Confete em rajadas — chamado a abrir e em loop. */
function fireConfettiBurst() {
  const defaults = {
    spread: 90,
    ticks: 200,
    gravity: 0.85,
    decay: 0.92,
    startVelocity: 35,
    colors: ['#fde047', '#f59e0b', '#ec4899', '#22c55e', '#3b82f6', '#a855f7'],
  };
  const fire = (particleRatio: number, opts: confetti.Options) =>
    confetti({ ...defaults, ...opts, particleCount: Math.floor(180 * particleRatio) });

  fire(0.25, { spread: 26, startVelocity: 55 });
  fire(0.2, { spread: 60 });
  fire(0.35, { spread: 100, decay: 0.91, scalar: 0.85 });
  fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
  fire(0.1, { spread: 120, startVelocity: 45 });
}

export function VictoryModal({
  open,
  winnerName,
  winnerColor,
  pot,
  isMe,
  onClose,
}: VictoryModalProps) {
  const [count, setCount] = useState(0);
  const playedRef = useRef(false);

  // Confete + som — apenas quando abre
  useEffect(() => {
    if (!open) {
      playedRef.current = false;
      return;
    }
    fireConfettiBurst();
    if (!playedRef.current) {
      playSound('victory');
      playedRef.current = true;
    }
    const interval = setInterval(fireConfettiBurst, 2200);
    return () => clearInterval(interval);
  }, [open]);

  // Count-up do prémio (apenas se for jogo apostado E vencedor)
  useEffect(() => {
    if (!open) {
      setCount(0);
      return;
    }
    const target = pot && pot > 0 ? Math.floor(pot * 0.95) : 0;
    if (target === 0) return;
    const duration = 1400;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      setCount(Math.floor(target * ease));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, pot]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="relative rounded-3xl p-8 text-center max-w-sm w-full overflow-hidden"
            style={{
              background: 'linear-gradient(180deg, #1a1530 0%, #0e0b1f 100%)',
              boxShadow:
                '0 0 0 1px rgba(251,191,36,0.45), 0 30px 80px rgba(251,191,36,0.30), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
            initial={{ scale: 0.5, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.7, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          >
            {/* Glow rays atrás */}
            <span
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle at center 30%, rgba(251,191,36,0.22), transparent 60%)',
              }}
            />

            {/* Trophy animado */}
            <motion.div
              className="relative mx-auto mb-3"
              style={{ width: 130, height: 130 }}
              animate={{ rotate: [0, -4, 4, -4, 0], y: [0, -4, 0] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Trophy size={130} />
            </motion.div>

            <h2
              className="text-3xl font-extrabold tracking-tight mb-2"
              style={{
                background: 'var(--grad-pot)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {isMe ? '🎉 Vitória!' : 'Fim de Jogo'}
            </h2>

            <p className="text-muted-foreground mb-4">
              <span
                className="font-extrabold"
                style={{ color: winnerColor ? COLOR_HEX[winnerColor] : '#fde68a' }}
              >
                {winnerName}
              </span>{' '}
              ganhou a partida
            </p>

            {pot && pot > 0 && (
              <div
                className="rounded-2xl px-5 py-3 mb-6 mx-auto inline-flex items-center gap-2 relative"
                style={{
                  background: 'var(--grad-pot)',
                  boxShadow: '0 0 24px rgba(251,191,36,0.55), inset 0 1px 0 rgba(255,255,255,0.45)',
                }}
              >
                <Crown size={20} className="text-amber-950" strokeWidth={2.5} />
                <span className="font-extrabold text-lg text-amber-950">
                  +{count.toLocaleString()} Kz
                </span>
              </div>
            )}

            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl font-extrabold uppercase tracking-wider text-amber-950 transition-transform hover:scale-[1.02] active:scale-95"
              style={{
                background: 'var(--grad-roll-btn)',
                boxShadow: '0 6px 20px rgba(245,158,11,0.45), inset 0 1px 0 rgba(255,255,255,0.45)',
              }}
            >
              Voltar ao Lobby
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
