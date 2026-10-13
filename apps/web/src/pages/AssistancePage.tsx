// Accès d'assistance (responsable) : permettre à l'administrateur de la
// plateforme de CONSULTER la résidence pour régler un problème, pour une
// durée limitée. Lecture seule, messagerie exclue, chaque page consultée
// inscrite au journal d'audit. Retirable à tout moment.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAssistanceGrants, useGrantAssistance, useRevokeAssistance } from '../api/hooks';
import type { AssistanceGrant } from '../api/types';
import { useAuth } from '../auth/session';
import { Badge, Button, Card, EmptyState, ErrorMessage, Loading, PageHeader, SelectField, TextArea } from '../components/ui';
import { formatWhen, fullName } from '../lib/format';

const DURATIONS = [
  { hours: 1, label: '1 heure' },
  { hours: 4, label: '4 heures' },
  { hours: 24, label: '24 heures' },
  { hours: 72, label: '3 jours' },
];

const STATUS = {
  active: { label: 'En cours', tone: 'priority' },
  expired: { label: 'Terminé', tone: 'neutral' },
  revoked: { label: 'Retiré', tone: 'neutral' },
} as const;

export function AssistancePage() {
  const grants = useAssistanceGrants();
  const { assistance } = useAuth();
  const active = grants.data?.find((g) => g.status === 'active');

  return (
    <>
      <PageHeader
        title="Accès d’assistance"
        subtitle="Permettre à l’équipe de la plateforme de consulter la résidence pour régler un problème."
      />

      <Card className="mb-6 p-4 text-sm">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-muted">
          <li>Sans votre accord, l’équipe de la plateforme ne voit <strong className="text-ink">aucune</strong> donnée de la résidence : seulement des chiffres (nombre d’employés, de résidents…).</li>
          <li>Pendant l’accès, elle peut <strong className="text-ink">consulter</strong> les pages comme vous les voyez, mais <strong className="text-ink">rien modifier</strong>.</li>
          <li>La messagerie et l’export des dossiers restent fermés.</li>
          <li>Chaque page consultée est inscrite au <Link to="../audit?type=assistance" className="text-primary underline">journal d’audit</Link>.</li>
          <li>Vous pouvez retirer l’accès à tout moment ; il se ferme seul à la fin de la durée choisie.</li>
        </ul>
      </Card>

      {grants.isPending ? <Loading /> : grants.isError ? <ErrorMessage error={grants.error} /> : (
        <>
          {active ? <ActiveGrant grant={active} readOnly={!!assistance} />
            : !assistance && <GrantForm />}

          <h2 className="mb-3 mt-8 text-lg font-semibold">Historique</h2>
          {grants.data.length === 0 ? <EmptyState>Aucun accès accordé jusqu’ici.</EmptyState> : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {grants.data.map((g) => <GrantRow key={g.id} grant={g} />)}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function ActiveGrant({ grant, readOnly }: { grant: AssistanceGrant; readOnly: boolean }) {
  const revoke = useRevokeAssistance();
  return (
    <Card className="border-priority p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-semibold">Accès ouvert <Badge tone="priority">En cours</Badge></p>
          <p className="text-sm text-muted">
            Jusqu’à {formatWhen(grant.expiresAt)} · accordé par {fullName(grant.grantedBy)} · {pages(grant.views)}
          </p>
          {grant.reason && <p className="mt-1 text-sm">Motif : {grant.reason}</p>}
        </div>
        {!readOnly && (
          <Button variant="danger" busy={revoke.isPending} onClick={() => revoke.mutate(grant.id)}>
            Retirer l’accès maintenant
          </Button>
        )}
      </div>
      <ErrorMessage error={revoke.error} />
    </Card>
  );
}

function GrantForm() {
  const grant = useGrantAssistance();
  const [hours, setHours] = useState(1);
  const [reason, setReason] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    grant.mutate({ hours, reason: reason.trim() || undefined }, { onSuccess: () => setReason('') });
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="font-semibold">Accorder un accès</h2>
        <div className="max-w-xs">
          <SelectField label="Durée" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {DURATIONS.map((d) => <option key={d.hours} value={d.hours}>{d.label}</option>)}
          </SelectField>
        </div>
        <TextArea label="Motif (facultatif)" rows={2} maxLength={500} value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Par exemple : « La relève ne s’affiche pas sur la tablette du poste. »" />
        <ErrorMessage error={grant.error} />
        <div><Button type="submit" variant="primary" busy={grant.isPending}>Accorder l’accès</Button></div>
      </form>
    </Card>
  );
}

function GrantRow({ grant }: { grant: AssistanceGrant }) {
  const status = STATUS[grant.status];
  return (
    <li className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
      <span className="shrink-0 sm:w-44 text-xs text-muted">{formatWhen(grant.grantedAt)}</span>
      <span className="flex-1">
        Accordé par {fullName(grant.grantedBy)}
        {grant.revokedBy && <> · retiré par {fullName(grant.revokedBy)} {grant.revokedAt && formatWhen(grant.revokedAt)}</>}
        {grant.status === 'expired' && <> · fermé {formatWhen(grant.expiresAt)}</>}
        {grant.reason && <span className="block text-muted">Motif : {grant.reason}</span>}
      </span>
      <span className="text-xs text-muted">{pages(grant.views)}</span>
      <Badge tone={status.tone}>{status.label}</Badge>
    </li>
  );
}

const pages = (n: number) => (n === 0 ? 'aucune page consultée' : n === 1 ? '1 page consultée' : `${n} pages consultées`);
