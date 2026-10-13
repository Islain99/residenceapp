// Accès à la session (fournie par AuthProvider) et règles liées aux rôles.
import { createContext, useContext } from 'react';
import type { Role, User } from '../api/types';

// Admin plateforme en consultation d'une résidence (accès accordé par sa responsable)
export interface AssistanceState {
  grantId: string;
  residence: { id: string; name: string; type: string };
  expiresAt: string;
}

export interface AuthState {
  // En mode assistance : l'admin, vu comme « responsable » de la résidence consultée
  // (lecture seule, l'API refuse toute modification)
  user: User | null;
  assistance: AssistanceState | null;
  startAssistance: (grantId: string) => Promise<void>;
  leaveAssistance: (notice?: string) => void;
  platformNotice: string | null;
  clearPlatformNotice: () => void;
  ready: boolean;                 // restauration de session terminée
  sharedDevice: boolean;          // appareil partagé : déconnexion après inactivité
  notice: string | null;          // raison de la dernière déconnexion, affichée à la connexion
  login: (email: string, password: string, sharedDevice: boolean) => Promise<void>;
  logout: (notice?: string) => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth hors de AuthProvider');
  return ctx;
}

// Utilisateur connecté (pages protégées seulement)
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('useUser sans utilisateur connecté');
  return user;
}

// Même règle que l'API : corrigent toute note, gèrent les résidents
export const isSupervisor = (role: Role) => role === 'infirmiere' || role === 'responsable';

export const ROLE_LABELS: Record<Role, string> = {
  prepose: 'Préposé·e',
  infirmiere: 'Infirmière',
  responsable: 'Responsable',
  admin: 'Administration',
};
