// Agenda : rendez-vous dans une liste (avec modification / annulation) et formulaire.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useCancelAppointment, useResidents, useSaveAppointment } from '../api/hooks';
import type { Appointment, AppointmentInput, AppointmentKind } from '../api/types';
import { isSupervisor, useUser } from '../auth/session';
import { KIND_LABELS } from '../lib/agenda';
import { cx } from '../lib/cx';
import { formatTime, formatWhen, fromLocalInput, fullName, toLocalInput } from '../lib/format';
import { Badge, Button, Dialog, ErrorMessage, SelectField, TextArea, TextField } from './ui';

const HOUR = 3_600_000;

export function AppointmentItem({ appointment: a, showDate = false }: { appointment: Appointment; showDate?: boolean }) {
  const user = useUser();
  const [dialog, setDialog] = useState<'edit' | 'cancel' | null>(null);
  const cancelled = a.status === 'annule';
  const canModify = !cancelled && (isSupervisor(user.role) || a.createdBy.id === user.id);
  const when = showDate ? formatWhen(a.startsAt) : formatTime(a.startsAt);

  return (
    <li className={cx('rounded-xl border border-line bg-surface p-4', cancelled && 'opacity-70')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <time dateTime={a.startsAt} className="w-24 shrink-0 font-semibold tabular-nums">
            {when}{a.endsAt && <span className="block text-sm font-normal text-muted">→ {formatTime(a.endsAt)}</span>}
          </time>
          <div className="min-w-0">
            <p className={cx('flex flex-wrap items-center gap-2 font-semibold', cancelled && 'line-through')}>
              {a.title}
              <Badge tone="info">{KIND_LABELS[a.kind]}</Badge>
              {cancelled && <Badge tone="danger">Annulé</Badge>}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
              {a.resident ? (
                <Link to={`/residents/${a.resident.id}`} className="font-medium text-ink hover:underline">
                  {fullName(a.resident)}{a.resident.room && ` · ch. ${a.resident.room}`}
                </Link>
              ) : <span>Résidence</span>}
              {a.location && <span>📍 {a.location}</span>}
            </p>
            {a.details && <p className="mt-2 whitespace-pre-line text-sm">{a.details}</p>}
            {cancelled && (
              <p className="mt-2 text-sm text-danger">
                Annulé par {a.cancelledBy ? fullName(a.cancelledBy) : '—'} — {a.cancelReason}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">Ajouté par {fullName(a.createdBy)}</p>
          </div>
        </div>
        {canModify && (
          <div className="flex gap-2 sm:shrink-0">
            <Button className="min-h-9" onClick={() => setDialog('edit')}>Modifier</Button>
            <Button variant="ghost" className="min-h-9 text-danger" onClick={() => setDialog('cancel')}>Annuler</Button>
          </div>
        )}
      </div>

      <Dialog open={dialog === 'edit'} onClose={() => setDialog(null)} title="Modifier le rendez-vous">
        <AppointmentForm appointment={a} onDone={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === 'cancel'} onClose={() => setDialog(null)} title="Annuler le rendez-vous">
        <CancelForm id={a.id} onDone={() => setDialog(null)} />
      </Dialog>
    </li>
  );
}

function CancelForm({ id, onDone }: { id: string; onDone: () => void }) {
  const cancel = useCancelAppointment(id);
  const [reason, setReason] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    await cancel.mutateAsync(reason);
    onDone();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm">Le rendez-vous restera visible, marqué « annulé », avec le motif.</p>
      <TextArea label="Motif" required minLength={3} maxLength={500} rows={2} value={reason}
        onChange={(e) => setReason(e.target.value)} placeholder="Ex. : reporté par la clinique." />
      <ErrorMessage error={cancel.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Retour</Button>
        <Button type="submit" variant="danger" busy={cancel.isPending}>Annuler le rendez-vous</Button>
      </div>
    </form>
  );
}

interface FormProps {
  appointment?: Appointment;     // modification
  defaultResidentId?: string;    // création depuis la fiche d'un résident
  defaultStart?: Date;           // création depuis un jour de l'agenda
  onDone: (saved?: Appointment) => void;   // saved absent : abandon
}

export function AppointmentForm({ appointment: a, defaultResidentId, defaultStart, onDone }: FormProps) {
  const residents = useResidents('actif');
  const save = useSaveAppointment(a?.id);
  const [initialStart] = useState(() => {
    if (a) return new Date(a.startsAt);
    const d = defaultStart ? new Date(defaultStart) : new Date(Date.now() + HOUR);
    if (!defaultStart) d.setMinutes(0, 0, 0);   // prochaine heure ronde
    return d;
  });
  const [v, setV] = useState({
    kind: a?.kind ?? ('medical' as AppointmentKind),
    title: a?.title ?? '',
    residentId: a ? a.resident?.id ?? '' : defaultResidentId ?? '',
    location: a?.location ?? '',
    startsAt: toLocalInput(initialStart),
    endsAt: a?.endsAt ? toLocalInput(new Date(a.endsAt)) : '',
    details: a?.details ?? '',
  });
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });

  // Résident parti (rendez-vous existant) : reste sélectionnable
  const options = [...(residents.data ?? [])];
  if (a?.resident && !options.some((r) => r.id === a.resident!.id)) {
    options.push({ ...a.resident, status: 'parti', specialInstructions: null });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: AppointmentInput = {
      kind: v.kind,
      title: v.title,
      residentId: v.residentId || null,
      location: v.location.trim() || null,
      startsAt: fromLocalInput(v.startsAt),
      endsAt: v.endsAt ? fromLocalInput(v.endsAt) : null,
      details: v.details.trim() || null,
    };
    onDone(await save.mutateAsync(input));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Type" value={v.kind} onChange={set('kind')}>
          {Object.entries(KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </SelectField>
        <SelectField label="Pour" value={v.residentId} onChange={set('residentId')}>
          <option value="">La résidence (activité, réunion…)</option>
          {options.map((r) => <option key={r.id} value={r.id}>{fullName(r)}{r.room ? ` — ch. ${r.room}` : ''}</option>)}
        </SelectField>
      </div>
      <TextField label="Titre" required maxLength={200} value={v.title} onChange={set('title')}
        placeholder="Ex. : dentiste, prise de sang, bingo, réunion d'équipe" />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Début" type="datetime-local" required value={v.startsAt} onChange={set('startsAt')} />
        <TextField label="Fin (facultatif)" type="datetime-local" min={v.startsAt} value={v.endsAt} onChange={set('endsAt')} />
      </div>
      <TextField label="Lieu (facultatif)" maxLength={200} value={v.location} onChange={set('location')}
        placeholder="Ex. : Clinique du Parc, salle commune" />
      <TextArea label="Détails (facultatif)" rows={2} maxLength={2000} value={v.details} onChange={set('details')}
        placeholder="Préparation, transport, accompagnement, à jeun…" />
      <ErrorMessage error={save.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone()}>Annuler</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>{a ? 'Enregistrer' : 'Ajouter le rendez-vous'}</Button>
      </div>
    </form>
  );
}
