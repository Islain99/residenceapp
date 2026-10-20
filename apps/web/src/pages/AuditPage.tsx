// Journal d'audit (responsable) : qui a fait quoi, et quand. Filtres par
// type d'élément et par employé, conservés dans l'adresse.
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useAudit, useStaff, type AuditFilters } from '../api/hooks';
import type { AuditEntry } from '../api/types';
import { Button, Chip, EmptyState, ErrorMessage, Loading, PageHeader, SelectField } from '../components/ui';
import { auditActor, describeAudit } from '../lib/audit';
import { formatFull, fullName } from '../lib/format';

// Filtres par type d'élément ('' : tout)
const ENTITIES = ['', 'resident', 'note', 'follow_up', 'user', 'note_category', 'assistance'] as const;

function Target({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation();
  if (!entry.entityId) return null;
  if (entry.entity === 'resident') return <Link className="text-primary hover:underline" to={`/residents/${entry.entityId}`}>{t('admin.audit.seeFile')}</Link>;
  if (entry.entity === 'note') return <Link className="text-primary hover:underline" to={`/notes/${entry.entityId}`}>{t('admin.audit.seeNote')}</Link>;
  return null;
}

export function AuditPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const staff = useStaff();
  const filters: AuditFilters = {
    entity: params.get('type') || undefined,
    userId: params.get('employe') || undefined,
  };
  const audit = useAudit(filters);
  const items = audit.data?.pages.flatMap((p) => p.items) ?? [];

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={t('admin.audit.title')}
        subtitle={t('admin.audit.subtitle')}
      />

      <div className="mb-5 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('admin.audit.entityType')}>
          {ENTITIES.map((key) => (
            <Chip key={key} active={(filters.entity ?? '') === key} onClick={() => setFilter('type', key)}>{t(`admin.audit.filters.${key || 'all'}`)}</Chip>
          ))}
        </div>
        <div className="max-w-xs">
          <SelectField label={t('admin.audit.employee')} value={filters.userId ?? ''} onChange={(e) => setFilter('employe', e.target.value)}>
            <option value="">{t('admin.audit.all')}</option>
            {staff.data?.map((s) => <option key={s.id} value={s.id}>{fullName(s)}</option>)}
          </SelectField>
        </div>
      </div>

      {audit.isPending ? <Loading /> : audit.isError ? <ErrorMessage error={audit.error} /> :
        items.length === 0 ? <EmptyState>{t('admin.audit.empty')}</EmptyState> : (
          <>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {items.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
                  <time dateTime={entry.at} className="shrink-0 text-xs text-muted sm:w-44">{formatFull(entry.at)}</time>
                  <span className="flex-1">
                    <strong>{auditActor(entry)}</strong>{' '}
                    {describeAudit(entry)}
                  </span>
                  <Target entry={entry} />
                </li>
              ))}
            </ul>
            {audit.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button busy={audit.isFetchingNextPage} onClick={() => audit.fetchNextPage()}>{t('admin.audit.more')}</Button>
              </div>
            )}
          </>
        )}
    </>
  );
}
