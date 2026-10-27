// Fonctionnalités activables, côté interface : ce que la personne connectée
// voit et peut faire (GET /features). L'API applique les mêmes niveaux ;
// l'interface cache ce qui serait refusé. Pendant le chargement, rien n'est
// caché (l'API reste seule juge).
import { useFeatures } from '../api/hooks';
import type { FeatureKey, FeatureLevel } from '../api/types';
import { atLeast } from './features';

export type Need = [FeatureKey, FeatureLevel?];

export function useAccess() {
  const query = useFeatures();
  const levels = query.data?.features;
  const can = (feature: FeatureKey, min: FeatureLevel = 'read') => !levels || atLeast(levels[feature], min);
  return {
    // Niveaux connus, ou impossibles à lire (réseau) : on n'attend plus
    ready: Boolean(levels) || query.isError || !query.isEnabled,
    levels,
    can,
    // Pour lancer une requête : seulement une fois les niveaux connus (sinon
    // l'API refuserait la requête d'un module masqué)
    allowed: (feature: FeatureKey, min: FeatureLevel = 'read') => Boolean(levels) && atLeast(levels![feature], min),
    // Au moins une des conditions
    canAny: (needs: Need[]) => needs.some(([feature, min]) => can(feature, min)),
    allowedAny: (needs: Need[]) => Boolean(levels) && needs.some(([feature, min]) => atLeast(levels![feature], min ?? 'read')),
  };
}

// Pages de la résidence et ce qu'il faut pour les ouvrir
export const PAGE_NEEDS: Record<string, Need[]> = {
  '/': [['handover', 'full']],
  '/journal': [['journal']],
  '/suivis': [['followUps']],
  '/messages': [['messaging', 'full'], ['announcements']],
  '/agenda': [['agenda']],
  '/horaires': [['schedule']],
  '/residents': [['residents']],
};
