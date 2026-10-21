// Suivis : élément de liste (avec fermeture) et formulaire d'ajout.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCloseFollowUp, useCreateFollowUp, useStaff, useTakeFollowUp } from '../api/hooks';
import { useUser } from '../auth/session';
import type { FollowUp } from '../api/types';
import { formatWhen, fromLocalInput, fullName } from '../lib/format';
import { cx } from '../lib/cx';
import { Badge, Button, Dialog, ErrorMessage, SelectField, TextArea, TextField } from './ui';

export function FollowUpItem({ followUp, showNote = true }: { followUp: FollowUp; showNote?: boolean }) {
  const { t } = useTranslation();
  const me = useUser();
  const take = useTakeFollowUp();
  const [closing, setClosing] = useState(false);
  const closed = followUp.closedAt !== null;
  const mine = followUp.assignedTo?.id === me.id;
  return (
    <li className={cx('rounded-xl border bg-surface p-4', followUp.isOverdue ? 'border-danger/60 border-l-4' : 'border-line')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          <p className={cx('font-medium', closed && 'text-muted line-through')}>{followUp.description}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
            {followUp.resident && (
              <Link to={`/residents/${followUp.resident.id}`} className="font-medium text-ink hover:underline">
                {fullName(followUp.resident)}{followUp.resident.room && ` · ${t('journal.note.room', { room: followUp.resident.room })}`}
              </Link>
            )}
            <span className={cx(mine && !closed && 'font-medium text-primary')}>
              {mine ? t('journal.followUp.forMe') : followUp.assignedTo ? t('journal.followUp.forPerson', { name: fullName(followUp.assignedTo) }) : t('journal.followUp.forTeam')}
            </span>
            {followUp.dueAt && <span>{t('journal.followUp.due', { when: formatWhen(followUp.dueAt) })}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          {followUp.isOverdue && <Badge tone="danger">{t('journal.followUp.overdue')}</Badge>}
          {closed ? <Badge tone="positive">{t('journal.followUp.done')}</Badge> : (
            <>
              {!mine && (
                <Button data-tour="followup-take" className="min-h-9 whitespace-nowrap" busy={take.isPending}
                  onClick={() => take.mutate({ id: followUp.id, userId: me.id })}>
                  {t('journal.followUp.take')}
                </Button>
              )}
              <Button variant="primary" className="min-h-9 whitespace-nowrap" onClick={() => setClosing(true)}>{t('journal.followUp.markDone')}</Button>
            </>
          )}
        </div>
      </div>

      {showNote && (
        <Link to={`/notes/${followUp.note.id}`} className="mt-2 block rounded-md bg-sunken px-3 py-2 text-sm text-muted hover:underline">
          {t('journal.followUp.noteOf', { when: formatWhen(followUp.note.occurredAt), excerpt: followUp.note.excerpt })}
        </Link>
      )}
      {closed && (
        <p className="mt-2 text-sm text-muted">
          {t('journal.followUp.doneBy', { name: followUp.closedBy ? fullName(followUp.closedBy) : '—', when: formatWhen(followUp.closedAt!) })}
          {followUp.closingNote && <> — « {followUp.closingNote} »</>}
        </p>
      )}

      <ErrorMessage error={take.error} />
      <CloseDialog followUp={followUp} open={closing} onClose={() => setClosing(false)} />
    </li>
  );
}

function CloseDialog({ followUp, open, onClose }: { followUp: FollowUp; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const close = useCloseFollowUp();
  const [note, setNote] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    await close.mutateAsync({ id: followUp.id, closingNote: note.trim() || null });
    setNote('');
    onClose();
  }
  return (
    <Dialog open={open} onClose={onClose} title={t('journal.followUp.closeTitle')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm">{followUp.description}</p>
        <TextArea label={t('journal.followUp.closingNote')} rows={2} maxLength={1000} value={note}
          onChange={(e) => setNote(e.target.value)} placeholder={t('journal.followUp.closingNotePlaceholder')} />
        <ErrorMessage error={close.error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" busy={close.isPending}>{t('common.confirm')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function FollowUpForm({ noteId, onDone }: { noteId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const staff = useStaff();
  const create = useCreateFollowUp(noteId);
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueAt, setDueAt] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      description,
      assignedTo: assignedTo || null,
      dueAt: dueAt ? fromLocalInput(dueAt) : null,
    });
    onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField label={t('journal.followUp.action')} required maxLength={1000} value={description}
        onChange={(e) => setDescription(e.target.value)} placeholder={t('journal.followUp.actionPlaceholder')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t('journal.followUp.for')} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
          <option value="">{t('journal.followUp.wholeTeam')}</option>
          {staff.data?.map((s) => <option key={s.id} value={s.id}>{fullName(s)}</option>)}
        </SelectField>
        <TextField label={t('journal.followUp.dueOptional')} type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      </div>
      <ErrorMessage error={create.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" busy={create.isPending}>{t('journal.followUp.add')}</Button>
      </div>
    </form>
  );
}
