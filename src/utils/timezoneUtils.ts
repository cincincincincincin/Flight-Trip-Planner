import { FORMAT_LOCALES } from '../constants/format';
import { CONFIG } from '../constants/config';

export const BROWSER_TIMEZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
})();

export function buildTzGroups(airports: Array<{ code: string; name: string; time_zone?: string | null }>) {
  const groups = new Map<string | number, { tz: string; airports: Array<{ code: string; name: string }>; currentDT: string; utcLabel: string; currentDateStr: string; currentTimeStr: string }>();
  const now = new Date();
  const utcStr = now.toLocaleString(FORMAT_LOCALES.SE, { timeZone: 'UTC' });
  for (const airport of airports) {
    const tz = airport.time_zone ?? CONFIG.UNKNOWN_TIMEZONE;
    if (tz === CONFIG.UNKNOWN_TIMEZONE) {
      if (!groups.has(CONFIG.UNKNOWN_TIMEZONE)) {
        groups.set(CONFIG.UNKNOWN_TIMEZONE, { tz: CONFIG.UNKNOWN_TIMEZONE, airports: [], currentDT: CONFIG.UNKNOWN_TZ_DUMMY, utcLabel: CONFIG.UNKNOWN_TZ_UTCLABEL, currentDateStr: '', currentTimeStr: '' });
      }
      groups.get(CONFIG.UNKNOWN_TIMEZONE)!.airports.push(airport);
      continue;
    }
    const localStr = now.toLocaleString(FORMAT_LOCALES.SE, { timeZone: tz });
    const diffMin = Math.round((new Date(localStr.replace(' ', 'T')).getTime() - new Date(utcStr.replace(' ', 'T')).getTime()) / 60000);
    if (!groups.has(diffMin)) {
      const diffH = diffMin / CONFIG.MINUTES_IN_HOUR;
      const sign = diffH >= 0 ? '+' : '-';
      const absH = Math.abs(diffH);
      const h = Math.floor(absH);
      const m = Math.round((absH - h) * CONFIG.MINUTES_IN_HOUR);
      const utcLabel = `UTC${sign}${h}${m > 0 ? ':' + String(m).padStart(2, '0') : ''}`;
      const currentDateStr = now.toLocaleDateString(FORMAT_LOCALES.GB, { timeZone: tz, weekday: 'short', day: '2-digit', month: '2-digit' });
      const currentTimeStr = now.toLocaleTimeString(FORMAT_LOCALES.GB, { timeZone: tz, hour: '2-digit', minute: '2-digit' });
      groups.set(diffMin, { tz, airports: [], currentDT: localStr, utcLabel, currentDateStr, currentTimeStr });
    }
    groups.get(diffMin)!.airports.push(airport);
  }
  return Array.from(groups.values()).sort((a, b) => a.currentDT.localeCompare(b.currentDT));
}

export function resolveTimezone(
  airportCodes: string[],
  tzMap: Record<string, string>,
  lastAddedCode: string | null,
): string | null {
  const known = airportCodes.filter(c => tzMap[c]);
  if (known.length === 0) return null;

  const tzCount: Record<string, number> = {};
  for (const code of known) tzCount[tzMap[code]] = (tzCount[tzMap[code]] || 0) + 1;

  const maxCount = Math.max(...Object.values(tzCount));
  const leading = Object.entries(tzCount).filter(([, c]) => c === maxCount).map(([tz]) => tz);

  if (leading.length === 1) return leading[0];
  if (BROWSER_TIMEZONE && tzCount[BROWSER_TIMEZONE]) return BROWSER_TIMEZONE;
  if (lastAddedCode && tzMap[lastAddedCode]) return tzMap[lastAddedCode];
  return leading[0];
}
