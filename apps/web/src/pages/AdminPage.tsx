// Administration (responsable) : onglets Équipe, Catégories, Journal d'audit.
import { NavLink, Outlet } from 'react-router';
import { cx } from '../lib/cx';

const TABS = [
  { to: 'equipe', label: 'Équipe' },
  { to: 'categories', label: 'Catégories' },
  { to: 'audit', label: "Journal d'audit" },
];

export function AdminPage() {
  return (
    <>
      <nav aria-label="Administration" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((tab) => (
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
