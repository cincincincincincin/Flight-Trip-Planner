import dayjs from '../lib/dayjs';
import { UI_SYMBOLS } from '../constants/ui';

/**
 * [STRATEGIA DAT]: Pełna migracja na Day.js.
 * Eliminujemy "haki" oparte na lokalach (en-CA, sv-SE) na rzecz 
 * profesjonalnej biblioteki obsługującej strefy czasowe.
 */

// Formatuje godzinę (HH:mm) w zadanej strefie czasowej
export const formatTime = (str: string | null | undefined, tz?: string): string => {
  if (!str) return UI_SYMBOLS.DASH;
  const d = dayjs(str);
  if (!d.isValid()) return UI_SYMBOLS.DASH;
  return tz ? d.tz(tz).format('HH:mm') : d.format('HH:mm');
};

// Formatuje datę (DD/MM/YYYY) w zadanej strefie czasowej
export const formatDate = (str: string | null | undefined, tz?: string): string => {
  if (!str) return UI_SYMBOLS.DASH;
  const d = dayjs(str);
  if (!d.isValid()) return UI_SYMBOLS.DASH;
  return tz ? d.tz(tz).format('DD/MM/YYYY') : d.format('DD/MM/YYYY');
};

// Przelicza milisekundy na czytelny format (np. 2d 5h 30m)
export const formatDurationMs = (ms: number): string => {
  const totalMinutes = Math.floor(ms / 60000);
  const mInDay = 24 * 60;
  
  const d = Math.floor(totalMinutes / mInDay);
  const h = Math.floor((totalMinutes % mInDay) / 60);
  const m = totalMinutes % 60;

  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
};

// Czas trwania lotu między dwoma datami ISO
export const getDuration = (dep: string | undefined, arr: string | undefined): string | null => {
  if (!dep || !arr) return null;
  const diff = dayjs(arr).diff(dayjs(dep));
  if (diff <= 0) return null;
  return formatDurationMs(diff);
};

export const getDurationMs = (from: string | undefined, to: string | undefined): number | null => {
  if (!from || !to) return null;
  const diff = dayjs(to).diff(dayjs(from));
  return diff > 0 ? diff : null;
};

/** Zwraca datę w formacie YYYY-MM-DD w zadanej strefie czasowej. */
export const getIsoDate = (date: Date | string, tz?: string): string => {
  return tz ? dayjs(date).tz(tz).format('YYYY-MM-DD') : dayjs(date).format('YYYY-MM-DD');
};

/** Zwraca dzisiejszą datę w formacie YYYY-MM-DD w zadanej strefie czasowej. */
export const getTodayInTz = (tz?: string): string => getIsoDate(new Date(), tz);

/** Zwraca pełny timestamp w formacie YYYY-MM-DDTHH:mm w zadanej strefie czasowej. */
export const getIsoDatetime = (date: Date | string, tz?: string): string => {
  return tz ? dayjs(date).tz(tz).format('YYYY-MM-DDTHH:mm') : dayjs(date).format('YYYY-MM-DDTHH:mm');
};

/** Zwraca timestamp (ms) dla danej daty w konkretnej strefie czasowej. */
export const getTimestampInTz = (date: Date | string, tz: string): number => {
  return dayjs(date).tz(tz).valueOf();
};

// Obliczanie różnicy między strefami (w godzinach)
export const computeTzDiff = (depUtc: string, depTz: string, destTz: string): number | null => {
  if (depTz === destTz) return null;
  const d = dayjs(depUtc);
  if (!d.isValid()) return null;

  const getOffH = (tz: string) => {
    return dayjs(d).tz(tz).utcOffset() / 60;
  };

  const diff = getOffH(destTz) - getOffH(depTz);
  return diff === 0 ? null : diff;
};

// Formatuje różnicę stref (obsługuje też np. Indie +5:30)
export const formatTzDiff = (diff: number): string => {
  const sign = diff > 0 ? '+' : '';
  if (Number.isInteger(diff)) return `${sign}${diff}h`;

  const h = Math.trunc(diff);
  const m = Math.round(Math.abs(diff - h) * 60);
  return `${h}h${m > 0 ? `${m}m` : ''}`;
};

// Pobiera czas przylotu ostatniego "prawdziwego" (nie-manualnego) odcinka podróży
export const getTripCurrentArrivalTimeUTC = (tripState: { legs: any[] } | null): string | null => {
  if (!tripState?.legs?.length) return null;
  for (let i = tripState.legs.length - 1; i >= 0; i--) {
    const leg = tripState.legs[i];
    if (leg.type !== 'manual' && leg.flight?.scheduled_arrival_utc) {
      return leg.flight.scheduled_arrival_utc;
    }
  }
  return null;
};
