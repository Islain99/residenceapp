// Plateforme — une résidence : informations, suspension, responsables,
// accès d'assistance. Aucun contenu de la résidence ici.
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useAddResponsable, usePlatformResidence, useUpdateResidence } from '../../api/hooks';
import type { PlatformResidence, PlatformResidenceDetail } from '../../api/types';
import { ROLE_LABELS } from '../../auth/session';
import { PlatformAccountRow, Stat } from '../../components/platform';
import {
  Badge, Button, Card, Dialog, EmptyState, ErrorMessage, Loading, PageHeader, SelectField, TextArea, TextField,
} from '../../components/ui';
import { formatFull, formatWhen, fullName } from '../../lib/format';
import { RESIDENCE_TYPES, TIMEZONES, useEnterAssistance } from '../../lib/platform';

export function PlatformResidencePage() {
  const { id = '' } = useParams();
  const detail = usePlatformResidence(id);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [adding, setAdding] = useState(false);
  const update = useUpdateResidence();

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorMessage error={detail.error} />;
  const { residence: r, responsables, assistance } = detail.data;

  return (
    <>
      <Link to="/plateforme" className="mb-3 inline-block text-sm text-primary hover:underline">← Résidences</Link>
      <PageHeader
        title={r.name}
        subtitle={<>{RESIDENCE_TYPES[r.type]} · {TIMEZONES.find((t) => t.id === r.timezone)?.label ?? r.timezone} · créée le {formatFull(r.createdAt)}</>}
        actions={<>
          <Button onClick={() => setEditing(true)}>Modifier</Button>
          {r.isActive
            ? <Button variant="ghost" className="text-danger" onClick={() => setSuspending(true)}>Suspendre</Button>
            : <Button variant="primary" busy={update.isPending} onClick={() => update.mutate({ id: r.id, isActive: true }, {
              onSuccess: () => setNotice('Résidence réactivée : son équipe peut de nouveau se connecter.'),
            })}>Réactiver</Button>}
        </>}
      />
      {!r.isActive && (
        <p className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          Résidence suspendue : personne ne peut s’y connecter. Ses données sont conservées.
        </p>
      )}
      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}
      <ErrorMessage error={update.error} />

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="employés actifs" value={r.staffActive} />
        <Stat label="résidents" value={r.residentsActive} />
        <Stat label="notes (30 jours)" value={r.notesLast30Days} />
        {r.lockedAccounts > 0
          ? <Stat label={r.lockedAccounts > 1 ? 'comptes bloqués' : 'compte bloqué'} value={r.lockedAccounts} tone="danger" />
          : <Stat label="refus de connexion (24 h)" value={r.failedLogins24h} />}
      </div>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Responsables</h2>
          <Button onClick={() => setAdding(true)}>+ Ajouter une responsable</Button>
        </div>
        {r.responsablesActive === 0 && r.isActive && (
          <p className="mb-3 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
            Aucune responsable active : personne ne peut gérer l’équipe de cette résidence.
          </p>
        )}
        <p className="mb-3 text-sm text-muted">
          Les autres employés sont gérés par la responsable. Pour remplacer une responsable : ajouter la nouvelle, puis désactiver l’ancienne.
        </p>
        {responsables.length === 0 ? <EmptyState>Aucune responsable.</EmptyState> : (
          <ul className="flex flex-col gap-3">
            {responsables.map((a) => <PlatformAccountRow key={a.id} account={a} onNotice={setNotice} />)}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Accès d’assistance</h2>
        <p className="mb-3 text-sm text-muted">
          Accordés par la responsable, depuis Admin › Assistance. Vous ne pouvez pas en ouvrir un vous-même.
        </p>
        <AssistanceList grants={assistance} />
      </section>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Modifier la résidence">
        <EditForm residence={r} onDone={() => setEditing(false)} />
      </Dialog>
      <Dialog open={suspending} onClose={() => setSuspending(false)} title="Suspendre la résidence">
        <SuspendForm residence={r} onDone={(done) => {
          setSuspending(false);
          if (done) setNotice('Résidence suspendue : toutes les sessions sont fermées.');
        }} />
      </Dialog>
      <Dialog open={adding} onClose={() => setAdding(false)} title="Ajouter une responsable">
        <AddResponsableForm detail={detail.data} onDone={(message) => {
          setAdding(false);
          if (message) setNotice(message);
        }} />
      </Dialog>
    </>
  );
}

function AssistanceList({ grants }: { grants: PlatformResidenceDetail['assistance'] }) {
  const { enter, busy, error } = useEnterAssistance();
  if (grants.length === 0) return <EmptyState>Aucun accès accordé.</EmptyState>;
  return (
    <>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {grants.map((g) => (
          <li key={g.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
            <span className="flex-1">
              {formatWhen(g.grantedAt)} · accordé par {fullName(g.grantedBy)} · jusqu’à {formatWhen(g.expiresAt)}
              {g.revokedBy && <> · retiré par {fullName(g.revokedBy)}</>}
              {g.reason && <span className="block text-muted">Motif : {g.reason}</span>}
            </span>
            <span className="text-xs text-muted">{g.views} page{g.views > 1 ? 's' : ''} consultée{g.views > 1 ? 's' : ''}</span>
            {g.status === 'active'
              ? <Button variant="primary" busy={busy} onClick={() => void enter(g.id)}>Consulter (lecture seule)</Button>
              : <Badge>{g.status === 'revoked' ? 'Retiré' : 'Terminé'}</Badge>}
          </li>
        ))}
      </ul>
      <ErrorMessage error={error} />
    </>
  );
}

function EditForm({ residence, onDone }: { residence: PlatformResidence; onDone: () => void }) {
  const update = useUpdateResidence();
  const [v, setV] = useState({ name: residence.name, type: residence.type, timezone: residence.timezone });
  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate({ id: residence.id, ...v }, { onSuccess: onDone });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField label="Nom" required maxLength={150} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <SelectField label="Type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as PlatformResidence['type'] })}>
        {Object.entries(RESIDENCE_TYPES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </SelectField>
      <SelectField label="Fuseau horaire" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>
        {!TIMEZONES.some((t) => t.id === v.timezone) && <option value={v.timezone}>{v.timezone}</option>}
        {TIMEZONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </SelectField>
      <ErrorMessage error={update.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Annuler</Button>
        <Button type="submit" variant="primary" busy={update.isPending}>Enregistrer</Button>
      </div>
    </form>
  );
}

function SuspendForm({ residence, onDone }: { residence: PlatformResidence; onDone: (done: boolean) => void }) {
  const update = useUpdateResidence();
  const [reason, setReason] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate({ id: residence.id, isActive: false, reason: reason.trim() }, { onSuccess: () => onDone(true) });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Card className="p-4 text-sm">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>Plus personne ne pourra se connecter à <strong>{residence.name}</strong> ; les sessions ouvertes sont fermées tout de suite.</li>
          <li>Les accès d’assistance ouverts sont retirés.</li>
          <li>Rien n’est effacé : la résidence peut être réactivée à tout moment.</li>
        </ul>
      </Card>
      <TextArea label="Motif" required minLength={5} maxLength={500} rows={3} value={reason}
        onChange={(e) => setReason(e.target.value)} hint="Inscrit au journal (fin de contrat, incident de sécurité…)." />
      <ErrorMessage error={update.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone(false)}>Annuler</Button>
        <Button type="submit" variant="danger" busy={update.isPending}>Suspendre la résidence</Button>
      </div>
    </form>
  );
}

function AddResponsableForm({ detail, onDone }: { detail: PlatformResidenceDetail; onDone: (message?: string) => void }) {
  const add = useAddResponsable();
  const [mode, setMode] = useState<'invite' | 'promote'>('invite');
  const [person, setPerson] = useState({ email: '', firstName: '', lastName: '' });
  const [userId, setUserId] = useState('');
  const residenceId = detail.residence.id;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'invite') {
      await add.mutateAsync({ residenceId, ...person });
      onDone(`Invitation envoyée à ${person.email} (valable 72 heures).`);
    } else {
      const account = await add.mutateAsync({ residenceId, userId });
      onDone(`${fullName(account)} est maintenant responsable.`);
    }
  }

  const set = (key: keyof typeof person) => (e: { target: { value: string } }) => setPerson({ ...person, [key]: e.target.value });

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Façon d’ajouter" className="flex gap-1 rounded-lg bg-sunken p-1">
        {([['invite', 'Inviter une personne'], ['promote', 'Nommer un employé']] as const).map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={mode === key} onClick={() => setMode(key)}
            className={mode === key ? 'flex-1 rounded-md bg-surface px-3 py-2 text-sm font-medium shadow-sm' : 'flex-1 rounded-md px-3 py-2 text-sm text-muted'}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'invite' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Prénom" required maxLength={100} value={person.firstName} onChange={set('firstName')} />
            <TextField label="Nom" required maxLength={100} value={person.lastName} onChange={set('lastName')} />
          </div>
          <TextField label="Courriel" type="email" required maxLength={254} value={person.email} onChange={set('email')}
            hint="Elle recevra une invitation et choisira elle-même son mot de passe." />
        </>
      ) : detail.staff.length === 0 ? (
        <EmptyState>Aucun autre employé actif dans cette résidence.</EmptyState>
      ) : (
        <SelectField label="Employé" required value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Choisir…</option>
          {detail.staff.map((s) => <option key={s.id} value={s.id}>{fullName(s)} — {ROLE_LABELS[s.role]}</option>)}
        </SelectField>
      )}
      <ErrorMessage error={add.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone()}>Annuler</Button>
        <Button type="submit" variant="primary" busy={add.isPending} disabled={mode === 'promote' && !userId}>
          {mode === 'invite' ? 'Envoyer l’invitation' : 'Nommer responsable'}
        </Button>
      </div>
    </form>
  );
}
