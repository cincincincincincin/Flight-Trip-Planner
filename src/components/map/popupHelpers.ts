import dayjs from '../../lib/dayjs';
export { haversineKm as popupHaversineKm } from '../../utils/math';

export const formatTime = (dateString: string | null | undefined, tz?: string): string => {
  if (!dateString) return '';
  // Parsujemy zawsze jako UTC: dla stringów lokalnych (bez 'Z') zachowuje HH:mm wprost,
  // dla stringów UTC z tz — poprawnie konwertuje do docelowej strefy.
  const d = dayjs.utc(dateString);
  if (!d.isValid()) return '';
  return tz ? d.tz(tz).format('HH:mm') : d.format('HH:mm');
};

export const popupFormatDuration = (minutes: number, estimated: boolean): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const mFormatted = m > 0 ? ` ${m}m` : '';
  const result = `${h}h${mFormatted}`;
  return estimated ? `~${result}` : result;
};

/** Oblicza przesunięcie UTC (w godzinach) czasu lokalnego względem UTC. */
export const getUTCOffH = (
  localStr: string | null | undefined,
  utcStr: string | null | undefined,
): number | null => {
  if (!localStr || !utcStr) return null;
  const dLocal = dayjs(localStr);
  const dUtc = dayjs(utcStr);
  if (!dLocal.isValid() || !dUtc.isValid()) return null;
  return dLocal.diff(dUtc, 'hour', true);
};

export const formatTzLabel = (diff: number): string | null => {
  if (Math.abs(diff) < 0.1) return null;
  const sign = diff > 0 ? '+' : '-';
  const abs = Math.abs(diff);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return m > 0 ? `(${sign}${h}h${m}min)` : `(${sign}${h}h)`;
};
/** Oblicza przesunięcie UTC dla konkretnej strefy czasowej i punktu w czasie. */
export const getOffsetForTz = (tz: string, date: Date | dayjs.Dayjs): number | null => {
  return dayjs(date).tz(tz).utcOffset() / 60;
};
