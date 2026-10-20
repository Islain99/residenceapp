import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useResidents, useSaveResident } from '../api/hooks';
import { isSupervisor, useUser } from '../auth/session';
import { ResidentForm } from '../components/ResidentForm';
import { Badge, Button, Chip, Dialog, EmptyState, ErrorMessage, Loading, PageHeader } from '../components/ui';
import { fullName } from '../lib/format';

export function ResidentsPage() {
  const { t } = useTranslation();
  const user = useUser();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'actif' | 'parti'>('actif');
  const [creating, setCreating] = useState(false);
  const residents = useResidents(status, q.trim());
  const save = useSaveResident();

  return (
    <>
      <PageHeader
        title={t('residents.list.title')}
        actions={isSupervisor(user.role) && <Button variant="primary" onClick={() => setCreating(true)}>{t('residents.list.add')}</Button>}
      />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t('residents.list.search')} aria-label={t('residents.list.searchLabel')}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base sm:max-w-xs sm:text-sm"
        />
        <div className="flex gap-2">
          <Chip active={status === 'actif'} onClick={() => setStatus('actif')}>{t('residents.list.present')}</Chip>
          <Chip active={status === 'parti'} onClick={() => setStatus('parti')}>{t('residents.list.left')}</Chip>
        </div>
      </div>

      {residents.isPending ? <Loading /> : residents.isError ? <ErrorMessage error={residents.error} /> :
        residents.data.length === 0 ? <EmptyState>{t('residents.list.empty')}</EmptyState> : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {residents.data.map((r) => (
              <li key={r.id}>
                <Link to={`/residents/${r.id}`} className="block h-full rounded-xl border border-line bg-surface p-4 hover:border-primary">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold">{fullName(r)}</span>
                    {r.room && <Badge>{t('residents.list.room', { room: r.room })}</Badge>}
                  </div>
                  {r.specialInstructions && <p className="mt-2 line-clamp-2 text-sm text-priority">{r.specialInstructions}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}

      <Dialog open={creating} onClose={() => setCreating(false)} title={t('residents.list.addTitle')}>
        <ResidentForm
          onCancel={() => setCreating(false)}
          onSubmit={async (input) => {
            const created = await save.mutateAsync(input);
            setCreating(false);
            navigate(`/residents/${created.id}`);
          }}
        />
      </Dialog>
    </>
  );
}
