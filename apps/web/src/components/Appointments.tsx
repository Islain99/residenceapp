// Agenda : rendez-vous dans une liste (avec modification / annulation) et formulaire.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCancelAppointment, useResidents, useSaveAppointment } from '../api/hooks';
import type { Appointment, AppointmentInput, AppointmentKind } from '../api/types';
import { isSupervisor, useUser } from '../auth/session';
import { APPOINTMENT_KINDS } from '../lib/agenda';
import { cx } from '../lib/cx';
import { formatTime, formatWhen, fromLocalInput, fullName, toLocalInput } from '../lib/format';
import { Badge, Button, Dialog, ErrorMessage, SelectField, TextArea, TextField } from './ui';

const HOUR = 3_600_000;

export function AppointmentItem({ appointment: a, showDate = false }: { appointment: Appointment; showDate?: boolean }) {
  const { t } = useTranslation();
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
              <Badge tone="info">{t(`agenda.kinds.${a.kind}`)}</Badge>
              {cancelled && <Badge tone="danger">{t('agenda.item.cancelled')}</Badge>}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
              {a.resident ? (
                <Link to={`/residents/${a.resident.id}`} className="font-medium text-ink hover:underline">
                  {fullName(a.resident)}{a.resident.room && ` · ${t('agenda.item.room', { room: a.resident.room })}`}
                </Link>
              ) : <span>{t('agenda.item.residence')}</span>}
              {a.location && <span>📍 {a.location}</span>}
            </p>
            {a.details && <p className="mt-2 whitespace-pre-line text-sm">{a.details}</p>}
            {cancelled && (
              <p className="mt-2 text-sm text-danger">
                {t('agenda.item.cancelledBy', { name: a.cancelledBy ? fullName(a.cancelledBy) : '—', reason: a.cancelReason })}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">{t('agenda.item.addedBy', { name: fullName(a.createdBy) })}</p>
          </div>
        </div>
        {canModify && (
          <div className="flex gap-2 sm:shrink-0">
            <Button className="min-h-9" onClick={() => setDialog('edit')}>{t('agenda.item.edit')}</Button>
            <Button variant="ghost" className="min-h-9 text-danger" onClick={() => setDialog('cancel')}>{t('agenda.item.cancel')}</Button>
          </div>
        )}
      </div>

      <Dialog open={dialog === 'edit'} onClose={() => setDialog(null)} title={t('agenda.item.editTitle')}>
        <AppointmentForm appointment={a} onDone={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === 'cancel'} onClose={() => setDialog(null)} title={t('agenda.item.cancelTitle')}>
        <CancelForm id={a.id} onDone={() => setDialog(null)} />
      </Dialog>
    </li>
  );
}

function CancelForm({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useTranslation();
  const cancel = useCancelAppointment(id);
  const [reason, setReason] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    await cancel.mutateAsync(reason);
    onDone();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm">{t('agenda.cancelForm.explain')}</p>
      <TextArea label={t('common.reason')} required minLength={3} maxLength={500} rows={2} value={reason}
        onChange={(e) => setReason(e.target.value)} placeholder={t('agenda.cancelForm.placeholder')} />
      <ErrorMessage error={cancel.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>{t('common.back')}</Button>
        <Button type="submit" variant="danger" busy={cancel.isPending}>{t('agenda.cancelForm.submit')}</Button>
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
  const { t } = useTranslation();
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
        <SelectField label={t('agenda.type')} value={v.kind} onChange={set('kind')}>
          {APPOINTMENT_KINDS.map((k) => <option key={k} value={k}>{t(`agenda.kinds.${k}`)}</option>)}
        </SelectField>
        <SelectField label={t('agenda.form.for')} value={v.residentId} onChange={set('residentId')}>
          <option value="">{t('agenda.form.residence')}</option>
          {options.map((r) => <option key={r.id} value={r.id}>{fullName(r)}{r.room ? ` — ${t('agenda.item.room', { room: r.room })}` : ''}</option>)}
        </SelectField>
      </div>
      <TextField label={t('agenda.form.title')} required maxLength={200} value={v.title} onChange={set('title')}
        placeholder={t('agenda.form.titlePlaceholder')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('agenda.form.start')} type="datetime-local" required value={v.startsAt} onChange={set('startsAt')} />
        <TextField label={t('agenda.form.end')} type="datetime-local" min={v.startsAt} value={v.endsAt} onChange={set('endsAt')} />
      </div>
      <TextField label={t('agenda.form.location')} maxLength={200} value={v.location} onChange={set('location')}
        placeholder={t('agenda.form.locationPlaceholder')} />
      <TextArea label={t('agenda.form.details')} rows={2} maxLength={2000} value={v.details} onChange={set('details')}
        placeholder={t('agenda.form.detailsPlaceholder')} />
      <ErrorMessage error={save.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone()}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>{a ? t('common.save') : t('agenda.form.submitNew')}</Button>
      </div>
    </form>
  );
}
