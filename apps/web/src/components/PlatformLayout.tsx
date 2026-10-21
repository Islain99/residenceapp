// Cadre des pages de l'administration de la plateforme (rôle « admin »).
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { useAuth, useUser } from '../auth/session';
import type shellFr from '../i18n/fr/shell';
import { cx } from '../lib/cx';
import { fullName } from '../lib/format';
import { Avatar } from './Avatar';
import { Logo } from './Logo';
import { NavIcon } from './NavIcon';
import { OfflineBanner } from './OfflineBanner';
import { TourHost, TourOffer } from './Tour';

const LINKS = [
  { to: '/plateforme', label: 'residences', end: true },
  { to: '/plateforme/securite', label: 'security', end: false },
  { to: '/plateforme/journal', label: 'platformAudit', end: false },
  { to: '/plateforme/administrateurs', label: 'admins', end: false },
  { to: '/plateforme/compte', label: 'profile', end: false },
] as const satisfies { to: string; label: keyof typeof shellFr.nav; end: boolean }[];

export function PlatformLayout() {
  const { t } = useTranslation();
  const user = useUser();
  const { logout, platformNotice, clearPlatformNotice } = useAuth();

  const nav = (className: string) => (
    <nav aria-label={t('shell.nav.platformRole')} className={className}>
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          data-tour={`nav-${link.label}`}
          className={({ isActive }) => cx(
            'flex shrink-0 items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium',
            isActive ? 'bg-info-soft text-primary' : 'text-muted hover:bg-sunken hover:text-ink',
          )}
        >
          {t(`shell.nav.${link.label}`)}
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
            <span className="whitespace-nowrap">{t('shell.nav.platform')}</span>
          </span>
          {nav('hidden gap-1 md:flex')}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <NavLink to="/plateforme/aide" data-tour="header-help" title={t('help.nav')} aria-label={t('help.nav')}
              className={({ isActive }) => cx('rounded-full p-2', isActive ? 'bg-info-soft text-primary' : 'text-muted hover:bg-sunken hover:text-ink')}>
              <NavIcon name="aide" className="size-6" />
            </NavLink>
            {/* Rond avec les initiales, puis le nom (à partir de la largeur d'une tablette) */}
            <NavLink to="/plateforme/compte" data-tour="header-profile" title={t('shell.nav.profile')} aria-label={t('shell.nav.profileOf', { name: fullName(user) })}
              className="flex items-center gap-2 rounded-full py-1 pr-1 pl-1 hover:bg-sunken sm:rounded-lg sm:pr-2">
              <Avatar person={user} />
              <span className="hidden text-left leading-tight sm:block">
                <span className="block whitespace-nowrap font-medium">{fullName(user)}</span>
                <span className="block text-xs text-muted">{t('shell.nav.platformRole')}</span>
              </span>
            </NavLink>
            <button type="button" onClick={() => void logout()} className="whitespace-nowrap rounded-lg px-3 py-2 text-muted hover:bg-sunken hover:text-ink">
              {t('common.logout')}
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
      <TourOffer />
      <TourHost />
    </div>
  );
}
