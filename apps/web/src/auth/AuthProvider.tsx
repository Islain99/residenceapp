// Session de l'utilisateur : restauration au chargement, connexion, déconnexion.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, isSharedDevice, onSessionExpired, refreshSession, setAccessToken, setSharedDevice } from '../api/client';
import type { User } from '../api/types';
import { AuthContext } from './session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [sharedDevice, setShared] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const clear = useCallback(() => {
    setAccessToken(null);
    setSharedDevice(false);
    setUser(null);
    setShared(false);
    queryClient.clear();
  }, [queryClient]);

  // Au chargement : le cookie de session (s'il existe) redonne un jeton d'accès
  useEffect(() => {
    onSessionExpired(() => {
      clear();
      setNotice('Session expirée : reconnectez-vous.');
    });
    let cancelled = false;
    (async () => {
      try {
        if (await refreshSession()) {
          const me = await api<User>('/auth/me');
          if (!cancelled && me.residenceId) {
            setShared(isSharedDevice());
            setUser(me);
          }
        }
      } catch {
        // pas de session : écran de connexion
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [clear]);

  const login = useCallback(async (email: string, password: string, sharedDevice: boolean) => {
    const res = await api<{ accessToken: string; sharedDevice: boolean; user: User }>('/auth/login', {
      method: 'POST', body: { email, password, session: 'cookie', sharedDevice },
    });
    setAccessToken(res.accessToken);
    if (!res.user.residenceId) {
      // Admin plateforme : pas de journal. On ferme la session ouverte par le cookie.
      await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
      setAccessToken(null);
      throw new ApiError(403, 'no_residence', "Ce compte n'est rattaché à aucune résidence.");
    }
    setSharedDevice(res.sharedDevice);
    setShared(res.sharedDevice);
    setNotice(null);
    setUser(res.user);
  }, []);

  const logout = useCallback(async (reason?: string) => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } catch {
      // hors connexion : la session locale est fermée quand même
    } finally {
      clear();
      setNotice(reason ?? null);
    }
  }, [clear]);

  const value = useMemo(
    () => ({ user, ready, sharedDevice, notice, login, logout }),
    [user, ready, sharedDevice, notice, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
