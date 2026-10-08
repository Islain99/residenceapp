// Détail d'une note : contenu complet, suivis, lecteurs, historique des corrections.
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useCancelNote, useCategories, useMarkRead, useNote, useUpdateNote } from '../api/hooks';
import type { NoteDetail } from '../api/types';
import { isSupervisor, useUser } from '../auth/session';
import { FollowUpForm, FollowUpItem } from '../components/FollowUps';
import { NoteBadges, ResidentLabel } from '../components/NoteCard';
import { NoteForm } from '../components/NoteForm';
import { Button, Card, Dialog, EmptyState, ErrorMessage, Loading, TextArea } from '../components/ui';
import { formatFull, formatWhen, fullName } from '../lib/format';

const AUTHOR_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;   // même règle que l'API

export function NoteDetailPage() {
  const { id = '' } = useParams();
  const note = useNote(id);

  if (note.isPending) return <Loading />;
  if (note.isError) return <ErrorMessage error={note.error} />;
  return <NoteView note={note.data} />;
}

function NoteView({ note }: { note: NoteDetail }) {
  const user = useUser();
  const markRead = useMarkRead();
  const [dialog, setDialog] = useState<'edit' | 'cancel' | 'follow-up' | null>(null);
  const close = () => setDialog(null);
  const [openedAt] = useState(() => Date.now());

  // Affichage seulement : l'API applique la même règle et refuse sinon
  const active = note.status === 'active';
  const canModify = active && (isSupervisor(user.role)
    || (note.author.id === user.id && openedAt - Date.parse(note.createdAt) < AUTHOR_EDIT_WINDOW_MS));

  return (
    <>
      <Link to="/journal" className="mb-4 inline-block text-sm text-primary hover:underline">← Journal</Link>

      <Card className={note.isPriority && active ? 'border-l-4 border-l-priority p-5' : 'p-5'}>
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <ResidentLabel note={note} />
          <div className="flex flex-wrap gap-1.5"><NoteBadges note={note} /></div>
        </div>
        <p className="mb-4 text-sm text-muted">
          <time dateTime={note.occurredAt}>{formatFull(note.occurredAt)}</time> · écrit par {fullName(note.author)}
          {' '}{formatWhen(note.createdAt)}
        </p>

        <p className={`whitespace-pre-line text-lg ${active ? '' : 'line-through'}`}>{note.description}</p>
        {note.intervention && (
          <div className="mt-4 rounded-lg bg-sunken p-3">
            <p className="text-sm font-semibold">Intervention</p>
            <p className="whitespace-pre-line">{note.intervention}</p>
          </div>
        )}

        {!active && (
          <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            Annulée par {note.cancelledBy ? fullName(note.cancelledBy) : '—'} {note.cancelledAt && formatWhen(note.cancelledAt)}
            {' '}— motif : {note.cancelReason}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {active && !note.readByMe && (
            <Button variant="primary" busy={markRead.isPending} onClick={() => markRead.mutate(note.id)}>Marquer comme lue</Button>
          )}
          {active && <Button onClick={() => setDialog('follow-up')}>+ Suivi</Button>}
          {canModify && <Button onClick={() => setDialog('edit')}>Corriger</Button>}
          {canModify && <Button variant="ghost" className="text-danger" onClick={() => setDialog('cancel')}>Annuler la note</Button>}
        </div>
        {active && !canModify && (
          <p className="mt-3 text-xs text-muted">
            Seul l'auteur (dans les 24 h) ou une infirmière / responsable peut corriger ou annuler cette note.
          </p>
        )}
      </Card>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Suivis</h2>
        {note.followUps.length === 0
          ? <EmptyState>Aucun suivi pour cette note.</EmptyState>
          : <ul className="flex flex-col gap-3">{note.followUps.map((f) => <FollowUpItem key={f.id} followUp={f} showNote={false} />)}</ul>}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Lue par</h2>
        {note.reads.length === 0 ? <p className="text-sm text-muted">Personne n'a encore confirmé la lecture.</p> : (
          <ul className="flex flex-wrap gap-2">
            {note.reads.map((r) => (
              <li key={r.user.id} className="rounded-full bg-sunken px-3 py-1 text-sm">
                {fullName(r.user)} <span className="text-muted">· {formatWhen(r.readAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {note.versions.length > 0 && <History note={note} />}

      <Dialog open={dialog === 'edit'} onClose={close} title="Corriger la note">
        <EditNote note={note} onDone={close} />
      </Dialog>
      <Dialog open={dialog === 'cancel'} onClose={close} title="Annuler la note">
        <CancelNote id={note.id} onDone={close} />
      </Dialog>
      <Dialog open={dialog === 'follow-up'} onClose={close} title="Nouveau suivi">
        <FollowUpForm noteId={note.id} onDone={close} />
      </Dialog>
    </>
  );
}

function EditNote({ note, onDone }: { note: NoteDetail; onDone: () => void }) {
  const update = useUpdateNote(note.id);
  return (
    <>
      <p className="mb-4 text-sm text-muted">La version actuelle est conservée dans l'historique de la note.</p>
      <NoteForm note={note} submitLabel="Enregistrer la correction" onCancel={onDone}
        onSubmit={async (input) => { await update.mutateAsync(input); onDone(); }} />
    </>
  );
}

function CancelNote({ id, onDone }: { id: string; onDone: () => void }) {
  const cancel = useCancelNote(id);
  const [reason, setReason] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    await cancel.mutateAsync(reason);
    onDone();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm">La note restera visible, marquée « annulée », avec le motif. Elle ne pourra plus être modifiée.</p>
      <TextArea label="Motif de l'annulation" required minLength={3} maxLength={500} rows={2}
        value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. : note écrite pour le mauvais résident." />
      <ErrorMessage error={cancel.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Retour</Button>
        <Button type="submit" variant="danger" busy={cancel.isPending}>Annuler la note</Button>
      </div>
    </form>
  );
}

function History({ note }: { note: NoteDetail }) {
  const categories = useCategories();
  const label = (id: string) => categories.data?.find((c) => c.id === id)?.label ?? '—';
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">Historique des corrections</h2>
      <ol className="flex flex-col gap-3">
        {note.versions.map((v) => (
          <li key={v.editedAt} className="rounded-xl border border-line bg-surface p-4 text-sm">
            <p className="mb-2 text-muted">
              Version remplacée {formatWhen(v.editedAt)} par {fullName(v.editedBy)}
            </p>
            <p className="whitespace-pre-line">{v.previous.description}</p>
            {v.previous.intervention && <p className="mt-1 text-muted">Intervention : {v.previous.intervention}</p>}
            <p className="mt-2 text-xs text-muted">
              {label(v.previous.categoryId)} · événement {formatWhen(v.previous.occurredAt)}
              {v.previous.isPriority && ' · prioritaire'}{v.previous.isPositive && ' · positif'}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
