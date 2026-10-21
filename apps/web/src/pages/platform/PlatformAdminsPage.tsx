// Plateforme — administrateurs : inviter, désactiver, réactiver.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useInviteAdmin, usePlatformAdmins } from '../../api/hooks';
import { PlatformAccountRow } from '../../components/platform';
import { Button, Dialog, ErrorMessage, Loading, PageHeader, SelectField, TextField } from '../../components/ui';
import { currentLanguage, LANGS } from '../../i18n';

export function PlatformAdminsPage() {
  const { t } = useTranslation();
  const admins = usePlatformAdmins();
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title={t('platform.admins.title')}
        subtitle={t('platform.admins.subtitle')}
        actions={<Button data-tour="platform-admins-invite" variant="primary" onClick={() => setInviting(true)}>{t('platform.admins.invite')}</Button>}
      />
      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}
      {admins.isPending ? <Loading /> : admins.isError ? <ErrorMessage error={admins.error} /> : (
        <ul className="flex flex-col gap-3">
          {admins.data.map((a) => <PlatformAccountRow key={a.id} account={a} onNotice={setNotice} />)}
        </ul>
      )}
      <Dialog open={inviting} onClose={() => setInviting(false)} title={t('platform.admins.inviteTitle')}>
        <InviteAdminForm onDone={(email) => {
          setInviting(false);
          if (email) setNotice(t('platform.admins.invited', { email }));
        }} />
      </Dialog>
    </>
  );
}

function InviteAdminForm({ onDone }: { onDone: (email?: string) => void }) {
  const { t } = useTranslation();
  const invite = useInviteAdmin();
  const [v, setV] = useState({ email: '', firstName: '', lastName: '', locale: currentLanguage() });
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const created = await invite.mutateAsync(v);
    onDone(created.email);
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('common.firstName')} required maxLength={100} value={v.firstName} onChange={set('firstName')} />
        <TextField label={t('common.lastName')} required maxLength={100} value={v.lastName} onChange={set('lastName')} />
      </div>
      <TextField label={t('common.email')} type="email" required maxLength={254} value={v.email} onChange={set('email')} />
      <SelectField label={t('platform.home.language')} value={v.locale} onChange={set('locale')}>
        {LANGS.map((l) => <option key={l} value={l}>{t(`common.language.${l}`)}</option>)}
      </SelectField>
      <ErrorMessage error={invite.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone()}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" busy={invite.isPending}>{t('platform.residence.sendInvite')}</Button>
      </div>
    </form>
  );
}
