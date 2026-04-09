import { FORMAT_LOCALES, FORMAT_OPTIONS } from '../constants/format';
import { UI_SYMBOLS } from '../constants/ui';
import { CONFIG } from '../constants/config';

// Formatuje godzinę (24h) z opcjonalną strefą czasową
export const formatTime = (str: string | null | undefined, tz?: string): string => {
  if (!str) return UI_SYMBOLS.DASH;
  const d = new Date(str);
  if (isNaN(d.getTime())) return UI_SYMBOLS.DASH; 
  return d.toLocaleTimeString(FORMAT_LOCALES.GB, { ...FORMAT_OPTIONS.TIME_24H, ...(tz ? { timeZone: tz } : {}) });
};

// Formatuje datę (DD/MM/YYYY)
export const formatDate = (str: string | null | undefined, tz?: string): string => {
  if (!str) return UI_SYMBOLS.DASH;
  const d = new Date(str);
  if (isNaN(d.getTime())) return UI_SYMBOLS.DASH;
  return d.toLocaleDateString(FORMAT_LOCALES.GB, { ...FORMAT_OPTIONS.DATE_SHORT, ...(tz ? { timeZone: tz } : {}) });
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
  const diff = new Date(arr).getTime() - new Date(dep).getTime();
  if (diff <= 0) return null;
  return formatDurationMs(diff);
};

export const getDurationMs = (from: string | undefined, to: string | undefined): number | null => {
  if (!from || !to) return null;
  const diff = new Date(to).getTime() - new Date(from).getTime();
  return diff > 0 ? diff : null;
};

/**
 * HACK: sv-SE (Szwecja) do wyciągania czasu w konkretnej strefie.
 * Zwraca RRRR-MM-DD GG:MM:SS, co Mapujemy na format ISO (zamiast spacji dajemy 'T').
 * 
 * ZALETY:
 * - Nie potrzebujemy Moment.js/Luxon (oszczędność ~50-100KB w bundle).
 * - Działa natywnie w przeglądarce.
 * 
 * RYZYKA:
 * - Polegamy na implementacji Intl. Zmiana formatu w sv-SE przez twórców przeglądarek 
 *   może zepsuć parsowanie date (na razie jest stabilnie).
 */
export const getTimestampInTz = (date: Date, tz: string): number => {
  // console.log('Computing timestamp for TZ:', tz);
  const localStr = date.toLocaleString(FORMAT_LOCALES.SE, { timeZone: tz });
  return new Date(localStr.replace(' ', 'T')).getTime();
};

// Obliczanie różnicy między strefami (w godzinach)
export const computeTzDiff = (depUtc: string, depTz: string, destTz: string): number | null => {
  if (depTz === destTz) return null;
  const d = new Date(depUtc);
  if (isNaN(d.getTime())) return null;

  const getOffH = (tz: string) => {
    const msInHour = 3600000;
    return (getTimestampInTz(d, tz) - getTimestampInTz(d, 'UTC')) / msInHour;
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
