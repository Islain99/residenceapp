// Client HTTP de l'API.
//
// Session :
//   * Jeton d'accès (15 min) : en mémoire seulement, jamais dans localStorage.
//   * Jeton de rafraîchissement : cookie httpOnly posé par l'API (mode
//     « cookie »), illisible ici. Un rechargement de page restaure la session
//     par POST /auth/refresh.
//   * Un 401 déclenche un seul rafraîchissement puis rejoue la requête.
//     Plusieurs onglets ne rafraîchissent jamais en même temps (Web Locks) :
//     présenter deux fois le même jeton ferait révoquer toutes les sessions.

import i18n, { currentLanguage } from '../i18n';
import { API_ERRORS_EN } from '../i18n/api-errors';

// Messages de l'API : rédigés en français par le serveur. Interface en
// anglais : message traduit d'après le code d'erreur (i18n/api-errors.ts),
// sinon celui du serveur.
function translateError(code: string, serverMessage: string): string {
  return currentLanguage() === 'en' ? API_ERRORS_EN[code] ?? serverMessage : serverMessage;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let accessToken: string | null = null;
let sharedDevice = false;           // session ouverte avec « appareil partagé » (selon l'API)
let refreshing: Promise<boolean> | null = null;
let onSessionLost: () => void = () => {};
// Accès d'assistance (admin plateforme) : jeton de consultation d'une
// résidence, en mémoire seulement. Utilisé pour toutes les requêtes sauf
// /auth/* et /platform/* (qui gardent le jeton de l'admin).
let assistanceToken: string | null = null;
let onAssistanceLost: (message: string) => void = () => {};

export function setAssistanceToken(token: string | null) {
  assistanceToken = token;
}

// Appelé quand l'accès d'assistance est retiré ou terminé
export function onAssistanceEnded(handler: (message: string) => void) {
  onAssistanceLost = handler;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function setSharedDevice(value: boolean) {
  sharedDevice = value;
}

// Appareil partagé : déconnexion après une période d'inactivité (IdleLogout)
export const isSharedDevice = () => sharedDevice;

// Appelé quand la session ne peut pas être renouvelée (retour à la connexion)
export function onSessionExpired(handler: () => void) {
  onSessionLost = handler;
}

async function doRefresh(): Promise<boolean> {
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    accessToken = null;
    return false;
  }
  const body = await res.json() as { accessToken: string; sharedDevice?: boolean };
  accessToken = body.accessToken;
  sharedDevice = body.sharedDevice ?? false;
  return true;
}

export function refreshSession(): Promise<boolean> {
  refreshing ??= (
    'locks' in navigator
      ? navigator.locks.request('session-refresh', doRefresh)
      : doRefresh()
  ).catch(() => false).finally(() => { refreshing = null; });
  return refreshing;
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  query?: Query;
}

function buildUrl(path: string, query?: Query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ''}`;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const assisted = assistanceToken !== null && !path.startsWith('/auth/') && !path.startsWith('/platform/');
  // Assistance : lecture seule (l'API refuse aussi) — message clair, sans appel
  if (assisted && (options.method ?? 'GET') !== 'GET') {
    throw new ApiError(403, 'assistance_read_only', i18n.t('common.assistanceReadOnly'));
  }
  const send = () => fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(assisted ? { authorization: `Bearer ${assistanceToken}` }
        : accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, 'network', i18n.t('common.network'));
  }

  if (res.status === 401 && assisted) {
    const body = await res.json().catch(() => null) as { message?: string } | null;
    const message = translateError('assistance_ended', body?.message ?? i18n.t('common.assistanceEnded'));
    assistanceToken = null;
    onAssistanceLost(message);
    throw new ApiError(401, 'assistance_ended', message);
  }

  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) {
      res = await send();
    } else {
      onSessionLost();
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string; message?: string } | null;
    const code = body?.error ?? 'error';
    throw new ApiError(res.status, code, translateError(code, body?.message ?? i18n.t('common.httpError', { status: res.status })));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
