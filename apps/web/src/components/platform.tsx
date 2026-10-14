// Éléments partagés des pages de la plateforme.
import { useState } from 'react';
import { usePlatformAccountAction, useSetPlatformAccountActive, type PlatformAccountAction } from '../api/hooks';
import type { PlatformAccount } from '../api/types';
import { useUser } from '../auth/session';
import { formatWhen, fullName } from '../lib/format';
import { Badge, Button, ErrorMessage } from './ui';

const STATUS = {
  invited: { label: 'Invitation envoyée', tone: 'priority' },
  active: { label: 'Actif', tone: 'positive' },
  inactive: { label: 'Désactivé', tone: 'neutral' },
} as const;

const DONE: Record<PlatformAccountAction, (a: PlatformAccount) => string> = {
  invite: (a) => `Nouvelle invitation envoyée à ${a.email}.`,
  'reset-password': (a) => `Lien de réinitialisation envoyé à ${a.email} (valable 1 heure).`,
  unlock: (a) => `Compte de ${fullName(a)} débloqué.`,
  'revoke-sessions': (a) => `Toutes les sessions de ${fullName(a)} sont fermées.`,
  'reset-mfa': (a) => `Double authentification réinitialisée : ${fullName(a)} la reconfigurera à sa prochaine connexion.`,
};

// Compte géré par la plateforme (responsable ou administrateur)
export function PlatformAccountRow({ account, onNotice }: { account: PlatformAccount; onNotice: (message: string) => void }) {
  const me = useUser();
  const action = usePlatformAccountAction();
  const setActive = useSetPlatformAccountActive();
  const self = account.id === me.id;
  const [now] = useState(() => Date.now());
  const status = STATUS[account.status];
  const run = (kind: PlatformAccountAction) =>
    action.mutate({ id: account.id, action: kind }, { onSuccess: () => onNotice(DONE[kind](account)) });

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {fullName(account)}{self && <span className="text-sm font-normal text-muted">(vous)</span>}
            <Badge tone={status.tone}>{status.label}</Badge>
            {account.lockedUntil && <Badge tone="danger">Bloqué jusqu’à {formatWhen(account.lockedUntil)}</Badge>}
            {account.status === 'active' && (account.mfaEnabled
              ? <Badge tone="info">Double authentification</Badge>
              : <Badge tone="priority">Double authentification à configurer</Badge>)}
          </p>
          <p className="truncate text-sm text-muted">{account.email}</p>
          <p className="text-xs text-muted">
            {account.status === 'invited'
              ? account.invitationExpiresAt && Date.parse(account.invitationExpiresAt) > now
                ? `Invitation valable jusqu’à ${formatWhen(account.invitationExpiresAt)}`
                : 'Invitation expirée : la renvoyer'
              : account.lastLoginAt ? `Dernière connexion ${formatWhen(account.lastLoginAt)}` : 'Jamais connecté'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {account.lockedUntil && <Button busy={action.isPending} onClick={() => run('unlock')}>Débloquer</Button>}
          {account.status === 'invited' && <Button busy={action.isPending} onClick={() => run('invite')}>Renvoyer l’invitation</Button>}
          {account.status === 'active' && (
            <Button busy={action.isPending} onClick={() => run('reset-password')}>Envoyer un lien de mot de passe</Button>
          )}
          {account.mfaEnabled && !self && (
            <Button variant="ghost" busy={action.isPending} onClick={() => {
              if (window.confirm(`Réinitialiser la double authentification de ${fullName(account)} (téléphone perdu, codes de secours perdus) ? Ses sessions seront fermées ; elle la reconfigurera à sa prochaine connexion.`)) run('reset-mfa');
            }}>Réinitialiser la double authentification</Button>
          )}
          {account.status === 'active' && !self && (
            <Button variant="ghost" busy={action.isPending} onClick={() => {
              if (window.confirm(`Fermer toutes les sessions de ${fullName(account)} ? Il devra se reconnecter sur chaque appareil.`)) run('revoke-sessions');
            }}>Fermer ses sessions</Button>
          )}
          {!self && (account.status === 'inactive' ? (
            <Button busy={setActive.isPending} onClick={() => setActive.mutate({ id: account.id, isActive: true })}>Réactiver</Button>
          ) : (
            <Button variant="ghost" className="text-danger" busy={setActive.isPending} onClick={() => {
              if (window.confirm(`Désactiver le compte de ${fullName(account)} ? Ses sessions seront fermées immédiatement.`)) {
                setActive.mutate({ id: account.id, isActive: false });
              }
            }}>Désactiver</Button>
          ))}
        </div>
      </div>
      <ErrorMessage error={action.error ?? setActive.error} />
    </li>
  );
}

export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'danger' }) {
  return (
    <div className={tone === 'danger' ? 'rounded-xl border border-danger bg-danger-soft p-4 text-danger' : 'rounded-xl border border-line bg-surface p-4'}>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className={tone === 'danger' ? 'text-sm' : 'text-sm text-muted'}>{label}</p>
    </div>
  );
}
