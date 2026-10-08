// Cadre des pages connectées : barre du haut (ordinateur) et barre du bas (téléphone).
import { NavLink, Outlet } from 'react-router';
import { useHandover } from '../api/hooks';
import { ROLE_LABELS, useAuth, useUser } from '../auth/session';
import { fullName } from '../lib/format';
import { cx } from '../lib/cx';

const LINKS = [
  { to: '/', label: 'Relève', icon: '◷', end: true },
  { to: '/journal', label: 'Journal', icon: '☰', end: false },
  { to: '/suivis', label: 'Suivis', icon: '✓', end: false },
  { to: '/residents', label: 'Résidents', icon: '⌂', end: false },
];
const TEAM_LINK = { to: '/equipe', label: 'Équipe', icon: '☺', end: false };

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
  const { logout } = useAuth();
  const links = user.role === 'responsable' ? [...LINKS, TEAM_LINK] : LINKS;

  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <span className="flex items-center gap-2 font-bold">
            <img src="/favicon.svg" alt="" className="size-7" />
            Journal de bord
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
            <span className="hidden text-right leading-tight sm:block">
              <span className="block font-medium">{fullName(user)}</span>
              <span className="block text-xs text-muted">{ROLE_LABELS[user.role]}</span>
            </span>
            <button type="button" onClick={logout} className="rounded-lg px-3 py-2 text-muted hover:bg-sunken hover:text-ink">
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>

      <nav aria-label="Navigation principale" className={cx('fixed inset-x-0 bottom-0 z-10 grid border-t border-line bg-surface md:hidden', links.length > 4 ? 'grid-cols-5' : 'grid-cols-4')}>
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => cx(
              'flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium',
              isActive ? 'text-primary' : 'text-muted',
            )}
          >
            <span aria-hidden className="text-lg leading-none">{link.icon}</span>
            <span className="flex items-center">{link.label}{link.to === '/' && <NavBadge />}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
