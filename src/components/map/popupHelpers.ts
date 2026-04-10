import dayjs from '../../lib/dayjs';
export { haversineKm as popupHaversineKm } from '../../utils/math';

export const formatTime = (dateString: string | null | undefined, tz?: string): string => {
  if (!dateString) return '';
  const d = dayjs(dateString);
  if (!d.isValid()) return '';
  return tz ? d.tz(tz).format('HH:mm') : d.format('HH:mm');
};

export const popupFormatDuration = (minutes: number, estimated: boolean): string => {
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, '0');
  return estimated ? `~${h}h ${m}m` : `${h}h ${m}m`;
};

/** Compute UTC offset (in hours) of a local timestamp relative to a UTC string. */
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
/** Calculate UTC offset (hours) for a specific timezone and point in time. */
export const getOffsetForTz = (tz: string, date: Date | dayjs.Dayjs): number | null => {
  return dayjs(date).tz(tz).utcOffset() / 60;
};
