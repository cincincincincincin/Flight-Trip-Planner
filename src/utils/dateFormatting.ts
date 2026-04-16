import dayjs from '../lib/dayjs';
import { UI_SYMBOLS } from '../constants/ui';

/**
 * Pełna migracja na bibliotekę Day.js dla obsługi dat i stref czasowych.
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
  if (ms <= 0) return "0m";
  const totalMinutes = Math.floor(ms / 60000);
  const mInDay = 24 * 60;
  
  const d = Math.floor(totalMinutes / mInDay);
  const h = Math.floor((totalMinutes % mInDay) / 60);
  const m = totalMinutes % 60;

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || (d === 0 && h === 0)) parts.push(`${m}m`);

  return parts.join(' ');
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
  return diff >= 0 ? diff : null;
};

/** Zwraca datę w formacie YYYY-MM-DD w zadanej strefie czasowej. */
export const getIsoDate = (date: Date | string, tz?: string): string => {
  if (!date) return '';
  const d = (typeof date === 'string' && !date.includes('Z') && !date.includes('T'))
    ? dayjs.utc(date)
    : dayjs(date);
  return tz ? d.tz(tz).format('YYYY-MM-DD') : d.format('YYYY-MM-DD');
};

/** Zwraca dzisiejszą datę w formacie YYYY-MM-DD w zadanej strefie czasowej. */
export const getTodayInTz = (tz?: string): string => getIsoDate(new Date(), tz);

/** Zwraca pełny timestamp w formacie YYYY-MM-DDTHH:mm w zadanej strefie czasowej. */
export const getIsoDatetime = (date: Date | string, tz?: string): string => {
  if (!date) return '';
  const d = (typeof date === 'string' && !date.includes('Z') && !date.includes('T'))
    ? dayjs.utc(date)
    : dayjs(date);
  return tz ? d.tz(tz).format('YYYY-MM-DDTHH:mm') : d.format('YYYY-MM-DDTHH:mm');
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

import { haversineKm } from './math';
import { CONFIG } from '../constants/config';

// Obliczanie czasu przylotu (faktyczny lub estymowany)
export const getLegArrivalUTC = (leg: any, coordsMap: Record<string, [number, number]>): string | null => {
  if (!leg || leg.type === 'manual') return null;
  if (leg.flight?.scheduled_arrival_utc) return leg.flight.scheduled_arrival_utc;
  
  // Estymacja na podstawie dystansu
  if (leg.flight?.scheduled_departure_utc) {
    const from = coordsMap[leg.fromAirportCode];
    const to = coordsMap[leg.toAirportCode];
    if (!from || !to) return null;
    
    const distKm = haversineKm(from[0], from[1], to[0], to[1]);
    const blockHours = distKm / CONFIG.AVERAGE_AIRCRAFT_SPEED_KMH + CONFIG.ADDITIONAL_BLOCK_HOURS;
    const depMs = new Date(leg.flight.scheduled_departure_utc).getTime();
    if (isNaN(depMs)) return null;
    return new Date(depMs + blockHours * 3600000).toISOString();
  }
  return null;
};

// Pobiera czas przylotu ostatniego "prawdziwego" (nie-manualnego) odcinka podróży (z estymacją czasu lotu)
export const getTripCurrentArrivalTimeUTC = (tripState: { legs: any[] } | null, coordsMap: Record<string, [number, number]> = {}): string | null => {
  if (!tripState?.legs?.length) return null;
  for (let i = tripState.legs.length - 1; i >= 0; i--) {
    const leg = tripState.legs[i];
    const arrival = getLegArrivalUTC(leg, coordsMap);
    if (arrival) return arrival;
  }
  return null;
};
