// Fonctionnalités activables par résidence (migration 0014).
//
// Catalogue des modules : niveaux possibles, plafond de chaque rôle (ce que
// le rôle permet dans l'application, qu'aucun réglage ne dépasse),
// dépendances et formules. Un seul endroit à modifier pour ajouter un module.
//
// Niveau effectif d'une personne pour un module :
//   1. son exception (user_features) si elle en a une,
//      sinon le réglage de son rôle dans la résidence (residence_features),
//      sinon la valeur par défaut (= le plafond du rôle : comportement d'avant) ;
//   2. ramené au plafond du rôle et aux niveaux possibles du module ;
//   3. ramené par les dépendances (Relève sans Journal → masquée, etc.).
import { sql } from 'kysely';
import type { Database } from '../db/index.js';

export const LEVELS = ['off', 'read', 'full'] as const;
export type Level = (typeof LEVELS)[number];
const RANK: Record<Level, number> = { off: 0, read: 1, full: 2 };
export const atLeast = (level: Level, min: Level) => RANK[level] >= RANK[min];
const lowest = (a: Level, b: Level): Level => (RANK[a] <= RANK[b] ? a : b);

export const FEATURE_ROLES = ['prepose', 'infirmiere', 'responsable'] as const;
export type FeatureRole = (typeof FEATURE_ROLES)[number];

export const FEATURE_KEYS = [
  'handover', 'journal', 'priority', 'followUps', 'messaging', 'announcements',
  'agenda', 'schedule', 'residents', 'stats', 'dictation',
] as const;
export type Feature = (typeof FEATURE_KEYS)[number];
export const isFeature = (key: string): key is Feature => (FEATURE_KEYS as readonly string[]).includes(key);

interface Dependency { feature: Feature; min: Level }

interface FeatureDef {
  levels: readonly Level[];                     // niveaux proposés à l'administration
  ceiling: Record<FeatureRole, Level>;           // ce que le rôle permet ('off' : jamais)
  requires?: Dependency[];                       // toutes exigées
  requiresAny?: Dependency[];                    // au moins une exigée
}

const ALL_FULL: Record<FeatureRole, Level> = { prepose: 'full', infirmiere: 'full', responsable: 'full' };

export const FEATURES: Record<Feature, FeatureDef> = {
  // Relève : rassemble le journal, les suivis, les rendez-vous et les annonces
  handover: { levels: ['off', 'full'], ceiling: ALL_FULL, requires: [{ feature: 'journal', min: 'read' }] },
  // Journal (notes) : lire ; écrire, corriger, annuler
  journal: { levels: ['off', 'read', 'full'], ceiling: ALL_FULL },
  // Consignes prioritaires : marquer une note prioritaire (infirmière, responsable)
  priority: {
    levels: ['off', 'full'], ceiling: { prepose: 'off', infirmiere: 'full', responsable: 'full' },
    requires: [{ feature: 'journal', min: 'full' }],
  },
  // Suivis : lire ; prendre, fermer, créer (la création exige aussi le Journal en Complet)
  followUps: { levels: ['off', 'read', 'full'], ceiling: ALL_FULL },
  // Messagerie : conversations privées, groupes, fil de l'équipe
  messaging: { levels: ['off', 'full'], ceiling: ALL_FULL },
  // Annonces de la direction : lire et confirmer (read) ; publier (full)
  announcements: {
    levels: ['off', 'read', 'full'], ceiling: { prepose: 'read', infirmiere: 'full', responsable: 'full' },
    requiresAny: [{ feature: 'messaging', min: 'full' }, { feature: 'handover', min: 'full' }],
  },
  // Agenda : rendez-vous des résidents et activités
  agenda: { levels: ['off', 'read', 'full'], ceiling: ALL_FULL },
  // Horaires : consulter les quarts ; les placer (responsable)
  schedule: { levels: ['off', 'read', 'full'], ceiling: { prepose: 'read', infirmiere: 'read', responsable: 'full' } },
  // Résidents : fiches (consulter ; gérer : infirmière, responsable)
  residents: { levels: ['off', 'read', 'full'], ceiling: { prepose: 'read', infirmiere: 'full', responsable: 'full' } },
  // Statistiques d'un résident (infirmière, responsable)
  stats: {
    levels: ['off', 'read'], ceiling: { prepose: 'off', infirmiere: 'read', responsable: 'read' },
    requires: [{ feature: 'journal', min: 'read' }, { feature: 'residents', min: 'read' }],
  },
  // Dictée : bouton micro du journal (sur l'appareil seulement)
  dictation: { levels: ['off', 'full'], ceiling: ALL_FULL, requires: [{ feature: 'journal', min: 'full' }] },
};

// Toujours actifs, jamais réglables : une résidence doit toujours pouvoir
// répondre à une demande d'accès (Loi 25) ou à une plainte.
export const LOCKED = ['audit', 'export', 'team', 'profile', 'help'] as const;

// Réglages d'une résidence : niveau par module et par rôle (seulement les écarts)
export type RoleSettings = Partial<Record<Feature, Partial<Record<FeatureRole, Level>>>>;
export type EffectiveFeatures = Record<Feature, Level>;

// ---------------------------------------------------------------------
// Formules : modèles appliqués en un clic par l'administration, puis
// ajustables. « Personnalisée » = des réglages qui ne correspondent à aucune.
// ---------------------------------------------------------------------
const offForAll = { prepose: 'off', infirmiere: 'off', responsable: 'off' } as const;

