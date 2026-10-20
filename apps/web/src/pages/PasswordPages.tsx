// Pages publiques du mot de passe :
//   /mot-de-passe-oublie   demander un lien par courriel
//   /mot-de-passe#<jeton>  choisir son mot de passe (invitation ou réinitialisation)
// Le jeton est dans le fragment (#) : jamais envoyé au serveur web ni noté dans un journal.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { checkPasswordToken, forgotPassword, setPassword } from '../api/hooks';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { Logo } from '../components/Logo';
import { Button, Card, ErrorMessage, Loading, TextField } from '../components/ui';

const MIN_LENGTH = 12;   // même règle que l'API

function PublicCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 py-8">
      <LanguageSwitch />
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo className="size-28" />
          <h1 className="text-xl font-bold">{title}</h1>
        </div>
        {children}
      </Card>
    </main>
  );
}

function BackToLogin() {
  const { t } = useTranslation();
  return <Link to="/connexion" className="mt-4 block text-center text-sm text-primary hover:underline">{t('auth.password.backToLogin')}</Link>;
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicCard title={t('auth.password.forgotTitle')}>
      {sent ? (
        <p role="status" className="rounded-lg bg-positive-soft px-3 py-3 text-sm text-positive">
          <Trans i18nKey="auth.password.forgotSent" values={{ email }} components={{ strong: <strong /> }} />
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm text-muted">{t('auth.password.forgotIntro')}</p>
          <TextField label={t('common.email')} type="email" autoComplete="username" required autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <ErrorMessage error={error} />
          <Button type="submit" variant="primary" busy={busy}>{t('auth.password.sendLink')}</Button>
        </form>
      )}
      <BackToLogin />
    </PublicCard>
  );
}

type TokenInfo = Awaited<ReturnType<typeof checkPasswordToken>>;

export function SetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [token] = useState(() => window.location.hash.slice(1));
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [checkError, setCheckError] = useState<unknown>(() =>
    token ? null : new Error(t('auth.password.incompleteLink')));
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Le jeton quitte la barre d'adresse (historique, capture d'écran)
    window.history.replaceState(null, '', window.location.pathname);
    if (token) checkPasswordToken(token).then(setInfo, setCheckError);
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(new Error(t('auth.password.mismatch')));
      return;
    }
    setBusy(true);
    try {
      await setPassword(token, password);
      navigate('/connexion', {
        replace: true,
        state: { email: info?.email, message: t('auth.password.savedCanLogin') },
      });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (checkError) {
    return (
      <PublicCard title={t('auth.password.invalidLink')}>
        <ErrorMessage error={checkError} />
        <Link to="/mot-de-passe-oublie" className="mt-4 block text-center text-sm text-primary hover:underline">
          {t('auth.password.newLink')}
        </Link>
        <BackToLogin />
      </PublicCard>
    );
  }
  if (!info) return <Loading />;

  const invite = info.purpose === 'invite';
  return (
    <PublicCard title={invite ? t('auth.password.welcome', { name: info.firstName }) : t('auth.password.newPassword')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {invite ? t('auth.password.chooseForInvite') : t('auth.password.chooseForReset')} <strong className="text-ink">{info.email}</strong>.
        </p>
        {/* Champ caché : aide le gestionnaire de mots de passe à associer le bon compte */}
        <input type="email" autoComplete="username" value={info.email} readOnly hidden />
        <TextField label={t('common.password')} type="password" autoComplete="new-password" required minLength={MIN_LENGTH}
          maxLength={200} autoFocus value={password} onChange={(e) => setPasswordValue(e.target.value)}
          hint={t('auth.password.hint', { min: MIN_LENGTH })} />
        <TextField label={t('auth.password.confirmPassword')} type="password" autoComplete="new-password" required
          minLength={MIN_LENGTH} maxLength={200} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <ErrorMessage error={error} />
        <Button type="submit" variant="primary" busy={busy}>{invite ? t('auth.password.activate') : t('common.save')}</Button>
      </form>
    </PublicCard>
  );
}
