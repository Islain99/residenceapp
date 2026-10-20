// Mon profil : avatar et coordonnées, mot de passe, apparence (thème et
// langue), notifications sur cet appareil, double authentification.
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useChangePassword, useMfaStatus, usePushConfig, usePushPreferences, useRegenerateBackupCodes, useSendTestPush,
  useUpdateProfile, useUpdatePushPreferences,
} from '../api/hooks';
import type { PushPreferences, User } from '../api/types';
import { useAuth, useUser } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { BackupCodes, CodeForm } from '../components/mfa';
import { Badge, Button, Card, Checkbox, Dialog, ErrorMessage, Loading, TextField } from '../components/ui';
import { AVATAR_COLORS, avatarColorOf, GALLERY, type AvatarColor } from '../lib/avatar';
import { cx } from '../lib/cx';
import { formatFull, fullName } from '../lib/format';
import { currentSubscription, disablePush, enablePush, needsInstallForPush, permission, pushSupported } from '../lib/push';
import { setThemePreference, THEMES, useThemePreference } from '../lib/theme';

const PASSWORD_MIN_LENGTH = 12;   // même règle que l'API

export function AccountPage() {
  const { t } = useTranslation();
  const user = useUser();
  const { assistance } = useAuth();
  return (
    <>
      <div className="mb-6 flex items-center gap-4">
        <Avatar person={user} size="lg" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t('account.title')}</h1>
          <p className="mt-1 break-words text-sm text-muted">{fullName(user)} · {user.email} · {t(`common.roles.${user.role}`)}</p>
        </div>
      </div>
      <div className="flex flex-col gap-6">
        {/* Accès d'assistance : consultation seulement, le profil de l'admin ne se modifie pas ici */}
        {!assistance && <ProfileSection user={user} />}
        {!assistance && <PasswordSection email={user.email} />}
        <AppearanceSection />
        <NotificationsSection forResidence={!!user.residenceId} />
        <MfaSection />
      </div>
    </>
  );
}

