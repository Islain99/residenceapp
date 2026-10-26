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
    ready: Boolean(levels),
    levels,
    can,
    // Au moins une des conditions
    canAny: (needs: Need[]) => needs.some(([feature, min]) => can(feature, min)),
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
