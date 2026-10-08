// Formulaire de résident (infirmière, responsable) : création ou modification.
import { useState, type FormEvent } from 'react';
import type { Resident, ResidentInput } from '../api/types';
import { Button, ErrorMessage, TextArea, TextField } from './ui';

interface Props {
  resident?: Resident;
  onSubmit: (input: ResidentInput) => Promise<unknown>;
  onCancel: () => void;
}

export function ResidentForm({ resident, onSubmit, onCancel }: Props) {
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
        <TextField label="Prénom" required maxLength={100} value={v.firstName} onChange={set('firstName')} />
        <TextField label="Nom" required maxLength={100} value={v.lastName} onChange={set('lastName')} />
        <TextField label="Chambre" maxLength={20} value={v.room} onChange={set('room')} />
        <TextField label="Date de naissance" type="date" value={v.birthDate} onChange={set('birthDate')} />
        <TextField label="Date d'admission" type="date" value={v.admittedAt} onChange={set('admittedAt')} />
        <TextField label="Personne à joindre" maxLength={500} value={v.emergencyContact} onChange={set('emergencyContact')} />
      </div>
      <TextArea label="Consignes particulières" hint="Visibles par toute l'équipe." rows={2} maxLength={2000}
        value={v.specialInstructions} onChange={set('specialInstructions')} />
      <TextArea label="Notes réservées" hint="Visibles seulement par les infirmières et les responsables." rows={2}
        maxLength={5000} value={v.restrictedNotes} onChange={set('restrictedNotes')} />
      <ErrorMessage error={error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Annuler</Button>
        <Button type="submit" variant="primary" busy={busy}>Enregistrer</Button>
      </div>
    </form>
  );
}
