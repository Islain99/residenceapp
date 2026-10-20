// Cadre des pages connectées : barre du haut (ordinateur) et barre du bas (téléphone).
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useEndAssistance, useHandover, useMessagingSummary } from '../api/hooks';
import { ROLE_LABELS, useAuth, useUser } from '../auth/session';
import { formatWhen, fullName } from '../lib/format';
import { cx } from '../lib/cx';
import { Avatar } from './Avatar';
import { IdleLogout } from './IdleLogout';
import { Logo } from './Logo';
import { NavIcon, type NavIconName } from './NavIcon';
import { OfflineBanner } from './OfflineBanner';

interface NavItem { to: string; label: string; icon: NavIconName; end: boolean }

const LINKS: NavItem[] = [
  { to: '/', label: 'Relève', icon: 'releve', end: true },
  { to: '/journal', label: 'Journal', icon: 'journal', end: false },
  { to: '/suivis', label: 'Suivis', icon: 'suivis', end: false },
  { to: '/messages', label: 'Messages', icon: 'messages', end: false },
  { to: '/agenda', label: 'Agenda', icon: 'agenda', end: false },
  { to: '/horaires', label: 'Horaires', icon: 'horaires', end: false },
  { to: '/residents', label: 'Résidents', icon: 'residents', end: false },
];
// Responsable : équipe, catégories, quarts, journal d'audit
const ADMIN_LINK: NavItem = { to: '/administration', label: 'Admin', icon: 'admin', end: false };

// Téléphone : les 5 écrans du quotidien en bas, le reste dans « Plus »
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

// Un onglet de la barre du bas : icône (dans une pastille si actif), pastille
// de compteur sur l'icône, libellé dessous
function MobileTab({ icon, label, active, badge }: { icon: NavIconName; label: string; active: boolean; badge?: ReactNode }) {
  return (
    <span className={cx('flex h-16 flex-col items-center justify-center gap-1 text-[11px]',
      active ? 'font-semibold text-primary' : 'font-medium text-muted')}>
      <span className={cx('relative flex h-8 w-14 items-center justify-center rounded-full transition-colors',
        active && 'bg-info-soft')}>
        <NavIcon name={icon} />
        {/* Pastille sur l'icône : le libellé garde toute la largeur */}
        <span className="absolute -top-1 left-8 text-[11px] leading-4">{badge}</span>
      </span>
      <span className="max-w-full truncate px-0.5">{label}</span>
    </span>
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
  const mobileMore: NavItem[] = [...links.filter((l) => !MOBILE_MAIN.includes(l.to)),
    ...(assistance ? [] : [{ to: '/compte', label: 'Mon profil', icon: 'profil' as const, end: false }])];
  const location = useLocation();
  // Menu « Plus » ouvert sur la page courante : il se referme dès qu'on change de page
  const [moreOpenOn, setMoreOpenOn] = useState<string | null>(null);
  const moreOpen = moreOpenOn === location.pathname;
  const setMoreOpen = (open: boolean) => setMoreOpenOn(open ? location.pathname : null);
  const inMore = mobileMore.some((l) => location.pathname.startsWith(l.to));

  return (
    <div className="min-h-dvh pb-[var(--nav-h)] md:pb-0">
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

      {/* Menu « Plus » : panneau qui monte du bas, au-dessus de la barre */}
      {moreOpen && (
        <>
          <button type="button" aria-label="Fermer le menu" className="fixed inset-0 z-10 bg-ink/30 md:hidden"
            onClick={() => setMoreOpen(false)} />
          <div id="menu-plus"
            className="fixed inset-x-0 bottom-[var(--nav-h)] z-20 rounded-t-2xl border-t border-line bg-surface px-3 pt-2 pb-3 shadow-[0_-8px_24px_rgb(0_0_0/0.12)] md:hidden">
            <span aria-hidden className="mx-auto mb-2 block h-1 w-10 rounded-full bg-line" />
            <div className="grid grid-cols-2 gap-1">
              {mobileMore.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => cx(
                    'flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium',
                    isActive ? 'bg-info-soft text-primary' : 'text-ink hover:bg-sunken',
                  )}
                >
                  <NavIcon name={link.icon} className="size-5 shrink-0" />
                  {link.label}
                </NavLink>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Téléphone : barre du bas, au-dessus de la barre d'accueil de l'iPhone
          (--nav-h, index.css). Onglet actif : icône dans une pastille colorée. */}
      <nav aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-20 grid h-[var(--nav-h)] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(0_0_0/0.06)] md:hidden"
        style={{ gridTemplateColumns: `repeat(${mobileMain.length + 1}, minmax(0, 1fr))` }}>
        {mobileMain.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className="min-w-0">
            {({ isActive }) => <MobileTab icon={link.icon} label={link.label} active={isActive && !moreOpen} badge={<NavBadge to={link.to} />} />}
          </NavLink>
        ))}
        <button type="button" aria-expanded={moreOpen} aria-controls="menu-plus" onClick={() => setMoreOpen(!moreOpen)} className="min-w-0">
          <MobileTab icon="plus" label="Plus" active={moreOpen || inMore} />
        </button>
      </nav>
    </div>
  );
}
