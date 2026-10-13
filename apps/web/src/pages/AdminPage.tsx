// Administration (responsable) : onglets Équipe, Catégories, Quarts, Messagerie,
// Assistance, Journal d'audit.
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/session';
import { cx } from '../lib/cx';

const TABS = [
  { to: 'equipe', label: 'Équipe' },
  { to: 'categories', label: 'Catégories' },
  { to: 'quarts', label: 'Quarts' },
  { to: 'messagerie', label: 'Messagerie' },
  { to: 'assistance', label: 'Assistance' },
  { to: 'audit', label: "Journal d'audit" },
];

export function AdminPage() {
  const { assistance } = useAuth();
  // Assistance (admin plateforme) : la messagerie reste privée
  const tabs = assistance ? TABS.filter((t) => t.to !== 'messagerie') : TABS;
  return (
    <>
      <nav aria-label="Administration" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => cx(
              '-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium',
              isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
