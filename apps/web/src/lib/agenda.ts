import type { AppointmentKind } from '../api/types';

// Types de rendez-vous, tels qu'affichés
export const KIND_LABELS: Record<AppointmentKind, string> = {
  medical: 'Médical',
  transport: 'Transport',
  visite: 'Visite',
  activite: 'Activité',
  reunion: 'Réunion',
  autre: 'Autre',
};
