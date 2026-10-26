// Administration (responsable) — fonctionnalités de la résidence : ce que
// chaque rôle voit et peut faire, et les exceptions par personne. Lecture
// seule : l'administration de la plateforme les règle (offre convenue avec la
// résidence) et la responsable est prévenue par courriel de chaque changement.
import { useTranslation } from 'react-i18next';
import { useResidenceFeatures } from '../api/hooks';
import type { FeatureKey, FeatureLevel, FeatureRole } from '../api/types';
import { Badge, EmptyState, ErrorMessage, Loading, PageHeader } from '../components/ui';
import { cx } from '../lib/cx';
import { FEATURE_ROLES, levelsFor } from '../lib/features';
import { fullName } from '../lib/format';

const TONE: Record<FeatureLevel, string> = {
  full: 'bg-positive-soft text-positive',
  read: 'bg-info-soft text-primary',
  off: 'bg-sunken text-muted',
};

export function ResidenceFeaturesPage() {
  const { t } = useTranslation();
  const features = useResidenceFeatures();
  if (features.isPending) return <Loading />;
  if (features.isError) return <ErrorMessage error={features.error} />;
  const { formula, effective, catalogue, exceptions } = features.data;
  const role = (r: FeatureRole) => t(`platform.features.roles.${r}`);
  const module = (k: FeatureKey) => t(`platform.features.modules.${k}`);
  const level = (l: FeatureLevel) => t(`platform.features.levels.${l}`);

  return (
    <>
      <PageHeader title={t('admin.features.title')} subtitle={t('admin.features.subtitle')} />
      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {t('admin.features.formula')}
        <Badge tone={formula === 'custom' ? 'priority' : 'info'}>{t(`platform.features.formulas.${formula}`)}</Badge>
        <span className="text-muted">{t(`platform.features.formulaHints.${formula}`)}</span>
      </p>

      <div className="mb-2 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="px-4 py-3 font-semibold">{t('platform.features.module')}</th>
              {FEATURE_ROLES.map((r) => <th key={r} scope="col" className="px-3 py-3 font-semibold">{role(r)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {catalogue.map((def) => (
              <tr key={def.key}>
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <span className="block font-medium">{module(def.key)}</span>
                  <span className="block text-xs text-muted">{t(`platform.features.moduleHints.${def.key}`)}</span>
                </th>
                {FEATURE_ROLES.map((r) => (
                  <td key={r} className="px-3 py-3">
                    {levelsFor(def, r).length <= 1
                      ? <span className="text-muted" title={t('platform.features.roleOnlyHint')}>{t('platform.features.roleOnly')}</span>
                      : <span className={cx('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', TONE[effective[r][def.key]])}>
                        {level(effective[r][def.key])}
                      </span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-6 text-xs text-muted">{t('platform.features.locked')}</p>

      <h2 className="mb-1 text-lg font-semibold">{t('platform.features.exceptions')}</h2>
      <p className="mb-3 text-sm text-muted">{t('admin.features.exceptionsHint')}</p>
      {exceptions.length === 0 ? <EmptyState>{t('platform.features.noExceptions')}</EmptyState> : (
        <ul className="mb-6 divide-y divide-line rounded-xl border border-line bg-surface">
          {exceptions.map((e) => (
            <li key={e.id} className="px-4 py-3 text-sm">
              <p className="font-medium">{fullName(e.user)} <span className="font-normal text-muted">· {role(e.user.role)}</span></p>
              <p>{t('platform.features.exceptionLine', { module: module(e.feature), from: level(e.roleLevel), to: level(e.level) })}</p>
              {e.reason && <p className="text-xs text-muted">{t('platform.features.reasonValue', { reason: e.reason })}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 rounded-lg bg-info-soft px-4 py-3 text-sm text-primary">{t('admin.features.howToChange')}</p>
    </>
  );
}
