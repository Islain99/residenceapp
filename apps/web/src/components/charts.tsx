// Graphiques simples, sans bibliothèque : tuile de chiffre clé, colonnes,
// barres horizontales (période en cours / précédente).
//
// Règles (guide de visualisation) : une seule teinte (--color-chart) pour une
// série ; la période précédente en gris en retrait ; textes et valeurs en
// encre, jamais dans la couleur de la série ; extrémités arrondies de 4 px
// posées sur la ligne de base ; 2 px d'espace entre colonnes ; survol ou
// focus = info-bulle, zone de survol plus grande que la marque.
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '../lib/cx';

// ---------------------------------------------------------------------
// Tuile : valeur, et écart avec la période précédente
// ---------------------------------------------------------------------
export function StatTile({ label, value, previous, previousLabel, hint }: {
  label: string; value: number; previous?: number; previousLabel?: string; hint?: ReactNode;
}) {
  const { t } = useTranslation();
  const delta = previous === undefined ? null : value - previous;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
      {delta !== null && (
        <p className="mt-1 text-xs text-muted">
          {t(delta === 0 ? 'residents.chart.same' : delta > 0 ? 'residents.chart.more' : 'residents.chart.less',
            { delta: Math.abs(delta), period: previousLabel, previous })}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Colonnes (une série) avec info-bulle au survol et au clavier
// ---------------------------------------------------------------------
export interface Column {
  key: string;
  axisLabel: string;        // sous l'axe (peut être vide pour alléger)
  value: number;
  title: string;            // titre de l'info-bulle (ex. « lundi 12 octobre »)
  details?: ReactNode;      // contenu de l'info-bulle sous la valeur
}

// format : texte d'une valeur (« 3 notes ») ; par défaut, des notes
export function ColumnChart({ columns, label, format, height = 160 }: {
  columns: Column[]; label: string; format?: (n: number) => string; height?: number;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...columns.map((c) => c.value));
  const current = columns.find((c) => c.key === active);
  const plural = format ?? ((n: number) => t('residents.chart.notes', { count: n }));

  return (
    <figure className="relative" aria-label={label}>
      <div className="flex items-end gap-0.5 border-b border-line" style={{ height }} onMouseLeave={() => setActive(null)}>
        {columns.map((c) => (
          // Zone de survol : toute la hauteur, plus grande que la colonne
          <button
            key={c.key}
            type="button"
            aria-label={`${c.title} : ${plural(c.value)}`}
            onMouseEnter={() => setActive(c.key)}
            onFocus={() => setActive(c.key)}
            onBlur={() => setActive(null)}
            className="group flex h-full min-w-0 flex-1 items-end focus:outline-none"
          >
            <span
              className={cx('block w-full rounded-t bg-chart transition-opacity',
                active && active !== c.key && 'opacity-40', 'group-focus-visible:ring-2 group-focus-visible:ring-primary')}
              style={{ height: c.value ? `${Math.max(2, (c.value / max) * 100)}%` : 0 }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 text-[10px] text-muted" aria-hidden>
        {/* Étiquette plus large que sa colonne (téléphone) : déborde, centrée, au lieu d'être coupée */}
        {columns.map((c) => (
          <span key={c.key} className="flex min-w-0 flex-1 justify-center overflow-visible whitespace-nowrap">{c.axisLabel}</span>
        ))}
      </div>
      <p className="absolute left-0 top-0 -translate-y-full pb-1 text-[10px] text-muted" aria-hidden>{t('residents.chart.max', { max })}</p>
      {current && (
        <div role="status" className="pointer-events-none absolute right-0 top-0 z-[1] min-w-40 rounded-lg border border-line bg-surface p-2 text-xs shadow-md">
          <p className="font-semibold first-letter:uppercase">{current.title}</p>
          <p className="tabular-nums">{plural(current.value)}</p>
          {current.details}
        </div>
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------
// Barres horizontales : période en cours (couleur) et précédente (gris)
// ---------------------------------------------------------------------
export function CompareBars({ rows, currentLabel, previousLabel }: {
  rows: { key: string; label: string; current: number; previous: number }[];
  currentLabel: string; previousLabel: string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.current, r.previous]));
  return (
    <figure>
      <figcaption className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm bg-chart" />{currentLabel}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm bg-chart-previous" />{previousLabel}</span>
      </figcaption>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[7rem_1fr_auto] items-center gap-x-3 text-sm sm:grid-cols-[9rem_1fr_auto]">
            <span className="truncate">{r.label}</span>
            <span className="flex flex-col gap-0.5" aria-hidden>
              <span className="h-3 rounded-r bg-chart" style={{ width: `${(r.current / max) * 100}%`, minWidth: r.current ? 2 : 0 }} />
              <span className="h-1.5 rounded-r bg-chart-previous" style={{ width: `${(r.previous / max) * 100}%`, minWidth: r.previous ? 2 : 0 }} />
            </span>
            <span className="w-16 text-right tabular-nums">
              <span className="font-semibold">{r.current}</span>
              <span className="text-xs text-muted" aria-hidden> / {r.previous}</span>
              <span className="sr-only">, {previousLabel.toLowerCase()} : {r.previous}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
