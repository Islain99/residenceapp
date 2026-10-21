// Équipe (responsable) : inviter un employé, renvoyer l'invitation,
// changer le rôle, désactiver / réactiver.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccounts, useInviteAccount, useResendInvite, useUpdateAccount } from '../api/hooks';
import type { Account, AccountInput } from '../api/types';
import { useUser } from '../auth/session';
import { currentLanguage, LANGS } from '../i18n';
import { Avatar } from '../components/Avatar';
import { Badge, Button, Dialog, EmptyState, ErrorMessage, Loading, PageHeader, SelectField, TextField } from '../components/ui';
import { formatWhen, fullName } from '../lib/format';

const ROLES: AccountInput['role'][] = ['prepose', 'infirmiere', 'responsable'];

const STATUS_TONE = { invited: 'priority', active: 'positive', inactive: 'neutral' } as const;

export function TeamPage() {
  const { t } = useTranslation();
  const accounts = useAccounts();
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title={t('admin.team.title')}
        subtitle={t('admin.team.subtitle')}
        actions={<Button data-tour="team-invite" variant="primary" onClick={() => setInviting(true)}>{t('admin.team.invite')}</Button>}
      />
      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}

      {accounts.isPending ? <Loading /> : accounts.isError ? <ErrorMessage error={accounts.error} /> :
        accounts.data.length === 0 ? <EmptyState>{t('admin.team.empty')}</EmptyState> : (
          <ul className="flex flex-col gap-3">
            {accounts.data.map((a) => <AccountRow key={a.id} account={a} onNotice={setNotice} />)}
          </ul>
        )}

      <Dialog open={inviting} onClose={() => setInviting(false)} title={t('admin.team.inviteTitle')}>
        <InviteForm onDone={(email) => {
          setInviting(false);
          if (email) setNotice(t('admin.team.invited', { email }));
        }} />
      </Dialog>
    </>
  );
}

function AccountRow({ account, onNotice }: { account: Account; onNotice: (message: string) => void }) {
  const { t } = useTranslation();
  const me = useUser();
  const resend = useResendInvite();
  const update = useUpdateAccount();
  const self = account.id === me.id;
  const [openedAt] = useState(() => Date.now());
  const tone = STATUS_TONE[account.status];

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar person={account} className="mt-0.5" />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              {fullName(account)}{self && <span className="text-sm font-normal text-muted">{t('common.you')}</span>}
              <Badge tone={tone}>{t(`admin.team.status.${account.status}`)}</Badge>
            </p>
            <p className="truncate text-sm text-muted">
              {account.email}
              {/* Téléphone saisi par l'employé dans son profil : un toucher pour appeler */}
              {account.phone && <> · <a href={`tel:${account.phone.replace(/[^\d+]/g, '')}`} className="text-primary hover:underline">{account.phone}</a></>}
            </p>
            <p className="text-xs text-muted">
              {account.status === 'invited'
                ? account.invitationExpiresAt && Date.parse(account.invitationExpiresAt) > openedAt
                  ? t('admin.team.validUntil', { when: formatWhen(account.invitationExpiresAt) })
                  : t('admin.team.expired')
                : account.lastLoginAt ? t('admin.team.lastLogin', { when: formatWhen(account.lastLoginAt) }) : t('admin.team.neverLoggedIn')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t('admin.team.roleOf', { name: fullName(account) })}
            value={account.role}
            disabled={self || update.isPending || !account.isActive}
            onChange={(e) => update.mutate({ id: account.id, role: e.target.value as AccountInput['role'] })}
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm disabled:opacity-60"
          >
            {ROLES.map((r) => <option key={r} value={r}>{t(`common.roles.${r}`)}</option>)}
          </select>
          {account.status === 'invited' && (
            <Button busy={resend.isPending} onClick={() => resend.mutate(account.id, {
              onSuccess: () => onNotice(t('admin.team.resent', { email: account.email })),
            })}>{t('admin.team.resend')}</Button>
          )}
          {!self && (account.isActive ? (
            <Button variant="ghost" className="text-danger" busy={update.isPending}
              onClick={() => {
                if (window.confirm(t('admin.team.deactivateConfirm', { name: fullName(account) }))) {
                  update.mutate({ id: account.id, isActive: false });
                }
              }}>{t('admin.team.deactivate')}</Button>
          ) : (
            <Button busy={update.isPending} onClick={() => update.mutate({ id: account.id, isActive: true })}>{t('admin.team.reactivate')}</Button>
          ))}
        </div>
      </div>
      <ErrorMessage error={resend.error ?? update.error} />
    </li>
  );
}

function InviteForm({ onDone }: { onDone: (email?: string) => void }) {
  const { t } = useTranslation();
  const invite = useInviteAccount();
  // Langue de l'invitation : celle de l'interface de la responsable, modifiable
  const [v, setV] = useState<AccountInput>({ email: '', firstName: '', lastName: '', role: 'prepose', locale: currentLanguage() });
  const set = (key: keyof AccountInput) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const created = await invite.mutateAsync(v);
    onDone(created.email);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('common.firstName')} required maxLength={100} value={v.firstName} onChange={set('firstName')} />
        <TextField label={t('common.lastName')} required maxLength={100} value={v.lastName} onChange={set('lastName')} />
      </div>
      <TextField label={t('common.email')} type="email" required maxLength={254} value={v.email} onChange={set('email')}
        hint={t('admin.team.emailHint')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t('common.role')} value={v.role} onChange={set('role')}>
          {ROLES.map((r) => <option key={r} value={r}>{t(`common.roles.${r}`)}</option>)}
        </SelectField>
        <SelectField label={t('admin.team.language')} value={v.locale} onChange={set('locale')}>
          {LANGS.map((l) => <option key={l} value={l}>{t(`common.language.${l}`)}</option>)}
        </SelectField>
      </div>
      <ErrorMessage error={invite.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone()}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" busy={invite.isPending}>{t('admin.team.send')}</Button>
      </div>
    </form>
  );
}
