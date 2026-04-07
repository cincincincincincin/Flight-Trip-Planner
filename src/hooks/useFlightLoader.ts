import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getSchedules } from '../api/schedules';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { Flight } from '../types';
import { FORMAT_LOCALES } from '../constants/format';
import { CONFIG } from '../constants/config';

// 24 hours — the fixed UTC window size for any single-day view (rolling in today mode)
const WINDOW_MS = 24 * 60 * 60_000;
const MIN_MS = 60_000;
const ALIGN_MS = 60_000; // Alignment to 1 minute for exact rolling window start

interface RawScheduleResponse {
  success: boolean;
  data: Flight[];
  last_fetched_at?: string;
  range_end_datetime?: string;
}

interface UseFlightLoaderParams {
  airportCodes: string[];
  timezone?: string;
  initialFromDatetime?: string; // kept for API compat but unused in new logic
  airportTimezones?: Record<string, string>;
  tripArrivalTimeUTC?: string | null;
  travelDateOverride?: string;
}

interface UseFlightLoaderResult {
  rawFlights: Flight[];
  error: string | null;
  lastFetched: string | null;
  perAirportLoading: Record<string, boolean>;
  anyLoading: boolean;
  flightsByDate: Record<string, Flight[]>;
  dateOrderRef: React.MutableRefObject<string[]>;
  handleRefresh: () => Promise<void>;
}

