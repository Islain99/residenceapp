// Plateforme — sécurité : comptes bloqués, refus de connexion, événements suspects.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePlatformAccountAction, usePlatformEmail, usePlatformSecurity, useSendTestEmail } from '../../api/hooks';
import { useUser } from '../../auth/session';
import { Button, Card, EmptyState, ErrorMessage, Loading, PageHeader, TextField } from '../../components/ui';
import { formatFull, formatWhen, fullName } from '../../lib/format';

const EVENTS = ['refresh_reuse', 'login_failed'] as const;   // textes : i18n, platform.security.eventTypes

export function PlatformSecurityPage() {
  const { t } = useTranslation();
  const security = usePlatformSecurity();
  const unlock = usePlatformAccountAction();
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={t('platform.security.title')} subtitle={t('platform.security.subtitle')} />
      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}

      <EmailCheck />

      {security.isPending ? <Loading /> : security.isError ? <ErrorMessage error={security.error} /> : (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 text-lg font-semibold">{t('platform.security.locked')}</h2>
            {security.data.locked.length === 0 ? <EmptyState>{t('platform.security.noLocked')}</EmptyState> : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {security.data.locked.map((u) => (
                  <li key={u.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
                    <span className="flex-1">
                      <strong>{fullName(u)}</strong> · {t(`common.roles.${u.role}`)} · {u.residence?.name ?? t('platform.security.platform')}
                      <span className="block text-muted">{u.email} · {t('platform.security.lockedUntil', { when: formatWhen(u.lockedUntil) })}</span>
                    </span>
                    <Button busy={unlock.isPending} onClick={() => unlock.mutate({ id: u.id, action: 'unlock' }, {
                      onSuccess: () => setNotice(t('platform.security.unlocked', { name: fullName(u) })),
                    })}>{t('platform.account.unlock')}</Button>
                  </li>
                ))}
              </ul>
            )}
            <ErrorMessage error={unlock.error} />
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">{t('platform.security.failed')}</h2>
            {security.data.failedLogins24h.length === 0 ? <EmptyState>{t('platform.security.none')}</EmptyState> : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {security.data.failedLogins24h.map((f) => (
                  <li key={f.residence?.id ?? 'none'} className="flex items-center justify-between px-4 py-3 text-sm">
                    {f.residence
                      ? <Link to={`/plateforme/residences/${f.residence.id}`} className="text-primary hover:underline">{f.residence.name}</Link>
                      : <span>{t('platform.security.unknownOrAdmins')}</span>}
                    <strong className="tabular-nums">{f.count}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">{t('platform.security.events')}</h2>
            {security.data.events.length === 0 ? <EmptyState>{t('platform.security.nothing')}</EmptyState> : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {security.data.events.map((e) => (
                  <li key={e.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:gap-4">
                    <time dateTime={e.at} className="shrink-0 text-xs text-muted sm:w-44">{formatFull(e.at)}</time>
                    <span className="flex-1">
                      <strong>{e.user ? fullName(e.user) : t('platform.security.unknownAccount')}</strong>
                      {e.residence && <> · {e.residence.name}</>}
                      <span className="block text-muted">
                        {(EVENTS as readonly string[]).includes(e.action) ? t(`platform.security.eventTypes.${e.action as (typeof EVENTS)[number]}`) : e.action}
                        {e.ip && t('platform.security.address', { ip: e.ip })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}

const PROVIDERS: Record<string, string> = { resend: 'Resend (API)', brevo: 'Brevo (API)', smtp: 'SMTP' };

// Envoi des courriels : fournisseur configuré et courriel d'essai
function EmailCheck() {
  const { t } = useTranslation();
  const email = usePlatformEmail();
  const test = useSendTestEmail();
  const me = useUser();
  const [to, setTo] = useState(me.email);
  if (!email.data) return null;
  const resendTest = email.data.provider === 'resend' && email.data.from.includes('@resend.dev');
  return (
    <Card className="mb-8 p-4">
      <h2 className="text-lg font-semibold">{t('platform.security.email')}</h2>
      <p className="text-sm text-muted">
        {t('platform.security.emailInfo', { provider: PROVIDERS[email.data.provider] ?? email.data.provider, from: email.data.from })}
      </p>
      {resendTest && (
        <p className="mt-2 rounded-lg bg-priority-soft px-3 py-2 text-sm text-priority">
          {t('platform.security.resendTest')}
        </p>
      )}
      <form className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); test.mutate(to.trim()); }}>
        <div className="flex-1">
          <TextField label={t('platform.security.testTo')} type="email" required maxLength={254} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button type="submit" busy={test.isPending}>{t('platform.security.sendTest')}</Button>
      </form>
      {test.isSuccess && (
        <p role="status" className="mt-3 rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive">
          {t('platform.security.testSent', { to: test.data.to })}
        </p>
      )}
      <div className="mt-3"><ErrorMessage error={test.error} /></div>
    </Card>
  );
}
