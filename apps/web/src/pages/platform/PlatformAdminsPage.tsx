// Plateforme — administrateurs : inviter, désactiver, réactiver.
import { useState, type FormEvent } from 'react';
import { useInviteAdmin, usePlatformAdmins } from '../../api/hooks';
import { PlatformAccountRow } from '../../components/platform';
import { Button, Dialog, ErrorMessage, Loading, PageHeader, TextField } from '../../components/ui';

export function PlatformAdminsPage() {
  const admins = usePlatformAdmins();
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Administrateurs"
        subtitle="Ils gèrent les résidences et leurs responsables, jamais le contenu d’une résidence."
        actions={<Button variant="primary" onClick={() => setInviting(true)}>+ Inviter un administrateur</Button>}
      />
      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}
      {admins.isPending ? <Loading /> : admins.isError ? <ErrorMessage error={admins.error} /> : (
        <ul className="flex flex-col gap-3">
          {admins.data.map((a) => <PlatformAccountRow key={a.id} account={a} onNotice={setNotice} />)}
        </ul>
      )}
      <Dialog open={inviting} onClose={() => setInviting(false)} title="Inviter un administrateur">
        <InviteAdminForm onDone={(email) => {
          setInviting(false);
          if (email) setNotice(`Invitation envoyée à ${email} (valable 72 heures).`);
        }} />
      </Dialog>
    </>
  );
}

function InviteAdminForm({ onDone }: { onDone: (email?: string) => void }) {
  const invite = useInviteAdmin();
  const [v, setV] = useState({ email: '', firstName: '', lastName: '' });
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const created = await invite.mutateAsync(v);
    onDone(created.email);
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Prénom" required maxLength={100} value={v.firstName} onChange={set('firstName')} />
        <TextField label="Nom" required maxLength={100} value={v.lastName} onChange={set('lastName')} />
      </div>
      <TextField label="Courriel" type="email" required maxLength={254} value={v.email} onChange={set('email')} />
      <ErrorMessage error={invite.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone()}>Annuler</Button>
        <Button type="submit" variant="primary" busy={invite.isPending}>Envoyer l’invitation</Button>
      </div>
    </form>
  );
}
