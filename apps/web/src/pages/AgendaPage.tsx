// Agenda : rendez-vous de la semaine, jour par jour. Semaine et filtres dans
// l'adresse (?semaine=AAAA-MM-JJ&residentId=…), donc partageables.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAppointments, useResidents } from '../api/hooks';
import type { Appointment, AppointmentKind } from '../api/types';
import { AppointmentForm, AppointmentItem } from '../components/Appointments';
import { Button, Chip, Dialog, ErrorMessage, Loading, PageHeader, SelectField } from '../components/ui';
import { APPOINTMENT_KINDS } from '../lib/agenda';
import { cx } from '../lib/cx';
import {
  addDays, formatDayHeading, formatRange, fromDateParam, fullName, sameDay, startOfWeek, toDateParam,
} from '../lib/format';

export function AgendaPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => new Date());
  // Nouveau rendez-vous : start absent = prochaine heure ronde ; sinon le jour choisi à 10 h
  const [creating, setCreating] = useState<{ start?: Date } | null>(null);
  const residents = useResidents('all');

  const weekStart = startOfWeek(fromDateParam(params.get('semaine')) ?? today);
  const weekEnd = addDays(weekStart, 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const residentId = params.get('residentId') ?? undefined;
  const kind = (params.get('type') as AppointmentKind | null) ?? undefined;
  const showCancelled = params.get('annules') === 'oui';

  const appointments = useAppointments({
    from: weekStart.toISOString(),
    to: weekEnd.toISOString(),
    residentId,
    kind,
    status: showCancelled ? 'all' : 'prevu',
  });

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const goToWeek = (d: Date) => setParam('semaine', sameDay(startOfWeek(d), startOfWeek(today)) ? null : toDateParam(d));

  const byDay = (day: Date) => (appointments.data ?? []).filter((a: Appointment) => sameDay(new Date(a.startsAt), day));

  return (
    <>
      <PageHeader
        title={t('agenda.title')}
        subtitle={t('agenda.subtitle')}
        actions={<Button variant="primary" onClick={() => setCreating({})}>{t('agenda.add')}</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button aria-label={t('agenda.previousWeek')} onClick={() => goToWeek(addDays(weekStart, -7))}>←</Button>
        <Button aria-label={t('agenda.nextWeek')} onClick={() => goToWeek(addDays(weekStart, 7))}>→</Button>
        <Button variant="ghost" onClick={() => goToWeek(today)}>{t('agenda.thisWeek')}</Button>
        <h2 className="ml-1 text-lg font-semibold">{formatRange(weekStart, addDays(weekStart, 6))}</h2>
      </div>

      <div className="mb-5 grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-3 sm:items-end">
        <SelectField label={t('agenda.resident')} value={residentId ?? ''} onChange={(e) => setParam('residentId', e.target.value || null)}>
          <option value="">{t('agenda.allWithResidence')}</option>
          {residents.data?.map((r) => (
            <option key={r.id} value={r.id}>{fullName(r)}{r.status === 'parti' ? t('agenda.left') : ''}</option>
          ))}
        </SelectField>
        <SelectField label={t('agenda.type')} value={kind ?? ''} onChange={(e) => setParam('type', e.target.value || null)}>
          <option value="">{t('agenda.all')}</option>
          {APPOINTMENT_KINDS.map((k) => <option key={k} value={k}>{t(`agenda.kinds.${k}`)}</option>)}
        </SelectField>
        <div><Chip active={showCancelled} onClick={() => setParam('annules', showCancelled ? null : 'oui')}>{t('agenda.showCancelled')}</Chip></div>
      </div>

      {appointments.isPending ? <Loading /> : appointments.isError ? <ErrorMessage error={appointments.error} /> : (
        <div className="flex flex-col gap-6">
          {days.map((day) => {
            const items = byDay(day);
            const isToday = sameDay(day, today);
            return (
              <section key={day.toISOString()} aria-label={formatDayHeading(day)}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className={cx('font-semibold first-letter:uppercase', isToday && 'text-primary')}>
                    {formatDayHeading(day)}{isToday && t('agenda.today')}
                  </h3>
                  <button type="button" className="rounded-lg px-2 py-1 text-sm text-primary hover:bg-sunken"
                    onClick={() => { const start = new Date(day); start.setHours(10, 0, 0, 0); setCreating({ start }); }}>
                    {t('agenda.addOnDay')}
                  </button>
                </div>
                {items.length === 0
                  ? <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">{t('agenda.nothing')}</p>
                  : <ul className="flex flex-col gap-2">{items.map((a) => <AppointmentItem key={a.id} appointment={a} />)}</ul>}
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={creating !== null} onClose={() => setCreating(null)} title={t('agenda.newTitle')}>
        {creating && (
          <AppointmentForm
            defaultResidentId={residentId}
            defaultStart={creating.start}
            onDone={(saved) => {
              setCreating(null);
              // Rendez-vous ajouté dans une autre semaine : on y va, pour le voir
              if (saved) goToWeek(new Date(saved.startsAt));
            }}
          />
        )}
      </Dialog>
    </>
  );
}
