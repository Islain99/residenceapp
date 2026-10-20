// Choix de la langue : « Français | English ». Page de connexion, pages du mot
// de passe et « Mon profil ». Connecté : aussi enregistré dans le compte
// (courriels et notifications dans cette langue).
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { User } from '../api/types';
import { useAuth } from '../auth/session';
import { applyLanguage, LANGS, type Lang } from '../i18n';
import { cx } from '../lib/cx';

export function LanguageSwitch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const { user, assistance, updateUser } = useAuth();
  const current = i18n.language === 'en' ? 'en' : 'fr';

  function choose(lang: Lang) {
    if (lang === current) return;
    applyLanguage(lang);
    // Accès d'assistance : lecture seule, le compte de l'admin ne change pas
    if (user && !assistance) {
      void api<User>('/auth/me', { method: 'PATCH', body: { locale: lang } }).then(updateUser, () => {});
    }
  }

  return (
    <div role="radiogroup" aria-label={t('common.language.label')}
      className={cx('inline-flex gap-1 rounded-xl bg-sunken p-1 text-sm', className)}>
      {LANGS.map((lang) => (
        <button key={lang} type="button" role="radio" aria-checked={current === lang} lang={lang}
          onClick={() => choose(lang)}
          className={cx('min-h-9 rounded-lg px-3 font-medium transition-colors',
            current === lang ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-ink')}>
          {t(`common.language.${lang}`)}
        </button>
      ))}
    </div>
  );
}
