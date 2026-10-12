// Dates et heures affichées en français (Québec), fuseau de l'appareil.
import type { Person } from '../api/types';

const time = new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short' });
const full = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeZone: 'UTC' });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// « aujourd'hui 14 h 05 », « hier 22 h 10 », « 3 oct. 08 h 15 »
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(new Date()).getTime() - startOfDay(date).getTime()) / 86_400_000);
  const prefix = days === 0 ? "aujourd'hui" : days === 1 ? 'hier' : days === -1 ? 'demain' : dayMonth.format(date);
  return `${prefix} ${time.format(date)}`;
}

export const formatFull = (iso: string) => full.format(new Date(iso));

// Dates sans heure (AAAA-MM-JJ) : affichées sans conversion de fuseau
export const formatDate = (value: string) => dateOnly.format(new Date(`${value}T00:00:00Z`));

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

// « 14 h 05 »
export const formatTime = (iso: string) => time.format(new Date(iso));

// ---------------------------------------------------------------------
// Jours et semaines (agenda, horaires) — heure locale de l'appareil
// ---------------------------------------------------------------------
const weekday = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
const shortRange = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });

export { startOfDay };
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Lundi de la semaine qui contient d
export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() + 6) % 7));
}

// « lundi 6 octobre »
export const formatDayHeading = (d: Date) => weekday.format(d);

// « 6 oct. 2026 – 12 oct. 2026 »
export const formatRange = (from: Date, to: Date) => shortRange.formatRange(from, to);

// Date locale ↔ paramètre d'adresse AAAA-MM-JJ
export const toDateParam = (d: Date) => d.toLocaleDateString('en-CA');
export function fromDateParam(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