export function useFlightLoader({
  airportCodes,
  timezone,
  airportTimezones,
  tripArrivalTimeUTC,
  travelDateOverride,
}: UseFlightLoaderParams): UseFlightLoaderResult {
  const { travelDate: travelDateFromStore } = useSettingsStore();
  const travelDate = travelDateOverride ?? travelDateFromStore;
  const { appendFlights } = useSelectionStore();

  const [rawFlights, setRawFlights] = useState<Flight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [perAirportLoading, setPerAirportLoading] = useState<Record<string, boolean>>({});

  // UTC ms range that has been fetched per airport: { fromMs, toMs }
  const perAirportLoadedRef = useRef<Map<string, { fromMs: number; toMs: number }>>(new Map());
  // Keys: code, Value: current target toMs — prevents concurrent redundant fetches for the same airport
  const perAirportFetchingRef = useRef<Map<string, number>>(new Map());
  // Cache key: travelDate + airportCodes. Tracked separately from `timezone` so that
  // a timezone-only change does NOT clear the loaded ranges — the global UTC window
  // already covers all TZs, and ensureLoaded handles any new gaps.
  const cacheKeyRef = useRef<string>('');
  // Tracks previous timezone to detect the 1-render lag during TZ switches:
  // when `timezone` changes, `travelDate` still reflects "today in old TZ" for one render
  // (before useTravelDate fires its setTravelDate). We use prevTimezoneRef to guard against
  // this transient state and avoid spurious non-today-mode fetches.
  const prevTimezoneRef = useRef<string>(timezone ?? '');
  const dateOrderRef = useRef<string[]>([]);

  const anyLoading = Object.values(perAirportLoading).some(Boolean);

  // ── Flight grouping keyed by departure date in the display timezone ─────────
  const flightsByDate = useMemo<Record<string, Flight[]>>(() => {
    const byDate: Record<string, Flight[]> = {};
    rawFlights.forEach(flight => {
      const dateStr = (flight.scheduled_departure_utc && timezone)
        ? new Date(flight.scheduled_departure_utc)
            .toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone })
        : (flight.scheduled_departure_local?.split('T')[0] ?? '');
      if (!dateStr) return;
      (byDate[dateStr] ??= []).push(flight);
    });
    return byDate;
  }, [rawFlights, timezone]);

  const dateOrder = useMemo(() => Object.keys(flightsByDate).sort(), [flightsByDate]);
  useEffect(() => { dateOrderRef.current = dateOrder; }, [dateOrder]);

  // ── UTC midnight of dateStr in tz (noon-probe, handles UTC±12+) ────────────
  const utcMidnightOf = useCallback((dateStr: string, tz: string): number => {
    const noonUTC = new Date(`${dateStr}T12:00:00Z`);
    const local = noonUTC.toLocaleString(FORMAT_LOCALES.SE, { timeZone: tz });
    const [localDate, localTime] = local.split(' ');
    const [h, m, s] = localTime.split(':').map(Number);
    let ms = noonUTC.getTime() - h * CONFIG.HOUR_IN_MS - m * MIN_MS - s * 1000;
    if (localDate > dateStr) ms -= 86_400_000;
    else if (localDate < dateStr) ms += 86_400_000;
    return ms;
  }, []);

  // ── UTC ms → local datetime string at minute precision ─────────────────────
  const toLocalMinute = useCallback((utcMs: number, tz: string): string => {
    const s = new Date(utcMs).toLocaleString(FORMAT_LOCALES.SE, {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    // Rygorystycznie wycinamy sekundy: zostaje tylko YYYY-MM-DDTHH:MM
    return s.replace(' ', 'T').substring(0, 16);
  }, []);

  // ── Fetch one airport for a bounded UTC range ───────────────────────────────
  const fetchAirportRange = useCallback(async (
    code: string,
    fromMs: number,
    toMs: number,
    airportTZ: string,
  ): Promise<void> => {
    // Dedup: skip if a fetch for this airport is already aimed at covering [fromMs, toMs]
    const currentlyFetchingTo = perAirportFetchingRef.current.get(code);
    if (currentlyFetchingTo !== undefined && currentlyFetchingTo >= toMs) return;
    perAirportFetchingRef.current.set(code, toMs);

    setPerAirportLoading(prev => ({ ...prev, [code]: true }));
    setError(null);

    try {
      const fromLocal = toLocalMinute(fromMs, airportTZ);
      const toLocal = toLocalMinute(toMs, airportTZ); 

      // We use raw fetch here instead of api/schedules.ts because we need NDJSON streaming (body.getReader())
      const url = `${CONFIG.API_BASE_URL}/schedules/${code}?from_local_datetime=${fromLocal}&to_local_datetime=${toLocal}&limit=${CONFIG.FLIGHT_LIMIT}`;
      const response = await fetch(url);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail ?? 'Failed to load flights');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const batch = JSON.parse(line) as RawScheduleResponse & { error?: string };
            
            if (batch.success === false) {
              setError(batch.error ?? 'Failed to load flights batch');
              continue;
            }

            if (batch.data) {
              setRawFlights(prev => {
                const ids = new Set(prev.map(f => f.id));
                const fresh = batch.data.filter(f => !ids.has(f.id));
                if (!fresh.length) return prev;
                return [...prev, ...fresh].sort((a, b) =>
                  (a.scheduled_departure_utc ?? a.scheduled_departure_local ?? '')
                    .localeCompare(b.scheduled_departure_utc ?? b.scheduled_departure_local ?? '')
                );
              });

              if (batch.last_fetched_at) {
                setLastFetched(prev =>
                  !prev || batch.last_fetched_at! > prev ? batch.last_fetched_at! : prev
                );
              }
              appendFlights(batch.data);
            }

            // Update airport's loaded UTC range incrementally based on range_end_datetime if provided
            // or use the target toMs if it's the last chunk. (Heuristic: if it's in the stream, we trust it).
            const batchEndMs = batch.range_end_datetime ? new Date(batch.range_end_datetime).getTime() : toMs;
            
            const prevLoad = perAirportLoadedRef.current.get(code);
            perAirportLoadedRef.current.set(code, {
              fromMs: prevLoad ? Math.min(prevLoad.fromMs, fromMs) : fromMs,
              toMs:   prevLoad ? Math.max(prevLoad.toMs,   batchEndMs) : batchEndMs,
            });

          } catch (e) {
            console.error('Failed to parse NDJSON line:', e);
          }
        }
      }
      // After successfully exhausting the stream (200 OK), mark the entire requested range 
      // as loaded for this airport to prevent infinite retry loops for empty ranges.
      const lastLoad = perAirportLoadedRef.current.get(code);
      perAirportLoadedRef.current.set(code, {
        fromMs: lastLoad ? Math.min(lastLoad.fromMs, fromMs) : fromMs,
        toMs:   lastLoad ? Math.max(lastLoad.toMs,   toMs)   : toMs,
      });
    } catch (err: any) {
      setError(err.message ?? 'Failed to load flights');
    } finally {
      if (perAirportFetchingRef.current.get(code) === toMs) {
        perAirportFetchingRef.current.delete(code);
      }
      setPerAirportLoading(prev => ({ ...prev, [code]: false }));
    }
  }, [toLocalMinute, appendFlights]);

  // ── Ensure airport is loaded for [targetFromMs, targetToMs], filling gaps ──
  const ensureLoaded = useCallback(async (
    code: string,
    targetFromMs: number,
    targetToMs: number,
    airportTZ: string,
  ): Promise<void> => {
    const loaded = perAirportLoadedRef.current.get(code);
    if (!loaded) {
      await fetchAirportRange(code, targetFromMs, targetToMs, airportTZ);
      return;
    }
    const gapBefore = targetFromMs < loaded.fromMs;
    const gapAfter  = targetToMs   > loaded.toMs;
    if (!gapBefore && !gapAfter) return;
    if (gapBefore) await fetchAirportRange(code, targetFromMs, Math.min(loaded.fromMs, targetToMs), airportTZ);
    if (gapAfter)  await fetchAirportRange(code, Math.max(loaded.toMs, targetFromMs), targetToMs, airportTZ);
  }, [fetchAirportRange]);

  // ── Main effect ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!timezone || airportCodes.length === 0) return;

    const codesKey  = JSON.stringify([...airportCodes].sort());
    const now    = Date.now();
    const nowMin = now - (now % MIN_MS);
    const todayInTZ  = new Date(nowMin).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone });

    // Guard: when timezone changes, travelDate may still be "today in old TZ" for 1 render
    // (before useTravelDate fires). Detect this transient state and force today mode.
    const prevTimezone = prevTimezoneRef.current;
    prevTimezoneRef.current = timezone;
    const tzJustChanged  = timezone !== prevTimezone && !!prevTimezone;
    const todayInPrevTZ  = (tzJustChanged && prevTimezone)
      ? new Date(nowMin).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: prevTimezone })
      : null;
    const arrivalDay = tripArrivalTimeUTC
      ? new Date(tripArrivalTimeUTC).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone })
      : null;
    const arrivalDayInPrevTZ = (tzJustChanged && prevTimezone && tripArrivalTimeUTC)
      ? new Date(tripArrivalTimeUTC).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: prevTimezone })
      : null;
    const todayInBrowser = new Date(nowMin).toLocaleDateString(FORMAT_LOCALES.CA);

    // Guard: isTodayMode is true if we are on the current day for the mode (today in now mode, or arrival day in trip mode).
    // The tzJustChanged checks handle the 1-render lag during a timezone switch to prevent redundant re-fetching.
    const isTodayMode = (arrivalDay ? travelDate === arrivalDay : (travelDate === todayInTZ || travelDate === todayInBrowser))
      || (tzJustChanged && (todayInPrevTZ === travelDate || (arrivalDayInPrevTZ && arrivalDayInPrevTZ === travelDate)));

    // In today/trip mode: use the literal string "today" as the date part of the cache key.
    // This means a timezone change (which auto-updates travelDate to "today in new TZ") does
    // NOT change the cacheKey → loaded ranges are preserved → no re-fetch.
    // In manual-date mode: use the actual date so a date change triggers re-fetch.
    const cacheKeyDate = isTodayMode ? 'today' : travelDate;
    const cacheKey = `${cacheKeyDate}|${codesKey}`;

    // Detect what changed
    const prevCacheKey = cacheKeyRef.current;
    const prevCodesKey = prevCacheKey ? prevCacheKey.split('|')[1] : '';
    const isNewSet         = prevCodesKey !== codesKey;
    const prevCodes: string[] = prevCodesKey ? JSON.parse(prevCodesKey) : [];
    const isAdditionOnly   = isNewSet && prevCodes.length > 0 && prevCodes.every(c => airportCodes.includes(c));
    const dateOrAirportsChanged = prevCacheKey !== cacheKey;

    if (dateOrAirportsChanged) cacheKeyRef.current = cacheKey;

    if (isNewSet && !isAdditionOnly) {
      // Airport removed or first load → full reset
      setRawFlights([]);
      perAirportLoadedRef.current = new Map();
      perAirportFetchingRef.current = new Map();
      setPerAirportLoading({});
      setError(null);
      dateOrderRef.current = [];
    } else if (dateOrAirportsChanged && !isAdditionOnly) {
      // travelDate changed (airports same) → clear loaded ranges to re-fetch for new date.
      // Only clear if NOT in the middle of a timezone transition (stable key change)
      if (!tzJustChanged) {
        perAirportLoadedRef.current = new Map();
        perAirportFetchingRef.current = new Map();
      }
    }

    // Wait until all airport timezones are known
    if (airportCodes.some(c => !airportTimezones?.[c])) return;

    // ── Compute the global UTC window ─────────────────────────────────────────
    // now, nowMin, todayInTZ, isTodayMode already computed above for cacheKey.
    let fromMs: number;
    let toMs: number;

    if (tripArrivalTimeUTC && isTodayMode) {
      // Trip mode on arrival day: fetch window from the arrival moment to :59 of the prev hour tomorrow
      fromMs = Math.floor(new Date(tripArrivalTimeUTC).getTime() / MIN_MS) * MIN_MS;
      
      const arrObj = new Date(fromMs);
      const minutes = arrObj.getMinutes();
      toMs = fromMs + WINDOW_MS - (minutes + 1) * MIN_MS;
    } else if (isTodayMode) {
      // Normal mode today: rolling window from now, exact start
      // End window at :59 of the previous hour on the next day (e.g. 03:04 -> 02:59)
      fromMs = Math.floor(now / ALIGN_MS) * ALIGN_MS;
      
      const nowObj = new Date(fromMs);
      const minutes = nowObj.getMinutes();
      // fromMs + 24h - (minutes + 1) minutes = :59 of the prev hour tomorrow
      toMs = fromMs + WINDOW_MS - (minutes + 1) * MIN_MS;
    } else {
      // Manual date (or later day in Trip mode): compute window covering travelDate in all TZs
      const tzs = new Set<string>([timezone]);
      Object.values(airportTimezones ?? {}).forEach(tz => { if (tz) tzs.add(tz); });
      fromMs = Infinity;
      toMs   = -Infinity;
      for (const tz of tzs) {
        const midnight = utcMidnightOf(travelDate, tz);
        if (midnight < fromMs) fromMs = midnight;
        if (midnight + WINDOW_MS > toMs) toMs = midnight + WINDOW_MS;
      }
    }

    airportCodes.forEach(code => {
      const airportTZ = airportTimezones?.[code] ?? timezone;
      ensureLoaded(code, fromMs, toMs, airportTZ);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airportCodes, timezone, travelDate, airportTimezones, tripArrivalTimeUTC]);

  // ── Refresh ─────────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setRawFlights([]);
    perAirportLoadedRef.current = new Map();
    setPerAirportLoading({});
    setError(null);
    dateOrderRef.current = [];
    if (!timezone || airportCodes.length === 0) return;

    const now    = Date.now();
    const nowMin = now - (now % MIN_MS);
    let fromMs: number, toMs: number;

    if (tripArrivalTimeUTC) {
      fromMs = Math.floor(new Date(tripArrivalTimeUTC).getTime() / MIN_MS) * MIN_MS;
      toMs   = fromMs + WINDOW_MS;
    } else {
      fromMs = nowMin;
      const nowObj = new Date(fromMs);
      const minutes = nowObj.getMinutes();
      toMs = fromMs + WINDOW_MS - (minutes + 1) * MIN_MS;
    }

    await Promise.all(airportCodes.map(code => {
      const airportTZ = airportTimezones?.[code] ?? timezone;
      return fetchAirportRange(code, fromMs, toMs, airportTZ);
    }));
  }, [airportCodes, timezone, airportTimezones, tripArrivalTimeUTC, fetchAirportRange]);

  return { rawFlights, error, lastFetched, perAirportLoading, anyLoading, flightsByDate, dateOrderRef, handleRefresh };
}
