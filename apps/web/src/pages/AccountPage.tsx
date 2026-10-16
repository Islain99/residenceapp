// Mon compte : notifications sur cet appareil, double authentification.
import { useEffect, useState } from 'react';
import {
  useMfaStatus, usePushConfig, usePushPreferences, useRegenerateBackupCodes, useSendTestPush, useUpdatePushPreferences,
} from '../api/hooks';
import type { PushPreferences } from '../api/types';
import { ROLE_LABELS, useAuth, useUser } from '../auth/session';
import { BackupCodes, CodeForm } from '../components/mfa';
import { Badge, Button, Card, Checkbox, Dialog, ErrorMessage, Loading, PageHeader } from '../components/ui';
import { formatFull, fullName } from '../lib/format';
import { currentSubscription, disablePush, enablePush, needsInstallForPush, permission, pushSupported } from '../lib/push';

export function AccountPage() {
  const user = useUser();
  return (
    <>
      <PageHeader title="Mon compte" subtitle={<>{fullName(user)} · {user.email} · {ROLE_LABELS[user.role]}</>} />
      <div className="flex flex-col gap-6">
        <NotificationsSection forResidence={!!user.residenceId} />
        <MfaSection />
      </div>
    </>
  );
}

const KINDS: { key: keyof Omit<PushPreferences, 'devices'>; label: string; hint: string }[] = [
  { key: 'priorityNotes', label: 'Consignes prioritaires', hint: 'Pendant mon quart (selon l’horaire).' },
  { key: 'messages', label: 'Messages reçus', hint: 'Messages privés, groupes et fil de l’équipe.' },
  { key: 'announcements', label: 'Annonces de la direction', hint: 'À lire et à confirmer.' },
  { key: 'followUps', label: 'Suivis', hint: 'Un suivi m’est confié, ou arrive à échéance.' },
];

// Administration de la plateforme : aucun avis à recevoir, mais l'essai
// permet de vérifier les notifications (clés VAPID) sur un appareil
function NotificationsSection({ forResidence }: { forResidence: boolean }) {
  const { sharedDevice } = useAuth();
  const config = usePushConfig();
  const prefs = usePushPreferences();
  const update = useUpdatePushPreferences();
  const test = useSendTestPush();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    currentSubscription().then((sub) => { if (!cancelled) setSubscribed(!!sub && permission() === 'granted'); }, () => setSubscribed(false));
    return () => { cancelled = true; };
  }, []);

  async function toggle() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
      } else {
        await enablePush(config.data!.publicKey!);
        setSubscribed(true);
        setNotice('Notifications activées sur cet appareil.');
      }
      await prefs.refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  let unavailable: string | null = null;
  if (config.data && !config.data.enabled) unavailable = 'Les notifications ne sont pas encore configurées sur le serveur.';
  else if (sharedDevice) unavailable = 'Appareil partagé : les notifications ne sont pas proposées (elles s’afficheraient à la personne suivante).';
  else if (needsInstallForPush()) unavailable = 'Sur iPhone ou iPad : ajoutez d’abord l’application à l’écran d’accueil (Partager › Sur l’écran d’accueil), puis ouvrez-la depuis cette icône.';
  else if (!pushSupported()) unavailable = 'Ce navigateur ne permet pas les notifications.';
  else if (permission() === 'denied') unavailable = 'Les notifications sont bloquées pour ce site dans les réglages du navigateur : les autoriser, puis revenir ici.';

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-lg font-semibold">Notifications</h2>
      <p className="mb-4 text-sm text-muted">
        Un avis sur le téléphone, même application fermée. Il n’affiche jamais le nom d’un résident ni le texte d’un message : il faut ouvrir l’application.
      </p>
      {config.isPending || subscribed === null ? <Loading /> : unavailable ? (
        <p className="rounded-lg bg-sunken px-4 py-3 text-sm">{unavailable}</p>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Badge tone={subscribed ? 'positive' : 'neutral'}>{subscribed ? 'Activées sur cet appareil' : 'Désactivées sur cet appareil'}</Badge>
          <Button variant={subscribed ? 'secondary' : 'primary'} busy={busy} onClick={() => void toggle()}>
            {subscribed ? 'Désactiver sur cet appareil' : 'Activer sur cet appareil'}
          </Button>
          {(subscribed || (prefs.data?.devices ?? 0) > 0) && (
            <Button variant="ghost" busy={test.isPending} onClick={() => test.mutate(undefined, {
              onSuccess: (r) => setNotice(r.sent
                ? `Notification d’essai envoyée (${r.sent} appareil${r.sent > 1 ? 's' : ''}).`
                : 'Aucun appareil n’a pu être joint : réactiver les notifications sur cet appareil.'),
            })}>Envoyer une notification d’essai</Button>
          )}
        </div>
      )}
      {notice && <p role="status" className="mb-3 rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive">{notice}</p>}
      <ErrorMessage error={error ?? test.error ?? update.error} />

      {forResidence && prefs.data && (
        <fieldset className="mt-2 flex flex-col">
          <legend className="mb-1 text-sm font-semibold">
            Recevoir{prefs.data.devices > 0 && <span className="font-normal text-muted"> · {prefs.data.devices} appareil{prefs.data.devices > 1 ? 's' : ''}</span>}
          </legend>
          {KINDS.map((k) => (
            <Checkbox key={k.key} checked={prefs.data[k.key]} disabled={update.isPending}
              onChange={(e) => update.mutate({ [k.key]: e.target.checked })}
              label={<span>{k.label} <span className="text-muted">— {k.hint}</span></span>} />
          ))}
        </fieldset>
      )}
    </Card>
  );
}

function MfaSection() {
  const status = useMfaStatus();
  const regenerate = useRegenerateBackupCodes();
  const { assistance } = useAuth();
  const [asking, setAsking] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  if (status.isPending) return <Card className="p-5"><Loading /></Card>;
  if (status.isError) return <ErrorMessage error={status.error} />;
  const s = status.data;
  if (!s.required && !s.enabled) return null;

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-lg font-semibold">Double authentification</h2>
      {s.enabled ? (
        <>
          <p className="mb-3 text-sm text-muted">
            Activée {s.enabledAt && <>le {formatFull(s.enabledAt)}</>}. À chaque connexion, un code de votre application d’authentification est demandé.
          </p>
          <p className="mb-4 text-sm">
            Codes de secours restants : <strong>{s.backupCodesRemaining}</strong>
            {s.backupCodesRemaining <= 3 && <span className="text-danger"> — en générer de nouveaux</span>}
          </p>
          {!assistance && <Button onClick={() => setAsking(true)}>Générer de nouveaux codes de secours</Button>}
          <p className="mt-3 text-xs text-muted">
            Téléphone perdu et plus de codes de secours : demandez à l’administration de la plateforme de réinitialiser votre double authentification.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">À configurer à votre prochaine connexion.</p>
      )}
      <Dialog open={asking} onClose={() => { setAsking(false); setCodes(null); regenerate.reset(); }} title="Nouveaux codes de secours">
        {codes ? (
          <BackupCodes codes={codes} doneLabel="Terminé" onDone={() => { setAsking(false); setCodes(null); }} />
        ) : (
          <>
            <p className="mb-4 text-sm">Les anciens codes ne fonctionneront plus. Confirmez avec le code de votre application :</p>
            <CodeForm submitLabel="Générer" busy={regenerate.isPending} error={regenerate.error}
              onSubmit={(code) => regenerate.mutate(code, { onSuccess: (r) => setCodes(r.backupCodes) })} />
          </>
        )}
      </Dialog>
    </Card>
  );
}
