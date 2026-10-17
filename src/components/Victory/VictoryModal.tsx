import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import { Crown, Flag, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Trophy } from "./Trophy";
import { playSound } from "@/utils/sound";
import type { Player, PlayerColor } from "@/lib/ludo-engine";

const COLOR_HEX: Record<PlayerColor, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#facc15",
};

interface VictoryModalProps {
  open: boolean;
  winnerName: string;
  winnerColor?: PlayerColor;
  winnerId?: string | null;
  pot?: number;
  betAmount?: number;
  players?: Player[];
  myUserId?: string;
  isMe?: boolean;
  /** Taxa da casa (%) da sala. */
  rakePct?: number;
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
    colors: ["#fde047", "#f59e0b", "#ec4899", "#22c55e", "#3b82f6", "#a855f7"],
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
  winnerId,
  pot,
  betAmount = 0,
  players = [],
  myUserId,
  isMe,
  rakePct = 5,
  onClose,
}: VictoryModalProps) {
  const [count, setCount] = useState(0);
  const playedRef = useRef(false);

  // Confete + som — apenas quando abre. Quem perdeu ouve o som de derrota
  // e não recebe confetti (celebrar a derrota dos outros seria cruel).
  useEffect(() => {
    if (!open) {
      playedRef.current = false;
      return;
    }
    if (!playedRef.current) {
      playSound(isMe ? "victory" : "defeat");
      playedRef.current = true;
    }
    if (!isMe) return;
    fireConfettiBurst();
    const interval = setInterval(fireConfettiBurst, 2200);
    return () => clearInterval(interval);
  }, [open, isMe]);

  // Count-up do prémio (apenas se for jogo apostado E vencedor)
  useEffect(() => {
    if (!open) {
      setCount(0);
      return;
    }
    const target = pot && pot > 0 ? Math.floor((pot * (100 - rakePct)) / 100) : 0;
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
  }, [open, pot, rakePct]);

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
              background: "linear-gradient(180deg, #1a1530 0%, #0e0b1f 100%)",
              boxShadow:
                "0 0 0 1px rgba(251,191,36,0.45), 0 30px 80px rgba(251,191,36,0.30), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
            initial={{ scale: 0.5, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.7, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
          >
            {/* Glow rays atrás */}
            <span
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle at center 30%, rgba(251,191,36,0.22), transparent 60%)",
              }}
            />

            {/* Trophy animado */}
            <motion.div
              className="relative mx-auto mb-3"
              style={{ width: 130, height: 130 }}
              animate={{ rotate: [0, -4, 4, -4, 0], y: [0, -4, 0] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Trophy size={130} />
            </motion.div>

            <h2
              className="text-3xl font-extrabold tracking-tight mb-2"
              style={{
                background: "var(--grad-pot)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {isMe ? "🎉 Vitória!" : "Fim de Jogo"}
            </h2>

            <p className="text-muted-foreground mb-4">
              <span
                className="font-extrabold"
                style={{ color: winnerColor ? COLOR_HEX[winnerColor] : "#fde68a" }}
              >
                {winnerName}
              </span>{" "}
              ganhou a partida
            </p>

            {pot && pot > 0 && (
              <div
                className="rounded-2xl px-5 py-3 mb-4 mx-auto inline-flex items-center gap-2 relative"
                style={{
                  background: "var(--grad-pot)",
                  boxShadow: "0 0 24px rgba(251,191,36,0.55), inset 0 1px 0 rgba(255,255,255,0.45)",
                }}
              >
                <Crown size={20} className="text-amber-950" strokeWidth={2.5} />
                <span className="font-extrabold text-lg text-amber-950">
                  +{count.toLocaleString()} Kz
                </span>
              </div>
            )}

            {/* Payout breakdown — só se houve aposta */}
            {betAmount > 0 && players.length > 0 && (
              <div
                className="rounded-xl p-3 mb-5 text-left text-sm"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
                  Resultado
                </p>
                <ul className="space-y-1.5">
                  {players.map((p) => {
                    const isWinner = p.id === winnerId;
                    const isYou = p.id === myUserId;
                    let delta: number;
                    let label: string;
                    let color: string;
                    if (p.isBot) {
                      delta = 0;
                      label = "—";
                      color = "text-muted-foreground";
                    } else if (isWinner) {
                      delta = pot ? Math.floor((pot * (100 - rakePct)) / 100) : 0;
                      label = `+${delta.toLocaleString()} Kz`;
                      color = "text-emerald-400";
                    } else {
                      delta = -betAmount;
                      label = `${delta.toLocaleString()} Kz`;
                      color = "text-rose-400";
                    }
                    return (
                      <li
                        key={p.id}
                        className={`flex items-center justify-between gap-2 px-2 py-1 rounded ${
                          isWinner ? "bg-amber-500/10" : ""
                        } ${p.resigned ? "opacity-50" : ""}`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: COLOR_HEX[p.color] }}
                          />
                          <span
                            className={`font-semibold truncate ${p.resigned ? "line-through" : ""}`}
                            style={{ color: COLOR_HEX[p.color] }}
                          >
                            {p.name}
                          </span>
                          {isYou && !p.isBot && (
                            <span className="text-[9px] uppercase font-bold text-white/50">tu</span>
                          )}
                          {p.isBot && (
                            <span className="text-[9px] uppercase font-bold text-indigo-300">
                              bot
                            </span>
                          )}
                          {isWinner && (
                            <Crown size={12} className="text-amber-400" strokeWidth={2.5} />
                          )}
                          {p.resigned && <Flag size={10} className="text-rose-400" />}
                        </span>
                        <span className={`font-extrabold tabular-nums shrink-0 ${color}`}>
                          {label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>Pot total: {pot?.toLocaleString() ?? 0} Kz</span>
                  <span>Taxa {rakePct}%</span>
                </div>
              </div>
            )}

            {isMe && (
              <button
                onClick={async () => {
                  const won = pot && pot > 0 ? Math.floor((pot * (100 - rakePct)) / 100) : 0;
                  const text = won
                    ? `Ganhei ${won.toLocaleString()} Kz no NANTER Ludo! 🎲👑 Achas que me ganhas?`
                    : "Ganhei uma partida no NANTER Ludo! 🎲👑 Achas que me ganhas?";
                  const url = window.location.origin;
                  try {
                    if (navigator.share) await navigator.share({ text, url });
                    else {
                      await navigator.clipboard.writeText(`${text} ${url}`);
                      toast.success("Copiado! Cola onde quiseres.");
                    }
                  } catch {
                    /* utilizador cancelou */
                  }
                }}
                className="w-full mb-2 py-3 rounded-xl font-extrabold uppercase tracking-wider text-white flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] active:scale-95"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              >
                <Share2 size={16} />
                Partilhar vitória
              </button>
            )}

            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl font-extrabold uppercase tracking-wider text-amber-950 transition-transform hover:scale-[1.02] active:scale-95"
              style={{
                background: "var(--grad-roll-btn)",
                boxShadow: "0 6px 20px rgba(245,158,11,0.45), inset 0 1px 0 rgba(255,255,255,0.45)",
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
