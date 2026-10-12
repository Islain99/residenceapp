// Horaires : durées et heures affichées en français.

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

// Durée d'un quart en minutes ; fin ≤ début = finit le lendemain
export function shiftMinutes(start: string, end: string): number {
  const minutes = toMinutes(end) - toMinutes(start);
  return minutes > 0 ? minutes : minutes + 24 * 60;
}

// 450 → « 7 h 30 », 480 → « 8 h »
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

// « 07:00 » → « 7 h », « 15:30 » → « 15 h 30 »
export function shortTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export const formatShiftTimes = (start: string, end: string) => `${shortTime(start)} – ${shortTime(end)}`;

// Calendrier du mois (petites cases) : « 7–15 », « 9 h 30–15 »
const compact = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return m ? `${h} h ${String(m).padStart(2, '0')}` : String(h);
};
export const compactShiftTimes = (start: string, end: string) => `${compact(start)}–${compact(end)}`;
