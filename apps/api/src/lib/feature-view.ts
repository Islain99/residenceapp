// Vue des fonctionnalités d'une résidence : réglages par rôle, niveaux
// effectifs, catalogue, formules et exceptions en cours. Utilisée par
// l'administration de la plateforme (routes/platform-features.ts) et par la
// responsable, en lecture seule (GET /features/residence).
import type { Database } from '../db/index.js';
import {
  effectiveFeatures, FEATURE_KEYS, FEATURE_ROLES, FEATURES, FORMULAS, formulaOf, isFeature, settingsFromRows,
  type EffectiveFeatures, type Feature, type FeatureRole, type Level, type RoleSettings,
} from './features.js';

export const roleGrid = (settings: RoleSettings) =>
  Object.fromEntries(FEATURE_ROLES.map((role) => [role, effectiveFeatures(role, settings)])) as Record<FeatureRole, EffectiveFeatures>;

export const catalogue = () => FEATURE_KEYS.map((key) => ({
  key, levels: [...FEATURES[key].levels], ceiling: FEATURES[key].ceiling,
  requires: FEATURES[key].requires ?? [], requiresAny: FEATURES[key].requiresAny ?? [],
}));

export const storedSettings = async (db: Database, residenceId: string) => settingsFromRows(
  await db.selectFrom('residence_features').select(['feature', 'role', 'level']).where('residence_id', '=', residenceId).execute());

export async function residenceFeatureView(db: Database, residenceId: string) {
  const settings = await storedSettings(db, residenceId);
  // Exceptions en cours d'employés actifs de la résidence (rôle actuel)
  const rows = await db.selectFrom('user_features as f')
    .innerJoin('users as u', 'u.id', 'f.user_id')
    .leftJoin('users as c', 'c.id', 'f.created_by')
    .select(['f.id', 'f.user_id', 'f.feature', 'f.level', 'f.reason', 'f.created_at', 'u.first_name', 'u.last_name', 'u.role',
      'c.id as by_id', 'c.first_name as by_first', 'c.last_name as by_last'])
    .where('f.residence_id', '=', residenceId).where('f.revoked_at', 'is', null)
    .where('u.residence_id', '=', residenceId).where('u.is_active', '=', true)
    .where('u.role', 'in', [...FEATURE_ROLES])
    .orderBy('u.last_name').orderBy('u.first_name').orderBy('f.feature')
    .execute();
  const byUser = new Map<string, Partial<Record<Feature, Level>>>();
  for (const e of rows) byUser.set(e.user_id, { ...byUser.get(e.user_id), [e.feature as Feature]: e.level as Level });
  const grid = roleGrid(settings);
  return {
    formula: formulaOf(settings),
    settings,
    effective: grid,
    catalogue: catalogue(),
    formulas: FORMULAS as Record<string, RoleSettings>,
    exceptions: rows.filter((e) => isFeature(e.feature)).map((e) => {
      const role = e.role as FeatureRole;
      const feature = e.feature as Feature;
      return {
        id: e.id,
        user: { id: e.user_id, firstName: e.first_name, lastName: e.last_name, role },
        feature, level: e.level as Level,
        roleLevel: grid[role][feature],
        effective: effectiveFeatures(role, settings, byUser.get(e.user_id))[feature],
        reason: e.reason,
        createdAt: e.created_at.toISOString(),
        createdBy: e.by_id ? { id: e.by_id, firstName: e.by_first!, lastName: e.by_last! } : null,
      };
    }),
  };
}
