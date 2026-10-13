// Cadre des pages connectées : barre du haut (ordinateur) et barre du bas (téléphone).
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useHandover } from '../api/hooks';
import { ROLE_LABELS, useAuth, useUser } from '../auth/session';
import { fullName } from '../lib/format';
import { cx } from '../lib/cx';
import { IdleLogout } from './IdleLogout';
import { Logo } from './Logo';
import { OfflineBanner } from './OfflineBanner';

const LINKS = [
  { to: '/', label: 'Relève', icon: '◷', end: true },
  { to: '/journal', label: 'Journal', icon: '☰', end: false },
  { to: '/suivis', label: 'Suivis', icon: '✓', end: false },
  { to: '/agenda', label: 'Agenda', icon: '▦', end: false },
  { to: '/horaires', label: 'Horaires', icon: '⏱', end: false },
  { to: '/residents', label: 'Résidents', icon: '⌂', end: false },
];
// Responsable : équipe, catégories, quarts, journal d'audit
const ADMIN_LINK = { to: '/administration', label: 'Admin', icon: '⚙', end: false };

// Téléphone : les 4 écrans du quotidien en bas, le reste dans « Plus »
const MOBILE_MAIN = ['/', '/journal', '/suivis', '/residents'];

function NavBadge() {
  const handover = useHandover();
  const unread = handover.data?.counts.unread ?? 0;
  if (!unread) return null;
  return (
    <span className="ml-1 rounded-full bg-priority px-1.5 text-xs font-bold text-white" aria-label={`${unread} non lues`}>
      {unread > 99 ? '99+' : unread}
    </span>
  );
}

export function Layout() {
  const user = useUser();
  const { logout, sharedDevice } = useAuth();
  const links = user.role === 'responsable' ? [...LINKS, ADMIN_LINK] : LINKS;
  const mobileMain = links.filter((l) => MOBILE_MAIN.includes(l.to));
  const mobileMore = links.filter((l) => !MOBILE_MAIN.includes(l.to));
  const location = useLocation();
  // Menu « Plus » ouvert sur la page courante : il se referme dès qu'on change de page
  const [moreOpenOn, setMoreOpenOn] = useState<string | null>(null);
  const moreOpen = moreOpenOn === location.pathname;
  const setMoreOpen = (open: boolean) => setMoreOpenOn(open ? location.pathname : null);
  const inMore = mobileMore.some((l) => location.pathname.startsWith(l.to));

  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      {sharedDevice && <IdleLogout />}
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <OfflineBanner />
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 lg:gap-6">
          <span className="flex shrink-0 items-center gap-2 font-bold">
            <Logo className="size-10" />
            {/* Ordinateur : le nom laisse la place aux onglets, sauf sur grand écran */}
            <span className="whitespace-nowrap md:hidden xl:inline">Journal de bord</span>
          </span>
          <nav aria-label="Navigation principale" className="hidden gap-1 md:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) => cx(
                  'flex items-center rounded-lg px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-info-soft text-primary' : 'text-muted hover:bg-sunken hover:text-ink',
                )}
              >
                {link.label}
                {link.to === '/' && <NavBadge />}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-right leading-tight sm:block md:hidden lg:block">
              <span className="block whitespace-nowrap font-medium">{fullName(user)}</span>
              <span className="block text-xs text-muted">{ROLE_LABELS[user.role]}</span>
            </span>
            <button type="button" onClick={() => void logout()} className="whitespace-nowrap rounded-lg px-3 py-2 text-muted hover:bg-sunken hover:text-ink">
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>

      {moreOpen && (
        <>
          <button type="button" aria-label="Fermer le menu" className="fixed inset-0 z-10 bg-ink/20 md:hidden"
            onClick={() => setMoreOpen(false)} />
          <div id="menu-plus" className="fixed inset-x-0 bottom-16 z-20 border-t border-line bg-surface p-2 shadow-lg md:hidden">
            {mobileMore.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => cx(
                  'flex min-h-12 items-center gap-3 rounded-lg px-4 font-medium',
                  isActive ? 'bg-info-soft text-primary' : 'text-ink hover:bg-sunken',
                )}
              >
                <span aria-hidden className="w-6 text-center text-lg">{link.icon}</span>
                {link.label}
              </NavLink>
            ))}
          </div>
        </>
      )}

      <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-surface md:hidden">
        {mobileMain.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => cx(
              'flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 text-xs font-medium',
              isActive && !moreOpen ? 'text-primary' : 'text-muted',
            )}
          >
            <span aria-hidden className="text-lg leading-none">{link.icon}</span>
            <span className="flex max-w-full items-center truncate">{link.label}{link.to === '/' && <NavBadge />}</span>
          </NavLink>
        ))}
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls="menu-plus"
          onClick={() => setMoreOpen(!moreOpen)}
          className={cx(
            'flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 text-xs font-medium',
            moreOpen || inMore ? 'text-primary' : 'text-muted',
          )}
        >
          <span aria-hidden className="text-lg leading-none">⋯</span>
          <span>Plus</span>
        </button>
      </nav>
    </div>
  );
}
