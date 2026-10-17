/**
 * Sistema de sons do jogo — Web Audio API (sem ficheiros externos).
 *
 * Cada som e sintetizado em tempo real usando osciladores, noise e envelopes.
 * Funciona em qualquer browser moderno sem carregar assets.
 */

export type SoundName =
  | "dice-roll"
  | "piece-move"
  | "piece-step"
  | "piece-capture"
  | "piece-finish"
  | "piece-out"
  | "victory"
  | "defeat"
  | "button-click"
  | "chat-message"
  | "gift-received"
  | "timer-tick"
  | "tension";

const MUTE_KEY = "nanter.sound.muted";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext();
  }
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

export function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(MUTE_KEY) === "1";
}

export function setMuted(value: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(MUTE_KEY, value ? "1" : "0");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGain(ac: AudioContext, volume: number): GainNode {
  const g = ac.createGain();
  g.gain.value = volume;
  g.connect(ac.destination);
  return g;
}

/** Oscilador simples com envelope attack-decay */
function playTone(
  ac: AudioContext,
  freq: number,
  type: OscillatorType,
  volume: number,
  duration: number,
  delay = 0,
  detune = 0,
) {
  const now = ac.currentTime + delay;
  const g = createGain(ac, 0);
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  osc.connect(g);
  // Envelope
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(volume, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.start(now);
  osc.stop(now + duration + 0.05);
}

/** Burst de ruido branco (para efeitos percussivos) */
function playNoise(ac: AudioContext, volume: number, duration: number, delay = 0, highpass = 0) {
  const now = ac.currentTime + delay;
  const bufferSize = ac.sampleRate * duration;
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;

  const g = createGain(ac, 0);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(volume, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, now + duration);

  if (highpass > 0) {
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = highpass;
    src.connect(hp);
    hp.connect(g);
  } else {
    src.connect(g);
  }

  src.start(now);
  src.stop(now + duration + 0.05);
}

// ---------------------------------------------------------------------------
// Sons individuais
// ---------------------------------------------------------------------------

function soundDiceRoll(ac: AudioContext) {
  // Sequencia rapida de clicks percussivos simulando dados a rolar
  for (let i = 0; i < 8; i++) {
    const d = i * 0.045;
    const vol = 0.15 - i * 0.012;
    playNoise(ac, Math.max(vol, 0.03), 0.035, d, 3000);
    playTone(ac, 300 + Math.random() * 400, "square", 0.04, 0.02, d);
  }
  // Click final mais forte
  playNoise(ac, 0.2, 0.06, 0.38, 2500);
  playTone(ac, 600, "triangle", 0.08, 0.05, 0.38);
}

function soundPieceMove(ac: AudioContext) {
  // Pop suave — tom curto ascendente
  playTone(ac, 440, "sine", 0.15, 0.08);
  playTone(ac, 660, "sine", 0.1, 0.06, 0.02);
  playNoise(ac, 0.04, 0.03, 0, 4000);
}

function soundPieceStep(ac: AudioContext) {
  // Passo casa-a-casa — tick muito suave, tom levemente aleatório para não cansar
  playTone(ac, 520 + Math.random() * 120, "sine", 0.07, 0.05);
  playNoise(ac, 0.02, 0.02, 0, 4500);
}

function soundPieceOut(ac: AudioContext) {
  // Peça sai da base — "pop" ascendente confiante
  playTone(ac, 330, "triangle", 0.14, 0.1);
  playTone(ac, 494, "triangle", 0.12, 0.12, 0.06);
  playTone(ac, 659, "sine", 0.1, 0.15, 0.12);
  playNoise(ac, 0.05, 0.04, 0, 3000);
}

function soundPieceFinish(ac: AudioContext) {
  // Peça chega ao centro — arpejo curto de recompensa
  const notes = [659, 831, 988];
  notes.forEach((f, i) => {
    playTone(ac, f, "triangle", 0.12, 0.18, i * 0.07);
    playTone(ac, f * 2, "sine", 0.04, 0.12, i * 0.07 + 0.02);
  });
  playNoise(ac, 0.04, 0.12, 0.2, 7000);
}

function soundDefeat(ac: AudioContext) {
  // Derrota — acorde descendente suave (sem ser irritante)
  const notes = [392, 330, 262];
  notes.forEach((f, i) => {
    playTone(ac, f, "triangle", 0.12, 0.4, i * 0.18);
    playTone(ac, f / 2, "sine", 0.06, 0.5, i * 0.18);
  });
}

function soundPieceCapture(ac: AudioContext) {
  // Impact + tom dramatico descendente
  playNoise(ac, 0.3, 0.12, 0, 1000);
  playTone(ac, 500, "sawtooth", 0.12, 0.15);
  playTone(ac, 350, "sawtooth", 0.1, 0.15, 0.05);
  playTone(ac, 200, "sawtooth", 0.08, 0.2, 0.1);
  // Ping metalico
  playTone(ac, 1200, "sine", 0.06, 0.3, 0.02);
}

function soundVictory(ac: AudioContext) {
  // Fanfarra — acorde ascendente com harmonicos
  const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
  notes.forEach((freq, i) => {
    const d = i * 0.12;
    playTone(ac, freq, "triangle", 0.15, 0.5, d);
    playTone(ac, freq * 1.5, "sine", 0.05, 0.4, d + 0.02);
  });
  // Brilho final
  playTone(ac, 1047, "sine", 0.12, 0.8, 0.48);
  playTone(ac, 1318, "sine", 0.08, 0.7, 0.55);
  // Shimmer noise
  playNoise(ac, 0.06, 0.6, 0.5, 6000);
}

function soundButtonClick(ac: AudioContext) {
  // Click tactil — muito curto
  playTone(ac, 800, "square", 0.08, 0.03);
  playTone(ac, 1200, "sine", 0.05, 0.02, 0.01);
  playNoise(ac, 0.03, 0.02, 0, 5000);
}

function soundChatMessage(ac: AudioContext) {
  // Ding duplo suave
  playTone(ac, 880, "sine", 0.1, 0.12);
  playTone(ac, 1100, "sine", 0.08, 0.1, 0.08);
}

function soundGiftReceived(ac: AudioContext) {
  // Coin/reward — arpejo brilhante
  const notes = [880, 1100, 1320, 1760];
  notes.forEach((freq, i) => {
    playTone(ac, freq, "sine", 0.1, 0.2, i * 0.06);
    playTone(ac, freq * 2, "sine", 0.03, 0.15, i * 0.06 + 0.01);
  });
  playNoise(ac, 0.04, 0.15, 0.2, 8000);
}

function soundTimerTick(ac: AudioContext) {
  // Tick seco — relogio
  playTone(ac, 1000, "square", 0.06, 0.015);
  playNoise(ac, 0.03, 0.01, 0, 6000);
}

function soundTension(ac: AudioContext) {
  // Batimento cardiaco duplo — ha uma captura em jogo
  [0, 0.22].forEach((d, i) => {
    playTone(ac, 70, "sine", i === 0 ? 0.35 : 0.25, 0.18, d);
    playTone(ac, 140, "sine", 0.08, 0.1, d);
  });
}

// ---------------------------------------------------------------------------
// Mapa de sons
// ---------------------------------------------------------------------------

const SOUND_MAP: Record<SoundName, (ac: AudioContext) => void> = {
  "dice-roll": soundDiceRoll,
  "piece-move": soundPieceMove,
  "piece-step": soundPieceStep,
  "piece-capture": soundPieceCapture,
  "piece-finish": soundPieceFinish,
  "piece-out": soundPieceOut,
  victory: soundVictory,
  defeat: soundDefeat,
  "button-click": soundButtonClick,
  "chat-message": soundChatMessage,
  "gift-received": soundGiftReceived,
  "timer-tick": soundTimerTick,
  tension: soundTension,
};

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

/** Toca um som pelo nome logico. No-op se muted. */
export function playSound(name: SoundName) {
  if (isMuted()) return;
  try {
    const ac = getCtx();
    SOUND_MAP[name](ac);
  } catch {
    /* autoplay policy ou browser antigo */
  }
}
