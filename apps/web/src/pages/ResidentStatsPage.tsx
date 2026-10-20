// Statistiques d'un résident (infirmière, responsable) : mois ou année,
// comparés à la période précédente. Période dans l'adresse
// (?periode=mois|annee&date=AAAA-MM-JJ), donc partageable.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useResidentStats } from '../api/hooks';
import type { ResidentStats, StatsPeriod } from '../api/types';
import { isSupervisor, useUser } from '../auth/session';
import { ColumnChart, CompareBars, StatTile, type Column } from '../components/charts';
import { Button, Card, Chip, EmptyState, ErrorMessage, Loading } from '../components/ui';
import { formatWith, fromDateParam, fullName } from '../lib/format';

// Dates AAAA-MM-JJ de l'API : affichées sans conversion de fuseau
const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const monthTitle = (d: Date) => formatWith(d, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthShort = (d: Date) => formatWith(d, { month: 'short', timeZone: 'UTC' });
const dayTitle = (d: Date) => formatWith(d, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function periodLabel(unit: StatsPeriod, start: string) {
  return unit === 'month' ? monthTitle(utc(start)) : start.slice(0, 4);
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
  const { t } = useTranslation();
  const user = useUser();
  const { id = '' } = useParams();
  if (!isSupervisor(user.role)) {
    return (
      <>
        <Link to={`/residents/${id}`} className="mb-4 inline-block text-sm text-primary hover:underline">{t('residents.stats.backToFile')}</Link>
        <EmptyState>{t('residents.stats.supervisorsOnly')}</EmptyState>
      </>
    );
  }
  return <ResidentStats />;
}

function ResidentStats() {
  const { t } = useTranslation();
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
      <Link to={`/residents/${id}`} className="mb-4 inline-block text-sm text-primary hover:underline">{t('residents.stats.backToCard')}</Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('residents.stats.title', { name: fullName(s.resident) })}</h1>
          <p className="mt-1 text-sm text-muted">{t('residents.stats.subtitle')}</p>
        </div>
        <div className="flex gap-2" role="group" aria-label={t('residents.stats.period')}>
          <Chip active={unit === 'month'} onClick={() => go({ periode: null, date })}>{t('residents.stats.month')}</Chip>
          <Chip active={unit === 'year'} onClick={() => go({ periode: 'annee', date })}>{t('residents.stats.year')}</Chip>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Button aria-label={t('residents.stats.previousPeriod')} onClick={() => go({ date: shift(unit, s.period.start, -1) })}>←</Button>
        <Button aria-label={t('residents.stats.nextPeriod')} onClick={() => go({ date: shift(unit, s.period.start, 1) })}>→</Button>
        <Button variant="ghost" onClick={() => go({ date: null })}>{unit === 'month' ? t('residents.stats.thisMonth') : t('residents.stats.thisYear')}</Button>
        <h2 className="ml-1 text-lg font-semibold first-letter:uppercase">
          {periodLabel(unit, s.period.start)}
          {stats.isFetching && <span className="ml-2 text-sm font-normal text-muted">{t('residents.stats.updating')}</span>}
        </h2>
      </div>

      <StatsView stats={s} />
    </>
  );
}

