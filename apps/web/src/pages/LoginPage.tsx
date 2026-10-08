import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/session';
import { Button, Card, ErrorMessage, TextField } from '../components/ui';

export function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  // Arrivée depuis « choisir mon mot de passe » : courriel prérempli et message
  const state = location.state as { from?: string; email?: string; message?: string } | null;
  const [email, setEmail] = useState(state?.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    const from = state?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src="/favicon.svg" alt="" className="size-12" />
          <h1 className="text-xl font-bold">Journal de bord</h1>
          <p className="text-sm text-muted">Connectez-vous avec votre compte de la résidence.</p>
        </div>
        {state?.message && (
          <p role="status" className="mb-4 rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive">{state.message}</p>
        )}
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TextField label="Courriel" type="email" autoComplete="username" required autoFocus={!state?.email}
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label="Mot de passe" type="password" autoComplete="current-password" required autoFocus={!!state?.email}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <ErrorMessage error={error} />
          <Button type="submit" variant="primary" busy={busy}>Se connecter</Button>
        </form>
        <Link to="/mot-de-passe-oublie" className="mt-4 block text-center text-sm text-primary hover:underline">
          Mot de passe oublié ?
        </Link>
      </Card>
    </main>
  );
}
