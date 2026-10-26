// Fonctionnalités activables : page d'un module masqué pour la personne
// (adresse tapée, ancien favori, notification) → message clair au lieu d'une
// erreur ; accueil vers la première page disponible si la relève est masquée.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, Outlet } from 'react-router';
import { PAGE_NEEDS, useAccess, type Need } from '../lib/access';
import { Loading } from './ui';

export function FeatureGate({ needs, children }: { needs: Need[]; children?: ReactNode }) {
  const { ready, canAny } = useAccess();
  if (ready && !canAny(needs)) return <FeatureOff />;
  return children ?? <Outlet />;
}

export function FeatureOff() {
  const { t } = useTranslation();
  return (
    <div className="py-16 text-center">
      <p className="mb-1 text-lg font-semibold">{t('shell.features.offTitle')}</p>
      <p className="mb-4 text-muted">{t('shell.features.offBody')}</p>
      <Link to="/" className="text-primary underline">{t('shell.features.home')}</Link>
    </div>
  );
}

// Accueil : la relève, sinon la première page disponible, sinon l'aide
export function HomeRoute({ children }: { children: ReactNode }) {
  const { ready, canAny } = useAccess();
  if (!ready) return <Loading />;
  if (canAny(PAGE_NEEDS['/']!)) return children;
  const first = Object.entries(PAGE_NEEDS).find(([path, needs]) => path !== '/' && canAny(needs));
  return <Navigate to={first?.[0] ?? '/aide'} replace />;
}
