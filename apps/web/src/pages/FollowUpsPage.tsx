import { useSearchParams } from 'react-router';
import { useFollowUps, type FollowUpFilter } from '../api/hooks';
import { FollowUpItem } from '../components/FollowUps';
import { Chip, EmptyState, ErrorMessage, Loading, PageHeader } from '../components/ui';

const VIEWS: Record<string, { label: string; filter: FollowUpFilter; empty: string }> = {
  mine: { label: 'Pour moi', filter: { status: 'open', assignedTo: 'me' }, empty: 'Aucun suivi ouvert qui vous est assigné.' },
  team: { label: "Pour l'équipe", filter: { status: 'open', assignedTo: 'team' }, empty: "Aucun suivi ouvert pour l'équipe." },
  open: { label: 'Tous les ouverts', filter: { status: 'open' }, empty: 'Aucun suivi ouvert.' },
  closed: { label: 'Faits', filter: { status: 'closed' }, empty: 'Aucun suivi fait.' },
};

export function FollowUpsPage() {
  const [params, setParams] = useSearchParams();
  const key = params.get('vue') ?? 'open';
  const view = VIEWS[key] ?? VIEWS.open!;
  const followUps = useFollowUps(view.filter);

  return (
    <>
      <PageHeader title="Suivis" subtitle="Actions à faire issues des notes. On ajoute un suivi depuis une note." />
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filtrer les suivis">
        {Object.entries(VIEWS).map(([k, v]) => (
          <Chip key={k} active={k === key} onClick={() => setParams({ vue: k }, { replace: true })}>{v.label}</Chip>
        ))}
      </div>
      {followUps.isPending ? <Loading /> : followUps.isError ? <ErrorMessage error={followUps.error} /> :
        followUps.data.length === 0 ? <EmptyState>{view.empty}</EmptyState> : (
          <ul className="flex flex-col gap-3">
            {followUps.data.map((f) => <FollowUpItem key={f.id} followUp={f} />)}
          </ul>
        )}
    </>
  );
}
