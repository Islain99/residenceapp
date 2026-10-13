// Plateforme — sécurité : comptes bloqués, refus de connexion, événements suspects.
import { useState } from 'react';
import { Link } from 'react-router';
import { usePlatformAccountAction, usePlatformSecurity } from '../../api/hooks';
import { ROLE_LABELS } from '../../auth/session';
import { Button, EmptyState, ErrorMessage, Loading, PageHeader } from '../../components/ui';
import { formatFull, formatWhen, fullName } from '../../lib/format';

const EVENTS: Record<string, string> = {
  refresh_reuse: 'Jeton de session réutilisé (vol possible) : toutes ses sessions ont été fermées',
  login_failed: 'Compte bloqué après trop de mots de passe erronés',
};

export function PlatformSecurityPage() {
  const security = usePlatformSecurity();
  const unlock = usePlatformAccountAction();
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Sécurité" subtitle="Toutes les résidences. Actualisé chaque minute." />
      {notice && <p role="status" className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">{notice}</p>}

      {security.isPending ? <Loading /> : security.isError ? <ErrorMessage error={security.error} /> : (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 text-lg font-semibold">Comptes bloqués</h2>
            {security.data.locked.length === 0 ? <EmptyState>Aucun compte bloqué.</EmptyState> : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {security.data.locked.map((u) => (
                  <li key={u.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
                    <span className="flex-1">
                      <strong>{fullName(u)}</strong> · {ROLE_LABELS[u.role]} · {u.residence?.name ?? 'Plateforme'}
                      <span className="block text-muted">{u.email} · bloqué jusqu’à {formatWhen(u.lockedUntil)}</span>
                    </span>
                    <Button busy={unlock.isPending} onClick={() => unlock.mutate({ id: u.id, action: 'unlock' }, {
                      onSuccess: () => setNotice(`Compte de ${fullName(u)} débloqué.`),
                    })}>Débloquer</Button>
                  </li>
                ))}
              </ul>
            )}
            <ErrorMessage error={unlock.error} />
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Connexions refusées (24 dernières heures)</h2>
            {security.data.failedLogins24h.length === 0 ? <EmptyState>Aucune.</EmptyState> : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {security.data.failedLogins24h.map((f) => (
                  <li key={f.residence?.id ?? 'none'} className="flex items-center justify-between px-4 py-3 text-sm">
                    {f.residence
                      ? <Link to={`/plateforme/residences/${f.residence.id}`} className="text-primary hover:underline">{f.residence.name}</Link>
                      : <span>Courriels inconnus ou administrateurs</span>}
                    <strong className="tabular-nums">{f.count}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Événements à surveiller (7 jours)</h2>
            {security.data.events.length === 0 ? <EmptyState>Rien à signaler.</EmptyState> : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {security.data.events.map((e) => (
                  <li key={e.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:gap-4">
                    <time dateTime={e.at} className="shrink-0 text-xs text-muted sm:w-44">{formatFull(e.at)}</time>
                    <span className="flex-1">
                      <strong>{e.user ? fullName(e.user) : 'Compte inconnu'}</strong>
                      {e.residence && <> · {e.residence.name}</>}
                      <span className="block text-muted">{EVENTS[e.action] ?? e.action}{e.ip && ` · adresse ${e.ip}`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
