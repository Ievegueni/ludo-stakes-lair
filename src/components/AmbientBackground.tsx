/**
 * Camada visual decorativa — 3 blobs gradient com blur intenso
 * a flutuar lentamente, mais uma vinheta nas bordas.
 *
 * É puramente cosmético, sem JS — animações em CSS @keyframes.
 * Renderiza-se com `position: fixed; pointer-events: none; z-index: -1`
 * por isso fica por trás de todo o conteúdo da app.
 */
export function AmbientBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Blobs subtis — apenas para dar movimento ténue por cima do background image */}
      <span
        className="absolute rounded-full"
        style={{
          width: '55vw',
          height: '55vw',
          left: '-15vw',
          top: '-10vw',
          background:
            'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)',
          filter: 'blur(80px)',
          animation: 'nanter-blob-1 22s ease-in-out infinite',
          mixBlendMode: 'screen',
        }}
      />
      <span
        className="absolute rounded-full"
        style={{
          width: '50vw',
          height: '50vw',
          right: '-12vw',
          top: '20vh',
          background:
            'radial-gradient(circle, rgba(59,130,246,0.16) 0%, transparent 70%)',
          filter: 'blur(90px)',
          animation: 'nanter-blob-2 28s ease-in-out infinite',
          mixBlendMode: 'screen',
        }}
      />

      {/* Overlay radial escurecedor — escurece o centro para focar a UI sobreposta */}
      <span
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.30) 45%, transparent 90%)',
        }}
      />

    </div>
  );
}
