// Pages publiques du mot de passe :
//   /mot-de-passe-oublie   demander un lien par courriel
//   /mot-de-passe#<jeton>  choisir son mot de passe (invitation ou réinitialisation)
// Le jeton est dans le fragment (#) : jamais envoyé au serveur web ni noté dans un journal.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { checkPasswordToken, forgotPassword, setPassword } from '../api/hooks';
import { Button, Card, ErrorMessage, Loading, TextField } from '../components/ui';

const MIN_LENGTH = 10;   // même règle que l'API

function PublicCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src="/favicon.svg" alt="" className="size-12" />
          <h1 className="text-xl font-bold">{title}</h1>
        </div>
        {children}
      </Card>
    </main>
  );
}

const backToLogin = <Link to="/connexion" className="mt-4 block text-center text-sm text-primary hover:underline">Retour à la connexion</Link>;

export function ForgotPasswordPage() {
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
    <PublicCard title="Mot de passe oublié">
      {sent ? (
        <p role="status" className="rounded-lg bg-positive-soft px-3 py-3 text-sm text-positive">
          Si un compte actif utilise <strong>{email}</strong>, un courriel vient d'être envoyé avec un lien pour
          choisir un nouveau mot de passe. Le lien est valable 1 heure. Pensez à vérifier les courriels indésirables.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm text-muted">Indiquez le courriel de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
          <TextField label="Courriel" type="email" autoComplete="username" required autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <ErrorMessage error={error} />
          <Button type="submit" variant="primary" busy={busy}>Envoyer le lien</Button>
        </form>
      )}
      {backToLogin}
    </PublicCard>
  );
}

type TokenInfo = Awaited<ReturnType<typeof checkPasswordToken>>;

export function SetPasswordPage() {
  const navigate = useNavigate();
  const [token] = useState(() => window.location.hash.slice(1));
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [checkError, setCheckError] = useState<unknown>(() =>
    token ? null : new Error('Lien incomplet. Ouvrez le lien reçu par courriel.'));
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
      setError(new Error('Les deux mots de passe ne sont pas identiques.'));
      return;
    }
    setBusy(true);
    try {
      await setPassword(token, password);
      navigate('/connexion', {
        replace: true,
        state: { email: info?.email, message: 'Mot de passe enregistré. Vous pouvez maintenant vous connecter.' },
      });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (checkError) {
    return (
      <PublicCard title="Lien invalide">
        <ErrorMessage error={checkError} />
        <Link to="/mot-de-passe-oublie" className="mt-4 block text-center text-sm text-primary hover:underline">
          Demander un nouveau lien
        </Link>
        {backToLogin}
      </PublicCard>
    );
  }
  if (!info) return <Loading />;

  const invite = info.purpose === 'invite';
  return (
    <PublicCard title={invite ? `Bienvenue ${info.firstName}` : 'Nouveau mot de passe'}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {invite ? 'Choisissez le mot de passe de votre compte' : 'Choisissez un nouveau mot de passe pour'} <strong className="text-ink">{info.email}</strong>.
        </p>
        {/* Champ caché : aide le gestionnaire de mots de passe à associer le bon compte */}
        <input type="email" autoComplete="username" value={info.email} readOnly hidden />
        <TextField label="Mot de passe" type="password" autoComplete="new-password" required minLength={MIN_LENGTH}
          maxLength={200} autoFocus value={password} onChange={(e) => setPasswordValue(e.target.value)}
          hint={`Au moins ${MIN_LENGTH} caractères. Une courte phrase est facile à retenir et difficile à deviner.`} />
        <TextField label="Confirmer le mot de passe" type="password" autoComplete="new-password" required
          minLength={MIN_LENGTH} maxLength={200} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <ErrorMessage error={error} />
        <Button type="submit" variant="primary" busy={busy}>{invite ? 'Activer mon compte' : 'Enregistrer'}</Button>
      </form>
    </PublicCard>
  );
}
