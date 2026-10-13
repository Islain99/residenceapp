// Journal d'audit (responsable) : qui a fait quoi, et quand. Filtres par
// type d'élément et par employé, conservés dans l'adresse.
import { Link, useSearchParams } from 'react-router';
import { useAudit, useStaff, type AuditFilters } from '../api/hooks';
import type { AuditEntry } from '../api/types';
import { Button, Chip, EmptyState, ErrorMessage, Loading, PageHeader, SelectField } from '../components/ui';
import { auditActor, describeAudit } from '../lib/audit';
import { formatFull, fullName } from '../lib/format';

const ENTITIES: Record<string, string> = {
  '': 'Tout',
  resident: 'Dossiers résidents',
  note: 'Notes',
  follow_up: 'Suivis',
  user: 'Comptes et connexions',
  note_category: 'Catégories',
  assistance: 'Accès d’assistance',
};

function target(entry: AuditEntry) {
  if (!entry.entityId) return null;
  if (entry.entity === 'resident') return <Link className="text-primary hover:underline" to={`/residents/${entry.entityId}`}>Voir le dossier</Link>;
  if (entry.entity === 'note') return <Link className="text-primary hover:underline" to={`/notes/${entry.entityId}`}>Voir la note</Link>;
  return null;
}

export function AuditPage() {
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
        title="Journal d'audit"
        subtitle="Toutes les actions sensibles, plus récentes d'abord. Rien ne peut y être modifié ni effacé."
      />

      <div className="mb-5 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Type d'élément">
          {Object.entries(ENTITIES).map(([key, label]) => (
            <Chip key={key} active={(filters.entity ?? '') === key} onClick={() => setFilter('type', key)}>{label}</Chip>
          ))}
        </div>
        <div className="max-w-xs">
          <SelectField label="Employé" value={filters.userId ?? ''} onChange={(e) => setFilter('employe', e.target.value)}>
            <option value="">Tous</option>
            {staff.data?.map((s) => <option key={s.id} value={s.id}>{fullName(s)}</option>)}
          </SelectField>
        </div>
      </div>

      {audit.isPending ? <Loading /> : audit.isError ? <ErrorMessage error={audit.error} /> :
        items.length === 0 ? <EmptyState>Aucune action pour ces filtres.</EmptyState> : (
          <>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {items.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
                  <time dateTime={entry.at} className="shrink-0 text-xs text-muted sm:w-44">{formatFull(entry.at)}</time>
                  <span className="flex-1">
                    <strong>{auditActor(entry)}</strong>{' '}
                    {describeAudit(entry)}
                  </span>
                  {target(entry)}
                </li>
              ))}
            </ul>
            {audit.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button busy={audit.isFetchingNextPage} onClick={() => audit.fetchNextPage()}>Voir plus</Button>
              </div>
            )}
          </>
        )}
    </>
  );
}
