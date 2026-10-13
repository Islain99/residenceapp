// Statistiques d'un résident (infirmière, responsable) : mois ou année,
// comparés à la période précédente. Période dans l'adresse
// (?periode=mois|annee&date=AAAA-MM-JJ), donc partageable.
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useResidentStats } from '../api/hooks';
import type { ResidentStats, StatsPeriod } from '../api/types';
import { isSupervisor, useUser } from '../auth/session';
import { ColumnChart, CompareBars, StatTile, type Column } from '../components/charts';
import { Button, Card, Chip, EmptyState, ErrorMessage, Loading } from '../components/ui';
import { fromDateParam, fullName } from '../lib/format';

const monthTitle = new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthShort = new Intl.DateTimeFormat('fr-CA', { month: 'short', timeZone: 'UTC' });
const dayTitle = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

const SLOT_LABELS = { nuit: 'Nuit (0 h – 6 h)', matin: 'Matin (6 h – 12 h)', apres_midi: 'Après-midi (12 h – 18 h)', soir: 'Soir (18 h – 24 h)' };
const SLOT_PHRASES = { nuit: 'la nuit (0 h – 6 h)', matin: 'le matin (6 h – 12 h)', apres_midi: 'l’après-midi (12 h – 18 h)', soir: 'le soir (18 h – 24 h)' };

// Dates AAAA-MM-JJ de l'API : affichées sans conversion de fuseau
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

function periodLabel(unit: StatsPeriod, start: string) {
  return unit === 'month' ? monthTitle.format(utc(start)) : start.slice(0, 4);
}

// Jour au milieu de la période voisine (évite les bords de mois)
function shift(unit: StatsPeriod, start: string, direction: -1 | 1) {
  const d = utc(start);
  if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + direction, 15);
  else d.setUTCFullYear(d.getUTCFullYear() + direction, 6, 1);
  return d.toISOString().slice(0, 10);
}

// Réservé à l'infirmière et à la responsable (l'API refuse les autres rôles) :
// message clair plutôt qu'une erreur si un préposé arrive ici par un lien.
export function ResidentStatsPage() {
  const user = useUser();
  const { id = '' } = useParams();
  if (!isSupervisor(user.role)) {
    return (
      <>
        <Link to={`/residents/${id}`} className="mb-4 inline-block text-sm text-primary hover:underline">← Dossier du résident</Link>
        <EmptyState>Les statistiques sont réservées à l'infirmière et à la responsable.</EmptyState>
      </>
    );
  }
  return <ResidentStats />;
}

function ResidentStats() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const unit: StatsPeriod = params.get('periode') === 'annee' ? 'year' : 'month';
  const date = fromDateParam(params.get('date')) ? params.get('date')! : undefined;
  const stats = useResidentStats(id, unit, date);

  // null : retire le paramètre (période par défaut : mois en cours)
  const go = (next: { periode?: string | null; date?: string | null }) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
    setParams(p, { replace: true });
  };

  if (stats.isPending) return <Loading />;
  if (stats.isError) return <ErrorMessage error={stats.error} />;
  const s = stats.data;

  return (
    <>
      <Link to={`/residents/${id}`} className="mb-4 inline-block text-sm text-primary hover:underline">← Fiche du résident</Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Statistiques — {fullName(s.resident)}</h1>
          <p className="mt-1 text-sm text-muted">Notes du journal, sans les notes annulées. Comparaison avec la période précédente.</p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Période">
          <Chip active={unit === 'month'} onClick={() => go({ periode: null, date })}>Mois</Chip>
          <Chip active={unit === 'year'} onClick={() => go({ periode: 'annee', date })}>Année</Chip>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Button aria-label="Période précédente" onClick={() => go({ date: shift(unit, s.period.start, -1) })}>←</Button>
        <Button aria-label="Période suivante" onClick={() => go({ date: shift(unit, s.period.start, 1) })}>→</Button>
        <Button variant="ghost" onClick={() => go({ date: null })}>{unit === 'month' ? 'Ce mois-ci' : 'Cette année'}</Button>
        <h2 className="ml-1 text-lg font-semibold first-letter:uppercase">
          {periodLabel(unit, s.period.start)}
          {stats.isFetching && <span className="ml-2 text-sm font-normal text-muted">mise à jour…</span>}
        </h2>
      </div>

      <StatsView stats={s} />
    </>
  );
}

