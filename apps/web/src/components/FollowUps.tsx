// Suivis : élément de liste (avec fermeture) et formulaire d'ajout.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useCloseFollowUp, useCreateFollowUp, useStaff } from '../api/hooks';
import type { FollowUp } from '../api/types';
import { formatWhen, fromLocalInput, fullName } from '../lib/format';
import { cx } from '../lib/cx';
import { Badge, Button, Dialog, ErrorMessage, SelectField, TextArea, TextField } from './ui';

export function FollowUpItem({ followUp, showNote = true }: { followUp: FollowUp; showNote?: boolean }) {
  const [closing, setClosing] = useState(false);
  const closed = followUp.closedAt !== null;
  return (
    <li className={cx('rounded-xl border bg-surface p-4', followUp.isOverdue ? 'border-danger/60 border-l-4' : 'border-line')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          <p className={cx('font-medium', closed && 'text-muted line-through')}>{followUp.description}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
            {followUp.resident && (
              <Link to={`/residents/${followUp.resident.id}`} className="font-medium text-ink hover:underline">
                {fullName(followUp.resident)}{followUp.resident.room && ` · ch. ${followUp.resident.room}`}
              </Link>
            )}
            <span>{followUp.assignedTo ? `Pour ${fullName(followUp.assignedTo)}` : "Pour toute l'équipe"}</span>
            {followUp.dueAt && <span>Échéance {formatWhen(followUp.dueAt)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {followUp.isOverdue && <Badge tone="danger">En retard</Badge>}
          {closed ? <Badge tone="positive">Fait</Badge> : (
            <Button variant="primary" className="min-h-9" onClick={() => setClosing(true)}>Marquer fait</Button>
          )}
        </div>
      </div>

      {showNote && (
        <Link to={`/notes/${followUp.note.id}`} className="mt-2 block rounded-md bg-sunken px-3 py-2 text-sm text-muted hover:underline">
          Note du {formatWhen(followUp.note.occurredAt)} : {followUp.note.excerpt}
        </Link>
      )}
      {closed && (
        <p className="mt-2 text-sm text-muted">
          Fait par {followUp.closedBy ? fullName(followUp.closedBy) : '—'} {formatWhen(followUp.closedAt!)}
          {followUp.closingNote && <> — « {followUp.closingNote} »</>}
        </p>
      )}

      <CloseDialog followUp={followUp} open={closing} onClose={() => setClosing(false)} />
    </li>
  );
}

function CloseDialog({ followUp, open, onClose }: { followUp: FollowUp; open: boolean; onClose: () => void }) {
  const close = useCloseFollowUp();
  const [note, setNote] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    await close.mutateAsync({ id: followUp.id, closingNote: note.trim() || null });
    setNote('');
    onClose();
  }
  return (
    <Dialog open={open} onClose={onClose} title="Marquer le suivi comme fait">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm">{followUp.description}</p>
        <TextArea label="Note de clôture (facultatif)" rows={2} maxLength={1000} value={note}
          onChange={(e) => setNote(e.target.value)} placeholder="Ex. : marche normale, rien à signaler." />
        <ErrorMessage error={close.error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" busy={close.isPending}>Confirmer</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function FollowUpForm({ noteId, onDone }: { noteId: string; onDone: () => void }) {
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
      <TextField label="Action à faire" required maxLength={1000} value={description}
        onChange={(e) => setDescription(e.target.value)} placeholder="Ex. : surveiller la mobilité pendant 48 h" />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Pour" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
          <option value="">Toute l'équipe</option>
          {staff.data?.map((s) => <option key={s.id} value={s.id}>{fullName(s)}</option>)}
        </SelectField>
        <TextField label="Échéance (facultatif)" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      </div>
      <ErrorMessage error={create.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Annuler</Button>
        <Button type="submit" variant="primary" busy={create.isPending}>Ajouter le suivi</Button>
      </div>
    </form>
  );
}
