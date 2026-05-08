import { Howl } from 'howler';

/**
 * Helper centralizado para sons do jogo.
 *
 * Mapeia nomes lógicos para URLs (em `public/sounds/`). Enquanto os assets
 * não chegam, o objecto SOUND_URLS pode ficar vazio — `playSound(name)`
 * vira no-op silenciosamente.
 *
 * Para activar um som basta preencher `SOUND_URLS[<nome>]` (ou descomentar
 * a entrada correspondente após colocar o ficheiro em `public/sounds/`).
 *
 * Um único Howl por som é mantido em cache para evitar reload + permitir
 * sobreposição de instâncias com `.play()`.
 */

export type SoundName =
  | 'dice-roll'
  | 'piece-move'
  | 'piece-capture'
  | 'victory'
  | 'button-click'
  | 'chat-message'
  | 'gift-received'
  | 'timer-tick';

/** Preencher cada chave com `'/sounds/<ficheiro>.mp3'` quando os assets chegarem. */
const SOUND_URLS: Partial<Record<SoundName, string>> = {
  // 'dice-roll':     '/sounds/dice-roll.mp3',
  // 'piece-move':    '/sounds/piece-move.mp3',
  // 'piece-capture': '/sounds/piece-capture.mp3',
  // 'victory':       '/sounds/victory.mp3',
  // 'button-click':  '/sounds/button-click.mp3',
  // 'chat-message':  '/sounds/chat-message.mp3',
  // 'gift-received': '/sounds/gift-received.mp3',
  // 'timer-tick':    '/sounds/timer-tick.mp3',
};

/** Volume por defeito, por som. */
const DEFAULT_VOLUMES: Record<SoundName, number> = {
  'dice-roll': 0.6,
  'piece-move': 0.4,
  'piece-capture': 0.7,
  'victory': 0.8,
  'button-click': 0.35,
  'chat-message': 0.3,
  'gift-received': 0.6,
  'timer-tick': 0.25,
};

const cache = new Map<SoundName, Howl>();

const MUTE_KEY = 'nanter.sound.muted';

export function isMuted(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(MUTE_KEY) === '1';
}

export function setMuted(value: boolean) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  // Aplica a todas as instâncias já carregadas
  cache.forEach((h) => h.mute(value));
}

/** Toca um som pelo nome lógico. No-op se não houver URL ou se mute estiver activo. */
export function playSound(name: SoundName) {
  if (isMuted()) return;
  const url = SOUND_URLS[name];
  if (!url) return;
  let h = cache.get(name);
  if (!h) {
    try {
      h = new Howl({ src: [url], volume: DEFAULT_VOLUMES[name], preload: true });
      cache.set(name, h);
    } catch {
      return;
    }
  }
  try {
    h.play();
  } catch {
    /* swallow — autoplay policy ou file missing */
  }
}
