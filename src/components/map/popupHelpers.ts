import { FORMAT_LOCALES } from '../../constants/format';
export { haversineKm as popupHaversineKm } from '../../utils/math';

export const formatTime = (dateString: string | null | undefined, tz?: string): string => {
  if (!dateString) return '';
  try {
    // If tz is provided, we use it. If not, it falls back to browser local
    // (which is fine for localStr already in 'naive' format but NOT for UTC strings)
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(FORMAT_LOCALES.GB, {
      hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}),
    });
  } catch { return ''; }
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
  const localAsUTC = new Date(localStr + 'Z');
  const utcDate = new Date(utcStr);
  if (isNaN(localAsUTC.getTime()) || isNaN(utcDate.getTime())) return null;
  return (localAsUTC.getTime() - utcDate.getTime()) / 3600000;
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
export const getOffsetForTz = (tz: string, utcDate: Date): number | null => {
  try {
    const s = utcDate.toLocaleString('sv-SE', { timeZone: tz });
    const [datePart, timePart] = s.split(' ');
    const [y, mo, d] = datePart.split('-').map(Number);
    const [h, mi, sec] = timePart.split(':').map(Number);
    const localMs = Date.UTC(y, mo - 1, d, h, mi, sec);
    return (localMs - utcDate.getTime()) / 3600000;
  } catch { return null; }
};
