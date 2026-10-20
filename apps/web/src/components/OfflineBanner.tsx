// Bandeau « Hors connexion ». Volontairement, aucune donnée de résident n'est
// gardée hors ligne (Loi 25) : sans réseau, l'application le dit clairement
// plutôt que d'afficher des informations peut-être périmées.
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine, () => true);

export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnline();
  if (online) return null;
  return (
    <div role="alert" className="border-b border-priority/40 bg-priority-soft px-4 py-2 text-center text-sm font-medium text-priority">
      {t('shell.offline')}
    </div>
  );
}
