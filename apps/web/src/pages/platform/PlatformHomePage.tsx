// Plateforme — tableau de bord : résidences (indicateurs chiffrés seulement),
// accès d'assistance ouverts, création d'une résidence.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCreateResidence, useOpenAssistance, usePlatformResidences } from '../../api/hooks';
import type { NewResidenceInput, PlatformResidence } from '../../api/types';
import { Stat } from '../../components/platform';
import { Badge, Button, Card, Dialog, EmptyState, ErrorMessage, Loading, PageHeader, SelectField, TextField } from '../../components/ui';
import { formatWhen, fullName } from '../../lib/format';
import { currentLanguage, LANGS } from '../../i18n';
import { RESIDENCE_TYPES, TIMEZONES, timezoneLabel, useEnterAssistance } from '../../lib/platform';

export function PlatformHomePage() {
  const { t } = useTranslation();
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
        title={t('platform.home.title')}
        subtitle={t('platform.home.subtitle')}
        actions={<Button data-tour="platform-new" variant="primary" onClick={() => setCreating(true)}>{t('platform.home.new')}</Button>}
      />
      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}

      {residences.isPending ? <Loading /> : residences.isError ? <ErrorMessage error={residences.error} /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t('platform.stats.residences', { count: active.length })} value={active.length} />
            <Stat label={t('platform.stats.staff')} value={sum('staffActive')} />
            <Stat label={t('platform.stats.residents')} value={sum('residentsActive')} />
            {sum('lockedAccounts') > 0
              ? <Stat label={t('platform.stats.locked', { count: sum('lockedAccounts') })} value={sum('lockedAccounts')} tone="danger" />
              : <Stat label={t('platform.stats.failed24')} value={sum('failedLogins24h')} />}
          </div>

          <OpenAssistance />

          {list.length === 0 ? <EmptyState>{t('platform.home.empty')}</EmptyState> : (
            <ul className="flex flex-col gap-3">
              {list.map((r) => <ResidenceCard key={r.id} residence={r} />)}
            </ul>
          )}
        </>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title={t('platform.home.newTitle')}>
        <NewResidenceForm onDone={(message) => {
          setCreating(false);
          if (message) setNotice(message);
        }} />
      </Dialog>
    </>
  );
}

function ResidenceCard({ residence: r }: { residence: PlatformResidence }) {
  const { t } = useTranslation();
  const noResponsable = r.isActive && r.responsablesActive === 0;
  return (
    <li>
      <Link to={`/plateforme/residences/${r.id}`} className="block rounded-xl border border-line bg-surface p-4 hover:border-primary">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{r.name}</h2>
          <Badge>{r.type}</Badge>
          {!r.isActive && <Badge tone="danger">{t('platform.home.suspended')}</Badge>}
          {r.formula !== 'complete' && <Badge tone="info">{t('platform.features.formulaBadge', { name: t(`platform.features.formulas.${r.formula}`) })}</Badge>}
          {r.assistanceUntil && <Badge tone="priority">{t('platform.home.assistanceUntil', { when: formatWhen(r.assistanceUntil) })}</Badge>}
          {noResponsable && <Badge tone="danger">{t('platform.home.noResponsable')}</Badge>}
          {r.lockedAccounts > 0 && <Badge tone="danger">{t('platform.home.lockedBadge', { count: r.lockedAccounts })}</Badge>}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
          <Figure label={t('platform.home.staff')} value={r.staffActive} />
          <Figure label={t('platform.home.residents')} value={r.residentsActive} />
          <Figure label={t('platform.home.notes30')} value={r.notesLast30Days} />
          <Figure label={t('platform.home.refused24')} value={r.failedLogins24h} />
          <div>
            <dt className="text-muted">{t('platform.home.lastLogin')}</dt>
            <dd className="font-medium">{r.lastLoginAt ? formatWhen(r.lastLoginAt) : t('platform.home.never')}</dd>
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
  const { t } = useTranslation();
  const open = useOpenAssistance();
  const { enter, busy, error } = useEnterAssistance();
  if (!open.data?.length) return null;
  return (
    <Card className="mb-6 border-priority p-4">
      <h2 className="mb-2 font-semibold">{t('platform.home.openAssistance')}</h2>
      <ul className="flex flex-col gap-3">
        {open.data.map((g) => (
          <li key={g.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="font-medium">{g.residence.name}</p>
              <p className="text-muted">
                {t('platform.home.grantedBy', { name: fullName(g.grantedBy), when: formatWhen(g.expiresAt) })}
                {g.reason && <> · « {g.reason} »</>}
              </p>
            </div>
            <Button variant="primary" busy={busy} onClick={() => void enter(g.id)}>{t('platform.home.consult')}</Button>
          </li>
        ))}
      </ul>
      <ErrorMessage error={error} />
    </Card>
  );
}

function NewResidenceForm({ onDone }: { onDone: (message?: string) => void }) {
  const { t } = useTranslation();
  const create = useCreateResidence();
  const [v, setV] = useState<NewResidenceInput>({
    name: '', type: 'RPA', timezone: 'America/Toronto', responsable: { email: '', firstName: '', lastName: '', locale: currentLanguage() },
  });
  const setResp = (key: keyof NewResidenceInput['responsable']) => (e: { target: { value: string } }) =>
    setV({ ...v, responsable: { ...v.responsable, [key]: e.target.value } });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const created = await create.mutateAsync(v);
    onDone(t('platform.home.created', { name: created.name, email: v.responsable.email }));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField label={t('platform.home.name')} required maxLength={150} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t('platform.home.type')} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as NewResidenceInput['type'] })}>
          {RESIDENCE_TYPES.map((id) => <option key={id} value={id}>{t(`platform.types.${id}`)}</option>)}
        </SelectField>
        <SelectField label={t('platform.home.timezone')} value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>
          {TIMEZONES.map((id) => <option key={id} value={id}>{timezoneLabel(id)}</option>)}
        </SelectField>
      </div>
      <fieldset className="flex flex-col gap-4 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold">{t('platform.home.responsable')}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('common.firstName')} required maxLength={100} value={v.responsable.firstName} onChange={setResp('firstName')} />
          <TextField label={t('common.lastName')} required maxLength={100} value={v.responsable.lastName} onChange={setResp('lastName')} />
        </div>
        <TextField label={t('common.email')} type="email" required maxLength={254} value={v.responsable.email} onChange={setResp('email')}
          hint={t('platform.home.responsableHint')} />
        <SelectField label={t('platform.home.language')} value={v.responsable.locale} onChange={setResp('locale')}>
          {LANGS.map((l) => <option key={l} value={l}>{t(`common.language.${l}`)}</option>)}
        </SelectField>
      </fieldset>
      <p className="text-xs text-muted">
        {t('platform.home.defaults')}
      </p>
      <ErrorMessage error={create.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone()}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" busy={create.isPending}>{t('platform.home.create')}</Button>
      </div>
    </form>
  );
}
