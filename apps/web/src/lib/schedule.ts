// Horaires : durées et heures affichées dans la langue de l'interface.
//   français : « 7 h 30 », « 7 h – 15 h » ; anglais : « 7h 30m », « 7 a.m. – 3 p.m. »
import { currentLanguage, currentLocale } from '../i18n';

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

// Durée d'un quart en minutes ; fin ≤ début = finit le lendemain
export function shiftMinutes(start: string, end: string): number {
  const minutes = toMinutes(end) - toMinutes(start);
  return minutes > 0 ? minutes : minutes + 24 * 60;
}

// 450 → « 7 h 30 » / « 7h 30m », 480 → « 8 h » / « 8h »
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (currentLanguage() === 'en') return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

// Heure d'horloge en anglais : « 7 a.m. », « 3:30 p.m. »
function englishTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat(currentLocale(), { hour: 'numeric', ...(m ? { minute: '2-digit' } : {}) })
    .format(new Date(2000, 0, 1, h, m));
}

// « 07:00 » → « 7 h », « 15:30 » → « 15 h 30 » (anglais : « 7 a.m. », « 3:30 p.m. »)
export function shortTime(hhmm: string): string {
  if (currentLanguage() === 'en') return englishTime(hhmm);
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export const formatShiftTimes = (start: string, end: string) => `${shortTime(start)} – ${shortTime(end)}`;

// Calendrier du mois (petites cases) : « 7–15 », « 9 h 30–15 » (anglais : « 7 a.m.–3 p.m. »)
const compact = (hhmm: string) => {
  if (currentLanguage() === 'en') return englishTime(hhmm);
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return m ? `${h} h ${String(m).padStart(2, '0')}` : String(h);
};
export const compactShiftTimes = (start: string, end: string) => `${compact(start)}–${compact(end)}`;
