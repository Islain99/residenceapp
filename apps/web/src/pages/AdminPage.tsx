// Administration (responsable) : onglets Équipe, Catégories, Quarts, Messagerie,
// Fonctionnalités (lecture seule), Assistance, Journal d'audit.
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/session';
import { useAccess, type Need } from '../lib/access';
import { cx } from '../lib/cx';

const TABS = [
  { to: 'equipe', label: 'team', needs: null },
  { to: 'categories', label: 'categories', needs: [['journal']] },
  { to: 'quarts', label: 'shifts', needs: [['schedule', 'full']] },
  { to: 'messagerie', label: 'messaging', needs: null },
  { to: 'fonctionnalites', label: 'features', needs: null },
  { to: 'assistance', label: 'assistance', needs: null },
  { to: 'audit', label: 'audit', needs: null },
] as const satisfies { to: string; label: string; needs: Need[] | null }[];

export function AdminPage() {
  const { t } = useTranslation();
  const { assistance } = useAuth();
  const { canAny } = useAccess();
  // Assistance (admin plateforme) : la messagerie reste privée. Catégories et
  // quarts suivent leur module (fonctionnalités activables).
  const tabs = TABS.filter((tab) => !(assistance && tab.to === 'messagerie') && (!tab.needs || canAny(tab.needs as Need[])));
  return (
    <>
      <nav aria-label={t('admin.tabs.label')} className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            data-tour={`admin-tab-${tab.to}`}
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
