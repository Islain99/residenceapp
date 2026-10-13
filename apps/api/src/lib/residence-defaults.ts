// Réglages de départ d'une nouvelle résidence (modifiables ensuite par la
// responsable) : catégories de notes, quarts types, canaux de la messagerie.
// Mêmes valeurs que les données de démonstration et les migrations 0007 / 0009.
import type { Db } from './note-view.js';

export const DEFAULT_CATEGORIES = ['Comportement', 'Alimentation', 'Sommeil', 'Chute', 'Visite', 'Santé', 'Hygiène', 'Activité'];

export const DEFAULT_SHIFT_TYPES = [
  { label: 'Jour', start_time: '07:00', end_time: '15:00' },
  { label: 'Soir', start_time: '15:00', end_time: '23:00' },
  { label: 'Nuit', start_time: '23:00', end_time: '07:00' },
];

export async function createResidenceDefaults(trx: Db, residenceId: string): Promise<void> {
  await trx.insertInto('note_categories')
    .values(DEFAULT_CATEGORIES.map((label, i) => ({ residence_id: residenceId, label, sort_order: i + 1 })))
    .execute();
  await trx.insertInto('shift_types')
    .values(DEFAULT_SHIFT_TYPES.map((t, i) => ({ residence_id: residenceId, ...t, sort_order: i + 1 })))
    .execute();
  await trx.insertInto('conversations')
    .values([
      { residence_id: residenceId, kind: 'team', title: "Toute l'équipe" },
      { residence_id: residenceId, kind: 'announcements', title: 'Annonces' },
    ])
    .onConflict((oc) => oc.doNothing())
    .execute();
}
