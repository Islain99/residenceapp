// Éléments partagés des pages de la plateforme.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlatformAccountAction, useSetPlatformAccountActive, type PlatformAccountAction } from '../api/hooks';
import type { PlatformAccount } from '../api/types';
import { useUser } from '../auth/session';
import { formatWhen, fullName } from '../lib/format';
import { Badge, Button, ErrorMessage } from './ui';

const STATUS_TONE = { invited: 'priority', active: 'positive', inactive: 'neutral' } as const;

// Message après une action (textes : i18n, platform.account.done)
const DONE_KEY = {
  invite: 'invite', 'reset-password': 'resetPassword', unlock: 'unlock', 'revoke-sessions': 'revokeSessions', 'reset-mfa': 'resetMfa',
} as const satisfies Record<PlatformAccountAction, string>;

// Compte géré par la plateforme (responsable ou administrateur)
export function PlatformAccountRow({ account, onNotice }: { account: PlatformAccount; onNotice: (message: string) => void }) {
  const { t } = useTranslation();
  const me = useUser();
  const action = usePlatformAccountAction();
  const setActive = useSetPlatformAccountActive();
  const self = account.id === me.id;
  const [now] = useState(() => Date.now());
  const run = (kind: PlatformAccountAction) =>
    action.mutate({ id: account.id, action: kind }, {
      onSuccess: () => onNotice(t(`platform.account.done.${DONE_KEY[kind]}`, { email: account.email, name: fullName(account) })),
    });

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {fullName(account)}{self && <span className="text-sm font-normal text-muted">{t('common.you')}</span>}
            <Badge tone={STATUS_TONE[account.status]}>{t(`admin.team.status.${account.status}`)}</Badge>
            {account.lockedUntil && <Badge tone="danger">{t('platform.account.lockedUntil', { when: formatWhen(account.lockedUntil) })}</Badge>}
            {account.status === 'active' && (account.mfaEnabled
              ? <Badge tone="info">{t('platform.account.mfaOn')}</Badge>
              : <Badge tone="priority">{t('platform.account.mfaToSetUp')}</Badge>)}
          </p>
          <p className="truncate text-sm text-muted">{account.email}</p>
          <p className="text-xs text-muted">
            {account.status === 'invited'
              ? account.invitationExpiresAt && Date.parse(account.invitationExpiresAt) > now
                ? t('admin.team.validUntil', { when: formatWhen(account.invitationExpiresAt) })
                : t('admin.team.expired')
              : account.lastLoginAt ? t('admin.team.lastLogin', { when: formatWhen(account.lastLoginAt) }) : t('admin.team.neverLoggedIn')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {account.lockedUntil && <Button busy={action.isPending} onClick={() => run('unlock')}>{t('platform.account.unlock')}</Button>}
          {account.status === 'invited' && <Button busy={action.isPending} onClick={() => run('invite')}>{t('platform.account.resend')}</Button>}
          {account.status === 'active' && (
            <Button busy={action.isPending} onClick={() => run('reset-password')}>{t('platform.account.resetLink')}</Button>
          )}
          {account.mfaEnabled && !self && (
            <Button variant="ghost" busy={action.isPending} onClick={() => {
              if (window.confirm(t('platform.account.resetMfaConfirm', { name: fullName(account) }))) run('reset-mfa');
            }}>{t('platform.account.resetMfa')}</Button>
          )}
          {account.status === 'active' && !self && (
            <Button variant="ghost" busy={action.isPending} onClick={() => {
              if (window.confirm(t('platform.account.revokeConfirm', { name: fullName(account) }))) run('revoke-sessions');
            }}>{t('platform.account.revoke')}</Button>
          )}
          {!self && (account.status === 'inactive' ? (
            <Button busy={setActive.isPending} onClick={() => setActive.mutate({ id: account.id, isActive: true })}>{t('admin.team.reactivate')}</Button>
          ) : (
            <Button variant="ghost" className="text-danger" busy={setActive.isPending} onClick={() => {
              if (window.confirm(t('admin.team.deactivateConfirm', { name: fullName(account) }))) {
                setActive.mutate({ id: account.id, isActive: false });
              }
            }}>{t('admin.team.deactivate')}</Button>
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
