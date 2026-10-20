// Administration (responsable) : onglets Équipe, Catégories, Quarts, Messagerie,
// Assistance, Journal d'audit.
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/session';
import { cx } from '../lib/cx';

const TABS = [
  { to: 'equipe', label: 'team' },
  { to: 'categories', label: 'categories' },
  { to: 'quarts', label: 'shifts' },
  { to: 'messagerie', label: 'messaging' },
  { to: 'assistance', label: 'assistance' },
  { to: 'audit', label: 'audit' },
] as const;

export function AdminPage() {
  const { t } = useTranslation();
  const { assistance } = useAuth();
  // Assistance (admin plateforme) : la messagerie reste privée
  const tabs = assistance ? TABS.filter((tab) => tab.to !== 'messagerie') : TABS;
  return (
    <>
      <nav aria-label={t('admin.tabs.label')} className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => cx(
              '-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium',
              isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t(`admin.tabs.${tab.label}`)}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
