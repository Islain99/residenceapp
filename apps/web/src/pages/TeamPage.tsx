// Équipe (responsable) : inviter un employé, renvoyer l'invitation,
// changer le rôle, désactiver / réactiver.
import { useState, type FormEvent } from 'react';
import { useAccounts, useInviteAccount, useResendInvite, useUpdateAccount } from '../api/hooks';
import type { Account, AccountInput } from '../api/types';
import { ROLE_LABELS, useUser } from '../auth/session';
import { Badge, Button, Dialog, EmptyState, ErrorMessage, Loading, PageHeader, SelectField, TextField } from '../components/ui';
import { formatWhen, fullName } from '../lib/format';

const ROLES: AccountInput['role'][] = ['prepose', 'infirmiere', 'responsable'];

const STATUS = {
  invited: { label: 'Invitation envoyée', tone: 'priority' },
  active: { label: 'Actif', tone: 'positive' },
  inactive: { label: 'Désactivé', tone: 'neutral' },
} as const;

export function TeamPage() {
  const accounts = useAccounts();
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Équipe"
        subtitle="Chaque employé reçoit une invitation par courriel et choisit lui-même son mot de passe."
        actions={<Button variant="primary" onClick={() => setInviting(true)}>+ Inviter un employé</Button>}
      />
      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}

      {accounts.isPending ? <Loading /> : accounts.isError ? <ErrorMessage error={accounts.error} /> :
        accounts.data.length === 0 ? <EmptyState>Aucun employé.</EmptyState> : (
          <ul className="flex flex-col gap-3">
            {accounts.data.map((a) => <AccountRow key={a.id} account={a} onNotice={setNotice} />)}
          </ul>
        )}

      <Dialog open={inviting} onClose={() => setInviting(false)} title="Inviter un employé">
        <InviteForm onDone={(email) => {
          setInviting(false);
          if (email) setNotice(`Invitation envoyée à ${email}. Le lien est valable 72 heures.`);
        }} />
      </Dialog>
    </>
  );
}

function AccountRow({ account, onNotice }: { account: Account; onNotice: (message: string) => void }) {
  const me = useUser();
  const resend = useResendInvite();
  const update = useUpdateAccount();
  const self = account.id === me.id;
  const [openedAt] = useState(() => Date.now());
  const status = STATUS[account.status];

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {fullName(account)}{self && <span className="text-sm font-normal text-muted">(vous)</span>}
            <Badge tone={status.tone}>{status.label}</Badge>
          </p>
          <p className="truncate text-sm text-muted">{account.email}</p>
          <p className="text-xs text-muted">
            {account.status === 'invited'
              ? account.invitationExpiresAt && Date.parse(account.invitationExpiresAt) > openedAt
                ? `Invitation valable jusqu'à ${formatWhen(account.invitationExpiresAt)}`
                : 'Invitation expirée : la renvoyer'
              : account.lastLoginAt ? `Dernière connexion ${formatWhen(account.lastLoginAt)}` : 'Jamais connecté'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`Rôle de ${fullName(account)}`}
            value={account.role}
            disabled={self || update.isPending || !account.isActive}
            onChange={(e) => update.mutate({ id: account.id, role: e.target.value as AccountInput['role'] })}
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm disabled:opacity-60"
          >
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          {account.status === 'invited' && (
            <Button busy={resend.isPending} onClick={() => resend.mutate(account.id, {
              onSuccess: () => onNotice(`Nouvelle invitation envoyée à ${account.email}.`),
            })}>Renvoyer l'invitation</Button>
          )}
          {!self && (account.isActive ? (
            <Button variant="ghost" className="text-danger" busy={update.isPending}
              onClick={() => {
                if (window.confirm(`Désactiver le compte de ${fullName(account)} ? Ses sessions seront fermées immédiatement.`)) {
                  update.mutate({ id: account.id, isActive: false });
                }
              }}>Désactiver</Button>
          ) : (
            <Button busy={update.isPending} onClick={() => update.mutate({ id: account.id, isActive: true })}>Réactiver</Button>
          ))}
        </div>
      </div>
      <ErrorMessage error={resend.error ?? update.error} />
    </li>
  );
}

function InviteForm({ onDone }: { onDone: (email?: string) => void }) {
  const invite = useInviteAccount();
  const [v, setV] = useState<AccountInput>({ email: '', firstName: '', lastName: '', role: 'prepose' });
  const set = (key: keyof AccountInput) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const created = await invite.mutateAsync(v);
    onDone(created.email);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Prénom" required maxLength={100} value={v.firstName} onChange={set('firstName')} />
        <TextField label="Nom" required maxLength={100} value={v.lastName} onChange={set('lastName')} />
      </div>
      <TextField label="Courriel" type="email" required maxLength={254} value={v.email} onChange={set('email')}
        hint="L'invitation y sera envoyée. C'est aussi l'identifiant de connexion." />
      <SelectField label="Rôle" value={v.role} onChange={set('role')}>
        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </SelectField>
      <ErrorMessage error={invite.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone()}>Annuler</Button>
        <Button type="submit" variant="primary" busy={invite.isPending}>Envoyer l'invitation</Button>
      </div>
    </form>
  );
}
