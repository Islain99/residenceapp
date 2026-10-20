import type { AppointmentKind } from '../api/types';

// Types de rendez-vous, dans l'ordre d'affichage (libellés : i18n, agenda.kinds)
export const APPOINTMENT_KINDS: AppointmentKind[] = ['medical', 'transport', 'visite', 'activite', 'reunion', 'autre'];