// Avatar (illustration de la galerie ou initiales, couleur du fond), prénom,
// nom, téléphone. Le courriel et le rôle sont gérés par la responsable (ou
// l'administration de la plateforme).
function ProfileSection({ user }: { user: User }) {
  const { t } = useTranslation();
  const update = useUpdateProfile();
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [avatar, setAvatar] = useState<string | null>(user.avatar);
  const [color, setColor] = useState<AvatarColor>(() => avatarColorOf(user));
  const [saved, setSaved] = useState(false);
  // Aperçu avec les valeurs en cours de saisie
  const preview = { id: user.id, firstName: firstName || user.firstName, lastName: lastName || user.lastName, avatar, avatarColor: color };
  const pick = (next: string | null) => { setAvatar(next); setSaved(false); };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    await update.mutateAsync({ firstName, lastName, phone: phone.trim() || null, avatar, avatarColor: color });
    setSaved(true);
  }

  // Une tuile de la galerie (bouton radio) : l'avatar sur la couleur choisie
  const tile = (id: string | null, label: string) => (
    <button key={id ?? 'initiales'} type="button" role="radio" aria-checked={avatar === id} aria-label={label} title={label}
      onClick={() => pick(id)}
      className={cx('rounded-full p-0.5 ring-offset-2 ring-offset-surface transition',
        avatar === id ? 'ring-2 ring-primary' : 'hover:scale-110')}>
      <Avatar person={{ ...preview, avatar: id }} />
    </button>
  );

  return (
    <Card className="p-5">
      <form onSubmit={submit} onChange={() => setSaved(false)} className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('account.avatar.title')}</h2>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Avatar person={preview} size="lg" className="self-center sm:self-start" />
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {GALLERY.map((group) => {
              const style = t(`account.avatar.styles.${group.style}`);
              return (
                <fieldset key={group.style}>
                  <legend className="mb-2 text-sm font-medium">{style}</legend>
                  <div role="radiogroup" aria-label={t('account.avatar.gallery', { style })} className="flex flex-wrap gap-2">
                    {group.ids.map((id, i) => tile(id, t('account.avatar.tile', { style, n: i + 1 })))}
                  </div>
                </fieldset>
              );
            })}
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t('account.avatar.none')}</legend>
              <div role="radiogroup" aria-label={t('account.avatar.none')} className="flex gap-2">
                {tile(null, t('account.avatar.initials'))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t('account.avatar.background')}</legend>
              <div role="radiogroup" aria-label={t('account.avatar.background')} className="flex flex-wrap gap-2">
                {(Object.keys(AVATAR_COLORS) as AvatarColor[]).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={t(`account.avatar.colors.${c}`)}
                    title={t(`account.avatar.colors.${c}`)} onClick={() => { setColor(c); setSaved(false); }}
                    className={cx('size-8 rounded-full ring-offset-2 ring-offset-surface transition',
                      c === color ? 'ring-2 ring-ink' : 'hover:scale-110')}
                    style={{ backgroundColor: AVATAR_COLORS[c].hex }} />
                ))}
              </div>
            </fieldset>
          </div>
        </div>

        <h2 className="mt-2 border-t border-line pt-5 text-lg font-semibold">{t('account.details.title')}</h2>
        <p className="-mt-2 text-sm text-muted">{t('account.details.hint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('common.firstName')} required maxLength={100} autoComplete="given-name" value={firstName}
            onChange={(e) => setFirstName(e.target.value)} />
          <TextField label={t('common.lastName')} required maxLength={100} autoComplete="family-name" value={lastName}
            onChange={(e) => setLastName(e.target.value)} />
        </div>
        <TextField label={t('account.details.phone')} type="tel" maxLength={30} autoComplete="tel" value={phone}
          pattern="[0-9 +().\-]{7,30}" title={t('account.details.phoneRule')}
          onChange={(e) => setPhone(e.target.value)} placeholder={t('account.details.phonePlaceholder')} />

        <ErrorMessage error={update.error} />
        {saved && <p role="status" className="rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive">{t('account.details.saved')}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" busy={update.isPending}>{t('common.save')}</Button>
        </div>
      </form>
    </Card>
  );
}

// Thème de cet appareil (lib/theme.ts, clair par défaut) et langue (aussi
// enregistrée dans le compte : courriels et notifications)
function AppearanceSection() {
  const { t } = useTranslation();
  const theme = useThemePreference();
  return (
    <Card className="p-5">
      <h2 className="mb-1 text-lg font-semibold">{t('account.appearance.title')}</h2>
      <p className="mb-4 text-sm text-muted">{t('account.appearance.hint')}</p>
      <div role="radiogroup" aria-label={t('account.appearance.theme')} className="inline-flex flex-wrap gap-1 rounded-xl bg-sunken p-1">
        {THEMES.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={theme === option} onClick={() => setThemePreference(option)}
            className={cx('min-h-10 rounded-lg px-4 text-sm font-medium transition-colors',
              theme === option ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-ink')}>
            {t(`account.appearance.themes.${option}`)}
          </button>
        ))}
      </div>
      <h3 className="mb-1 mt-5 text-sm font-semibold">{t('account.appearance.language')}</h3>
      <p className="mb-2 text-sm text-muted">{t('account.appearance.languageHint')}</p>
      <LanguageSwitch />
    </Card>
  );
}

// Changer son mot de passe en connaissant l'actuel
function PasswordSection({ email }: { email: string }) {
  const { t } = useTranslation();
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
      setError(new Error(t('account.password.mismatch')));
      return;
    }
    try {
      const res = await change.mutateAsync({ currentPassword: current, newPassword: next, signOutOthers });
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(res.otherSessionsClosed > 0
        ? t('account.password.changedClosed', { count: res.otherSessionsClosed })
        : t('account.password.changed'));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-lg font-semibold">{t('account.password.title')}</h2>
      <p className="mb-4 text-sm text-muted">{t('account.password.hint')}</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* Champ caché : aide le gestionnaire de mots de passe à associer le bon compte */}
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <TextField label={t('account.password.current')} type="password" autoComplete="current-password" required maxLength={200}
          value={current} onChange={(e) => setCurrent(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('account.password.new')} type="password" autoComplete="new-password" required
            minLength={PASSWORD_MIN_LENGTH} maxLength={200} value={next} onChange={(e) => setNext(e.target.value)}
            hint={t('account.password.newHint', { min: PASSWORD_MIN_LENGTH })} />
          <TextField label={t('account.password.confirm')} type="password" autoComplete="new-password" required
            minLength={PASSWORD_MIN_LENGTH} maxLength={200} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Checkbox label={t('account.password.signOutOthers')} checked={signOutOthers}
          onChange={(e) => setSignOutOthers(e.target.checked)} />
        <ErrorMessage error={error} />
        {done && <p role="status" className="rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive">{done}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" busy={change.isPending}>{t('account.password.submit')}</Button>
        </div>
      </form>
    </Card>
  );
}

const KINDS: (keyof Omit<PushPreferences, 'devices'>)[] = ['priorityNotes', 'messages', 'announcements', 'followUps'];

// Administration de la plateforme : aucun avis à recevoir, mais l'essai
// permet de vérifier les notifications (clés VAPID) sur un appareil
function NotificationsSection({ forResidence }: { forResidence: boolean }) {
  const { t } = useTranslation();
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
        setNotice(t('account.notifications.enabledHere'));
      }
      await prefs.refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  let unavailable: string | null = null;
  if (config.data && !config.data.enabled) unavailable = t('account.notifications.notConfigured');
  else if (sharedDevice) unavailable = t('account.notifications.sharedDevice');
  else if (needsInstallForPush()) unavailable = t('account.notifications.installFirst');
  else if (!pushSupported()) unavailable = t('account.notifications.unsupported');
  else if (permission() === 'denied') unavailable = t('account.notifications.blocked');

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-lg font-semibold">{t('account.notifications.title')}</h2>
      <p className="mb-4 text-sm text-muted">{t('account.notifications.hint')}</p>
      {config.isPending || subscribed === null ? <Loading /> : unavailable ? (
        <p className="rounded-lg bg-sunken px-4 py-3 text-sm">{unavailable}</p>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Badge tone={subscribed ? 'positive' : 'neutral'}>{subscribed ? t('account.notifications.on') : t('account.notifications.off')}</Badge>
          <Button variant={subscribed ? 'secondary' : 'primary'} busy={busy} onClick={() => void toggle()}>
            {subscribed ? t('account.notifications.disable') : t('account.notifications.enable')}
          </Button>
          {(subscribed || (prefs.data?.devices ?? 0) > 0) && (
            <Button variant="ghost" busy={test.isPending} onClick={() => test.mutate(undefined, {
              onSuccess: (r) => setNotice(r.sent
                ? t('account.notifications.testSent', { count: r.sent })
                : t('account.notifications.testNone')),
            })}>{t('account.notifications.test')}</Button>
          )}
        </div>
      )}
      {notice && <p role="status" className="mb-3 rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive">{notice}</p>}
      <ErrorMessage error={error ?? test.error ?? update.error} />

      {forResidence && prefs.data && (
        <fieldset className="mt-2 flex flex-col">
          <legend className="mb-1 text-sm font-semibold">
            {t('account.notifications.receive')}
            {prefs.data.devices > 0 && <span className="font-normal text-muted">{t('account.notifications.devices', { count: prefs.data.devices })}</span>}
          </legend>
          {KINDS.map((k) => (
            <Checkbox key={k} checked={prefs.data[k]} disabled={update.isPending}
              onChange={(e) => update.mutate({ [k]: e.target.checked })}
              label={<span>{t(`account.notifications.kinds.${k}`)} <span className="text-muted">— {t(`account.notifications.kinds.${k}Hint`)}</span></span>} />
          ))}
        </fieldset>
      )}
    </Card>
  );
}