export const FORMULAS = {
  complete: {},
  essential: { agenda: offForAll, schedule: offForAll, messaging: offForAll, announcements: offForAll },
  nurseJournal: { journal: { prepose: 'read' }, residents: { prepose: 'off' } },
} as const satisfies Record<string, RoleSettings>;
export type Formula = keyof typeof FORMULAS | 'custom';

export const defaultLevel = (feature: Feature, role: FeatureRole): Level => FEATURES[feature].ceiling[role];

// Niveau demandé (avant dépendances), ramené au plafond et aux niveaux possibles
function clamp(feature: Feature, role: FeatureRole, wanted: Level): Level {
  const def = FEATURES[feature];
  let level = lowest(wanted, def.ceiling[role]);
  // Niveau absent du module (ex. « read » pour la Messagerie) : le niveau possible juste en dessous
  while (!def.levels.includes(level)) level = LEVELS[RANK[level] - 1]!;
  return level;
}

// Niveaux effectifs d'une personne. Les dépendances se propagent dans les
// deux sens (Journal masqué → Relève masquée → Annonces sans affichage).
export function effectiveFeatures(
  role: FeatureRole,
  settings: RoleSettings = {},
  exceptions: Partial<Record<Feature, Level>> = {},
): EffectiveFeatures {
  const result = {} as EffectiveFeatures;
  for (const feature of FEATURE_KEYS) {
    const wanted = exceptions[feature] ?? settings[feature]?.[role] ?? defaultLevel(feature, role);
    result[feature] = clamp(feature, role, wanted);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const feature of FEATURE_KEYS) {
      const def = FEATURES[feature];
      if (result[feature] === 'off') continue;
      const ok = (def.requires ?? []).every((d) => atLeast(result[d.feature], d.min))
        && (!def.requiresAny || def.requiresAny.some((d) => atLeast(result[d.feature], d.min)));
      if (!ok) { result[feature] = 'off'; changed = true; }
    }
  }
  return result;
}

// Formule qui correspond exactement aux réglages (par rôle), sinon « custom »
export function formulaOf(settings: RoleSettings): Formula {
  const grid = (s: RoleSettings) => FEATURE_ROLES.map((role) => effectiveFeatures(role, s));
  const current = JSON.stringify(grid(settings));
  for (const [name, preset] of Object.entries(FORMULAS) as [keyof typeof FORMULAS, RoleSettings][]) {
    if (JSON.stringify(grid(preset)) === current) return name;
  }
  return 'custom';
}

// ---------------------------------------------------------------------
// Lecture dans la base, avec un cache de 30 s par résidence. Un changement
// fait par ce serveur vide le cache tout de suite (invalidate) ; un autre
// serveur le voit au plus tard 30 s après.
// ---------------------------------------------------------------------
export const FEATURE_CACHE_MS = 30_000;

interface ResidenceFeatures {
  settings: RoleSettings;
  exceptions: Map<string, Partial<Record<Feature, Level>>>;   // par personne
}

export class FeatureStore {
  private cache = new Map<string, { at: number; value: Promise<ResidenceFeatures> }>();

  constructor(private db: Database, private ttl = FEATURE_CACHE_MS) {}

  invalidate(residenceId: string): void {
    this.cache.delete(residenceId);
  }

  residence(residenceId: string): Promise<ResidenceFeatures> {
    const hit = this.cache.get(residenceId);
    if (hit && Date.now() - hit.at < this.ttl) return hit.value;
    const value = this.load(residenceId);
    this.cache.set(residenceId, { at: Date.now(), value });
    value.catch(() => this.cache.delete(residenceId));   // pas d'erreur gardée en cache
    return value;
  }

  // Niveaux effectifs d'un compte de la résidence (rôle relu à chaque requête)
  async forUser(residenceId: string, userId: string, role: FeatureRole): Promise<EffectiveFeatures> {
    const { settings, exceptions } = await this.residence(residenceId);
    return effectiveFeatures(role, settings, exceptions.get(userId));
  }

  // Niveau effectif d'un module pour un compte (gardes de l'étape suivante, notifications)
  async level(residenceId: string, userId: string, role: FeatureRole, feature: Feature): Promise<Level> {
    return (await this.forUser(residenceId, userId, role))[feature];
  }

  private async load(residenceId: string): Promise<ResidenceFeatures> {
    const [roleRows, userRows] = await Promise.all([
      this.db.selectFrom('residence_features').select(['feature', 'role', 'level'])
        .where('residence_id', '=', residenceId).where('level', 'is not', null).execute(),
      // Exceptions en cours d'employés actifs de la résidence, pour leur rôle actuel
      this.db.selectFrom('user_features as f').innerJoin('users as u', 'u.id', 'f.user_id')
        .select(['f.user_id', 'f.feature', 'f.level'])
        .where('f.residence_id', '=', residenceId).where('f.revoked_at', 'is', null)
        .where('u.residence_id', '=', residenceId)
        .where(sql<boolean>`u.role IN ('prepose', 'infirmiere', 'responsable')`)
        .execute(),
    ]);
    const settings: RoleSettings = {};
    for (const row of roleRows) {
      if (!isFeature(row.feature) || !row.level) continue;   // module retiré du catalogue
      (settings[row.feature] ??= {})[row.role as FeatureRole] = row.level as Level;
    }
    const exceptions = new Map<string, Partial<Record<Feature, Level>>>();
    for (const row of userRows) {
      if (!isFeature(row.feature)) continue;
      const own = exceptions.get(row.user_id) ?? {};
      own[row.feature] = row.level as Level;
      exceptions.set(row.user_id, own);
    }
    return { settings, exceptions };
  }
}
