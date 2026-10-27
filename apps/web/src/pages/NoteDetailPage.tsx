// Détail d'une note : contenu complet, suivis, lecteurs, historique des corrections.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useCancelNote, useCategories, useMarkRead, useNote, useUpdateNote } from '../api/hooks';
import type { NoteDetail } from '../api/types';
import { isSupervisor, useUser } from '../auth/session';
import { useAccess } from '../lib/access';
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
  const { t } = useTranslation();
  const user = useUser();
  const markRead = useMarkRead();
  const [dialog, setDialog] = useState<'edit' | 'cancel' | 'follow-up' | null>(null);
  const close = () => setDialog(null);
  const [openedAt] = useState(() => Date.now());

  // Affichage seulement : l'API applique la même règle et refuse sinon
  const active = note.status === 'active';
  const { can } = useAccess();
  // Fonctionnalités activables : journal en consultation, suivis masqués ou en consultation
  const canWrite = can('journal', 'full');
  const canAddFollowUp = canWrite && can('followUps', 'full');
  const canModify = active && canWrite && (isSupervisor(user.role)
    || (note.author.id === user.id && openedAt - Date.parse(note.createdAt) < AUTHOR_EDIT_WINDOW_MS));

  return (
    <>
      <Link to="/journal" className="mb-4 inline-block text-sm text-primary hover:underline">{t('journal.note.back')}</Link>

      <Card className={note.isPriority && active ? 'border-l-4 border-l-priority p-5' : 'p-5'}>
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <ResidentLabel note={note} />
          <div className="flex flex-wrap gap-1.5"><NoteBadges note={note} /></div>
        </div>
        <p className="mb-4 text-sm text-muted">
          <time dateTime={note.occurredAt}>{formatFull(note.occurredAt)}</time> · {t('journal.note.writtenBy', { name: fullName(note.author), when: formatWhen(note.createdAt) })}
        </p>

        <p className={`whitespace-pre-line text-lg ${active ? '' : 'line-through'}`}>{note.description}</p>
        {note.intervention && (
          <div className="mt-4 rounded-lg bg-sunken p-3">
            <p className="text-sm font-semibold">{t('journal.note.intervention')}</p>
            <p className="whitespace-pre-line">{note.intervention}</p>
          </div>
        )}

        {!active && (
          <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {t('journal.note.cancelledBy', { name: note.cancelledBy ? fullName(note.cancelledBy) : '—', when: note.cancelledAt ? formatWhen(note.cancelledAt) : '', reason: note.cancelReason })}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {active && !note.readByMe && (
            <Button variant="primary" busy={markRead.isPending} onClick={() => markRead.mutate(note.id)}>
              {note.isPriority ? t('journal.note.readPriority') : t('journal.note.markRead')}
            </Button>
          )}
          {active && canAddFollowUp && <Button onClick={() => setDialog('follow-up')}>{t('journal.note.addFollowUp')}</Button>}
          {canModify && <Button onClick={() => setDialog('edit')}>{t('journal.note.correct')}</Button>}
          {canModify && <Button variant="ghost" className="text-danger" onClick={() => setDialog('cancel')}>{t('journal.note.cancel')}</Button>}
        </div>
        {active && !canModify && canWrite && (
          <p className="mt-3 text-xs text-muted">
            {t('journal.note.whoCanEdit')}
          </p>
        )}
      </Card>

      {can('followUps') && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">{t('journal.note.followUps')}</h2>
          {note.followUps.length === 0
            ? <EmptyState>{t('journal.note.noFollowUps')}</EmptyState>
            : <ul className="flex flex-col gap-3">{note.followUps.map((f) => <FollowUpItem key={f.id} followUp={f} showNote={false} />)}</ul>}
        </section>
      )}

      {note.isPriority && active && (
        <section className="mt-8">
          <h2 className="mb-1 text-lg font-semibold">{t('journal.note.notReadBy')}</h2>
          <p className="mb-3 text-sm text-muted">
            {note.contentEditedAt ? t('journal.note.notReadByHintEdited') : t('journal.note.notReadByHint')}
          </p>
          {note.unreadBy.length === 0 ? <p className="text-sm text-positive">{t('journal.note.everyoneRead')}</p> : (
            <ul className="flex flex-wrap gap-2">
              {note.unreadBy.map((u) => (
                <li key={u.id} className="rounded-full bg-priority-soft px-3 py-1 text-sm text-priority">{fullName(u)}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">{t('journal.note.readBy')}</h2>
        {note.reads.length === 0 ? <p className="text-sm text-muted">{t('journal.note.nobodyRead')}</p> : (
          <ul className="flex flex-wrap gap-2">
            {note.reads.map((r) => {
              // Lecture antérieure à la dernière correction de fond
              const before = note.contentEditedAt !== null && r.readAt < note.contentEditedAt;
              return (
                <li key={r.user.id} className="rounded-full bg-sunken px-3 py-1 text-sm">
                  {fullName(r.user)} <span className="text-muted">· {formatWhen(r.readAt)}{before && t('journal.note.beforeEdit')}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {note.versions.length > 0 && <History note={note} />}

      <Dialog open={dialog === 'edit'} onClose={close} title={t('journal.note.editTitle')}>
        <EditNote note={note} onDone={close} />
      </Dialog>
      <Dialog open={dialog === 'cancel'} onClose={close} title={t('journal.note.cancelTitle')}>
        <CancelNote id={note.id} onDone={close} />
      </Dialog>
      <Dialog open={dialog === 'follow-up'} onClose={close} title={t('journal.note.newFollowUp')}>
        <FollowUpForm noteId={note.id} onDone={close} />
      </Dialog>
    </>
  );
}

function EditNote({ note, onDone }: { note: NoteDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateNote(note.id);
  return (
    <>
      <p className="mb-4 text-sm text-muted">{t('journal.note.versionKept')}</p>
      <NoteForm note={note} submitLabel={t('journal.note.saveCorrection')} onCancel={onDone}
        onSubmit={async (input) => { await update.mutateAsync(input); onDone(); }} />
    </>
  );
}

function CancelNote({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useTranslation();
  const cancel = useCancelNote(id);
  const [reason, setReason] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    await cancel.mutateAsync(reason);
    onDone();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm">{t('journal.note.cancelExplain')}</p>
      <TextArea label={t('journal.note.cancelReason')} required minLength={3} maxLength={500} rows={2}
        value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('journal.note.cancelReasonPlaceholder')} />
      <ErrorMessage error={cancel.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>{t('common.back')}</Button>
        <Button type="submit" variant="danger" busy={cancel.isPending}>{t('journal.note.cancel')}</Button>
      </div>
    </form>
  );
}

function History({ note }: { note: NoteDetail }) {
  const { t } = useTranslation();
  const categories = useCategories();
  const label = (id: string) => categories.data?.find((c) => c.id === id)?.label ?? '—';
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">{t('journal.note.history')}</h2>
      <ol className="flex flex-col gap-3">
        {note.versions.map((v) => (
          <li key={v.editedAt} className="rounded-xl border border-line bg-surface p-4 text-sm">
            <p className="mb-2 text-muted">
              {t('journal.note.replacedBy', { when: formatWhen(v.editedAt), name: fullName(v.editedBy) })}
            </p>
            <p className="whitespace-pre-line">{v.previous.description}</p>
            {v.previous.intervention && <p className="mt-1 text-muted">{t('journal.note.previousIntervention', { text: v.previous.intervention })}</p>}
            <p className="mt-2 text-xs text-muted">
              {t('journal.note.previousEvent', { category: label(v.previous.categoryId), when: formatWhen(v.previous.occurredAt) })}
              {v.previous.isPriority && t('journal.note.previousPriority')}{v.previous.isPositive && t('journal.note.previousPositive')}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
