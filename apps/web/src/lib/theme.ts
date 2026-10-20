// Thème de l'interface, choisi dans « Mon profil » et gardé sur cet appareil.
//   light  : fond blanc (par défaut, quel que soit le réglage du téléphone)
//   dark   : fond sombre (quarts de nuit)
//   system : suit le réglage clair / sombre de l'appareil
// Appliqué par l'attribut data-theme de <html> (index.css). index.html le
// pose avant le premier affichage : pas d'éclair de la mauvaise couleur.
import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
// Dans l'ordre d'affichage (libellés : i18n, account.appearance.themes)
export const THEMES: ThemePreference[] = ['light', 'dark', 'system'];

const KEY = 'theme';
const EVENT = 'themechange';
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function themePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // stockage bloqué (navigation privée…) : thème par défaut
  }
  return 'light';
}

export function setThemePreference(theme: ThemePreference): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // stockage bloqué : le choix vaut jusqu'à la fermeture de la page
  }
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event(EVENT));
}

// Thème réellement affiché (« system » résolu selon l'appareil)
function resolvedTheme(): 'light' | 'dark' {
  const theme = document.documentElement.dataset.theme ?? themePreference();
  if (theme === 'system') return darkQuery().matches ? 'dark' : 'light';
  return theme === 'dark' ? 'dark' : 'light';
}

function subscribe(onChange: () => void) {
  const query = darkQuery();
  window.addEventListener(EVENT, onChange);
  query.addEventListener('change', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    query.removeEventListener('change', onChange);
  };
}

// Composants qui dépendent du thème (logo) : se redessinent quand il change
export const useResolvedTheme = () => useSyncExternalStore(subscribe, resolvedTheme);
export const useThemePreference = () => useSyncExternalStore(subscribe, themePreference);