function MfaSection() {
  const { t } = useTranslation();
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
      <h2 className="mb-1 text-lg font-semibold">{t('account.mfa.title')}</h2>
      {s.enabled ? (
        <>
          <p className="mb-3 text-sm text-muted">
            {s.enabledAt ? t('account.mfa.enabledOn', { date: formatFull(s.enabledAt) }) : t('account.mfa.enabled')}. {t('account.mfa.enabledHint')}
          </p>
          <p className="mb-4 text-sm">
            {t('account.mfa.remaining')} <strong>{s.backupCodesRemaining}</strong>
            {s.backupCodesRemaining <= 3 && <span className="text-danger">{t('account.mfa.generateMore')}</span>}
          </p>
          {!assistance && <Button onClick={() => setAsking(true)}>{t('account.mfa.regenerate')}</Button>}
          <p className="mt-3 text-xs text-muted">{t('account.mfa.lostPhone')}</p>
        </>
      ) : (
        <p className="text-sm text-muted">{t('account.mfa.toSetUp')}</p>
      )}
      <Dialog open={asking} onClose={() => { setAsking(false); setCodes(null); regenerate.reset(); }} title={t('account.mfa.newCodesTitle')}>
        {codes ? (
          <BackupCodes codes={codes} doneLabel={t('account.mfa.done')} onDone={() => { setAsking(false); setCodes(null); }} />
        ) : (
          <>
            <p className="mb-4 text-sm">{t('account.mfa.oldCodesWarning')}</p>
            <CodeForm submitLabel={t('account.mfa.generate')} busy={regenerate.isPending} error={regenerate.error}
              onSubmit={(code) => regenerate.mutate(code, { onSuccess: (r) => setCodes(r.backupCodes) })} />
          </>
        )}
      </Dialog>
    </Card>
  );
}
