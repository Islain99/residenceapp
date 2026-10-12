// Quarts types (responsable) : ajouter, modifier les heures, désactiver / réactiver.
// Changer les heures d'un quart type ne modifie pas les quarts déjà planifiés.
import { useState, type FormEvent } from 'react';
import { useSaveShiftType, useShiftTypes } from '../api/hooks';
import type { ShiftType } from '../api/types';
import { Badge, Button, EmptyState, ErrorMessage, Loading, PageHeader, TextField } from '../components/ui';
import { formatShiftTimes } from '../lib/schedule';

export function ShiftTypesPage() {
  const types = useShiftTypes(true);
  const list = types.data ?? [];

  return (
    <>
      <PageHeader
        title="Quarts de travail"
        subtitle="Proposés dans l’horaire, dans cet ordre. Une fin plus tôt que le début signifie que le quart finit le lendemain (nuit)."
      />
      <ShiftTypeForm nextOrder={Math.max(0, ...list.map((t) => t.sortOrder)) + 1} />

      {types.isPending ? <Loading /> : types.isError ? <ErrorMessage error={types.error} /> :
        list.length === 0 ? <EmptyState>Aucun quart. Ajoutez-en un (ex. : Jour, 07:00 à 15:00).</EmptyState> : (
          <ul className="mt-6 flex flex-col gap-2">{list.map((t) => <ShiftTypeRow key={t.id} type={t} />)}</ul>
        )}
    </>
  );
}

function ShiftTypeForm({ type, nextOrder, onDone }: { type?: ShiftType; nextOrder?: number; onDone?: () => void }) {
  const save = useSaveShiftType(type?.id);
  const [label, setLabel] = useState(type?.label ?? '');
  const [start, setStart] = useState(type?.startTime ?? '');
  const [end, setEnd] = useState(type?.endTime ?? '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await save.mutateAsync(type ? { label, startTime: start, endTime: end } : { label, startTime: start, endTime: end, sortOrder: nextOrder });
    if (onDone) onDone(); else { setLabel(''); setStart(''); setEnd(''); }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem_9rem_auto] sm:items-end">
        <TextField label={type ? 'Nom' : 'Nouveau quart'} required maxLength={50} value={label}
          onChange={(e) => setLabel(e.target.value)} placeholder="Ex. : Jour" />
        <TextField label="Début" type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
        <TextField label="Fin" type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
        <div className="flex gap-2">
          {onDone && <Button onClick={onDone}>Annuler</Button>}
          <Button type="submit" variant="primary" busy={save.isPending}>{type ? 'Enregistrer' : 'Ajouter'}</Button>
        </div>
      </div>
      <ErrorMessage error={save.error} />
    </form>
  );
}

function ShiftTypeRow({ type }: { type: ShiftType }) {
  const save = useSaveShiftType(type.id);
  const [editing, setEditing] = useState(false);
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      {editing ? <ShiftTypeForm type={type} onDone={() => setEditing(false)} /> : (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="flex-1">
            <span className="font-medium">{type.label}</span>{' '}
            <span className="text-sm text-muted tabular-nums">{formatShiftTimes(type.startTime, type.endTime)}</span>{' '}
            {type.endTime <= type.startTime && <Badge>Finit le lendemain</Badge>}{' '}
            {!type.isActive && <Badge>Désactivé</Badge>}
          </span>
          <div className="-ml-3 flex gap-1 sm:ml-0">
            {type.isActive ? (
              <>
                <Button variant="ghost" onClick={() => setEditing(true)}>Modifier</Button>
                <Button variant="ghost" className="text-danger" busy={save.isPending}
                  onClick={() => save.mutate({ isActive: false })}>Désactiver</Button>
              </>
            ) : <Button busy={save.isPending} onClick={() => save.mutate({ isActive: true })}>Réactiver</Button>}
          </div>
        </div>
      )}
      <ErrorMessage error={save.error} />
    </li>
  );
}
