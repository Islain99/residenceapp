// Formulaire de note : création (valeurs par défaut) ou correction (note existante).
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories, useResidents } from '../api/hooks';
import { isSupervisor, useUser } from '../auth/session';
import type { Note, NoteInput } from '../api/types';
import { appendDictated } from '../lib/dictation';
import { fromLocalInput, fullName, toLocalInput } from '../lib/format';
import { DictationButton } from './Dictation';
import { useAccess } from '../lib/access';
import { Button, Checkbox, ErrorMessage, SelectField, TextArea, TextField } from './ui';

interface Props {
  note?: Note;                    // correction
  defaultResidentId?: string;     // création depuis la fiche d'un résident
  onSubmit: (input: NoteInput) => Promise<unknown>;
  onCancel: () => void;
  submitLabel: string;
}

export function NoteForm({ note, defaultResidentId, onSubmit, onCancel, submitLabel }: Props) {
  const { t } = useTranslation();
  const user = useUser();
  // Consigne prioritaire : infirmière ou responsable seulement (règle de l'API)
  const { can } = useAccess();
  // Fonctionnalités activables : consignes prioritaires et dictée peuvent être désactivées
  const canMarkPriority = isSupervisor(user.role) && can('priority', 'full');
  const dictation = can('dictation', 'full');
  const categories = useCategories();
  const residents = useResidents('actif');
  const [occurredAt, setOccurredAt] = useState(() => toLocalInput(note ? new Date(note.occurredAt) : new Date()));
  const [maxOccurredAt] = useState(() => toLocalInput(new Date(Date.now() + 5 * 60_000)));   // tolérance de l'API
  const [residentId, setResidentId] = useState(note ? note.resident?.id ?? '' : defaultResidentId ?? '');
  const [categoryId, setCategoryId] = useState(note?.category.id ?? '');
  const [description, setDescription] = useState(note?.description ?? '');
  const [intervention, setIntervention] = useState(note?.intervention ?? '');
  const [isPriority, setPriority] = useState(note?.isPriority ?? false);
  const [isPositive, setPositive] = useState(note?.isPositive ?? false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Résident déjà parti (correction d'une ancienne note) : reste sélectionnable
  const residentOptions = [...(residents.data ?? [])];
  if (note?.resident && !residentOptions.some((r) => r.id === note.resident!.id)) {
    residentOptions.push({ ...note.resident, status: 'parti', specialInstructions: null });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        occurredAt: fromLocalInput(occurredAt),
        residentId: residentId || null,
        categoryId,
        description,
        intervention: intervention.trim() || null,
        isPriority,
        isPositive,
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
        <SelectField label={t('journal.form.resident')} value={residentId} onChange={(e) => setResidentId(e.target.value)}>
          <option value="">{t('journal.form.general')}</option>
          {residentOptions.map((r) => (
            <option key={r.id} value={r.id}>{fullName(r)}{r.room ? ` — ${t('journal.note.room', { room: r.room })}` : ''}</option>
          ))}
        </SelectField>
        <SelectField label={t('journal.form.category')} required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="" disabled>{t('common.choose')}</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </SelectField>
      </div>

      <TextField
        label={t('journal.form.occurredAt')}
        type="datetime-local"
        required
        value={occurredAt}
        max={maxOccurredAt}
        onChange={(e) => setOccurredAt(e.target.value)}
      />

      <TextArea
        label={t('journal.form.description')}
        required
        maxLength={5000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t('journal.form.descriptionPlaceholder')}
      />
      {dictation && <DictationButton iosHint field={t('journal.form.dictateDescription')} onText={(spoken) => setDescription((text) => appendDictated(text, spoken))} />}
      <TextArea
        label={t('journal.form.intervention')}
        rows={2}
        maxLength={5000}
        value={intervention}
        onChange={(e) => setIntervention(e.target.value)}
        placeholder={t('journal.form.interventionPlaceholder')}
      />
      {dictation && <DictationButton field={t('journal.form.dictateIntervention')} onText={(spoken) => setIntervention((text) => appendDictated(text, spoken))} />}

      <div className="flex flex-wrap gap-x-6">
        {canMarkPriority && (
          <Checkbox label={<span><strong>{t('journal.form.priority')}</strong> — {t('journal.form.priorityHint')}</span>}
            checked={isPriority} onChange={(e) => setPriority(e.target.checked)} />
        )}
        <Checkbox label={t('journal.form.positive')} checked={isPositive} onChange={(e) => setPositive(e.target.checked)} />
      </div>

      <ErrorMessage error={error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" busy={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
