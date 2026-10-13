// Plateforme — tableau de bord : résidences (indicateurs chiffrés seulement),
// accès d'assistance ouverts, création d'une résidence.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useCreateResidence, useOpenAssistance, usePlatformResidences } from '../../api/hooks';
import type { NewResidenceInput, PlatformResidence } from '../../api/types';
import { Stat } from '../../components/platform';
import { Badge, Button, Card, Dialog, EmptyState, ErrorMessage, Loading, PageHeader, SelectField, TextField } from '../../components/ui';
import { formatWhen, fullName } from '../../lib/format';
import { RESIDENCE_TYPES, TIMEZONES, useEnterAssistance } from '../../lib/platform';

export function PlatformHomePage() {
  const residences = usePlatformResidences();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const list = residences.data ?? [];
  const active = list.filter((r) => r.isActive);
  const sum = (key: 'staffActive' | 'residentsActive' | 'lockedAccounts' | 'failedLogins24h') =>
    active.reduce((total, r) => total + r[key], 0);

  return (
    <>
      <PageHeader
        title="Résidences"
        subtitle="Des chiffres seulement : le contenu d’une résidence ne s’ouvre qu’avec l’accord de sa responsable."
        actions={<Button variant="primary" onClick={() => setCreating(true)}>+ Nouvelle résidence</Button>}
      />
      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}

      {residences.isPending ? <Loading /> : residences.isError ? <ErrorMessage error={residences.error} /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={active.length > 1 ? 'résidences actives' : 'résidence active'} value={active.length} />
            <Stat label="employés actifs" value={sum('staffActive')} />
            <Stat label="résidents" value={sum('residentsActive')} />
            {sum('lockedAccounts') > 0
              ? <Stat label={sum('lockedAccounts') > 1 ? 'comptes bloqués' : 'compte bloqué'} value={sum('lockedAccounts')} tone="danger" />
              : <Stat label="connexions refusées (24 h)" value={sum('failedLogins24h')} />}
          </div>

          <OpenAssistance />

          {list.length === 0 ? <EmptyState>Aucune résidence pour l’instant.</EmptyState> : (
            <ul className="flex flex-col gap-3">
              {list.map((r) => <ResidenceCard key={r.id} residence={r} />)}
            </ul>
          )}
        </>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Nouvelle résidence">
        <NewResidenceForm onDone={(message) => {
          setCreating(false);
          if (message) setNotice(message);
        }} />
      </Dialog>
    </>
  );
}

function ResidenceCard({ residence: r }: { residence: PlatformResidence }) {
  const noResponsable = r.isActive && r.responsablesActive === 0;
  return (
    <li>
      <Link to={`/plateforme/residences/${r.id}`} className="block rounded-xl border border-line bg-surface p-4 hover:border-primary">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{r.name}</h2>
          <Badge>{r.type}</Badge>
          {!r.isActive && <Badge tone="danger">Suspendue</Badge>}
          {r.assistanceUntil && <Badge tone="priority">Assistance ouverte jusqu’à {formatWhen(r.assistanceUntil)}</Badge>}
          {noResponsable && <Badge tone="danger">Aucune responsable active</Badge>}
          {r.lockedAccounts > 0 && <Badge tone="danger">{r.lockedAccounts > 1 ? `${r.lockedAccounts} comptes bloqués` : '1 compte bloqué'}</Badge>}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
          <Figure label="Employés" value={r.staffActive} />
          <Figure label="Résidents" value={r.residentsActive} />
          <Figure label="Notes (30 j)" value={r.notesLast30Days} />
          <Figure label="Refus de connexion (24 h)" value={r.failedLogins24h} />
          <div>
            <dt className="text-muted">Dernière connexion</dt>
            <dd className="font-medium">{r.lastLoginAt ? formatWhen(r.lastLoginAt) : 'jamais'}</dd>
          </div>
        </dl>
      </Link>
    </li>
  );
}

const Figure = ({ label, value }: { label: string; value: number }) => (
  <div>
    <dt className="text-muted">{label}</dt>
    <dd className="font-medium tabular-nums">{value}</dd>
  </div>
);

function OpenAssistance() {
  const open = useOpenAssistance();
  const { enter, busy, error } = useEnterAssistance();
  if (!open.data?.length) return null;
  return (
    <Card className="mb-6 border-priority p-4">
      <h2 className="mb-2 font-semibold">Accès d’assistance accordés</h2>
      <ul className="flex flex-col gap-3">
        {open.data.map((g) => (
          <li key={g.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="font-medium">{g.residence.name}</p>
              <p className="text-muted">
                Accordé par {fullName(g.grantedBy)} · jusqu’à {formatWhen(g.expiresAt)}
                {g.reason && <> · « {g.reason} »</>}
              </p>
            </div>
            <Button variant="primary" busy={busy} onClick={() => void enter(g.id)}>Consulter (lecture seule)</Button>
          </li>
        ))}
      </ul>
      <ErrorMessage error={error} />
    </Card>
  );
}

function NewResidenceForm({ onDone }: { onDone: (message?: string) => void }) {
  const create = useCreateResidence();
  const [v, setV] = useState<NewResidenceInput>({
    name: '', type: 'RPA', timezone: 'America/Toronto', responsable: { email: '', firstName: '', lastName: '' },
  });
  const setResp = (key: keyof NewResidenceInput['responsable']) => (e: { target: { value: string } }) =>
    setV({ ...v, responsable: { ...v.responsable, [key]: e.target.value } });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const created = await create.mutateAsync(v);
    onDone(`${created.name} est créée. Invitation envoyée à ${v.responsable.email} (valable 72 heures).`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField label="Nom de la résidence" required maxLength={150} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as NewResidenceInput['type'] })}>
          {Object.entries(RESIDENCE_TYPES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </SelectField>
        <SelectField label="Fuseau horaire" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>
          {TIMEZONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </SelectField>
      </div>
      <fieldset className="flex flex-col gap-4 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold">Responsable</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Prénom" required maxLength={100} value={v.responsable.firstName} onChange={setResp('firstName')} />
          <TextField label="Nom" required maxLength={100} value={v.responsable.lastName} onChange={setResp('lastName')} />
        </div>
        <TextField label="Courriel" type="email" required maxLength={254} value={v.responsable.email} onChange={setResp('email')}
          hint="Elle recevra une invitation et choisira elle-même son mot de passe, puis créera son équipe." />
      </fieldset>
      <p className="text-xs text-muted">
        La résidence est créée avec les catégories de notes, les quarts (jour, soir, nuit) et les canaux de messagerie habituels ;
        la responsable pourra les modifier.
      </p>
      <ErrorMessage error={create.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone()}>Annuler</Button>
        <Button type="submit" variant="primary" busy={create.isPending}>Créer et inviter</Button>
      </div>
    </form>
  );
}
