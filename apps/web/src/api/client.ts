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
let refreshing: Promise<boolean> | null = null;
let onSessionLost: () => void = () => {};

export function setAccessToken(token: string | null) {
  accessToken = token;
}

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
  accessToken = (await res.json()).accessToken;
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
  const send = () => fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, 'network', 'Serveur injoignable. Vérifier la connexion.');
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
    throw new ApiError(res.status, body?.error ?? 'error', body?.message ?? `Erreur ${res.status}.`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
