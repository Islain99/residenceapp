import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/client';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import './i18n';   // avant tout composant : langue choisie (français par défaut)
import './index.css';

// Fonction masquée ou passée en consultation pendant qu'on l'utilise : les
// fonctionnalités sont relues, la navigation et les boutons s'adaptent
const featureChanged = (error: unknown) => {
  if (error instanceof ApiError && (error.code === 'feature_disabled' || error.code === 'feature_read_only')) {
    void queryClient.invalidateQueries({ queryKey: ['features'] });
  }
};

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: featureChanged }),
  // Accès d'assistance : toute tentative de modification est signalée dans le bandeau
  mutationCache: new MutationCache({
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'assistance_read_only') {
        window.dispatchEvent(new CustomEvent('assistance-refused'));
      }
      featureChanged(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Pas de nouvel essai sur une erreur prévue (404, 403…) : seulement réseau / serveur
      retry: (count, error) => count < 2 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
    },
  },
});

// PWA : installable sur téléphone et tablette, notifications push.
// Aussi en développement (le cache ne concerne que /assets/ et les icônes,
// que Vite ne sert pas en développement).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
