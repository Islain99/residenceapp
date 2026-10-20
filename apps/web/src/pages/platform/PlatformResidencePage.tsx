// Plateforme — une résidence : informations, suspension, responsables,
// accès d'assistance. Aucun contenu de la résidence ici.
import { useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAddResponsable, usePlatformResidence, useUpdateResidence } from '../../api/hooks';
import type { PlatformResidence, PlatformResidenceDetail } from '../../api/types';
import { currentLanguage, LANGS } from '../../i18n';
import { PlatformAccountRow, Stat } from '../../components/platform';
import {
  Badge, Button, Card, Dialog, EmptyState, ErrorMessage, Loading, PageHeader, SelectField, TextArea, TextField,
} from '../../components/ui';
import { formatFull, formatWhen, fullName } from '../../lib/format';
import { RESIDENCE_TYPES, TIMEZONES, timezoneLabel, useEnterAssistance } from '../../lib/platform';

export function PlatformResidencePage() {
  const { t } = useTranslation();
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
      <Link to="/plateforme" className="mb-3 inline-block text-sm text-primary hover:underline">{t('platform.residence.back')}</Link>
      <PageHeader
        title={r.name}
        subtitle={t('platform.residence.subtitle', { type: t(`platform.types.${r.type}`), timezone: timezoneLabel(r.timezone), date: formatFull(r.createdAt) })}
        actions={<>
          <Button onClick={() => setEditing(true)}>{t('common.edit')}</Button>
          {r.isActive
            ? <Button variant="ghost" className="text-danger" onClick={() => setSuspending(true)}>{t('platform.residence.suspend')}</Button>
            : <Button variant="primary" busy={update.isPending} onClick={() => update.mutate({ id: r.id, isActive: true }, {
              onSuccess: () => setNotice(t('platform.residence.reactivated')),
            })}>{t('platform.residence.reactivate')}</Button>}
        </>}
      />
      {!r.isActive && (
        <p className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          {t('platform.residence.suspendedNotice')}
        </p>
      )}
      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}
      <ErrorMessage error={update.error} />

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('platform.stats.staff')} value={r.staffActive} />
        <Stat label={t('platform.stats.residents')} value={r.residentsActive} />
        <Stat label={t('platform.stats.notes30')} value={r.notesLast30Days} />
        {r.lockedAccounts > 0
          ? <Stat label={t('platform.stats.locked', { count: r.lockedAccounts })} value={r.lockedAccounts} tone="danger" />
          : <Stat label={t('platform.stats.refused24')} value={r.failedLogins24h} />}
      </div>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('platform.residence.responsables')}</h2>
          <Button onClick={() => setAdding(true)}>{t('platform.residence.addResponsable')}</Button>
        </div>
        {r.responsablesActive === 0 && r.isActive && (
          <p className="mb-3 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
            {t('platform.residence.noActiveResponsable')}
          </p>
        )}
        <p className="mb-3 text-sm text-muted">
          {t('platform.residence.responsablesHint')}
        </p>
        {responsables.length === 0 ? <EmptyState>{t('platform.residence.noResponsables')}</EmptyState> : (
          <ul className="flex flex-col gap-3">
            {responsables.map((a) => <PlatformAccountRow key={a.id} account={a} onNotice={setNotice} />)}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">{t('platform.residence.assistance')}</h2>
        <p className="mb-3 text-sm text-muted">
          {t('platform.residence.assistanceHint')}
        </p>
        <AssistanceList grants={assistance} />
      </section>

      <Dialog open={editing} onClose={() => setEditing(false)} title={t('platform.residence.editTitle')}>
        <EditForm residence={r} onDone={() => setEditing(false)} />
      </Dialog>
      <Dialog open={suspending} onClose={() => setSuspending(false)} title={t('platform.residence.suspendTitle')}>
        <SuspendForm residence={r} onDone={(done) => {
          setSuspending(false);
          if (done) setNotice(t('platform.residence.suspendedDone'));
        }} />
      </Dialog>
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('platform.residence.addTitle')}>
        <AddResponsableForm detail={detail.data} onDone={(message) => {
          setAdding(false);
          if (message) setNotice(message);
        }} />
      </Dialog>
    </>
  );
}

