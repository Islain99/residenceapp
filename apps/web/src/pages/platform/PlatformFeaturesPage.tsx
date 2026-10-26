// Plateforme — fonctionnalités d'une résidence : formule, grille modules ×
// rôles, conséquences des dépendances, aperçu par rôle. L'API applique les
// réglages (lib/features.ts) ; cet écran les montre avant l'enregistrement.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { usePlatformFeatures, useSaveFeatures } from '../../api/hooks';
import type { FeatureDef, FeatureFormula, FeatureGrid, FeatureKey, FeatureLevel, FeatureRole, PlatformFeatures } from '../../api/types';
import { ResidenceTabs } from '../../components/platform';
import { Badge, Button, Card, Dialog, ErrorMessage, Loading, PageHeader } from '../../components/ui';
import { cx } from '../../lib/cx';
import {
  atLeast, blockers, diff, effectiveGrid, FEATURE_ROLES, formulaOf, levelsFor, requestedGrid, toSettings,
} from '../../lib/features';
import { formatWhen, fullName } from '../../lib/format';

const FORMULAS: Exclude<FeatureFormula, 'custom'>[] = ['complete', 'essential', 'nurseJournal'];

export function PlatformFeaturesPage() {
  const { id = '' } = useParams();
  const features = usePlatformFeatures(id);
  const [notice, setNotice] = useState<string | null>(null);   // gardé quand la grille est relue
  if (features.isPending) return <Loading />;
  if (features.isError) return <ErrorMessage error={features.error} />;
  // Grille de travail remise à zéro à chaque nouvelle version enregistrée
  return <FeaturesEditor key={features.data.updatedAt ?? 'default'} data={features.data} notice={notice} setNotice={setNotice} />;
}

