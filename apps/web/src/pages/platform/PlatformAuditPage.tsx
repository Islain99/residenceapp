// Plateforme — journal : actions des administrateurs et événements sans
// résidence. L'activité d'une résidence reste dans son propre journal.
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePlatformAudit, usePlatformResidences } from '../../api/hooks';
import { Button, EmptyState, ErrorMessage, Loading, PageHeader, SelectField } from '../../components/ui';
import { auditActor, describeAudit } from '../../lib/audit';
import { formatFull } from '../../lib/format';

export function PlatformAuditPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const residences = usePlatformResidences();
  const residenceId = params.get('residence') || undefined;
  const audit = usePlatformAudit({ residenceId });
  const items = audit.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title={t('platform.audit.title')}
        subtitle={t('platform.audit.subtitle')}
      />
      <div className="mb-5 max-w-xs">
        <SelectField label={t('platform.audit.residence')} value={residenceId ?? ''} onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value) next.set('residence', e.target.value); else next.delete('residence');
          setParams(next, { replace: true });
        }}>
          <option value="">{t('platform.audit.all')}</option>
          {residences.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </SelectField>
      </div>

      {audit.isPending ? <Loading /> : audit.isError ? <ErrorMessage error={audit.error} /> :
        items.length === 0 ? <EmptyState>{t('platform.audit.empty')}</EmptyState> : (
          <>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {items.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
                  <time dateTime={entry.at} className="shrink-0 text-xs text-muted sm:w-44">{formatFull(entry.at)}</time>
                  <span className="flex-1">
                    <strong>{auditActor(entry)}</strong> {describeAudit(entry)}
                    {entry.residence && <span className="text-muted"> · {entry.residence.name}</span>}
                  </span>
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