function AssistanceList({ grants }: { grants: PlatformResidenceDetail['assistance'] }) {
  const { t } = useTranslation();
  const { enter, busy, error } = useEnterAssistance();
  if (grants.length === 0) return <EmptyState>{t('platform.residence.noGrants')}</EmptyState>;
  return (
    <>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {grants.map((g) => (
          <li key={g.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
            <span className="flex-1">
              {t('platform.residence.grant', { grantedAt: formatWhen(g.grantedAt), name: fullName(g.grantedBy), until: formatWhen(g.expiresAt) })}
              {g.revokedBy && t('platform.residence.revokedBy', { name: fullName(g.revokedBy) })}
              {g.reason && <span className="block text-muted">{t('platform.residence.reason', { reason: g.reason })}</span>}
            </span>
            <span className="text-xs text-muted">{t('platform.residence.views', { count: g.views })}</span>
            {g.status === 'active'
              ? <Button variant="primary" busy={busy} onClick={() => void enter(g.id)}>{t('platform.home.consult')}</Button>
              : <Badge>{g.status === 'revoked' ? t('platform.residence.revoked') : t('platform.residence.ended')}</Badge>}
          </li>
        ))}
      </ul>
      <ErrorMessage error={error} />
    </>
  );
}

function EditForm({ residence, onDone }: { residence: PlatformResidence; onDone: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateResidence();
  const [v, setV] = useState({ name: residence.name, type: residence.type, timezone: residence.timezone });
  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate({ id: residence.id, ...v }, { onSuccess: onDone });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField label={t('platform.home.name')} required maxLength={150} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <SelectField label={t('platform.home.type')} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as PlatformResidence['type'] })}>
        {RESIDENCE_TYPES.map((id) => <option key={id} value={id}>{t(`platform.types.${id}`)}</option>)}
      </SelectField>
      <SelectField label={t('platform.home.timezone')} value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>
        {!(TIMEZONES as string[]).includes(v.timezone) && <option value={v.timezone}>{v.timezone}</option>}
        {TIMEZONES.map((id) => <option key={id} value={id}>{timezoneLabel(id)}</option>)}
      </SelectField>
      <ErrorMessage error={update.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" busy={update.isPending}>{t('common.save')}</Button>
      </div>
    </form>
  );
}

function SuspendForm({ residence, onDone }: { residence: PlatformResidence; onDone: (done: boolean) => void }) {
  const { t } = useTranslation();
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
          <li><Trans i18nKey="platform.residence.suspendRule1" values={{ name: residence.name }} components={{ strong: <strong /> }} /></li>
          <li>{t('platform.residence.suspendRule2')}</li>
          <li>{t('platform.residence.suspendRule3')}</li>
        </ul>
      </Card>
      <TextArea label={t('common.reason')} required minLength={5} maxLength={500} rows={3} value={reason}
        onChange={(e) => setReason(e.target.value)} hint={t('platform.residence.suspendReasonHint')} />
      <ErrorMessage error={update.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone(false)}>{t('common.cancel')}</Button>
        <Button type="submit" variant="danger" busy={update.isPending}>{t('platform.residence.suspendSubmit')}</Button>
      </div>
    </form>
  );
}

function AddResponsableForm({ detail, onDone }: { detail: PlatformResidenceDetail; onDone: (message?: string) => void }) {
  const { t } = useTranslation();
  const add = useAddResponsable();
  const [mode, setMode] = useState<'invite' | 'promote'>('invite');
  const [person, setPerson] = useState({ email: '', firstName: '', lastName: '', locale: currentLanguage() });
  const [userId, setUserId] = useState('');
  const residenceId = detail.residence.id;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'invite') {
      await add.mutateAsync({ residenceId, ...person });
      onDone(t('platform.residence.invitedNotice', { email: person.email }));
    } else {
      const account = await add.mutateAsync({ residenceId, userId });
      onDone(t('platform.residence.promotedNotice', { name: fullName(account) }));
    }
  }

  const set = (key: keyof typeof person) => (e: { target: { value: string } }) => setPerson({ ...person, [key]: e.target.value });

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div role="radiogroup" aria-label={t('platform.residence.addMode')} className="flex gap-1 rounded-lg bg-sunken p-1">
        {([['invite', t('platform.residence.invitePerson')], ['promote', t('platform.residence.promoteEmployee')]] as const).map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={mode === key} onClick={() => setMode(key)}
            className={mode === key ? 'flex-1 rounded-md bg-surface px-3 py-2 text-sm font-medium shadow-sm' : 'flex-1 rounded-md px-3 py-2 text-sm text-muted'}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'invite' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('common.firstName')} required maxLength={100} value={person.firstName} onChange={set('firstName')} />
            <TextField label={t('common.lastName')} required maxLength={100} value={person.lastName} onChange={set('lastName')} />
          </div>
          <TextField label={t('common.email')} type="email" required maxLength={254} value={person.email} onChange={set('email')}
            hint={t('platform.residence.inviteHint')} />
          <SelectField label={t('platform.home.language')} value={person.locale} onChange={set('locale')}>
            {LANGS.map((l) => <option key={l} value={l}>{t(`common.language.${l}`)}</option>)}
          </SelectField>
        </>
      ) : detail.staff.length === 0 ? (
        <EmptyState>{t('platform.residence.noOtherStaff')}</EmptyState>
      ) : (
        <SelectField label={t('platform.residence.employee')} required value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">{t('common.choose')}</option>
          {detail.staff.map((s) => <option key={s.id} value={s.id}>{fullName(s)} — {t(`common.roles.${s.role}`)}</option>)}
        </SelectField>
      )}
      <ErrorMessage error={add.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone()}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" busy={add.isPending} disabled={mode === 'promote' && !userId}>
          {mode === 'invite' ? t('platform.residence.sendInvite') : t('platform.residence.promote')}
        </Button>
      </div>
    </form>
  );
}
