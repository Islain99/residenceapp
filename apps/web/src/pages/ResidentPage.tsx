// Fiche d'un résident : informations, consignes, rendez-vous à venir, suivis ouverts et notes récentes.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { downloadResidentExport, useAppointments, useCreateNote, useFollowUps, useNotes, useResident, useSaveResident } from '../api/hooks';
import type { Resident } from '../api/types';
import { isSupervisor, useUser } from '../auth/session';
import { useAccess } from '../lib/access';
import { AppointmentForm, AppointmentItem } from '../components/Appointments';
import { FollowUpItem } from '../components/FollowUps';
import { NoteCard } from '../components/NoteCard';
import { NoteForm } from '../components/NoteForm';
import { ResidentForm } from '../components/ResidentForm';
import { Badge, Button, Card, Dialog, EmptyState, ErrorMessage, Loading, TextField } from '../components/ui';
import { addDays, ageFrom, formatDate, fullName, startOfDay } from '../lib/format';

export function ResidentPage() {
  const { id = '' } = useParams();
  const resident = useResident(id);
  if (resident.isPending) return <Loading />;
  if (resident.isError) return <ErrorMessage error={resident.error} />;
  return <ResidentView resident={resident.data} />;
}

function ResidentView({ resident }: { resident: Resident }) {
  const { t } = useTranslation();
  const user = useUser();
  const navigate = useNavigate();
  // Fonctionnalités activables : chaque section suit son module
  const { can } = useAccess();
  const notes = useNotes({ residentId: resident.id }, 10, can('journal'));
  const followUps = useFollowUps({ status: 'open', residentId: resident.id }, can('followUps'));
  // Suivis terminés : ce qui a été fait, avec la note de clôture
  const doneFollowUps = useFollowUps({ status: 'closed', residentId: resident.id }, can('followUps'));
  // Rendez-vous des trois prochains mois. 90 jours et non 92 (limite de l'API) :
  // un changement d'heure ajoute une heure à la période.
  const [today] = useState(() => startOfDay(new Date()));
  const appointments = useAppointments({
    from: today.toISOString(), to: addDays(today, 90).toISOString(), residentId: resident.id,
  }, can('agenda'));
  const createNote = useCreateNote();
  const [dialog, setDialog] = useState<'note' | 'appointment' | 'edit' | 'leave' | null>(null);
  const close = () => setDialog(null);
  const save = useSaveResident(resident.id);
  const supervisor = isSupervisor(user.role);
  const manage = supervisor && can('residents', 'full');   // Résidents en consultation : pas de modification
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);

  async function exportFile() {
    setExportError(null);
    setExporting(true);
    try {
      await downloadResidentExport(resident);
    } catch (err) {
      setExportError(err);
    } finally {
      setExporting(false);
    }
  }
  const items = notes.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <Link to="/residents" className="mb-4 inline-block text-sm text-primary hover:underline">{t('residents.detail.back')}</Link>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{fullName(resident)}</h1>
            <p className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
              {resident.room && <Badge>{t('residents.detail.room', { room: resident.room })}</Badge>}
              {resident.status === 'parti' && <Badge tone="danger">{resident.leftAt ? t('residents.detail.leftOn', { date: formatDate(resident.leftAt) }) : t('residents.detail.left')}</Badge>}
              {resident.birthDate && <span>{t('residents.detail.age', { age: ageFrom(resident.birthDate), date: formatDate(resident.birthDate) })}</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can('journal', 'full') && <Button variant="primary" onClick={() => setDialog('note')}>{t('residents.detail.addNote')}</Button>}
            {can('agenda', 'full') && <Button onClick={() => setDialog('appointment')}>{t('residents.detail.addAppointment')}</Button>}
            {supervisor && can('stats') && (
              <Link to={`/residents/${resident.id}/statistiques`}
                className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-sunken">
                {t('residents.detail.stats')}
              </Link>
            )}
            {manage && <Button onClick={() => setDialog('edit')}>{t('common.edit')}</Button>}
            {manage && resident.status === 'actif' && <Button variant="ghost" onClick={() => setDialog('leave')}>{t('residents.detail.leave')}</Button>}
            {manage && resident.status === 'parti' && (
              <Button variant="ghost" busy={save.isPending} onClick={() => save.mutate({ status: 'actif' })}>{t('residents.detail.readmit')}</Button>
            )}
            {user.role === 'responsable' && (
              <Button variant="ghost" busy={exporting} onClick={exportFile}
                title={t('residents.detail.exportTitle')}>
                {t('residents.detail.export')}
              </Button>
            )}
          </div>
        </div>
        <ErrorMessage error={exportError} />

        {resident.specialInstructions && (
          <div className="mt-4 rounded-lg bg-priority-soft p-3">
            <p className="text-sm font-semibold text-priority">{t('residents.detail.specialInstructions')}</p>
            <p className="whitespace-pre-line">{resident.specialInstructions}</p>
          </div>
        )}

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">{t('residents.detail.emergencyContact')}</dt><dd>{resident.emergencyContact ?? '—'}</dd></div>
          <div><dt className="text-muted">{t('residents.detail.admission')}</dt><dd>{resident.admittedAt ? formatDate(resident.admittedAt) : '—'}</dd></div>
        </dl>

        {resident.restrictedNotes !== undefined && (
          <div className="mt-4 rounded-lg border border-dashed border-line p-3">
            <p className="text-sm font-semibold">{t('residents.detail.restrictedNotes')} <span className="font-normal text-muted">{t('residents.detail.restrictedNotesWho')}</span></p>
            <p className="whitespace-pre-line text-sm">{resident.restrictedNotes ?? '—'}</p>
          </div>
        )}
      </Card>

      {can('agenda') && <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('residents.detail.upcoming')}</h2>
          <Link to={`/agenda?residentId=${resident.id}`} className="text-sm text-primary hover:underline">{t('residents.detail.seeInAgenda')}</Link>
        </div>
        {appointments.isPending ? <Loading /> : !appointments.data?.length ? <EmptyState>{t('residents.detail.noAppointments')}</EmptyState> : (
          <ul className="flex flex-col gap-2">{appointments.data.map((a) => <AppointmentItem key={a.id} appointment={a} showDate />)}</ul>
        )}
      </section>}

      {can('followUps') && <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">{t('residents.detail.openFollowUps')}</h2>
        {followUps.isPending ? <Loading /> : !followUps.data?.length ? <EmptyState>{t('residents.detail.noOpenFollowUps')}</EmptyState> : (
          <ul className="flex flex-col gap-3">{followUps.data.map((f) => <FollowUpItem key={f.id} followUp={f} />)}</ul>
        )}
      </section>}

      {!!doneFollowUps.data?.length && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">{t('residents.detail.doneFollowUps')}</h2>
          <ul className="flex flex-col gap-3">
            {doneFollowUps.data.slice(0, 5).map((f) => <FollowUpItem key={f.id} followUp={f} />)}
          </ul>
        </section>
      )}

      {can('journal') && <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('residents.detail.recentNotes')}</h2>
          <Link to={`/journal?residentId=${resident.id}`} className="text-sm text-primary hover:underline">{t('residents.detail.allNotes')}</Link>
        </div>
        {notes.isPending ? <Loading /> : items.length === 0 ? <EmptyState>{t('residents.detail.noNotes')}</EmptyState> : (
          <div className="flex flex-col gap-3">{items.map((n) => <NoteCard key={n.id} note={n} />)}</div>
        )}
      </section>}

      <Dialog open={dialog === 'appointment'} onClose={close} title={t('residents.detail.newAppointment', { name: fullName(resident) })}>
        <AppointmentForm defaultResidentId={resident.id} onDone={close} />
      </Dialog>
      <Dialog open={dialog === 'note'} onClose={close} title={t('journal.form.newNoteFor', { name: fullName(resident) })}>
        <NoteForm defaultResidentId={resident.id} submitLabel={t('journal.form.saveNote')} onCancel={close}
          onSubmit={async (input) => {
            const note = await createNote.mutateAsync(input);
            close();
            navigate(`/notes/${note.id}`);
          }} />
      </Dialog>
      <Dialog open={dialog === 'edit'} onClose={close} title={t('residents.detail.editTitle')}>
        <ResidentForm resident={resident} onCancel={close}
          onSubmit={async (input) => { await save.mutateAsync(input); close(); }} />
      </Dialog>
      <Dialog open={dialog === 'leave'} onClose={close} title={t('residents.detail.leaveTitle')}>
        <LeaveForm resident={resident} onDone={close} />
      </Dialog>
    </>
  );
}

function LeaveForm({ resident, onDone }: { resident: Resident; onDone: () => void }) {
  const { t } = useTranslation();
  const save = useSaveResident(resident.id);
  const [leftAt, setLeftAt] = useState(() => new Date().toLocaleDateString('en-CA'));   // AAAA-MM-JJ local
  async function submit(event: FormEvent) {
    event.preventDefault();
    await save.mutateAsync({ status: 'parti', leftAt });
    onDone();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm">{t('residents.detail.leaveExplain')}</p>
      <TextField label={t('residents.detail.leftAt')} type="date" required value={leftAt} min={resident.admittedAt ?? undefined}
        onChange={(e) => setLeftAt(e.target.value)} />
      <ErrorMessage error={save.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>{t('residents.detail.confirmLeave')}</Button>
      </div>
    </form>
  );
}
