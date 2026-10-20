// Accès d'assistance (responsable) : permettre à l'administrateur de la
// plateforme de CONSULTER la résidence pour régler un problème, pour une
// durée limitée. Lecture seule, messagerie exclue, chaque page consultée
// inscrite au journal d'audit. Retirable à tout moment.
import { useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAssistanceGrants, useGrantAssistance, useRevokeAssistance } from '../api/hooks';
import type { AssistanceGrant } from '../api/types';
import { useAuth } from '../auth/session';
import { Badge, Button, Card, EmptyState, ErrorMessage, Loading, PageHeader, SelectField, TextArea } from '../components/ui';
import { formatWhen, fullName } from '../lib/format';

const DURATIONS = [1, 4, 24, 72] as const;
const STATUS_TONE = { active: 'priority', expired: 'neutral', revoked: 'neutral' } as const;

export function AssistancePage() {
  const { t } = useTranslation();
  const grants = useAssistanceGrants();
  const { assistance } = useAuth();
  const active = grants.data?.find((g) => g.status === 'active');

  return (
    <>
      <PageHeader
        title={t('admin.assistance.title')}
        subtitle={t('admin.assistance.subtitle')}
      />

      <Card className="mb-6 p-4 text-sm">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-muted">
          <li><Trans i18nKey="admin.assistance.rule1" components={{ strong: <strong className="text-ink" /> }} /></li>
          <li><Trans i18nKey="admin.assistance.rule2" components={{ strong: <strong className="text-ink" /> }} /></li>
          <li>{t('admin.assistance.rule3')}</li>
          <li><Trans i18nKey="admin.assistance.rule4" components={{ auditLink: <Link to="../audit?type=assistance" className="text-primary underline" /> }} /></li>
          <li>{t('admin.assistance.rule5')}</li>
        </ul>
      </Card>

      {grants.isPending ? <Loading /> : grants.isError ? <ErrorMessage error={grants.error} /> : (
        <>
          {active ? <ActiveGrant grant={active} readOnly={!!assistance} />
            : !assistance && <GrantForm />}

          <h2 className="mb-3 mt-8 text-lg font-semibold">{t('admin.assistance.history')}</h2>
          {grants.data.length === 0 ? <EmptyState>{t('admin.assistance.noHistory')}</EmptyState> : (
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
  const { t } = useTranslation();
  const revoke = useRevokeAssistance();
  return (
    <Card className="border-priority p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-semibold">{t('admin.assistance.open')} <Badge tone="priority">{t('admin.assistance.status.active')}</Badge></p>
          <p className="text-sm text-muted">
            {t('admin.assistance.until', { when: formatWhen(grant.expiresAt), name: fullName(grant.grantedBy), pages: t('admin.assistance.pages', { count: grant.views }) })}
          </p>
          {grant.reason && <p className="mt-1 text-sm">{t('admin.assistance.reason', { reason: grant.reason })}</p>}
        </div>
        {!readOnly && (
          <Button variant="danger" busy={revoke.isPending} onClick={() => revoke.mutate(grant.id)}>
            {t('admin.assistance.revokeNow')}
          </Button>
        )}
      </div>
      <ErrorMessage error={revoke.error} />
    </Card>
  );
}

function GrantForm() {
  const { t } = useTranslation();
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
        <h2 className="font-semibold">{t('admin.assistance.grantTitle')}</h2>
        <div className="max-w-xs">
          <SelectField label={t('admin.assistance.duration')} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {DURATIONS.map((h) => <option key={h} value={h}>{t(`admin.assistance.durations.h${h}`)}</option>)}
          </SelectField>
        </div>
        <TextArea label={t('admin.assistance.reasonOptional')} rows={2} maxLength={500} value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint={t('admin.assistance.reasonHint')} />
        <ErrorMessage error={grant.error} />
        <div><Button type="submit" variant="primary" busy={grant.isPending}>{t('admin.assistance.grant')}</Button></div>
      </form>
    </Card>
  );
}

function GrantRow({ grant }: { grant: AssistanceGrant }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
      <span className="shrink-0 sm:w-44 text-xs text-muted">{formatWhen(grant.grantedAt)}</span>
      <span className="flex-1">
        {t('admin.assistance.grantedBy', { name: fullName(grant.grantedBy) })}
        {grant.revokedBy && t('admin.assistance.revokedBy', { name: fullName(grant.revokedBy), when: grant.revokedAt ? formatWhen(grant.revokedAt) : '' })}
        {grant.status === 'expired' && t('admin.assistance.closedAt', { when: formatWhen(grant.expiresAt) })}
        {grant.reason && <span className="block text-muted">{t('admin.assistance.reason', { reason: grant.reason })}</span>}
      </span>
      <span className="text-xs text-muted">{t('admin.assistance.pages', { count: grant.views })}</span>
      <Badge tone={STATUS_TONE[grant.status]}>{t(`admin.assistance.status.${grant.status}`)}</Badge>
    </li>
  );
}

