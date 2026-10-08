// Fiche d'un résident : informations, consignes, suivis ouverts et notes récentes.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useCreateNote, useFollowUps, useNotes, useResident, useSaveResident } from '../api/hooks';
import type { Resident } from '../api/types';
import { isSupervisor, useUser } from '../auth/session';
import { FollowUpItem } from '../components/FollowUps';
import { NoteCard } from '../components/NoteCard';
import { NoteForm } from '../components/NoteForm';
import { ResidentForm } from '../components/ResidentForm';
import { Badge, Button, Card, Dialog, EmptyState, ErrorMessage, Loading, TextField } from '../components/ui';
import { ageFrom, formatDate, fullName } from '../lib/format';

export function ResidentPage() {
  const { id = '' } = useParams();
  const resident = useResident(id);
  if (resident.isPending) return <Loading />;
  if (resident.isError) return <ErrorMessage error={resident.error} />;
  return <ResidentView resident={resident.data} />;
}

function ResidentView({ resident }: { resident: Resident }) {
  const user = useUser();
  const navigate = useNavigate();
  const notes = useNotes({ residentId: resident.id }, 10);
  const followUps = useFollowUps({ status: 'open', residentId: resident.id });
  const createNote = useCreateNote();
  const [dialog, setDialog] = useState<'note' | 'edit' | 'leave' | null>(null);
  const close = () => setDialog(null);
  const save = useSaveResident(resident.id);
  const supervisor = isSupervisor(user.role);
  const items = notes.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <Link to="/residents" className="mb-4 inline-block text-sm text-primary hover:underline">← Résidents</Link>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{fullName(resident)}</h1>
            <p className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
              {resident.room && <Badge>Chambre {resident.room}</Badge>}
              {resident.status === 'parti' && <Badge tone="danger">Parti{resident.leftAt && ` le ${formatDate(resident.leftAt)}`}</Badge>}
              {resident.birthDate && <span>{ageFrom(resident.birthDate)} ans (né·e le {formatDate(resident.birthDate)})</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setDialog('note')}>+ Note</Button>
            {supervisor && <Button onClick={() => setDialog('edit')}>Modifier</Button>}
            {supervisor && resident.status === 'actif' && <Button variant="ghost" onClick={() => setDialog('leave')}>Départ</Button>}
            {supervisor && resident.status === 'parti' && (
              <Button variant="ghost" busy={save.isPending} onClick={() => save.mutate({ status: 'actif' })}>Réadmettre</Button>
            )}
          </div>
        </div>

        {resident.specialInstructions && (
          <div className="mt-4 rounded-lg bg-priority-soft p-3">
            <p className="text-sm font-semibold text-priority">Consignes particulières</p>
            <p className="whitespace-pre-line">{resident.specialInstructions}</p>
          </div>
        )}

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Personne à joindre</dt><dd>{resident.emergencyContact ?? '—'}</dd></div>
          <div><dt className="text-muted">Admission</dt><dd>{resident.admittedAt ? formatDate(resident.admittedAt) : '—'}</dd></div>
        </dl>

        {resident.restrictedNotes !== undefined && (
          <div className="mt-4 rounded-lg border border-dashed border-line p-3">
            <p className="text-sm font-semibold">Notes réservées <span className="font-normal text-muted">(infirmières et responsables)</span></p>
            <p className="whitespace-pre-line text-sm">{resident.restrictedNotes ?? '—'}</p>
          </div>
        )}
      </Card>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Suivis ouverts</h2>
        {followUps.isPending ? <Loading /> : !followUps.data?.length ? <EmptyState>Aucun suivi ouvert.</EmptyState> : (
          <ul className="flex flex-col gap-3">{followUps.data.map((f) => <FollowUpItem key={f.id} followUp={f} />)}</ul>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Notes récentes</h2>
          <Link to={`/journal?residentId=${resident.id}`} className="text-sm text-primary hover:underline">Toutes ses notes →</Link>
        </div>
        {notes.isPending ? <Loading /> : items.length === 0 ? <EmptyState>Aucune note pour ce résident.</EmptyState> : (
          <div className="flex flex-col gap-3">{items.map((n) => <NoteCard key={n.id} note={n} />)}</div>
        )}
      </section>

      <Dialog open={dialog === 'note'} onClose={close} title={`Nouvelle note — ${fullName(resident)}`}>
        <NoteForm defaultResidentId={resident.id} submitLabel="Enregistrer la note" onCancel={close}
          onSubmit={async (input) => {
            const note = await createNote.mutateAsync(input);
            close();
            navigate(`/notes/${note.id}`);
          }} />
      </Dialog>
      <Dialog open={dialog === 'edit'} onClose={close} title="Modifier le résident">
        <ResidentForm resident={resident} onCancel={close}
          onSubmit={async (input) => { await save.mutateAsync(input); close(); }} />
      </Dialog>
      <Dialog open={dialog === 'leave'} onClose={close} title="Départ du résident">
        <LeaveForm resident={resident} onDone={close} />
      </Dialog>
    </>
  );
}

function LeaveForm({ resident, onDone }: { resident: Resident; onDone: () => void }) {
  const save = useSaveResident(resident.id);
  const [leftAt, setLeftAt] = useState(() => new Date().toLocaleDateString('en-CA'));   // AAAA-MM-JJ local
  async function submit(event: FormEvent) {
    event.preventDefault();
    await save.mutateAsync({ status: 'parti', leftAt });
    onDone();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm">Le dossier et les notes sont conservés. Le résident n'apparaîtra plus dans la liste des présents.</p>
      <TextField label="Date de départ" type="date" required value={leftAt} min={resident.admittedAt ?? undefined}
        onChange={(e) => setLeftAt(e.target.value)} />
      <ErrorMessage error={save.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Annuler</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>Confirmer le départ</Button>
      </div>
    </form>
  );
}
