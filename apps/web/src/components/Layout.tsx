// Cadre des pages connectées : barre du haut (ordinateur) et barre du bas (téléphone).
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useEndAssistance, useHandover, useMessagingSummary } from '../api/hooks';
import { ROLE_LABELS, useAuth, useUser } from '../auth/session';
import { formatWhen, fullName } from '../lib/format';
import { cx } from '../lib/cx';
import { Avatar } from './Avatar';
import { IdleLogout } from './IdleLogout';
import { Logo } from './Logo';
import { OfflineBanner } from './OfflineBanner';

const LINKS = [
  { to: '/', label: 'Relève', icon: '◷', end: true },
  { to: '/journal', label: 'Journal', icon: '☰', end: false },
  { to: '/suivis', label: 'Suivis', icon: '✓', end: false },
  { to: '/messages', label: 'Messages', icon: '✉', end: false },
  { to: '/agenda', label: 'Agenda', icon: '▦', end: false },
  { to: '/horaires', label: 'Horaires', icon: '⏱', end: false },
  { to: '/residents', label: 'Résidents', icon: '⌂', end: false },
];
// Responsable : équipe, catégories, quarts, journal d'audit
const ADMIN_LINK = { to: '/administration', label: 'Admin', icon: '⚙', end: false };

// Téléphone : les 4 écrans du quotidien en bas, le reste dans « Plus »
const MOBILE_MAIN = ['/', '/journal', '/suivis', '/messages', '/residents'];

// Pastille : non lues de la relève, ou messages non lus + annonces à confirmer
function NavBadge({ to }: { to: string }) {
  if (to === '/') return <HandoverBadge />;
  if (to === '/messages') return <MessagesBadge />;
  return null;
}

function MessagesBadge() {
  const summary = useMessagingSummary();
  const count = (summary.data?.unread ?? 0) + (summary.data?.announcements.length ?? 0);
  if (!count) return null;
  return (
    <span className="ml-1 rounded-full bg-primary px-1.5 text-xs font-bold text-on-primary" aria-label={count > 1 ? `${count} messages non lus` : '1 message non lu'}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

function HandoverBadge() {
  const handover = useHandover();
  const unread = handover.data?.counts.unread ?? 0;
  if (!unread) return null;
  return (
    <span className="ml-1 rounded-full bg-priority px-1.5 text-xs font-bold text-white" aria-label={`${unread} non lues`}>
      {unread > 99 ? '99+' : unread}
    </span>
  );
}

// Admin plateforme en consultation : bandeau toujours visible, sortie en un clic
function AssistanceBanner() {
  const { assistance, leaveAssistance } = useAuth();
  const end = useEndAssistance();
  const navigate = useNavigate();
  // Tentative de modification : rappel bien visible pendant quelques secondes
  const [refusedAt, setRefusedAt] = useState(0);
  useEffect(() => {
    const onRefused = () => setRefusedAt(Date.now());
    window.addEventListener('assistance-refused', onRefused);
    return () => window.removeEventListener('assistance-refused', onRefused);
  }, []);
  useEffect(() => {
    if (!refusedAt) return;
    const timer = setTimeout(() => setRefusedAt(0), 5000);
    return () => clearTimeout(timer);
  }, [refusedAt]);
  if (!assistance) return null;
  const leave = (notice?: string) => {
    leaveAssistance(notice);
    void navigate('/plateforme');
  };
  return (
    <div role="status" className="bg-priority px-4 py-2 text-sm text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1">
          {refusedAt > 0 && (
            <strong role="alert" className="mr-2 inline-block rounded bg-white px-2 text-priority">
              Modification refusée : consultation seulement.
            </strong>
          )}
          <strong>Accès d’assistance — {assistance.residence.name}</strong>
          {' · '}lecture seule, messagerie exclue, chaque page consultée est inscrite au journal de la résidence
          {' · '}jusqu’à {formatWhen(assistance.expiresAt)}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => leave()} className="min-h-9 rounded-lg bg-white/15 px-3 font-medium hover:bg-white/25">
            Revenir à la plateforme
          </button>
          <button
            type="button"
            disabled={end.isPending}
            onClick={() => end.mutate(assistance.grantId, { onSettled: () => leave('Accès d’assistance terminé.') })}
            className="min-h-9 rounded-lg bg-white px-3 font-medium text-priority hover:bg-white/90"
          >
            Terminer l’accès
          </button>
        </div>
      </div>
    </div>
  );
}

export function Layout() {
  const user = useUser();
  const { logout, sharedDevice, assistance } = useAuth();
  // Assistance : la messagerie reste privée (l'API la refuse aussi)
  const base = assistance ? LINKS.filter((l) => l.to !== '/messages') : LINKS;
  const links = user.role === 'responsable' ? [...base, ADMIN_LINK] : base;
  const mobileMain = links.filter((l) => MOBILE_MAIN.includes(l.to));
  // « Mon profil » : rond avec les initiales en haut, et aussi dans « Plus » sur téléphone
  const mobileMore = [...links.filter((l) => !MOBILE_MAIN.includes(l.to)),
    ...(assistance ? [] : [{ to: '/compte', label: 'Mon profil', icon: '☺', end: false }])];
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
        <AssistanceBanner />
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
                <NavBadge to={link.to} />
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {/* Rond avec les initiales, puis le nom (le nom seul disparaît quand la place manque) */}
            <NavLink to="/compte" title="Mon profil" aria-label={`Mon profil (${fullName(user)})`}
              className="flex items-center gap-2 rounded-full py-1 pr-1 pl-1 hover:bg-sunken lg:rounded-lg lg:pr-2">
              <Avatar person={user} />
              <span className="hidden text-left leading-tight sm:block md:hidden lg:block">
                <span className="block whitespace-nowrap font-medium">{fullName(user)}</span>
                <span className="block text-xs text-muted">{assistance ? 'Assistance (lecture seule)' : ROLE_LABELS[user.role]}</span>
              </span>
            </NavLink>
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

      <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-20 grid border-t border-line bg-surface md:hidden"
        style={{ gridTemplateColumns: `repeat(${mobileMain.length + 1}, minmax(0, 1fr))` }}>
        {mobileMain.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => cx(
              'flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
              isActive && !moreOpen ? 'text-primary' : 'text-muted',
            )}
          >
            {/* Pastille sur l'icône : le libellé garde toute la largeur */}
            <span className="relative text-lg leading-none">
              <span aria-hidden>{link.icon}</span>
              <span className="absolute -top-2 left-3 text-[11px] leading-4"><NavBadge to={link.to} /></span>
            </span>
            <span className="max-w-full truncate">{link.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls="menu-plus"
          onClick={() => setMoreOpen(!moreOpen)}
          className={cx(
            'flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
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
