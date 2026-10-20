// Formulaire de résident (infirmière, responsable) : création ou modification.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Resident, ResidentInput } from '../api/types';
import { Button, ErrorMessage, TextArea, TextField } from './ui';

interface Props {
  resident?: Resident;
  onSubmit: (input: ResidentInput) => Promise<unknown>;
  onCancel: () => void;
}

export function ResidentForm({ resident, onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const [v, setV] = useState({
    firstName: resident?.firstName ?? '',
    lastName: resident?.lastName ?? '',
    room: resident?.room ?? '',
    birthDate: resident?.birthDate ?? '',
    admittedAt: resident?.admittedAt ?? '',
    emergencyContact: resident?.emergencyContact ?? '',
    specialInstructions: resident?.specialInstructions ?? '',
    restrictedNotes: resident?.restrictedNotes ?? '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });
  const orNull = (s: string) => s.trim() || null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        firstName: v.firstName, lastName: v.lastName, room: orNull(v.room),
        birthDate: v.birthDate || null, admittedAt: v.admittedAt || null,
        emergencyContact: orNull(v.emergencyContact), specialInstructions: orNull(v.specialInstructions),
        restrictedNotes: orNull(v.restrictedNotes),
      });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('common.firstName')} required maxLength={100} value={v.firstName} onChange={set('firstName')} />
        <TextField label={t('common.lastName')} required maxLength={100} value={v.lastName} onChange={set('lastName')} />
        <TextField label={t('residents.form.room')} maxLength={20} value={v.room} onChange={set('room')} />
        <TextField label={t('residents.form.birthDate')} type="date" value={v.birthDate} onChange={set('birthDate')} />
        <TextField label={t('residents.form.admittedAt')} type="date" value={v.admittedAt} onChange={set('admittedAt')} />
        <TextField label={t('residents.form.emergencyContact')} maxLength={500} value={v.emergencyContact} onChange={set('emergencyContact')} />
      </div>
      <TextArea label={t('residents.form.specialInstructions')} hint={t('residents.form.specialInstructionsHint')} rows={2} maxLength={2000}
        value={v.specialInstructions} onChange={set('specialInstructions')} />
      <TextArea label={t('residents.form.restrictedNotes')} hint={t('residents.form.restrictedNotesHint')} rows={2}
        maxLength={5000} value={v.restrictedNotes} onChange={set('restrictedNotes')} />
      <ErrorMessage error={error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" busy={busy}>{t('common.save')}</Button>
      </div>
    </form>
  );
}
