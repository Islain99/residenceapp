// Relève de quart : page d'accueil. Ce qui s'est passé depuis ma dernière
// relève, puis « J'ai pris connaissance ».
import { useState } from 'react';
import { Link } from 'react-router';
import { useAcknowledgeHandover, useHandover } from '../api/hooks';
import { useUser } from '../auth/session';
import { FollowUpItem } from '../components/FollowUps';
import { NoteCard } from '../components/NoteCard';
import { Badge, Button, EmptyState, ErrorMessage, Loading, PageHeader } from '../components/ui';
import { formatWhen } from '../lib/format';

export function HandoverPage() {
  const user = useUser();
  const handover = useHandover();
  const ack = useAcknowledgeHandover();
  const [done, setDone] = useState(false);

  if (handover.isPending) return <Loading />;
  if (handover.isError) return <ErrorMessage error={handover.error} />;

  const h = handover.data;
  const priority = h.notes.filter((n) => n.isPriority);
  const others = h.notes.filter((n) => !n.isPriority);

  async function acknowledge() {
    await ack.mutateAsync(h.generatedAt);
    setDone(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <>
      <PageHeader
        title={`Bonjour ${user.firstName}`}
        subtitle={h.lastHandoverAt
          ? <>Depuis votre dernière relève, {formatWhen(h.since)}</>
          : <>Dernières 24 heures (première relève)</>}
      />

      {done && (
        <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm font-medium text-positive">
          Relève confirmée. Les prochaines nouveautés s'afficheront ici.
        </p>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone="info">{h.counts.notes} note{h.counts.notes > 1 ? 's' : ''}</Badge>
        <Badge tone="priority">{h.counts.priority} prioritaire{h.counts.priority > 1 ? 's' : ''}</Badge>
        <Badge>{h.counts.unread} non lue{h.counts.unread > 1 ? 's' : ''}</Badge>
        <Badge tone={h.followUps.some((f) => f.isOverdue) ? 'danger' : 'neutral'}>
          {h.followUps.length} suivi{h.followUps.length > 1 ? 's' : ''} à faire
        </Badge>
      </div>

      {priority.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-priority">Consignes prioritaires</h2>
          <div className="flex flex-col gap-3">{priority.map((n) => <NoteCard key={n.id} note={n} />)}</div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Suivis à faire</h2>
        {h.followUps.length === 0
          ? <EmptyState>Aucun suivi ouvert pour vous ou l'équipe.</EmptyState>
          : <ul className="flex flex-col gap-3">{h.followUps.map((f) => <FollowUpItem key={f.id} followUp={f} />)}</ul>}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Nouvelles notes</h2>
        {others.length === 0
          ? <EmptyState>Aucune nouvelle note depuis votre dernière relève.</EmptyState>
          : <div className="flex flex-col gap-3">{others.map((n) => <NoteCard key={n.id} note={n} />)}</div>}
        {h.truncated && (
          <p className="mt-3 text-sm text-muted">
            Seules les 200 notes les plus récentes sont affichées. <Link to="/journal" className="text-primary underline">Voir le journal</Link>
          </p>
        )}
      </section>

      <div className="sticky bottom-20 z-[5] flex justify-center md:bottom-4">
        <Button variant="primary" className="shadow-lg" busy={ack.isPending} onClick={acknowledge}>
          J'ai pris connaissance de la relève
        </Button>
      </div>
      <ErrorMessage error={ack.error} />
    </>
  );
}
