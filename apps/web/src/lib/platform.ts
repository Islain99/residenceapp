// Constantes et crochet partagés des pages de la plateforme.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/session';

export const TIMEZONES = [
  { id: 'America/Toronto', label: 'Heure de l’Est (Québec, Ontario)' },
  { id: 'America/Halifax', label: 'Heure de l’Atlantique' },
  { id: 'America/Moncton', label: 'Heure de l’Atlantique (Nouveau-Brunswick)' },
  { id: 'America/St_Johns', label: 'Heure de Terre-Neuve' },
  { id: 'America/Winnipeg', label: 'Heure du Centre' },
  { id: 'America/Edmonton', label: 'Heure des Rocheuses' },
  { id: 'America/Vancouver', label: 'Heure du Pacifique' },
];

export const RESIDENCE_TYPES = { RPA: 'RPA — résidence privée pour aînés', RI: 'RI — ressource intermédiaire' } as const;

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

