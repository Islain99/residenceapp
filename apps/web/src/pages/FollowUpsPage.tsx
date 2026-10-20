import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useFollowUps, type FollowUpFilter } from '../api/hooks';
import { FollowUpItem } from '../components/FollowUps';
import { Chip, EmptyState, ErrorMessage, Loading, PageHeader } from '../components/ui';

type View = 'mine' | 'team' | 'open' | 'closed';
const VIEWS: Record<View, FollowUpFilter> = {
  mine: { status: 'open', assignedTo: 'me' },
  team: { status: 'open', assignedTo: 'team' },
  open: { status: 'open' },
  closed: { status: 'closed' },
};
const isView = (v: string | null): v is View => v !== null && v in VIEWS;

export function FollowUpsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const vue = params.get('vue');
  const key: View = isView(vue) ? vue : 'open';
  const followUps = useFollowUps(VIEWS[key]);

  return (
    <>
      <PageHeader title={t('journal.followUp.title')} subtitle={t('journal.followUp.subtitle')} />
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label={t('journal.followUp.filter')}>
        {(Object.keys(VIEWS) as View[]).map((k) => (
          <Chip key={k} active={k === key} onClick={() => setParams({ vue: k }, { replace: true })}>{t(`journal.followUp.views.${k}`)}</Chip>
        ))}
      </div>
      {followUps.isPending ? <Loading /> : followUps.isError ? <ErrorMessage error={followUps.error} /> :
        followUps.data.length === 0 ? <EmptyState>{t(`journal.followUp.empty.${key}`)}</EmptyState> : (
          <ul className="flex flex-col gap-3">
            {followUps.data.map((f) => <FollowUpItem key={f.id} followUp={f} />)}
          </ul>
        )}
    </>
  );
}
