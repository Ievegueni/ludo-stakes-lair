/**
 * Troféu SVG dourado — substitui o Lottie enquanto o asset não chega.
 * Pode ser substituído por `<Lottie animationData={trophy} />` mais tarde.
 */
export function Trophy({ size = 120 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 110" width={size} height={size} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="t-gold" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="35%" stopColor="#fbbf24" />
          <stop offset="75%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#7c2d12" />
        </linearGradient>
        <linearGradient id="t-gold-light" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="100%" stopColor="#fde047" />
        </linearGradient>
        <radialGradient id="t-glow" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="rgba(253, 224, 71, 0.6)" />
          <stop offset="100%" stopColor="rgba(253, 224, 71, 0)" />
        </radialGradient>
      </defs>

      {/* Glow atrás */}
      <circle cx="50" cy="42" r="42" fill="url(#t-glow)" />

      {/* Pegas laterais */}
      <path
        d="M 30 30 Q 14 30 14 42 Q 14 54 28 56"
        stroke="url(#t-gold)"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 70 30 Q 86 30 86 42 Q 86 54 72 56"
        stroke="url(#t-gold)"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />

      {/* Taça */}
      <path
        d="M 26 18 L 74 18 L 71 52 Q 67 64 50 64 Q 33 64 29 52 Z"
        fill="url(#t-gold)"
        stroke="#7c2d12"
        strokeWidth="0.6"
      />

      {/* Borda superior brilhante */}
      <rect x="25" y="16" width="50" height="6" rx="1.2" fill="url(#t-gold-light)" stroke="#92400e" strokeWidth="0.5" />

      {/* Estrela central */}
      <path
        d="M 50 30 L 53 38 L 61 38 L 55 43 L 57 51 L 50 46 L 43 51 L 45 43 L 39 38 L 47 38 Z"
        fill="#fef3c7"
        stroke="#92400e"
        strokeWidth="0.6"
      />

      {/* Highlight no topo da taça */}
      <ellipse cx="38" cy="22" rx="9" ry="2.5" fill="rgba(255,255,255,0.55)" />

      {/* Coluna */}
      <rect x="44" y="64" width="12" height="14" fill="url(#t-gold)" stroke="#7c2d12" strokeWidth="0.5" />

      {/* Base superior */}
      <rect x="36" y="78" width="28" height="6" rx="1.2" fill="url(#t-gold)" stroke="#7c2d12" strokeWidth="0.5" />

      {/* Base inferior */}
      <rect x="30" y="84" width="40" height="8" rx="1.5" fill="#92400e" />
      <rect x="30" y="84" width="40" height="2.5" rx="1" fill="url(#t-gold-light)" />

      {/* Confetes pequenos a flutuar */}
      <circle cx="20" cy="14" r="1.5" fill="#fde047" opacity="0.85" />
      <circle cx="82" cy="20" r="1.2" fill="#ec4899" opacity="0.85" />
      <circle cx="88" cy="60" r="1.5" fill="#22c55e" opacity="0.7" />
      <circle cx="14" cy="68" r="1.2" fill="#3b82f6" opacity="0.7" />
    </svg>
  );
}
