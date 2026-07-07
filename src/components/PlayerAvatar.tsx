import { Crown, Flag } from "lucide-react";
import type { PlayerColor } from "@/lib/ludo-engine";

/**
 * Avatar reutilizável para jogadores.
 *  - Frame circular com gradient ring na cor do jogador
 *  - Foto (se houver) > inicial colorida
 *  - Badge no canto: 🤖 (bot), 🏳️ (desistiu), 👑 (vencedor)
 *  - Anel pulsante quando `isActive=true`
 *  - Greyscale + opacidade reduzida quando `resigned=true`
 *
 * Usar em: Lobby (sala de espera), Sidebar do jogo, Barra mobile compacta.
 */

const COLOR_HEX: Record<PlayerColor, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#facc15",
};

const COLOR_DARK: Record<PlayerColor, string> = {
  red: "#7f1d1d",
  blue: "#1e3a8a",
  green: "#14532d",
  yellow: "#854d0e",
};

export type PlayerAvatarBadge = "resigned" | "winner" | null;

export interface PlayerAvatarProps {
  name: string;
  color?: PlayerColor;
  avatarUrl?: string | null;
  size?: number;
  isActive?: boolean;
  resigned?: boolean;
  isBot?: boolean;
  isWinner?: boolean;
  className?: string;
}

export function PlayerAvatar({
  name,
  color,
  avatarUrl,
  size = 40,
  isActive = false,
  resigned = false,
  isBot = false,
  isWinner = false,
  className = "",
}: PlayerAvatarProps) {
  const ring = color ? COLOR_HEX[color] : "#a1a1aa";
  const ringDark = color ? COLOR_DARK[color] : "#52525b";
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  // Os "bots" são apresentados como humanos — sem badge identificador.
  // Apenas vencedor e desistente mostram badge.
  void isBot; // mantido na assinatura por compat
  const badge: PlayerAvatarBadge = isWinner ? "winner" : resigned ? "resigned" : null;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Glow ring quando activo */}
      {isActive && (
        <span
          aria-hidden
          className="absolute rounded-full anim-pulse-glow pointer-events-none"
          style={{
            inset: -2,
            boxShadow: `0 0 0 2px ${ring}, 0 0 16px ${ring}cc`,
          }}
        />
      )}

      <div
        className="rounded-full overflow-hidden relative"
        style={{
          width: "100%",
          height: "100%",
          background: avatarUrl
            ? "#0b0817"
            : `radial-gradient(circle at 30% 30%, ${ring} 0%, ${ringDark} 100%)`,
          boxShadow: `inset 0 0 0 1.5px rgba(0,0,0,0.45), 0 0 0 2px ${ring}aa`,
          opacity: resigned ? 0.45 : 1,
          filter: resigned ? "grayscale(0.6)" : "none",
          transition: "filter 240ms, opacity 240ms",
        }}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <span
            className="absolute inset-0 flex items-center justify-center font-bold text-white select-none"
            style={{
              fontSize: size * 0.45,
              textShadow: "0 1px 2px rgba(0,0,0,0.55)",
            }}
          >
            {initial}
          </span>
        )}

        {/* Glossy highlight */}
        <span
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            top: "6%",
            left: "12%",
            width: "40%",
            height: "30%",
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse at center, rgba(255,255,255,0.45), transparent 70%)",
          }}
        />
      </div>

      {badge && (
        <div
          className="absolute rounded-full flex items-center justify-center"
          style={{
            width: size * 0.42,
            height: size * 0.42,
            right: -size * 0.04,
            bottom: -size * 0.04,
            background:
              badge === "winner" ? "linear-gradient(135deg, #fde047, #f59e0b)" : "#dc2626",
            border: "1.5px solid #0b0817",
            boxShadow: "0 2px 6px rgba(0,0,0,0.55)",
          }}
        >
          {badge === "winner" ? (
            <Crown size={size * 0.24} color="#7c2d12" strokeWidth={2.5} />
          ) : (
            <Flag size={size * 0.22} color="#fff" strokeWidth={2.5} />
          )}
        </div>
      )}
    </div>
  );
}