function FeaturesEditor({ data, notice, setNotice }: {
  data: PlatformFeatures; notice: string | null; setNotice: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const save = useSaveFeatures();
  const [draft, setDraft] = useState<FeatureGrid>(data.effective);
  const [confirming, setConfirming] = useState(false);
  const [previewRole, setPreviewRole] = useState<FeatureRole>('prepose');

  const effective = useMemo(() => effectiveGrid(data.catalogue, draft), [data.catalogue, draft]);
  const changes = useMemo(() => diff(data.effective, effective), [data.effective, effective]);
  const formula = formulaOf(data, effective);
  // Cases demandées mais masquées par une dépendance
  const cascades = FEATURE_ROLES.flatMap((role) => data.catalogue
    .filter((def) => draft[role][def.key] !== effective[role][def.key])
    .map((def) => ({ role, def })));

  const label = {
    role: (r: FeatureRole) => t(`platform.features.roles.${r}`),
    module: (k: FeatureKey) => t(`platform.features.modules.${k}`),
    level: (l: FeatureLevel) => t(`platform.features.levels.${l}`),
  };

  function setCell(role: FeatureRole, feature: FeatureKey, level: FeatureLevel) {
    setNotice(null);
    setDraft((g) => ({ ...g, [role]: { ...g[role], [feature]: level } }));
  }

  function applyFormula(name: Exclude<FeatureFormula, 'custom'>) {
    setNotice(null);
    setDraft(requestedGrid(data.catalogue, data.formulas[name]));
  }

  function submit() {
    setConfirming(false);
    save.mutate({ id: data.residence.id, settings: toSettings(data.catalogue, draft), acceptCascade: true }, {
      onSuccess: (res) => setNotice(res.changes.length === 0 ? t('platform.features.savedNothing')
        : res.notified > 0 ? t('platform.features.saved', { count: res.notified }) : t('platform.features.savedNoMail')),
    });
  }

  return (
    <>
      <Link to="/plateforme" className="mb-3 inline-block text-sm text-primary hover:underline">{t('platform.residence.back')}</Link>
      <PageHeader title={data.residence.name} subtitle={t('platform.features.subtitle')} />
      <ResidenceTabs id={data.residence.id} />

      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}

      {/* Formule */}
      <section className="mb-6">
        <h2 className="mb-2 flex flex-wrap items-center gap-2 text-lg font-semibold">
          {t('platform.features.formula')}
          <Badge tone={formula === 'custom' ? 'priority' : 'info'}>{t(`platform.features.formulas.${formula}`)}</Badge>
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {FORMULAS.map((name) => (
            <Card key={name} className={cx('flex flex-col gap-2 p-4', formula === name && 'border-primary')}>
              <p className="font-semibold">{t(`platform.features.formulas.${name}`)}</p>
              <p className="flex-1 text-sm text-muted">{t(`platform.features.formulaHints.${name}`)}</p>
              <Button disabled={formula === name} onClick={() => applyFormula(name)}>{t('platform.features.apply')}</Button>
            </Card>
          ))}
        </div>
      </section>

      {/* Grille modules × rôles */}
      <section className="mb-6">
        {/* Téléphone : un module par carte, un menu par rôle */}
        <ul className="flex flex-col gap-3 md:hidden">
          {data.catalogue.map((def) => (
            <li key={def.key} className="rounded-xl border border-line bg-surface p-4 text-sm">
              <p className="font-medium">{label.module(def.key)}</p>
              <p className="mb-3 text-xs text-muted">{t(`platform.features.moduleHints.${def.key}`)}</p>
              <div className="flex flex-col gap-3">
                {FEATURE_ROLES.map((role) => (
                  <div key={role} className="grid grid-cols-[7rem_1fr] items-start gap-2">
                    <span className="pt-2 text-muted">{label.role(role)}</span>
                    <Cell def={def} role={role} requested={draft[role][def.key]} effective={effective[role]}
                      saved={data.effective[role][def.key]} label={label} onChange={(l) => setCell(role, def.key, l)} />
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="px-4 py-3 font-semibold">{t('platform.features.module')}</th>
                {FEATURE_ROLES.map((role) => <th key={role} scope="col" className="px-3 py-3 font-semibold">{label.role(role)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.catalogue.map((def) => (
                <tr key={def.key}>
                  <th scope="row" className="px-4 py-3 text-left align-top font-normal">
                    <span className="block font-medium">{label.module(def.key)}</span>
                    <span className="block text-xs text-muted">{t(`platform.features.moduleHints.${def.key}`)}</span>
                  </th>
                  {FEATURE_ROLES.map((role) => (
                    <td key={role} className="px-3 py-3 align-top">
                      <Cell def={def} role={role} requested={draft[role][def.key]} effective={effective[role]}
                        saved={data.effective[role][def.key]} label={label} onChange={(l) => setCell(role, def.key, l)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">{t('platform.features.locked')}</p>
      </section>

      {/* Aperçu par rôle */}
      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">{t('platform.features.preview')}</h2>
        <div role="tablist" className="mb-3 flex flex-wrap gap-2">
          {FEATURE_ROLES.map((role) => (
            <button key={role} type="button" role="tab" aria-selected={previewRole === role} onClick={() => setPreviewRole(role)}
              className={cx('rounded-full border px-3 py-1 text-sm', previewRole === role ? 'border-primary bg-info-soft text-primary' : 'border-line text-muted hover:text-ink')}>
              {label.role(role)}
            </button>
          ))}
        </div>
        <Preview role={previewRole} levels={effective[previewRole]} catalogue={data.catalogue} label={label} />
      </section>

      {/* Changements et enregistrement */}
      {/* Reste visible en bas de l'écran tant qu'il y a des changements */}
      <Card className={cx('p-4', changes.length > 0 && 'sticky bottom-[calc(var(--nav-h,0px)+0.5rem)] shadow-lg md:bottom-4')}>
        {changes.length === 0 ? <p className="text-sm text-muted">{t('platform.features.noChanges')}</p> : (
          <details>
            <summary className="cursor-pointer text-sm font-semibold">{t('platform.features.changes', { count: changes.length })}</summary>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {changes.map((c) => (
                <li key={`${c.role}-${c.feature}`}>
                  {t('platform.features.change', { role: label.role(c.role), module: label.module(c.feature), from: label.level(c.from), to: label.level(c.to) })}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="mt-2 text-xs text-muted">{t('platform.features.emailNote')}</p>
        <ErrorMessage error={save.error} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {data.updatedAt && data.updatedBy && t('platform.features.updated', { when: formatWhen(data.updatedAt), name: fullName(data.updatedBy) })}
          </span>
          <div className="flex gap-2">
            <Button disabled={changes.length === 0 && cascades.length === 0} onClick={() => { setNotice(null); setDraft(data.effective); }}>
              {t('platform.features.reset')}
            </Button>
            <Button variant="primary" busy={save.isPending} disabled={changes.length === 0}
              onClick={() => (cascades.length ? setConfirming(true) : submit())}>
              {t('platform.features.save')}
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={confirming} onClose={() => setConfirming(false)} title={t('platform.features.confirmTitle')}>
        <p className="mb-3 text-sm">{t('platform.features.confirmIntro')}</p>
        <ul className="mb-4 flex list-disc flex-col gap-1 pl-5 text-sm">
          {cascades.map(({ role, def }) => (
            <li key={`${role}-${def.key}`}>{t('platform.features.confirmItem', {
              role: label.role(role), module: label.module(def.key),
              blockers: blockers(def, effective[role]).map(label.module).join(', '),
            })}</li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit}>{t('platform.features.confirm')}</Button>
        </div>
      </Dialog>
    </>
  );
}

type Labels = {
  role: (r: FeatureRole) => string;
  module: (k: FeatureKey) => string;
  level: (l: FeatureLevel) => string;
};

function Cell({ def, role, requested, effective, saved, label, onChange }: {
  def: FeatureDef; role: FeatureRole; requested: FeatureLevel; effective: Record<FeatureKey, FeatureLevel>;
  saved: FeatureLevel; label: Labels; onChange: (level: FeatureLevel) => void;
}) {
  const { t } = useTranslation();
  const options = levelsFor(def, role);
  if (options.length <= 1) {
    return <span className="text-muted" title={t('platform.features.roleOnlyHint')}>{t('platform.features.roleOnly')}</span>;
  }
  const actual = effective[def.key];
  const blocked = actual !== requested;
  const changed = actual !== saved;
  return (
    <div className="flex flex-col gap-1">
      <select aria-label={`${label.module(def.key)} — ${label.role(role)}`} value={requested}
        onChange={(e) => onChange(e.target.value as FeatureLevel)}
        className={cx('min-h-10 w-full rounded-lg border bg-surface px-2 text-sm',
          changed ? 'border-primary ring-1 ring-primary' : 'border-line',
          actual === 'off' && 'text-muted')}>
        {options.map((l) => <option key={l} value={l}>{label.level(l)}</option>)}
      </select>
      {blocked && (
        <span className="text-xs text-danger">
          {t('platform.features.blockedBy', { modules: blockers(def, effective).map(label.module).join(', ') })}
        </span>
      )}
      {changed && !blocked && <span className="text-xs text-primary">{t('platform.features.changed')}</span>}
    </div>
  );
}

function Preview({ role, levels, catalogue, label }: {
  role: FeatureRole; levels: Record<FeatureKey, FeatureLevel>; catalogue: FeatureDef[]; label: Labels;
}) {
  const { t } = useTranslation();
  const visible = catalogue.filter((def) => atLeast(levels[def.key], 'read'));
  return (
    <Card className="p-4 text-sm">
      <p className="mb-2 font-medium">{t('platform.features.previewFor', { role: label.role(role) })}</p>
      {visible.length === 0 ? <p className="text-muted">{t('platform.features.previewNothing')}</p> : (
        <ul className="flex flex-wrap gap-2">
          {visible.map((def) => (
            <li key={def.key}>
              <Badge tone={levels[def.key] === 'full' ? 'positive' : 'neutral'}>
                {levels[def.key] === 'read' && def.levels.includes('full')
                  ? t('platform.features.previewRead', { module: label.module(def.key) }) : label.module(def.key)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
