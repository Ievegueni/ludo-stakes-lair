// Aparência das molduras de avatar. Nomes e preços vêm do servidor (/api/rewards/shop);
// os ids têm de coincidir com SHOP em server/src/routes/rewards.ts.
export const FRAMES: Record<string, { ring: string; glow: string }> = {
  gold: { ring: "conic-gradient(#fde047, #f59e0b, #fef3c7, #f59e0b, #fde047)", glow: "#f59e0b" },
  neon: { ring: "conic-gradient(#22d3ee, #a855f7, #ec4899, #22d3ee)", glow: "#a855f7" },
  fire: { ring: "conic-gradient(#f97316, #ef4444, #facc15, #ef4444, #f97316)", glow: "#ef4444" },
  diamond: { ring: "conic-gradient(#e0f2fe, #7dd3fc, #c4b5fd, #f0abfc, #e0f2fe)", glow: "#7dd3fc" },
};
