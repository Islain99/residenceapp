// Invitation discrète à activer les notifications (relève), une seule fois par
// appareil : masquée après « Plus tard », une activation ou un refus.
import { useState } from 'react';
import { Link } from 'react-router';
import { usePushConfig } from '../api/hooks';
import { useAuth } from '../auth/session';
import { enablePush, needsInstallForPush, permission, pushSupported } from '../lib/push';
import { Button, ErrorMessage } from './ui';

const KEY = 'push-prompt-dismissed';

function dismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function PushPrompt() {
  const { sharedDevice, assistance } = useAuth();
  const config = usePushConfig();
  const [hidden, setHidden] = useState(dismissed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const hide = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // stockage indisponible : masqué jusqu'au rechargement
    }
    setHidden(true);
  };

  if (hidden || sharedDevice || assistance || !config.data?.enabled || !config.data.publicKey) return null;
  if (!pushSupported() || needsInstallForPush() || permission() !== 'default') return null;
  const key = config.data.publicKey;

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-line bg-info-soft p-4 text-sm sm:flex-row sm:items-center">
      <p className="flex-1">
        <strong>Recevoir les avis sur cet appareil ?</strong> Consignes prioritaires, messages, annonces et suivis,
        même application fermée (<Link to="/compte" className="text-primary underline">réglages</Link>).
      </p>
      <div className="flex gap-2">
        <Button variant="primary" busy={busy} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await enablePush(key);
            hide();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}>Activer</Button>
        <Button variant="ghost" onClick={hide}>Plus tard</Button>
      </div>
      <ErrorMessage error={error} />
    </div>
  );
}
