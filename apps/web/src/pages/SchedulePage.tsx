// Horaires du personnel : grille de la semaine (équipe) ou « Mon horaire ».
// La responsable place, ajuste et retire les quarts, et copie la semaine précédente.
// Semaine et vue dans l'adresse (?semaine=AAAA-MM-JJ&vue=equipe|moi).
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useCancelShift, useCopyWeek, useSaveShift, useShifts, useShiftTypes, useStaff } from '../api/hooks';
import type { Shift, StaffMember } from '../api/types';
import { ROLE_LABELS, useUser } from '../auth/session';
import { Badge, Button, Chip, Dialog, EmptyState, ErrorMessage, Loading, PageHeader, SelectField, TextField } from '../components/ui';
import { cx } from '../lib/cx';
import {
  addDays, formatDayHeading, formatRange, fromDateParam, fullName, sameDay, startOfWeek, toDateParam,
} from '../lib/format';
import { formatDuration, formatShiftTimes, shiftMinutes } from '../lib/schedule';

const dayShort = new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric' });

type Editing = { shift?: Shift; userId: string; workDate: string };

export function SchedulePage() {
  const user = useUser();
  const responsable = user.role === 'responsable';
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => new Date());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const copyWeek = useCopyWeek();

  const weekStart = startOfWeek(fromDateParam(params.get('semaine')) ?? today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const from = toDateParam(weekStart);
  const to = toDateParam(days[6]!);
  const view = params.get('vue') ?? (responsable ? 'equipe' : 'moi');
  const shifts = useShifts(from, to, view === 'moi' ? user.id : undefined);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const goToWeek = (d: Date) => {
    setNotice(null);
    setParam('semaine', sameDay(startOfWeek(d), startOfWeek(today)) ? null : toDateParam(startOfWeek(d)));
  };

  async function copyPreviousWeek() {
    if (!window.confirm('Copier les quarts de la semaine précédente dans cette semaine ? Les quarts déjà placés sont gardés.')) return;
    const result = await copyWeek.mutateAsync({ fromWeek: toDateParam(addDays(weekStart, -7)), toWeek: from });
    setNotice(result.created === 0 && result.skipped === 0
      ? 'La semaine précédente est vide : rien à copier.'
      : `${result.created} quart${result.created > 1 ? 's' : ''} copié${result.created > 1 ? 's' : ''}`
        + (result.skipped ? `, ${result.skipped} déjà présent${result.skipped > 1 ? 's' : ''}.` : '.'));
  }

  return (
    <>
      <PageHeader
        title="Horaires"
        subtitle={responsable ? 'Placez les quarts de l’équipe. Cliquez sur une case pour ajouter, sur un quart pour le modifier.' : undefined}
        actions={responsable && view === 'equipe' && (
          <Button busy={copyWeek.isPending} onClick={() => void copyPreviousWeek()}>Copier la semaine précédente</Button>
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button aria-label="Semaine précédente" onClick={() => goToWeek(addDays(weekStart, -7))}>←</Button>
        <Button aria-label="Semaine suivante" onClick={() => goToWeek(addDays(weekStart, 7))}>→</Button>
        <Button variant="ghost" onClick={() => goToWeek(today)}>Cette semaine</Button>
        <h2 className="ml-1 text-lg font-semibold">{formatRange(weekStart, days[6]!)}</h2>
        <div className="ml-auto flex gap-2" role="group" aria-label="Vue">
          <Chip active={view === 'moi'} onClick={() => setParam('vue', 'moi')}>Mon horaire</Chip>
          <Chip active={view === 'equipe'} onClick={() => setParam('vue', 'equipe')}>Équipe</Chip>
        </div>
      </div>

      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}
      <ErrorMessage error={copyWeek.error} />

      {shifts.isPending ? <Loading /> : shifts.isError ? <ErrorMessage error={shifts.error} /> : view === 'moi'
        ? <MySchedule days={days} shifts={shifts.data} today={today} />
        : <TeamGrid days={days} shifts={shifts.data} today={today} editable={responsable}
            onEdit={(e) => setEditing(e)} />}

      <Dialog open={editing !== null} onClose={() => setEditing(null)}
        title={editing?.shift ? 'Modifier le quart' : 'Ajouter un quart'}>
        {editing && <ShiftForm editing={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------
// Mon horaire : liste des jours, total de la semaine
// ---------------------------------------------------------------------
function MySchedule({ days, shifts, today }: { days: Date[]; shifts: Shift[]; today: Date }) {
  const total = shifts.reduce((sum, s) => sum + shiftMinutes(s.startTime, s.endTime), 0);
  return (
    <>
      <p className="mb-4 text-sm text-muted">
        {shifts.length} quart{shifts.length > 1 ? 's' : ''} cette semaine · {formatDuration(total)}
      </p>
      <ul className="flex flex-col gap-2">
        {days.map((day) => {
          const mine = shifts.filter((s) => s.workDate === toDateParam(day));
          const isToday = sameDay(day, today);
          return (
            <li key={day.toISOString()}
              className={cx('flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-surface px-4 py-3',
                isToday ? 'border-primary' : 'border-line')}>
              <span className={cx('font-medium first-letter:uppercase', isToday && 'text-primary')}>
                {formatDayHeading(day)}{isToday && ' — aujourd’hui'}
              </span>
              {mine.length === 0 ? <span className="text-sm text-muted">Congé</span> : (
                <span className="flex flex-wrap gap-2">
                  {mine.map((s) => (
                    <span key={s.id} className="text-right">
                      <Badge tone="info">{s.shiftType.label}</Badge>{' '}
                      <span className="font-semibold tabular-nums">{formatShiftTimes(s.startTime, s.endTime)}</span>
                      {s.overnight && <span className="text-xs text-muted"> (lendemain)</span>}
                      {s.notes && <span className="block text-xs text-muted">{s.notes}</span>}
                    </span>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------
// Équipe : une ligne par employé, une colonne par jour, couverture en bas
// ---------------------------------------------------------------------
function TeamGrid({ days, shifts, today, editable, onEdit }: {
  days: Date[]; shifts: Shift[]; today: Date; editable: boolean; onEdit: (e: Editing) => void;
}) {
  const staff = useStaff();
  const types = useShiftTypes();
  if (staff.isPending || types.isPending) return <Loading />;

  // Employés actifs, plus ceux encore à l'horaire (ex. désactivés depuis)
  const people: StaffMember[] = [...(staff.data ?? [])];
  for (const s of shifts) {
    if (!people.some((p) => p.id === s.user.id)) people.push(s.user);
  }
  if (people.length === 0) return <EmptyState>Aucun employé.</EmptyState>;

  const cell = (userId: string, day: Date) => shifts.filter((s) => s.user.id === userId && s.workDate === toDateParam(day));
  const weekMinutes = (userId: string) => shifts.filter((s) => s.user.id === userId)
    .reduce((sum, s) => sum + shiftMinutes(s.startTime, s.endTime), 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="sticky left-0 bg-surface px-3 py-2 text-left font-semibold">Employé</th>
            {days.map((day) => (
              <th key={day.toISOString()} scope="col"
                className={cx('px-2 py-2 text-center font-semibold first-letter:uppercase', sameDay(day, today) && 'text-primary')}>
                {dayShort.format(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.id} className="border-b border-line align-top">
              <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left font-normal">
                <span className="block font-medium">{fullName(person)}</span>
                <span className="text-xs text-muted">{ROLE_LABELS[person.role]} · {formatDuration(weekMinutes(person.id))}</span>
              </th>
              {days.map((day) => {
                const items = cell(person.id, day);
                return (
                  <td key={day.toISOString()} className={cx('px-1 py-1', sameDay(day, today) && 'bg-info-soft/40')}>
                    <div className="flex min-h-12 flex-col gap-1">
                      {items.map((s) => (
                        <button key={s.id} type="button" disabled={!editable}
                          onClick={() => onEdit({ shift: s, userId: person.id, workDate: s.workDate })}
                          title={s.notes ?? undefined}
                          className={cx('rounded-md px-2 py-1 text-left text-xs',
                            s.adjusted ? 'bg-priority-soft text-priority' : 'bg-info-soft text-primary',
                            editable && 'hover:ring-2 hover:ring-primary')}>
                          <span className="block font-semibold">{s.shiftType.label}{s.notes && ' •'}</span>
                          <span className="tabular-nums">{formatShiftTimes(s.startTime, s.endTime)}</span>
                        </button>
                      ))}
                      {editable && (
                        <button type="button" aria-label={`Ajouter un quart à ${fullName(person)}, ${formatDayHeading(day)}`}
                          onClick={() => onEdit({ userId: person.id, workDate: toDateParam(day) })}
                          className="rounded-md border border-dashed border-line py-1 text-xs text-muted hover:border-primary hover:text-primary">
                          +
                        </button>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left text-xs font-semibold text-muted">Couverture</th>
            {days.map((day) => (
              <td key={day.toISOString()} className="px-2 py-2 text-xs text-muted">
                {types.data?.map((t) => {
                  const n = shifts.filter((s) => s.workDate === toDateParam(day) && s.shiftType.id === t.id).length;
                  return <span key={t.id} className={cx('block', n === 0 && 'font-semibold text-danger')}>{t.label} : {n}</span>;
                })}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      <p className="px-3 py-2 text-xs text-muted">
        <span className="mr-3 inline-block rounded bg-info-soft px-1.5 text-primary">Quart</span>
        <span className="mr-3 inline-block rounded bg-priority-soft px-1.5 text-priority">Heures ajustées</span>
        • = note sur le quart
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Ajouter / modifier / retirer un quart (responsable)
// ---------------------------------------------------------------------
function ShiftForm({ editing, onDone }: { editing: Editing; onDone: () => void }) {
  const staff = useStaff();
  const types = useShiftTypes();
  const save = useSaveShift(editing.shift?.id);
  const cancel = useCancelShift();
  const s = editing.shift;
  const [typeId, setTypeId] = useState(s?.shiftType.id ?? '');
  const [start, setStart] = useState(s?.startTime ?? '');
  const [end, setEnd] = useState(s?.endTime ?? '');
  const [notes, setNotes] = useState(s?.notes ?? '');

  const person = staff.data?.find((p) => p.id === editing.userId) ?? s?.user;
  const day = fromDateParam(editing.workDate)!;

  // Choisir un quart type remplit ses heures (modifiables ensuite)
  function chooseType(id: string) {
    setTypeId(id);
    const type = types.data?.find((t) => t.id === id);
    if (type) { setStart(type.startTime); setEnd(type.endTime); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await save.mutateAsync(s
      ? { shiftTypeId: typeId, startTime: start, endTime: end, notes: notes.trim() || null }
      : { userId: editing.userId, workDate: editing.workDate, shiftTypeId: typeId, startTime: start, endTime: end, notes: notes.trim() || null });
    onDone();
  }

  async function remove() {
    if (!s || !window.confirm('Retirer ce quart de l’horaire ?')) return;
    await cancel.mutateAsync(s.id);
    onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm">
        <strong>{person ? fullName(person) : ''}</strong> — <span className="first-letter:uppercase">{formatDayHeading(day)}</span>
      </p>
      <SelectField label="Quart" required value={typeId} onChange={(e) => chooseType(e.target.value)}>
        <option value="" disabled>Choisir…</option>
        {types.data?.map((t) => <option key={t.id} value={t.id}>{t.label} ({formatShiftTimes(t.startTime, t.endTime)})</option>)}
      </SelectField>
      <div className="grid grid-cols-2 gap-4">
        <TextField label="Début" type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
        <TextField label="Fin" type="time" required value={end} onChange={(e) => setEnd(e.target.value)}
          hint={start && end && end <= start ? 'Finit le lendemain.' : undefined} />
      </div>
      <TextField label="Note (facultatif)" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="Ex. : formation de 9 h à 11 h, remplacement" />
      <ErrorMessage error={save.error ?? cancel.error} />
      <div className="flex flex-wrap justify-between gap-2">
        {s ? <Button variant="ghost" className="text-danger" busy={cancel.isPending} onClick={() => void remove()}>Retirer de l’horaire</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onDone}>Annuler</Button>
          <Button type="submit" variant="primary" busy={save.isPending}>{s ? 'Enregistrer' : 'Ajouter'}</Button>
        </div>
      </div>
    </form>
  );
}
