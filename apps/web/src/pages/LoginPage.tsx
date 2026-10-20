import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router';
import type { MfaChallenge, MfaSetup } from '../api/types';
import { useAuth } from '../auth/session';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { Logo } from '../components/Logo';
import { BackupCodes, CodeForm, SetupInstructions } from '../components/mfa';
import { Button, Card, Checkbox, ErrorMessage, Loading, TextField } from '../components/ui';

// Étapes : mot de passe → (responsable, admin) code de l'application,
// ou première fois : code QR, confirmation, codes de secours
type Step =
  | { kind: 'password' }
  | { kind: 'code'; challenge: MfaChallenge }
  | { kind: 'setup'; challenge: MfaChallenge; setup: MfaSetup | null }
  | { kind: 'backup'; codes: string[]; finish: () => void };

// Écran public : choix de la langue en haut, puis la carte
function PublicScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 py-8">
      <LanguageSwitch />
      {children}
    </main>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const { user, login, notice, verifyMfa, setupMfa, enableMfa } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const location = useLocation();
  // Arrivée depuis « choisir mon mot de passe » : courriel prérempli et message
  const state = location.state as { from?: string; email?: string; message?: string } | null;
  const [email, setEmail] = useState(state?.email ?? '');
  const [password, setPassword] = useState('');
  const [sharedDevice, setSharedDevice] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user && step.kind !== 'backup') {
    const from = state?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const challenge = await login(email, password, sharedDevice);
      if (challenge?.mfa === 'required') setStep({ kind: 'code', challenge });
      if (challenge?.mfa === 'setup') {
        setStep({ kind: 'setup', challenge, setup: null });
        const setup = await setupMfa(challenge.mfaToken);
        setStep({ kind: 'setup', challenge, setup });
      }
    } catch (err) {
      setError(err);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  // Étape 2 : code expiré ou refusé trop de fois → retour au mot de passe
  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'mfa_expired' || code === 'account_locked') {
        setStep({ kind: 'password' });
        setPassword('');
      }
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <button type="button" className="mt-4 block w-full text-center text-sm text-primary hover:underline"
      onClick={() => { setStep({ kind: 'password' }); setPassword(''); setError(null); }}>
      {t('auth.login.backToLogin')}
    </button>
  );

  if (step.kind !== 'password') {
    const titles = { code: t('auth.mfa.titleCode'), setup: t('auth.mfa.titleSetup'), backup: t('auth.mfa.titleBackup') };
    return (
      <PublicScreen>
        <Card className="w-full max-w-md p-6">
          <div className="mb-5 flex flex-col items-center gap-2 text-center">
            <Logo className="size-16" />
            <h1 className="text-xl font-bold">{titles[step.kind]}</h1>
            {step.kind === 'setup' && <p className="text-sm text-muted">{t('auth.mfa.setupRequired')}</p>}
          </div>
          {step.kind === 'code' && (
            <>
              <CodeForm submitLabel={t('auth.mfa.validate')} allowBackup busy={busy} error={error}
                onSubmit={(code) => void run(() => verifyMfa(step.challenge.mfaToken, code))} />
              {back}
            </>
          )}
          {step.kind === 'setup' && (step.setup ? (
            <>
              <SetupInstructions setup={step.setup} />
              <div className="mt-4">
                <CodeForm submitLabel={t('auth.mfa.enable')} busy={busy} error={error} onSubmit={(code) => void run(async () => {
                  const { backupCodes, finish } = await enableMfa(step.challenge.mfaToken, code);
                  setStep({ kind: 'backup', codes: backupCodes, finish });
                })} />
              </div>
              {back}
            </>
          ) : <><Loading /><ErrorMessage error={error} /></>)}
          {step.kind === 'backup' && <BackupCodes codes={step.codes} onDone={() => { setStep({ kind: 'password' }); step.finish(); }} />}
        </Card>
      </PublicScreen>
    );
  }

  return (
    <PublicScreen>
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo className="size-28" />
          <h1 className="text-xl font-bold">{t('common.appName')}</h1>
          <p className="text-sm text-muted">{t('auth.login.subtitle')}</p>
        </div>
        {notice && !state?.message && (
          <p role="status" className="mb-4 rounded-lg bg-info-soft px-3 py-2 text-sm text-primary">{notice}</p>
        )}
        {state?.message && (
          <p role="status" className="mb-4 rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive">{state.message}</p>
        )}
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TextField label={t('common.email')} type="email" autoComplete="username" required autoFocus={!state?.email}
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label={t('common.password')} type="password" autoComplete="current-password" required autoFocus={!!state?.email}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <Checkbox
            label={<span><strong>{t('auth.login.sharedDevice')}</strong> — {t('auth.login.sharedDeviceHint')}</span>}
            checked={sharedDevice} onChange={(e) => setSharedDevice(e.target.checked)} />
          <ErrorMessage error={error} />
          <Button type="submit" variant="primary" busy={busy}>{t('auth.login.submit')}</Button>
        </form>
        <Link to="/mot-de-passe-oublie" className="mt-4 block text-center text-sm text-primary hover:underline">
          {t('auth.login.forgot')}
        </Link>
      </Card>
    </PublicScreen>
  );
}
