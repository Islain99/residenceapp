// Notifications push sur cet appareil (Web Push, via le service worker sw.js).
//
// iPhone / iPad : seulement une fois l'application ajoutée à l'écran
// d'accueil (iOS 16.4 et plus). Appareil partagé : jamais proposé (les avis
// d'une personne s'afficheraient à la suivante).
import { api } from '../api/client';
import i18n from '../i18n';

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// iPhone ou iPad dans Safari, pas encore installé sur l'écran d'accueil
export function needsInstallForPush(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export const permission = (): NotificationPermission => (pushSupported() ? Notification.permission : 'denied');

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

// Demande l'autorisation, abonne l'appareil et l'enregistre auprès de l'API
export async function enablePush(publicKey: string): Promise<void> {
  const result = await Notification.requestPermission();
  if (result !== 'granted') throw new Error(i18n.t('shell.push.denied'));
  const reg = await registration();
  // Le service de notification du navigateur peut ne pas répondre (réseau filtré)
  const timeout = new Promise<never>((_, reject) => setTimeout(
    () => reject(new Error(i18n.t('shell.push.timeout'))), 20_000));
  const sub = await reg.pushManager.getSubscription()
    ?? await Promise.race([reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }), timeout]);
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/push/subscriptions', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } });
}

// Retire l'abonnement de cet appareil (aussi à la déconnexion)
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/push/subscriptions/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => false);
}
