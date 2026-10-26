// Fonctionnalités activables : même calcul que l'API (apps/api/src/lib/features.ts),
// à partir du catalogue qu'elle envoie. Sert à l'écran de réglage de la
// plateforme pour montrer les conséquences avant d'enregistrer ; l'API refait
// le calcul et reste seule juge.
import type {
  FeatureDef, FeatureFormula, FeatureGrid, FeatureKey, FeatureLevel, FeatureRole, FeatureSettings, PlatformFeatures,
} from '../api/types';

export const FEATURE_ROLES: FeatureRole[] = ['prepose', 'infirmiere', 'responsable'];
const RANK: Record<FeatureLevel, number> = { off: 0, read: 1, full: 2 };
export const atLeast = (level: FeatureLevel, min: FeatureLevel) => RANK[level] >= RANK[min];

// Niveaux proposés pour un rôle : ceux du module, jusqu'au plafond du rôle
export const levelsFor = (def: FeatureDef, role: FeatureRole) =>
  def.levels.filter((l) => atLeast(def.ceiling[role], l));

// Grille demandée : réglages, sinon valeur par défaut (plafond du rôle)
export function requestedGrid(catalogue: FeatureDef[], settings: FeatureSettings): FeatureGrid {
  const grid = {} as FeatureGrid;
  for (const role of FEATURE_ROLES) {
    grid[role] = {} as FeatureGrid[FeatureRole];
    for (const def of catalogue) {
      const wanted = settings[def.key]?.[role] ?? def.ceiling[role];
      const allowed = levelsFor(def, role);
      // Niveau impossible : le plus haut possible en dessous
      grid[role][def.key] = [...allowed].reverse().find((l) => atLeast(wanted, l)) ?? 'off';
    }
  }
  return grid;
}

// Niveaux d'un rôle (ou d'une personne), ramenés par les dépendances
export function applyDependencies(catalogue: FeatureDef[], requested: Record<FeatureKey, FeatureLevel>): Record<FeatureKey, FeatureLevel> {
  const levels = { ...requested };
  for (let changed = true; changed;) {
    changed = false;
    for (const def of catalogue) {
      if (levels[def.key] === 'off') continue;
      const ok = def.requires.every((d) => atLeast(levels[d.feature], d.min))
        && (def.requiresAny.length === 0 || def.requiresAny.some((d) => atLeast(levels[d.feature], d.min)));
      if (!ok) { levels[def.key] = 'off'; changed = true; }
    }
  }
  return levels;
}

// Niveaux effectifs : la grille demandée, ramenée par les dépendances
export function effectiveGrid(catalogue: FeatureDef[], requested: FeatureGrid): FeatureGrid {
  return Object.fromEntries(FEATURE_ROLES.map((r) => [r, applyDependencies(catalogue, requested[r])])) as FeatureGrid;
}

// Modules dont dépend un module masqué par ses dépendances (pour l'expliquer)
export function blockers(def: FeatureDef, levels: Record<FeatureKey, FeatureLevel>): FeatureKey[] {
  const missing = def.requires.filter((d) => !atLeast(levels[d.feature], d.min)).map((d) => d.feature);
  if (def.requiresAny.length && !def.requiresAny.some((d) => atLeast(levels[d.feature], d.min))) {
    missing.push(...def.requiresAny.map((d) => d.feature));
  }
  return missing;
}

// Écarts à envoyer à l'API (sans les valeurs par défaut)
export function toSettings(catalogue: FeatureDef[], grid: FeatureGrid): FeatureSettings {
  const settings: FeatureSettings = {};
  for (const def of catalogue) {
    for (const role of FEATURE_ROLES) {
      if (grid[role][def.key] !== def.ceiling[role]) (settings[def.key] ??= {})[role] = grid[role][def.key];
    }
  }
  return settings;
}

const same = (a: FeatureGrid, b: FeatureGrid) => FEATURE_ROLES.every((r) =>
  Object.keys(a[r]).every((k) => a[r][k as FeatureKey] === b[r][k as FeatureKey]));

// Formule correspondant à une grille effective, sinon « custom »
export function formulaOf(data: PlatformFeatures, effective: FeatureGrid): FeatureFormula {
  for (const [name, preset] of Object.entries(data.formulas) as [Exclude<FeatureFormula, 'custom'>, FeatureSettings][]) {
    if (same(effectiveGrid(data.catalogue, requestedGrid(data.catalogue, preset)), effective)) return name;
  }
  return 'custom';
}

// Changements entre deux grilles effectives
export function diff(before: FeatureGrid, after: FeatureGrid) {
  return FEATURE_ROLES.flatMap((role) => (Object.keys(after[role]) as FeatureKey[])
    .filter((k) => before[role][k] !== after[role][k])
    .map((feature) => ({ role, feature, from: before[role][feature], to: after[role][feature] })));
}