function StatsView({ stats: s }: { stats: ResidentStats }) {
  const unit = s.period.unit;
  const previousLabel = unit === 'month' ? 'le mois précédent' : "l'année précédente";
  const [categoryId, setCategoryId] = useState<string | null>(null);   // filtre du graphique dans le temps
  const t = s.totals;

  if (t.notes === 0 && t.previousNotes === 0) {
    return <EmptyState>Aucune note pour ce résident sur cette période ni la précédente.</EmptyState>;
  }

  const categoryLabel = (id: string) => s.categories.find((c) => c.id === id)?.label ?? '—';
  const columns: Column[] = s.timeline.map((p) => {
    const d = utc(p.bucket);
    const value = categoryId ? p.byCategory[categoryId] ?? 0 : p.total;
    const breakdown = Object.entries(p.byCategory).sort((a, b) => b[1] - a[1]);
    return {
      key: p.bucket,
      value,
      title: unit === 'month' ? dayTitle.format(d) : monthTitle.format(d),
      axisLabel: unit === 'month' ? (d.getUTCDate() === 1 || d.getUTCDate() % 5 === 0 ? String(d.getUTCDate()) : '') : monthShort.format(d),
      details: !categoryId && breakdown.length > 0 && (
        <ul className="mt-1 text-muted">
          {breakdown.map(([id, n]) => <li key={id}>{categoryLabel(id)} : {n}</li>)}
        </ul>
      ),
    };
  });
  const active = s.categories.filter((c) => c.count > 0);
  const slotMax = Math.max(...s.timeOfDay.map((x) => x.count));

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Chiffres clés" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Notes" value={t.notes} previous={t.previousNotes} previousLabel={previousLabel} />
        <StatTile label="Consignes prioritaires" value={t.priority} previous={t.previousPriority} previousLabel={previousLabel} />
        <StatTile label="Observations positives" value={t.positive} previous={t.previousPositive} previousLabel={previousLabel}
          hint={t.notes > 0 ? `${Math.round((t.positive / t.notes) * 100)} % des notes` : undefined} />
        <StatTile label="Suivis ouverts sur la période" value={s.followUps.opened}
          hint={`${s.followUps.closed} fermé${s.followUps.closed > 1 ? 's' : ''} · ${s.followUps.openNow} encore ouvert${s.followUps.openNow > 1 ? 's' : ''} aujourd'hui · ${s.appointments} rendez-vous`} />
      </section>

      <Highlights stats={s} previousLabel={previousLabel} />

      <Card className="p-5">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{unit === 'month' ? 'Notes jour par jour' : 'Notes mois par mois'}</h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Catégorie affichée">
            <Chip active={categoryId === null} onClick={() => setCategoryId(null)}>Toutes</Chip>
            {active.map((c) => <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>{c.label}</Chip>)}
          </div>
        </div>
        <ColumnChart columns={columns} label={`Notes ${categoryId ? `« ${categoryLabel(categoryId)} » ` : ''}${unit === 'month' ? 'par jour' : 'par mois'}`} />
        <DataTable stats={s} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-lg font-semibold">Par catégorie</h2>
          <CompareBars
            rows={s.categories.map((c) => ({ key: c.id, label: c.label, current: c.count, previous: c.previousCount }))}
            currentLabel={unit === 'month' ? 'Ce mois' : 'Cette année'}
            previousLabel={unit === 'month' ? 'Mois précédent' : 'Année précédente'}
          />
        </Card>
        <Card className="p-5">
          <h2 className="mb-1 text-lg font-semibold">Moments de la journée</h2>
          <p className="mb-4 text-sm text-muted">Heure à laquelle l'événement est survenu.</p>
          <ul className="flex flex-col gap-3">
            {s.timeOfDay.map((x) => (
              <li key={x.slot} className="grid grid-cols-[10rem_1fr_2rem] items-center gap-3 text-sm">
                <span>{SLOT_LABELS[x.slot]}</span>
                <span className="h-3 rounded-r bg-chart" aria-hidden
                  style={{ width: slotMax ? `${(x.count / slotMax) * 100}%` : 0, minWidth: x.count ? 2 : 0 }} />
                <span className="text-right font-semibold tabular-nums">{x.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// Faits saillants : hausses nettes par catégorie, moment de la journée dominant
function Highlights({ stats: s, previousLabel }: { stats: ResidentStats; previousLabel: string }) {
  const facts: string[] = [];
  // Hausse nette : au moins le double, avec un écart minimal. Plus exigeant sur
  // une année (l'année en cours est incomplète, la précédente souvent clairsemée).
  const minimum = s.period.unit === 'month' ? 2 : 5;
  for (const c of s.categories) {
    if (c.count >= minimum && c.count >= c.previousCount * 2 && c.count - c.previousCount >= minimum) {
      facts.push(`${c.label} : ${c.count} note${c.count > 1 ? 's' : ''}, contre ${c.previousCount} ${previousLabel}.`);
    }
  }
  const total = s.timeOfDay.reduce((sum, x) => sum + x.count, 0);
  const top = [...s.timeOfDay].sort((a, b) => b.count - a.count)[0];
  if (top && total >= 4 && top.count / total >= 0.5) {
    facts.push(`${Math.round((top.count / total) * 100)} % des événements surviennent ${SLOT_PHRASES[top.slot]}.`);
  }
  if (facts.length === 0) return null;
  return (
    <section aria-label="Faits saillants" className="rounded-xl border border-priority/40 bg-priority-soft p-4">
      <h2 className="mb-2 font-semibold">À surveiller</h2>
      <ul className="list-disc pl-5 text-sm">{facts.map((f) => <li key={f}>{f}</li>)}</ul>
    </section>
  );
}

// Les mêmes chiffres en tableau (lecteurs d'écran, impression, copie)
function DataTable({ stats: s }: { stats: ResidentStats }) {
  const withNotes = s.timeline.filter((p) => p.total > 0);
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-primary">Voir les données</summary>
      {withNotes.length === 0 ? <p className="mt-2 text-muted">Aucune note sur la période.</p> : (
        <table className="mt-2 w-full text-left">
          <thead><tr className="border-b border-line text-muted"><th className="py-1">{s.period.unit === 'month' ? 'Jour' : 'Mois'}</th><th className="py-1 text-right">Notes</th></tr></thead>
          <tbody>
            {withNotes.map((p) => (
              <tr key={p.bucket} className="border-b border-line">
                <td className="py-1 first-letter:uppercase">{(s.period.unit === 'month' ? dayTitle : monthTitle).format(utc(p.bucket))}</td>
                <td className="py-1 text-right tabular-nums">{p.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
