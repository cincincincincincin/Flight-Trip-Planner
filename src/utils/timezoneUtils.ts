import { CONFIG } from '../constants/config';
import { getTimestampInTz, getIsoDatetime } from './dateFormatting';
import dayjs from '../lib/dayjs';

export const BROWSER_TIMEZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
})();

/**
 * Grupuje lotniska według ich czasu lokalnego (przesunięcia UTC).
 * Zapobiega to wyświetlaniu wielu identycznych zegarów w panelu wyboru kraju (PendingCountryPicker.tsx), 
 * co sprawia, że interfejs jest czytelniejszy.
 */
export function buildTzGroups(airports: Array<{ code: string; name: string; time_zone?: string | null }>) {
  const groups = new Map<string | number, { tz: string; airports: Array<{ code: string; name: string }>; currentDT: string; utcLabel: string; currentDateStr: string; currentTimeStr: string }>();
  const now = new Date();

  for (const airport of airports) {
    const tz = airport.time_zone ?? CONFIG.UNKNOWN_TIMEZONE;

    // Obsługa lotnisk bez przypisanej strefy (fallback do wartości z config.ts - np. wyświetlenie kreski)
    if (tz === CONFIG.UNKNOWN_TIMEZONE) {
      if (!groups.has(CONFIG.UNKNOWN_TIMEZONE)) {
        groups.set(CONFIG.UNKNOWN_TIMEZONE, { tz: CONFIG.UNKNOWN_TIMEZONE, airports: [], currentDT: CONFIG.UNKNOWN_TZ_FALLBACK, utcLabel: CONFIG.UNKNOWN_TZ_UTCLABEL, currentDateStr: '', currentTimeStr: '' });
      }
      groups.get(CONFIG.UNKNOWN_TIMEZONE)!.airports.push(airport);
      continue;
    }

    // Obliczamy przesunięcie (UTC offset w minutach) dla danej strefy
    const diffMin = dayjs(now).tz(tz).utcOffset();

    if (!groups.has(diffMin)) {
      const diffH = diffMin / CONFIG.MINUTES_IN_HOUR;
      const sign = diffH >= 0 ? '+' : '-';
      const absH = Math.abs(diffH);
      const h = Math.floor(absH);
      const m = Math.round((absH - h) * CONFIG.MINUTES_IN_HOUR);

      // Etykieta wyświetlana w UI obok czasu lokalnego (np. "UTC+05:30")
      const utcLabel = `UTC${sign}${h}${m > 0 ? ':' + String(m).padStart(2, '0') : ''}`;

      // Formaty prezentacyjne dopasowane do Day.js (spójne z lokalizacją aplikacji)
      // ddd, DD/MM -> np. "Wt, 10/04" lub "Tue, 10/04"
      const currentDateStr = dayjs(now).tz(tz).format('ddd, DD/MM');
      const currentTimeStr = dayjs(now).tz(tz).format('HH:mm');

      // localDT używamy jako klucza sortującego (ISO format)
      const localDT = getIsoDatetime(now, tz);

      groups.set(diffMin, { tz, airports: [], currentDT: localDT, utcLabel, currentDateStr, currentTimeStr });
    }
    groups.get(diffMin)!.airports.push(airport);
  }

  // Sortujemy grupy od zachodu (wcześniejsza godzina) do wschodu
  return Array.from(groups.values()).sort((a, b) => a.currentDT.localeCompare(b.currentDT));
}

/**
 * Funkcja przygotowana pod przyszłą rozbudowę: wybór strefy czasowej przy wielu lotniskach.
 * ObecnieNIEUŻYWANA w kodzie źródłowym, ale zachowana jako propozycja algorytmu głosowania:
 * 1. Dominująca strefa (większość). 2. Strefa użytkownika. 3. Ostatnio dodane lotnisko.
 */
export function resolveTimezone(
  airportCodes: string[],
  tzMap: Record<string, string>,
  lastAddedCode: string | null,
): string | null {
  const known = airportCodes.filter(c => tzMap[c]);
  if (known.length === 0) return null;

  // Liczymy wystąpienia każdej strefy
  const tzCount: Record<string, number> = {};
  for (const code of known) {
    const tz = tzMap[code];
    tzCount[tz] = (tzCount[tz] || 0) + 1;
  }

  const maxCount = Math.max(...Object.values(tzCount));
  const leading = Object.entries(tzCount)
    .filter(([, count]) => count === maxCount)
    .map(([tz]) => tz);

  // 1. Jeśli jest jeden wyraźny zwycięzca
  if (leading.length === 1) return leading[0];

  // 2. Jeśli jest remis, sprawdź czy pasuje strefa przeglądarki
  if (BROWSER_TIMEZONE && tzCount[BROWSER_TIMEZONE]) return BROWSER_TIMEZONE;

  // 3. Jeśli nie, weź strefę ostatnio klikniętego lotniska
  if (lastAddedCode && tzMap[lastAddedCode]) return tzMap[lastAddedCode];

  // 4. Fallback na pierwszy wynik
  return leading[0];
}
