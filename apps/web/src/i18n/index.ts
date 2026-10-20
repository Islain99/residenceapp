// Interface bilingue français / anglais (i18next).
//
//   * Français par défaut (Charte de la langue française) ; l'anglais se
//     choisit sur la page de connexion ou dans « Mon profil ».
//   * Le choix est gardé sur l'appareil (localStorage « lang ») et dans le
//     compte (users.locale) : courriels et notifications partent dans la
//     langue de la personne.
//   * Textes : un fichier par partie de l'application, i18n/fr/*.ts et
//     i18n/en/*.ts. Chaque fichier anglais doit avoir exactement les clés du
//     français (types.ts) : une fonctionnalité ne peut pas arriver dans une
//     seule langue. Clés vérifiées aussi dans les composants (t('…')).
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en';
import fr from './fr';

export type Lang = 'fr' | 'en';
export const LANGS: Lang[] = ['fr', 'en'];
const KEY = 'lang';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof fr };
  }
}

// Langue choisie sur cet appareil, s'il y en a une
export function savedLanguage(): Lang | null {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'fr' || saved === 'en' ? saved : null;
  } catch {
    return null;   // stockage bloqué (navigation privée…)
  }
}

const initial: Lang = savedLanguage() ?? 'fr';
document.documentElement.lang = initial === 'en' ? 'en-CA' : 'fr-CA';

void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: initial,
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },   // React échappe déjà le texte
  returnNull: false,
});

export const currentLanguage = (): Lang => (i18n.language === 'en' ? 'en' : 'fr');

// Paramètres régionaux des dates et des nombres (lib/format.ts)
export const currentLocale = () => (currentLanguage() === 'en' ? 'en-CA' : 'fr-CA');

// Change la langue de l'interface et la garde sur cet appareil
export function applyLanguage(lang: Lang): void {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // stockage bloqué : la langue vaut jusqu'à la fermeture de la page
  }
  document.documentElement.lang = lang === 'en' ? 'en-CA' : 'fr-CA';
  void i18n.changeLanguage(lang);
}

export default i18n;