function StatsView({ stats: s }: { stats: ResidentStats }) {
  const { t } = useTranslation();
  const unit = s.period.unit;
  const previousLabel = unit === 'month' ? t('residents.stats.previousMonth') : t('residents.stats.previousYear');
  const [categoryId, setCategoryId] = useState<string | null>(null);   // filtre du graphique dans le temps
  const totals = s.totals;

  if (totals.notes === 0 && totals.previousNotes === 0) {
    return <EmptyState>{t('residents.stats.empty')}</EmptyState>;
  }

  const categoryLabel = (id: string) => s.categories.find((c) => c.id === id)?.label ?? '—';
  const columns: Column[] = s.timeline.map((p) => {
    const d = utc(p.bucket);
    const value = categoryId ? p.byCategory[categoryId] ?? 0 : p.total;
    const breakdown = Object.entries(p.byCategory).sort((a, b) => b[1] - a[1]);
    return {
      key: p.bucket,
      value,
      title: unit === 'month' ? dayTitle(d) : monthTitle(d),
      axisLabel: unit === 'month' ? (d.getUTCDate() === 1 || d.getUTCDate() % 5 === 0 ? String(d.getUTCDate()) : '') : monthShort(d),
      details: !categoryId && breakdown.length > 0 && (
        <ul className="mt-1 text-muted">
          {breakdown.map(([id, n]) => <li key={id}>{t('residents.stats.breakdown', { category: categoryLabel(id), count: n })}</li>)}
        </ul>
      ),
    };
  });
  const active = s.categories.filter((c) => c.count > 0);
  const slotMax = Math.max(...s.timeOfDay.map((x) => x.count));
  const chartLabel = categoryId
    ? t(unit === 'month' ? 'residents.stats.chartLabelCategoryDay' : 'residents.stats.chartLabelCategoryMonth', { category: categoryLabel(categoryId) })
    : t(unit === 'month' ? 'residents.stats.chartLabelDay' : 'residents.stats.chartLabelMonth');

  return (
    <div className="flex flex-col gap-8">
      <section aria-label={t('residents.stats.keyFigures')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('residents.stats.notes')} value={totals.notes} previous={totals.previousNotes} previousLabel={previousLabel} />
        <StatTile label={t('residents.stats.priority')} value={totals.priority} previous={totals.previousPriority} previousLabel={previousLabel} />
        <StatTile label={t('residents.stats.positive')} value={totals.positive} previous={totals.previousPositive} previousLabel={previousLabel}
          hint={totals.notes > 0 ? t('residents.stats.positiveShare', { percent: Math.round((totals.positive / totals.notes) * 100) }) : undefined} />
        <StatTile label={t('residents.stats.followUpsOpened')} value={s.followUps.opened}
          hint={t('residents.stats.followUpsHint', {
            closed: t('residents.stats.closed', { count: s.followUps.closed }),
            openNow: t('residents.stats.openNow', { count: s.followUps.openNow }),
            appointments: t('residents.stats.appointments', { count: s.appointments }),
          })} />
      </section>

      <Highlights stats={s} previousLabel={previousLabel} />

      <Card className="p-5">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{unit === 'month' ? t('residents.stats.byDay') : t('residents.stats.byMonth')}</h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('residents.stats.shownCategory')}>
            <Chip active={categoryId === null} onClick={() => setCategoryId(null)}>{t('residents.stats.all')}</Chip>
            {active.map((c) => <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>{c.label}</Chip>)}
          </div>
        </div>
        <ColumnChart columns={columns} label={chartLabel} />
        <DataTable stats={s} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-lg font-semibold">{t('residents.stats.byCategory')}</h2>
          <CompareBars
            rows={s.categories.map((c) => ({ key: c.id, label: c.label, current: c.count, previous: c.previousCount }))}
            currentLabel={unit === 'month' ? t('residents.stats.currentMonth') : t('residents.stats.currentYear')}
            previousLabel={unit === 'month' ? t('residents.stats.lastMonth') : t('residents.stats.lastYear')}
          />
        </Card>
        <Card className="p-5">
          <h2 className="mb-1 text-lg font-semibold">{t('residents.stats.timeOfDay')}</h2>
          <p className="mb-4 text-sm text-muted">{t('residents.stats.timeOfDayHint')}</p>
          <ul className="flex flex-col gap-3">
            {s.timeOfDay.map((x) => (
              <li key={x.slot} className="grid grid-cols-[10rem_1fr_2rem] items-center gap-3 text-sm">
                <span>{t(`residents.stats.slots.${x.slot}`)}</span>
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
  const { t } = useTranslation();
  const facts: string[] = [];
  // Hausse nette : au moins le double, avec un écart minimal. Plus exigeant sur
  // une année (l'année en cours est incomplète, la précédente souvent clairsemée).
  const minimum = s.period.unit === 'month' ? 2 : 5;
  for (const c of s.categories) {
    if (c.count >= minimum && c.count >= c.previousCount * 2 && c.count - c.previousCount >= minimum) {
      facts.push(t('residents.stats.rise', { category: c.label, count: c.count, previous: c.previousCount, period: previousLabel }));
    }
  }
  const total = s.timeOfDay.reduce((sum, x) => sum + x.count, 0);
  const top = [...s.timeOfDay].sort((a, b) => b.count - a.count)[0];
  if (top && total >= 4 && top.count / total >= 0.5) {
    facts.push(t('residents.stats.slotShare', {
      percent: Math.round((top.count / total) * 100), slot: t(`residents.stats.slotPhrases.${top.slot}`),
    }));
  }
  if (facts.length === 0) return null;
  return (
    <section aria-label={t('residents.stats.highlights')} className="rounded-xl border border-priority/40 bg-priority-soft p-4">
      <h2 className="mb-2 font-semibold">{t('residents.stats.watch')}</h2>
      <ul className="list-disc pl-5 text-sm">{facts.map((f) => <li key={f}>{f}</li>)}</ul>
    </section>
  );
}

// Les mêmes chiffres en tableau (lecteurs d'écran, impression, copie)
function DataTable({ stats: s }: { stats: ResidentStats }) {
  const { t } = useTranslation();
  const withNotes = s.timeline.filter((p) => p.total > 0);
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-primary">{t('residents.stats.seeData')}</summary>
      {withNotes.length === 0 ? <p className="mt-2 text-muted">{t('residents.stats.noData')}</p> : (
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-1">{s.period.unit === 'month' ? t('residents.stats.day') : t('residents.stats.month')}</th>
              <th className="py-1 text-right">{t('residents.stats.notes')}</th>
            </tr>
          </thead>
          <tbody>
            {withNotes.map((p) => (
              <tr key={p.bucket} className="border-b border-line">
                <td className="py-1 first-letter:uppercase">{(s.period.unit === 'month' ? dayTitle : monthTitle)(utc(p.bucket))}</td>
                <td className="py-1 text-right tabular-nums">{p.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
