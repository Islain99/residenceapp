// Session de l'utilisateur : restauration au chargement, connexion, déconnexion.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api, isSharedDevice, onAssistanceEnded, onSessionExpired, refreshSession, setAccessToken, setAssistanceToken, setSharedDevice,
} from '../api/client';
import type { AssistanceSession, LoginSession, MfaChallenge, MfaSetup, User } from '../api/types';
import { disablePush } from '../lib/push';
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

  // Session ouverte : jeton en mémoire, utilisateur connu
  const open = useCallback((res: LoginSession) => {
    setAccessToken(res.accessToken);
    setSharedDevice(res.sharedDevice);
    setShared(res.sharedDevice);
    setNotice(null);
    setUser(res.user);
  }, []);

  const login = useCallback(async (email: string, password: string, sharedDevice: boolean) => {
    const res = await api<LoginSession | MfaChallenge>('/auth/login', {
      method: 'POST', body: { email, password, session: 'cookie', sharedDevice },
    });
    if ('mfa' in res) return res;
    open(res);
    return null;
  }, [open]);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    open(await api<LoginSession>('/auth/mfa/verify', { method: 'POST', body: { mfaToken, code } }));
  }, [open]);

  const setupMfa = useCallback(
    (mfaToken: string) => api<MfaSetup>('/auth/mfa/setup', { method: 'POST', body: { mfaToken } }),
    [],
  );

  const enableMfa = useCallback(async (mfaToken: string, code: string) => {
    const res = await api<LoginSession & { backupCodes: string[] }>('/auth/mfa/enable', { method: 'POST', body: { mfaToken, code } });
    // Jeton gardé dès maintenant (le cookie de session est déjà posé) ; l'écran
    // des codes de secours reste affiché jusqu'à finish()
    setAccessToken(res.accessToken);
    return { backupCodes: res.backupCodes, finish: () => open(res) };
  }, [open]);

  const logout = useCallback(async (reason?: string) => {
    try {
      // Plus d'avis sur cet appareil après une déconnexion volontaire
      await disablePush().catch(() => {});
      await api('/auth/logout', { method: 'POST', body: {} });
    } catch {
      // hors connexion : la session locale est fermée quand même
    } finally {
      clear();
      setNotice(reason ?? null);
    }
  }, [clear]);

  const clearPlatformNotice = useCallback(() => setPlatformNotice(null), []);
  const updateUser = useCallback((next: User) => setUser(next), []);

  // Mode assistance : l'admin voit la résidence comme sa responsable (lecture seule)
  const effectiveUser = useMemo(
    () => (user && assistance ? { ...user, role: 'responsable' as const, residenceId: assistance.residence.id } : user),
    [user, assistance],
  );

  const value = useMemo(
    () => ({
      user: effectiveUser, ready, sharedDevice, notice, login, logout, verifyMfa, setupMfa, enableMfa,
      assistance, startAssistance, leaveAssistance, platformNotice, clearPlatformNotice, updateUser,
    }),
    [effectiveUser, ready, sharedDevice, notice, login, logout, verifyMfa, setupMfa, enableMfa, assistance, startAssistance, leaveAssistance,
      platformNotice, clearPlatformNotice, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
