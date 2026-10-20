// Horaires du personnel : grille de la semaine (équipe) ou « Mon horaire ».
// La responsable place, ajuste et retire les quarts, et copie la semaine précédente.
// Semaine et vue dans l'adresse (?semaine=AAAA-MM-JJ&vue=equipe|moi).
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCancelShift, useCopyWeek, useSaveShift, useShifts, useShiftTypes, useStaff } from '../api/hooks';
import type { Shift, StaffMember } from '../api/types';
import { useUser } from '../auth/session';
import { Badge, Button, Chip, Dialog, EmptyState, ErrorMessage, Loading, PageHeader, SelectField, TextField } from '../components/ui';
import { cx } from '../lib/cx';
import {
  addDays, formatDayHeading, formatRange, formatWith, fromDateParam, fullName, sameDay, startOfWeek, toDateParam,
} from '../lib/format';
import { compactShiftTimes, formatDuration, formatShiftTimes, shiftMinutes } from '../lib/schedule';

const dayShort = (d: Date) => formatWith(d, { weekday: 'short', day: 'numeric' });
const monthTitle = (d: Date) => formatWith(d, { month: 'long', year: 'numeric' });
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

type Editing = { shift?: Shift; userId: string; workDate: string };

export function SchedulePage() {
  const { t } = useTranslation();
  const user = useUser();
  const responsable = user.role === 'responsable';
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => new Date());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const copyWeek = useCopyWeek();

  // Période affichée : une semaine (?semaine=AAAA-MM-JJ) ou un mois (?periode=mois&mois=AAAA-MM)
  const monthly = params.get('periode') === 'mois';
  const weekStart = startOfWeek(fromDateParam(params.get('semaine')) ?? today);
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(params.get('mois') ?? '');
  const monthStart = monthMatch
    ? new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1)
    : new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  // Mois : semaines complètes du lundi au dimanche (35 ou 42 jours, sous la limite de l'API)
  const firstDay = monthly ? startOfWeek(monthStart) : weekStart;
  const lastDay = monthly ? addDays(startOfWeek(monthEnd), 6) : addDays(weekStart, 6);
  const days = Array.from({ length: Math.round((lastDay.getTime() - firstDay.getTime()) / 86_400_000) + 1 },
    (_, i) => addDays(firstDay, i));
  const from = toDateParam(firstDay);
  const to = toDateParam(lastDay);
  const view = params.get('vue') ?? (responsable ? 'equipe' : 'moi');
  const shifts = useShifts(from, to, view === 'moi' ? user.id : undefined);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    setParams(next, { replace: true });
  };
  const setParam = (key: string, value: string | null) => update({ [key]: value });
  const goToWeek = (d: Date) => {
    setNotice(null);
    setParam('semaine', sameDay(startOfWeek(d), startOfWeek(today)) ? null : toDateParam(startOfWeek(d)));
  };
  const goToMonth = (d: Date) => {
    const current = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
    setParam('mois', current ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const move = (direction: -1 | 1) => monthly
    ? goToMonth(new Date(monthStart.getFullYear(), monthStart.getMonth() + direction, 1))
    : goToWeek(addDays(weekStart, 7 * direction));
  // Calendrier de l'équipe : un jour ouvre sa semaine, où se font les modifications
  const openWeek = (day: Date) => update({ periode: null, mois: null, semaine: toDateParam(startOfWeek(day)) });

  async function copyPreviousWeek() {
    if (!window.confirm(t('schedule.copyConfirm'))) return;
    const result = await copyWeek.mutateAsync({ fromWeek: toDateParam(addDays(weekStart, -7)), toWeek: from });
    setNotice(result.created === 0 && result.skipped === 0
      ? t('schedule.copyEmpty')
      : t('schedule.copied', { count: result.created })
        + (result.skipped ? t('schedule.alreadyThere', { count: result.skipped }) : '.'));
  }

  return (
    <>
      <PageHeader
        title={t('schedule.title')}
        subtitle={responsable && !monthly ? t('schedule.subtitleEdit') : undefined}
        actions={responsable && view === 'equipe' && !monthly && (
          <Button busy={copyWeek.isPending} onClick={() => void copyPreviousWeek()}>{t('schedule.copyWeek')}</Button>
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button aria-label={monthly ? t('schedule.previousMonth') : t('schedule.previousWeek')} onClick={() => move(-1)}>←</Button>
        <Button aria-label={monthly ? t('schedule.nextMonth') : t('schedule.nextWeek')} onClick={() => move(1)}>→</Button>
        <Button variant="ghost" onClick={() => (monthly ? goToMonth(today) : goToWeek(today))}>
          {monthly ? t('schedule.thisMonth') : t('schedule.thisWeek')}
        </Button>
        <h2 className="ml-1 text-lg font-semibold first-letter:uppercase">
          {monthly ? monthTitle(monthStart) : formatRange(weekStart, addDays(weekStart, 6))}
        </h2>
        <div className="ml-auto flex flex-wrap gap-2">
          <div className="flex gap-2" role="group" aria-label={t('schedule.period')}>
            <Chip active={!monthly} onClick={() => setParam('periode', null)}>{t('schedule.week')}</Chip>
            <Chip active={monthly} onClick={() => setParam('periode', 'mois')}>{t('schedule.month')}</Chip>
          </div>
          <div className="flex gap-2" role="group" aria-label={t('schedule.view')}>
            <Chip active={view === 'moi'} onClick={() => setParam('vue', 'moi')}>{t('schedule.mine')}</Chip>
            <Chip active={view === 'equipe'} onClick={() => setParam('vue', 'equipe')}>{t('schedule.team')}</Chip>
          </div>
        </div>
      </div>

      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}
      <ErrorMessage error={copyWeek.error} />

      {shifts.isPending ? <Loading /> : shifts.isError ? <ErrorMessage error={shifts.error} /> : monthly
        ? <MonthCalendar days={days} monthStart={monthStart} shifts={shifts.data} today={today} mine={view === 'moi'}
            onOpenWeek={view === 'equipe' ? openWeek : undefined} />
        : view === 'moi'
          ? <MySchedule days={days} shifts={shifts.data} today={today} />
          : <TeamGrid days={days} shifts={shifts.data} today={today} editable={responsable}
              onEdit={(e) => setEditing(e)} />}

      <Dialog open={editing !== null} onClose={() => setEditing(null)}
        title={editing?.shift ? t('schedule.editShift') : t('schedule.addShift')}>
        {editing && <ShiftForm editing={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------
// Calendrier du mois : mon horaire (quart et heures, ou congé) ou l'équipe
// (qui travaille sur chaque quart). Semaines complètes du lundi au dimanche ;
// les jours des mois voisins sont grisés et ne comptent pas dans le total.
// ---------------------------------------------------------------------
function MonthCalendar({ days, monthStart, shifts, today, mine, onOpenWeek }: {
  days: Date[]; monthStart: Date; shifts: Shift[]; today: Date; mine: boolean; onOpenWeek?: (day: Date) => void;
}) {
  const { t } = useTranslation();
  const types = useShiftTypes();
  const inMonth = (d: Date) => d.getMonth() === monthStart.getMonth();
  const monthShifts = shifts.filter((s) => inMonth(fromDateParam(s.workDate)!));
  const total = monthShifts.reduce((sum, s) => sum + shiftMinutes(s.startTime, s.endTime), 0);
  const order = (s: Shift) => types.data?.findIndex((type) => type.id === s.shiftType.id) ?? 0;
  // « Congé » seulement dans une semaine où j'ai au moins un quart : une semaine
  // vide n'est probablement pas encore planifiée, ce n'est pas un congé.
  const plannedWeeks = new Set(shifts.map((s) => toDateParam(startOfWeek(fromDateParam(s.workDate)!))));
  const planned = (d: Date) => plannedWeeks.has(toDateParam(startOfWeek(d)));

  return (
    <>
      {mine && (
        <p className="mb-4 text-sm text-muted">
          {t('schedule.monthTotal', { count: monthShifts.length, duration: formatDuration(total) })}
        </p>
      )}
      {!mine && onOpenWeek && <p className="mb-4 text-sm text-muted">{t('schedule.clickDay')}</p>}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line text-center text-xs font-semibold text-muted" aria-hidden>
          {WEEKDAYS.map((d) => <span key={d} className="py-2">{t(`schedule.weekdays.${d}`)}</span>)}
        </div>
        <ol className="grid grid-cols-7">
          {days.map((day) => {
            const items = shifts.filter((s) => s.workDate === toDateParam(day)).sort((a, b) => order(a) - order(b));
            const isToday = sameDay(day, today);
            const outside = !inMonth(day);
            const label = formatDayHeading(day);
            const content = mine ? (
              items.length === 0
                ? !outside && planned(day) && <span className="text-[10px] text-muted sm:text-xs">{t('schedule.dayOff')}</span>
                : items.map((s) => (
                  <span key={s.id} className={cx('block rounded px-1 py-0.5 text-[10px] leading-tight sm:text-xs',
                    s.adjusted ? 'bg-priority-soft text-priority' : 'bg-info-soft text-primary')}>
                    <span className="block font-semibold">{s.shiftType.label}</span>
                    <span className="tabular-nums">{compactShiftTimes(s.startTime, s.endTime)}</span>
                  </span>
                ))
            ) : (
              types.data?.map((type) => {
                const people = items.filter((s) => s.shiftType.id === type.id);
                if (people.length === 0) return null;
                return (
                  <span key={type.id} className="block text-[10px] leading-tight sm:text-xs">
                    <span className="font-semibold">{type.label}</span>
                    <span className="sm:hidden"> {people.length}</span>
                    <span className="hidden text-muted sm:inline"> {people.map((s) => s.user.firstName).join(', ')}</span>
                  </span>
                );
              })
            );
            const cell = (
              <>
                <span className={cx('mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                  isToday && 'bg-primary text-on-primary')}>
                  {day.getDate()}
                </span>
                <span className="flex flex-col gap-0.5">{content}</span>
              </>
            );
            const classes = cx('flex min-h-20 flex-col border-b border-r border-line p-1 text-left sm:min-h-24 sm:p-1.5',
              outside && 'bg-sunken/60 opacity-60');
            return (
              <li key={day.toISOString()} aria-label={label} aria-current={isToday ? 'date' : undefined}>
                {onOpenWeek ? (
                  <button type="button" onClick={() => onOpenWeek(day)} aria-label={t('schedule.openWeek', { day: label })}
                    className={cx(classes, 'h-full w-full hover:bg-info-soft/40')}>{cell}</button>
                ) : <div className={cx(classes, 'h-full')}>{cell}</div>}
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Mon horaire : liste des jours, total de la semaine
// ---------------------------------------------------------------------
function MySchedule({ days, shifts, today }: { days: Date[]; shifts: Shift[]; today: Date }) {
  const { t } = useTranslation();
  const total = shifts.reduce((sum, s) => sum + shiftMinutes(s.startTime, s.endTime), 0);
  return (
    <>
      <p className="mb-4 text-sm text-muted">
        {t('schedule.weekTotal', { count: shifts.length, duration: formatDuration(total) })}
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
                {formatDayHeading(day)}{isToday && t('schedule.today')}
              </span>
              {mine.length === 0 ? <span className="text-sm text-muted">{t('schedule.dayOff')}</span> : (
                <span className="flex flex-wrap gap-2">
                  {mine.map((s) => (
                    <span key={s.id} className="text-right">
                      <Badge tone="info">{s.shiftType.label}</Badge>{' '}
                      <span className="font-semibold tabular-nums">{formatShiftTimes(s.startTime, s.endTime)}</span>
                      {s.overnight && <span className="text-xs text-muted">{t('schedule.nextDay')}</span>}
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
  const { t } = useTranslation();
  const staff = useStaff();
  const types = useShiftTypes();
  if (staff.isPending || types.isPending) return <Loading />;

  // Employés actifs, plus ceux encore à l'horaire (ex. désactivés depuis)
  const people: StaffMember[] = [...(staff.data ?? [])];
  for (const s of shifts) {
    if (!people.some((p) => p.id === s.user.id)) people.push(s.user);
  }
  if (people.length === 0) return <EmptyState>{t('schedule.noStaff')}</EmptyState>;

  const cell = (userId: string, day: Date) => shifts.filter((s) => s.user.id === userId && s.workDate === toDateParam(day));
  const weekMinutes = (userId: string) => shifts.filter((s) => s.user.id === userId)
    .reduce((sum, s) => sum + shiftMinutes(s.startTime, s.endTime), 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="sticky left-0 bg-surface px-3 py-2 text-left font-semibold">{t('schedule.employee')}</th>
            {days.map((day) => (
              <th key={day.toISOString()} scope="col"
                className={cx('px-2 py-2 text-center font-semibold first-letter:uppercase', sameDay(day, today) && 'text-primary')}>
                {dayShort(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.id} className="border-b border-line align-top">
              <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left font-normal">
                <span className="block font-medium">{fullName(person)}</span>
                <span className="text-xs text-muted">{t(`common.roles.${person.role}`)} · {formatDuration(weekMinutes(person.id))}</span>
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
                        <button type="button" aria-label={t('schedule.addShiftFor', { name: fullName(person), day: formatDayHeading(day) })}
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
            <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left text-xs font-semibold text-muted">{t('schedule.coverage')}</th>
            {days.map((day) => (
              <td key={day.toISOString()} className="px-2 py-2 text-xs text-muted">
                {types.data?.map((type) => {
                  const n = shifts.filter((s) => s.workDate === toDateParam(day) && s.shiftType.id === type.id).length;
                  return <span key={type.id} className={cx('block', n === 0 && 'font-semibold text-danger')}>{t('schedule.coverageCount', { label: type.label, count: n })}</span>;
                })}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      <p className="px-3 py-2 text-xs text-muted">
        <span className="mr-3 inline-block rounded bg-info-soft px-1.5 text-primary">{t('schedule.legendShift')}</span>
        <span className="mr-3 inline-block rounded bg-priority-soft px-1.5 text-priority">{t('schedule.legendAdjusted')}</span>
        {t('schedule.legendNote')}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Ajouter / modifier / retirer un quart (responsable)
// ---------------------------------------------------------------------
function ShiftForm({ editing, onDone }: { editing: Editing; onDone: () => void }) {
  const { t } = useTranslation();
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
    const type = types.data?.find((x) => x.id === id);
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
    if (!s || !window.confirm(t('schedule.form.removeConfirm'))) return;
    await cancel.mutateAsync(s.id);
    onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm">
        <strong>{person ? fullName(person) : ''}</strong> — <span className="first-letter:uppercase">{formatDayHeading(day)}</span>
      </p>
      <SelectField label={t('schedule.form.shift')} required value={typeId} onChange={(e) => chooseType(e.target.value)}>
        <option value="" disabled>{t('common.choose')}</option>
        {types.data?.map((type) => <option key={type.id} value={type.id}>{type.label} ({formatShiftTimes(type.startTime, type.endTime)})</option>)}
      </SelectField>
      <div className="grid grid-cols-2 gap-4">
        <TextField label={t('schedule.form.start')} type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
        <TextField label={t('schedule.form.end')} type="time" required value={end} onChange={(e) => setEnd(e.target.value)}
          hint={start && end && end <= start ? t('schedule.form.endsNextDay') : undefined} />
      </div>
      <TextField label={t('schedule.form.note')} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder={t('schedule.form.notePlaceholder')} />
      <ErrorMessage error={save.error ?? cancel.error} />
      <div className="flex flex-wrap justify-between gap-2">
        {s ? <Button variant="ghost" className="text-danger" busy={cancel.isPending} onClick={() => void remove()}>{t('schedule.form.remove')}</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onDone}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" busy={save.isPending}>{s ? t('common.save') : t('common.add')}</Button>
        </div>
      </div>
    </form>
  );
}
