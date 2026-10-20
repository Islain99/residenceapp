// Dates et heures dans la langue de l'interface (français ou anglais du
// Canada, i18n/index.ts), fuseau de l'appareil.
import type { Person } from '../api/types';
import i18n, { currentLocale } from '../i18n';

// Formats créés une fois par langue
const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(name: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${currentLocale()}|${name}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(currentLocale(), options);
    cache.set(key, format);
  }
  return format;
}
const time = () => fmt('time', { hour: '2-digit', minute: '2-digit' });
const dayMonth = () => fmt('dayMonth', { day: 'numeric', month: 'short' });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// « aujourd'hui 14 h 05 », « hier 22 h 10 », « 3 oct. 08 h 15 » (ou en anglais)
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(new Date()).getTime() - startOfDay(date).getTime()) / 86_400_000);
  const day = days === 0 ? i18n.t('common.when.today') : days === 1 ? i18n.t('common.when.yesterday')
    : days === -1 ? i18n.t('common.when.tomorrow') : dayMonth().format(date);
  return i18n.t('common.when.at', { day, time: time().format(date) });
}

export const formatFull = (iso: string) => fmt('full', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));

// Dates sans heure (AAAA-MM-JJ) : affichées sans conversion de fuseau
export const formatDate = (value: string) =>
  fmt('dateOnly', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));

export function ageFrom(birthDate: string): number {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  const now = new Date();
  return now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
}

// Valeur d'un <input type="datetime-local"> ↔ ISO
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export const fromLocalInput = (value: string) => new Date(value).toISOString();

export const fullName = (p: Pick<Person, 'firstName' | 'lastName'>) => `${p.firstName} ${p.lastName}`;

// « 14 h 05 » / « 2:05 p.m. »
export const formatTime = (iso: string) => time().format(new Date(iso));

// ---------------------------------------------------------------------
// Jours et semaines (agenda, horaires) — heure locale de l'appareil
// ---------------------------------------------------------------------
export { startOfDay };
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Lundi de la semaine qui contient d
export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() + 6) % 7));
}

// « lundi 6 octobre » / « Monday, October 6 »
export const formatDayHeading = (d: Date) => fmt('weekday', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);

// « 6 oct. 2026 – 12 oct. 2026 »
export const formatRange = (from: Date, to: Date) =>
  fmt('shortRange', { day: 'numeric', month: 'short', year: 'numeric' }).formatRange(from, to);

// Formats ponctuels (mois, jours de la semaine…) dans la langue de l'interface
export const formatWith = (date: Date, options: Intl.DateTimeFormatOptions) =>
  fmt(JSON.stringify(options), options).format(date);

// Date locale ↔ paramètre d'adresse AAAA-MM-JJ
export const toDateParam = (d: Date) => d.toLocaleDateString('en-CA');
export function fromDateParam(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
