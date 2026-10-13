// Session de l'utilisateur : restauration au chargement, connexion, déconnexion.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api, isSharedDevice, onAssistanceEnded, onSessionExpired, refreshSession, setAccessToken, setAssistanceToken, setSharedDevice,
} from '../api/client';
import type { AssistanceSession, User } from '../api/types';
import { AuthContext, type AssistanceState } from './session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [sharedDevice, setShared] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [assistance, setAssistance] = useState<AssistanceState | null>(null);
  const [platformNotice, setPlatformNotice] = useState<string | null>(null);

  const leaveAssistance = useCallback((message?: string) => {
    setAssistanceToken(null);
    setAssistance(null);
    queryClient.clear();
    setPlatformNotice(message ?? null);
  }, [queryClient]);

  const startAssistance = useCallback(async (grantId: string) => {
    const session = await api<AssistanceSession>(`/platform/assistance/${grantId}/start`, { method: 'POST' });
    queryClient.clear();
    setAssistanceToken(session.accessToken);
    setPlatformNotice(null);
    setAssistance({ grantId, residence: session.residence, expiresAt: session.expiresAt });
  }, [queryClient]);

  // Fin prévue de l'accès : retour au tableau de bord de la plateforme
  useEffect(() => {
    if (!assistance) return;
    const ms = Date.parse(assistance.expiresAt) - Date.now();
    const timer = setTimeout(() => leaveAssistance('L’accès d’assistance est arrivé à échéance.'), Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => clearTimeout(timer);
  }, [assistance, leaveAssistance]);

  useEffect(() => {
    onAssistanceEnded((message) => leaveAssistance(message));
  }, [leaveAssistance]);

  const clear = useCallback(() => {
    setAccessToken(null);
    setAssistanceToken(null);
    setAssistance(null);
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
          if (!cancelled) {
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

  const clearPlatformNotice = useCallback(() => setPlatformNotice(null), []);

  // Mode assistance : l'admin voit la résidence comme sa responsable (lecture seule)
  const effectiveUser = useMemo(
    () => (user && assistance ? { ...user, role: 'responsable' as const, residenceId: assistance.residence.id } : user),
    [user, assistance],
  );

  const value = useMemo(
    () => ({
      user: effectiveUser, ready, sharedDevice, notice, login, logout,
      assistance, startAssistance, leaveAssistance, platformNotice, clearPlatformNotice,
    }),
    [effectiveUser, ready, sharedDevice, notice, login, logout, assistance, startAssistance, leaveAssistance,
      platformNotice, clearPlatformNotice],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
