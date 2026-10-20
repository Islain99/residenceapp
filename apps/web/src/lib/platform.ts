// Constantes et crochet partagés des pages de la plateforme.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/session';
import i18n from '../i18n';
import type platformFr from '../i18n/fr/platform';

// Fuseaux proposés (libellés : i18n, platform.timezones)
export const TIMEZONES = Object.keys({
  'America/Toronto': 0, 'America/Halifax': 0, 'America/Moncton': 0, 'America/St_Johns': 0,
  'America/Winnipeg': 0, 'America/Edmonton': 0, 'America/Vancouver': 0,
} satisfies Record<keyof typeof platformFr.timezones, 0>) as (keyof typeof platformFr.timezones)[];

// Libellé d'un fuseau ; fuseau hors liste : son identifiant
export const timezoneLabel = (id: string) =>
  (TIMEZONES as string[]).includes(id) ? i18n.t(`platform.timezones.${id as (typeof TIMEZONES)[number]}`) : id;

export const RESIDENCE_TYPES = ['RPA', 'RI'] as const;   // libellés : i18n, platform.types

// Ouvre l'accès d'assistance puis affiche la résidence (lecture seule)
export function useEnterAssistance() {
  const { startAssistance } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const enter = async (grantId: string) => {
    setBusy(true);
    setError(null);
    try {
      await startAssistance(grantId);
      void navigate('/');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return { enter, error, busy };
}
