// Relève de quart : page d'accueil. Ce qui s'est passé depuis ma dernière
// relève, puis « J'ai pris connaissance ».
//
// Les consignes prioritaires se confirment une à une ; ensuite seulement,
// « J'ai pris connaissance » confirme la lecture des notes ordinaires.
import { useState } from 'react';
import { Link } from 'react-router';
import { PushPrompt } from '../components/PushPrompt';
import { useAckAnnouncement, useAcknowledgeHandover, useHandover, useMessagingSummary } from '../api/hooks';
import { useUser } from '../auth/session';
import { AppointmentItem } from '../components/Appointments';
import { FollowUpItem } from '../components/FollowUps';
import { NoteCard } from '../components/NoteCard';
import { Badge, Button, EmptyState, ErrorMessage, Loading, PageHeader } from '../components/ui';
import { formatWhen, fullName } from '../lib/format';

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
  const pending = priority.filter((n) => !n.readByMe).length;   // consignes à confirmer d'abord

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

      <PushPrompt />
      <AnnouncementsToConfirm />

      {priority.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-semibold text-priority">Consignes prioritaires</h2>
          <p className="mb-3 text-sm text-muted">
            {pending > 0
              ? `À lire et confirmer une à une (${pending} restante${pending > 1 ? 's' : ''}).`
              : 'Toutes confirmées.'}
          </p>
          <div className="flex flex-col gap-3">{priority.map((n) => <NoteCard key={n.id} note={n} />)}</div>
        </section>
      )}

      {h.appointments.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Rendez-vous des prochaines 24 h</h2>
            <Link to="/agenda" className="text-sm text-primary hover:underline">Agenda →</Link>
          </div>
          <ul className="flex flex-col gap-2">{h.appointments.map((a) => <AppointmentItem key={a.id} appointment={a} showDate />)}</ul>
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

      {/* Téléphone : espace réservé sous la dernière note, que la barre fixe ne cache pas */}
      <div aria-hidden className="h-24 md:hidden" />
      {/* Barre de confirmation. Téléphone : fixée juste au-dessus de la barre du
          bas (--nav-h), même quand la relève est courte. Ordinateur : carte
          collée au bas de l'écran en défilant. */}
      <div className="fixed inset-x-0 bottom-[var(--nav-h)] z-[5] flex flex-col items-center gap-1 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:sticky md:inset-x-auto md:bottom-4 md:rounded-xl md:border md:shadow-lg">
        <Button variant="primary" className="w-full sm:w-auto" busy={ack.isPending} disabled={pending > 0} onClick={acknowledge}>
          J'ai pris connaissance de la relève
        </Button>
        <p className="text-center text-xs text-muted">
          {pending > 0
            ? `Confirmez d'abord ${pending > 1 ? `les ${pending} consignes prioritaires` : 'la consigne prioritaire'}.`
            : 'Les notes de la relève seront marquées comme lues.'}
        </p>
        <ErrorMessage error={ack.error} />
      </div>
    </>
  );
}

// Annonces de la messagerie pas encore confirmées : en tête de la relève
function AnnouncementsToConfirm() {
  const summary = useMessagingSummary();
  const ack = useAckAnnouncement();
  const pending = summary.data?.announcements ?? [];
  if (pending.length === 0) return null;
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-priority">Annonces à confirmer</h2>
        <Link to={`/messages/${pending[0]!.conversationId}`} className="text-sm text-primary hover:underline">Annonces →</Link>
      </div>
      <ul className="flex flex-col gap-3">
        {pending.map((m) => (
          <li key={m.id} className="rounded-xl border border-l-4 border-priority/60 bg-surface p-4">
            <p className="mb-1 text-sm"><span className="font-semibold">{fullName(m.author)}</span> <span className="text-muted">{formatWhen(m.createdAt)}</span></p>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <Button variant="primary" className="mt-3 min-h-9" busy={ack.isPending && ack.variables === m.id} onClick={() => ack.mutate(m.id)}>
              J'ai lu cette annonce
            </Button>
          </li>
        ))}
      </ul>
      <ErrorMessage error={ack.error} />
    </section>
  );
}
