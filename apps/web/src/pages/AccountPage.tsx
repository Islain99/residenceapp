// Mon profil : coordonnées, mot de passe, notifications sur cet appareil,
// double authentification.
import { useEffect, useState, type FormEvent } from 'react';
import {
  useChangePassword, useMfaStatus, usePushConfig, usePushPreferences, useRegenerateBackupCodes, useSendTestPush,
  useUpdateProfile, useUpdatePushPreferences,
} from '../api/hooks';
import type { PushPreferences, User } from '../api/types';
import { ROLE_LABELS, useAuth, useUser } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { AVATAR_COLORS, avatarColorOf, type AvatarColor } from '../lib/avatar';
import { BackupCodes, CodeForm } from '../components/mfa';
import { Badge, Button, Card, Checkbox, Dialog, ErrorMessage, Loading, TextField } from '../components/ui';
import { cx } from '../lib/cx';
import { formatFull, fullName } from '../lib/format';
import { currentSubscription, disablePush, enablePush, needsInstallForPush, permission, pushSupported } from '../lib/push';

const PASSWORD_MIN_LENGTH = 12;   // même règle que l'API

export function AccountPage() {
  const user = useUser();
  const { assistance } = useAuth();
  return (
    <>
      <div className="mb-6 flex items-center gap-4">
        <Avatar person={user} size="lg" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Mon profil</h1>
          <p className="mt-1 break-words text-sm text-muted">{fullName(user)} · {user.email} · {ROLE_LABELS[user.role]}</p>
        </div>
      </div>
      <div className="flex flex-col gap-6">
        {/* Accès d'assistance : consultation seulement, le profil de l'admin ne se modifie pas ici */}
        {!assistance && <ProfileSection user={user} />}
        {!assistance && <PasswordSection email={user.email} />}
        <NotificationsSection forResidence={!!user.residenceId} />
        <MfaSection />
      </div>
    </>
  );
}

// Prénom, nom, téléphone, couleur du rond. Le courriel et le rôle sont gérés
// par la responsable (ou l'administration de la plateforme).
function ProfileSection({ user }: { user: User }) {
  const update = useUpdateProfile();
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [color, setColor] = useState<AvatarColor>(() => avatarColorOf(user));
  const [saved, setSaved] = useState(false);
  // Aperçu du rond avec les valeurs en cours de saisie
  const preview = { id: user.id, firstName: firstName || user.firstName, lastName: lastName || user.lastName, avatarColor: color };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    await update.mutateAsync({ firstName, lastName, phone: phone.trim() || null, avatarColor: color });
    setSaved(true);
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-lg font-semibold">Mes coordonnées</h2>
      <p className="mb-4 text-sm text-muted">
        Visibles par la responsable dans l’équipe. Le courriel et le rôle se changent auprès d’elle.
      </p>
      <form onSubmit={submit} onChange={() => setSaved(false)} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Prénom" required maxLength={100} autoComplete="given-name" value={firstName}
            onChange={(e) => setFirstName(e.target.value)} />
          <TextField label="Nom" required maxLength={100} autoComplete="family-name" value={lastName}
            onChange={(e) => setLastName(e.target.value)} />
        </div>
        <TextField label="Téléphone (facultatif)" type="tel" maxLength={30} autoComplete="tel" value={phone}
          pattern="[0-9 +().\-]{7,30}" title="Chiffres, espaces, + ( ) . - (7 caractères au moins)"
          onChange={(e) => setPhone(e.target.value)} placeholder="Ex. : 514 555-0123" />

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Couleur de mon rond</legend>
          <div className="flex flex-wrap items-center gap-3">
            <Avatar person={preview} size="md" />
            <div role="radiogroup" aria-label="Couleur de mon rond" className="flex flex-wrap gap-2">
              {(Object.keys(AVATAR_COLORS) as AvatarColor[]).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={AVATAR_COLORS[c].label}
                  title={AVATAR_COLORS[c].label} onClick={() => { setColor(c); setSaved(false); }}
                  className={cx('size-8 rounded-full ring-offset-2 ring-offset-surface transition',
                    c === color ? 'ring-2 ring-ink' : 'hover:scale-110')}
                  style={{ backgroundColor: AVATAR_COLORS[c].hex }} />
              ))}
            </div>
          </div>
        </fieldset>

        <ErrorMessage error={update.error} />
        {saved && <p role="status" className="rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive">Profil enregistré.</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" busy={update.isPending}>Enregistrer</Button>
        </div>
      </form>
    </Card>
  );
}

// Changer son mot de passe en connaissant l'actuel
function PasswordSection({ email }: { email: string }) {
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (next !== confirm) {
      setError(new Error('Les deux nouveaux mots de passe ne sont pas identiques.'));
      return;
    }
    try {
      const res = await change.mutateAsync({ currentPassword: current, newPassword: next, signOutOthers });
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(res.otherSessionsClosed > 0
        ? `Mot de passe changé. ${res.otherSessionsClosed} autre${res.otherSessionsClosed > 1 ? 's' : ''} session${res.otherSessionsClosed > 1 ? 's' : ''} fermée${res.otherSessionsClosed > 1 ? 's' : ''}.`
        : 'Mot de passe changé.');
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-lg font-semibold">Mot de passe</h2>
      <p className="mb-4 text-sm text-muted">Un courriel vous avertit à chaque changement.</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* Champ caché : aide le gestionnaire de mots de passe à associer le bon compte */}
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <TextField label="Mot de passe actuel" type="password" autoComplete="current-password" required maxLength={200}
          value={current} onChange={(e) => setCurrent(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Nouveau mot de passe" type="password" autoComplete="new-password" required
            minLength={PASSWORD_MIN_LENGTH} maxLength={200} value={next} onChange={(e) => setNext(e.target.value)}
            hint={`Au moins ${PASSWORD_MIN_LENGTH} caractères. Une courte phrase est facile à retenir.`} />
          <TextField label="Confirmer le nouveau mot de passe" type="password" autoComplete="new-password" required
            minLength={PASSWORD_MIN_LENGTH} maxLength={200} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Checkbox label="Déconnecter mes autres appareils" checked={signOutOthers}
          onChange={(e) => setSignOutOthers(e.target.checked)} />
        <ErrorMessage error={error} />
        {done && <p role="status" className="rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive">{done}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" busy={change.isPending}>Changer le mot de passe</Button>
        </div>
      </form>
    </Card>
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
