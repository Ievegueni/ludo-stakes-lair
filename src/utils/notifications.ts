/**
 * Helper de notificações nativas do browser.
 *
 * Comportamento:
 *  - `notify()` é no-op silencioso se a permissão não foi concedida ou
 *    se a página está visível (utilizador já está a ver o ecrã)
 *  - `requestPermission()` pede ao browser uma vez. Resultado em cache.
 *
 * Não usa service workers — apenas Notification API simples. Suficiente
 * para alertar quando o jogo está em background.
 */

const STORAGE_KEY = 'nanter.notifications.askedOnce';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationsGranted(): boolean {
  return notificationsSupported() && Notification.permission === 'granted';
}

/**
 * Pede permissão se ainda não foi pedida. Retorna true se foi concedida.
 * Idempotente — só pede uma vez por instalação do browser.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  if (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1') {
    // Já pediu antes nesta sessão (e a permissão pode ter ficado default — não insistir)
    return false;
  }
  try {
    const result = await Notification.requestPermission();
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, '1');
    }
    return result === 'granted';
  } catch {
    return false;
  }
}

interface NotifyOptions {
  body: string;
  icon?: string;
  tag?: string; // notificações com mesma tag substituem-se (evita spam)
  requireInteraction?: boolean;
  /** Se true, mostra mesmo com a página visível (raro). Default false. */
  whenVisible?: boolean;
}

/**
 * Mostra notificação se: permissão dada + página em background (a não ser
 * que `whenVisible: true`). Click foca a janela.
 */
export function notify(title: string, opts: NotifyOptions) {
  if (!notificationsGranted()) return;
  if (typeof document !== 'undefined' && !document.hidden && !opts.whenVisible) {
    return;
  }
  try {
    const n = new Notification(title, {
      body: opts.body,
      icon: opts.icon || '/logo.png',
      badge: '/logo.png',
      tag: opts.tag,
      requireInteraction: !!opts.requireInteraction,
      silent: false,
    });
    n.onclick = () => {
      try { window.focus(); } catch {}
      n.close();
    };
  } catch {
    /* swallow — alguns browsers atiram em background */
  }
}
