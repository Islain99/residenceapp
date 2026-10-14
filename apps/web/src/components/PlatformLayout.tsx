// Cadre des pages de l'administration de la plateforme (rôle « admin »).
import { NavLink, Outlet } from 'react-router';
import { useAuth, useUser } from '../auth/session';
import { cx } from '../lib/cx';
import { fullName } from '../lib/format';
import { Logo } from './Logo';
import { OfflineBanner } from './OfflineBanner';

const LINKS = [
  { to: '/plateforme', label: 'Résidences', end: true },
  { to: '/plateforme/securite', label: 'Sécurité', end: false },
  { to: '/plateforme/journal', label: 'Journal', end: false },
  { to: '/plateforme/administrateurs', label: 'Administrateurs', end: false },
  { to: '/plateforme/compte', label: 'Mon compte', end: false },
];

export function PlatformLayout() {
  const user = useUser();
  const { logout, platformNotice, clearPlatformNotice } = useAuth();

  const nav = (className: string) => (
    <nav aria-label="Administration de la plateforme" className={className}>
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) => cx(
            'flex shrink-0 items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium',
            isActive ? 'bg-info-soft text-primary' : 'text-muted hover:bg-sunken hover:text-ink',
          )}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <OfflineBanner />
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <span className="flex shrink-0 items-center gap-2 font-bold">
            <Logo className="size-10" />
            <span className="whitespace-nowrap">Plateforme</span>
          </span>
          {nav('hidden gap-1 md:flex')}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-right leading-tight sm:block">
              <span className="block whitespace-nowrap font-medium">{fullName(user)}</span>
              <span className="block text-xs text-muted">Administration de la plateforme</span>
            </span>
            <button type="button" onClick={() => void logout()} className="whitespace-nowrap rounded-lg px-3 py-2 text-muted hover:bg-sunken hover:text-ink">
              Déconnexion
            </button>
          </div>
        </div>
        {/* Téléphone : les onglets sous l'en-tête, défilants */}
        {nav('flex gap-1 overflow-x-auto border-t border-line px-2 py-1 md:hidden')}
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {platformNotice && (
          <p role="status" className="mb-4 flex items-start justify-between gap-3 rounded-lg bg-info-soft px-4 py-3 text-sm text-primary">
            {platformNotice}
            <button type="button" aria-label="Fermer" onClick={clearPlatformNotice} className="text-primary">✕</button>
          </p>
        )}
        <Outlet />
      </main>
    </div>
  );
}
