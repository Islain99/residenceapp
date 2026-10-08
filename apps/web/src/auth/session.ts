// Accès à la session (fournie par AuthProvider) et règles liées aux rôles.
import { createContext, useContext } from 'react';
import type { Role, User } from '../api/types';

export interface AuthState {
  user: User | null;
  ready: boolean;                 // restauration de session terminée
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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
