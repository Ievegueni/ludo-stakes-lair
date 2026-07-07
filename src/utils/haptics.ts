/**
 * Vibração do dispositivo (haptic feedback).
 *
 * Usa a Web Vibration API (`navigator.vibrate`). Notas importantes:
 *  - Funciona em Chrome Android, Edge Android, Samsung Internet.
 *  - **iOS Safari NÃO suporta** — `navigator.vibrate` é undefined ou no-op.
 *    Não há fallback razoável a partir do browser; precisaria de wrapper
 *    nativo (Capacitor / app nativa) para vibrar em iPhone.
 *  - Browsers ignoram se a página não tem user gesture activo ou está em
 *    background. No fluxo do jogo já houve interacção (login, entrar na
 *    sala), portanto funciona durante a partida.
 *
 * Mute partilhado com o som — se o user silenciou o jogo (botão volume),
 * a vibração também respeita. Defensável: quem quer silêncio total quer
 * silêncio total. Se um dia for preciso separar, basta nova chave em LS.
 */

import { isMuted } from "./sound";

const HAPTIC_MUTE_KEY = "nanter.haptics.muted";

/** Override próprio só para vibração (default: respeita o mute do som). */
export function isHapticsMuted(): boolean {
  if (typeof window === "undefined") return false;
  const explicit = localStorage.getItem(HAPTIC_MUTE_KEY);
  if (explicit !== null) return explicit === "1";
  return isMuted();
}

export function setHapticsMuted(value: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(HAPTIC_MUTE_KEY, value ? "1" : "0");
}

/** Dispara vibração se o ambiente suporta e o user não silenciou. */
function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return; // iOS Safari etc.
  if (isHapticsMuted()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Browsers podem lançar se houver restrições — ignora silenciosamente
  }
}

// ─── Padrões predefinidos ────────────────────────────────────────────
// Estudados para serem reconhecíveis sem serem irritantes:

/** Pulso curto e subtil — "é a tua vez de jogar". */
export function hapticTurn(): void {
  vibrate(50);
}

/** Duplo rápido — eu capturei uma peça (positivo, satisfatório). */
export function hapticCaptureSuccess(): void {
  vibrate([60, 35, 90]);
}

/** Triplo curto crescente — a minha peça foi capturada (alerta). */
export function hapticCaptureLoss(): void {
  vibrate([40, 30, 60, 30, 100]);
}

/** Pulso longo único — vitória / fim de jogo. */
export function hapticVictory(): void {
  vibrate([120, 60, 120, 60, 200]);
}
