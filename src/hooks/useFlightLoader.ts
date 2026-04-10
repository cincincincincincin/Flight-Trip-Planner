import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { supabase } from '../lib/supabaseClient';
import type { Flight } from '../types';
import { CONFIG } from '../constants/config';
import { getIsoDate, getIsoDatetime, getTodayInTz } from '../utils/dateFormatting';
import dayjs from '../lib/dayjs';

// 24 hours — the fixed UTC window size for any single-day view (rolling in today mode)
const WINDOW_MS = 24 * 60 * 60_000;
const MIN_MS = 60_000;
const ALIGN_MS = 60_000; // Alignment to 1 minute for exact rolling window start

// Helpers
const toLocalMinute = (ms: number, tz: string) => dayjs(ms).tz(tz).format('YYYY-MM-DDTHH:mm');

/** 
 * [DAYJS]: Wyznacza UTC timestamp dla północy (00:00:00) danej daty w podanej strefie czasowej.
 * Obsługuje poprawnie DST i UTC±14. Zastępuje aluminiowy algorytm "noon-probe" oparty na Intl/sv-SE.
 */
const utcMidnightOf = (dateStr: string, tz: string): number =>
  dayjs.tz(`${dateStr}T00:00:00`, tz).valueOf();

/**
 * [STRATEGIA ŁADOWANIA LOTÓW]: NDJSON Streaming & RAF Batching
 * To serce wydajności aplikacji. Zamiast czekać na pełną odpowiedź JSON, system przetwarza
 * strumień danych wiersz po wierszu, co pozwala na natychmiastowe wyświetlanie pierwszych wyników.
 */
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
  const { appendFlights, setFlightsData, flightsData: rawFlights } = useSelectionStore();

  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [perAirportLoading, setPerAirportLoading] = useState<Record<string, boolean>>({});

  // UTC ms range that has been fetched per airport: { fromMs, toMs }
  const perAirportLoadedRef = useRef<Map<string, { fromMs: number; toMs: number }>>(new Map());
  // Keys: code, Value: current target toMs — prevents concurrent redundant fetches for the same airport
  const perAirportFetchingRef = useRef<Map<string, number>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);
  const flightUpdateBufferRef = useRef<Flight[]>([]);
  const flightBatchTimerRef = useRef<number | null>(null);
  const cacheKeyRef = useRef<string>('');
  const prevTimezoneRef = useRef<string>(timezone ?? '');
  const dateOrderRef = useRef<string[]>([]);
  
  /** [STRATEGIA O(1)]: Szybki lookup kluczy lotów dla całej aplikacji. */
  const loadedFlightKeysRef = useRef<Set<string>>(new Set());
  /** [MUTEX LOADER LOCK]: Zapobiega nakładaniu się procesów odświeżania. */
  const loaderMutexRef = useRef(false);

  const anyLoading = Object.values(perAirportLoading).some(Boolean);

  // ── Flight grouping keyed by departure date in the display timezone ─────────
  const flightsByDate = useMemo<Record<string, Flight[]>>(() => {
    const byDate: Record<string, Flight[]> = {};
    
    if (rawFlights.length > 0) {
       console.log(`%c[ACTION-LOAD] %cGrouping ${rawFlights.length} flights into dates...`, 'color: #10b981; font-weight: bold', 'color: inherit');
    }

    rawFlights.forEach((flight: Flight) => {
      const dateStr = (flight.scheduled_departure_utc && timezone)
        ? getIsoDate(flight.scheduled_departure_utc, timezone)
        : (flight.scheduled_departure_local?.split('T')[0] ?? '');
      if (!dateStr) return;
      (byDate[dateStr] ??= []).push(flight);
    });

    console.log(`%c[ACTION-LOAD] %cGrouping DONE | Dates found: ${Object.keys(byDate).join(', ')}`, 'color: #10b981; font-weight: bold', 'color: inherit');
    return byDate;
  }, [rawFlights, timezone]);

  const dateOrder = useMemo(() => Object.keys(flightsByDate).sort(), [flightsByDate]);
  useEffect(() => { dateOrderRef.current = dateOrder; }, [dateOrder]);

  // ── UTC midnight of dateStr in tz ────────────
  const getUtcMidnight = useCallback((dateStr: string, tz: string): number => {
    return utcMidnightOf(dateStr, tz);
  }, []);

  // ── UTC ms → local datetime string at minute precision ─────────────────────
  const toLocalMinute = useCallback((utcMs: number, tz: string): string => {
    return getIsoDatetime(new Date(utcMs), tz);
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

    const showLogs = useSettingsStore.getState().showConsoleLogs;
    setPerAirportLoading((prev: Record<string, boolean>) => ({ ...prev, [code]: true }));
    setError(null);

    try {
      if (currentlyFetchingTo !== undefined && currentlyFetchingTo >= toMs) {
        console.log(`%c[ACTION-LOAD] %c[REFUSED] fetchAirportRange | Code: ${code} | already aimed at ${toLocalMinute(currentlyFetchingTo, airportTZ)}`, 'color: #ef4444; font-weight: bold', 'color: inherit');
        return;
      }
      perAirportFetchingRef.current.set(code, toMs);

      const fromLocal = toLocalMinute(fromMs, airportTZ);
      const toLocal = toLocalMinute(toMs, airportTZ); // [FIX]: Removed -1 to avoid :58 instead of :59
      
      console.log(`%c[ACTION-LOAD] %cfetchAirportRange START | Airport: ${code}, From: ${fromLocal}, To: ${toLocal}`, 'color: #8b5cf6; font-weight: bold', 'color: inherit');

      /**
       * [AUTHORIZATION POLICY]: Obsługa sesji i tokenów JWT.
       * Aplikacja jest "Guest-Ready": jeśli session.access_token jest obecny, dołącza go
       * do nagłówka; w przeciwnym razie zapytanie jest wysyłane anonimowo.
       */
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      // [CORS-FIX]: No Auth header for public flight schedules fetch

      const url = `${CONFIG.API_BASE_URL}/schedules/${code}?from_local_datetime=${fromLocal}&to_local_datetime=${toLocal}&limit=${CONFIG.FLIGHT_LIMIT}`;
      const response = await fetch(url, { 
        headers,
        signal: abortControllerRef.current?.signal 
      });

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
              if (showLogs) console.warn(`%c[ACTION-LOAD] %cfetchAirportRange BATCH ERROR | Airport: ${code}, Err: ${batch.error}`, 'color: #ef4444; font-weight: bold', 'color: inherit');
              setError(batch.error ?? 'Failed to load flights batch');
              continue;
            }

            if (batch.data) {
              // ZERO WASTE: RAF-based batching state updates
              flightUpdateBufferRef.current.push(...batch.data);
              
              if (flightBatchTimerRef.current === null) {
                flightBatchTimerRef.current = requestAnimationFrame(() => {
                  const updateStart = performance.now();
                  const items = flightUpdateBufferRef.current;
                  flightUpdateBufferRef.current = [];
                  flightBatchTimerRef.current = null;
                  
                  if (items.length === 0) return;
                  
                  const getFlightKey = (f: Flight) => `${f.flight_number}-${f.scheduled_departure_utc}`;
                  const fresh = items.filter((f: Flight) => {
                    const key = getFlightKey(f);
                    if (loadedFlightKeysRef.current.has(key)) return false;
                    loadedFlightKeysRef.current.add(key);
                    return true;
                  });

                  if (fresh.length > 0) {
                    appendFlights(fresh);
                  }

                  const updateEnd = performance.now();
                  console.log(`%c[ACTION-LOAD] %cRAF BATCH | New Items: ${fresh.length}, Time: ${(updateEnd - updateStart).toFixed(2)}ms`, 'color: #8b5cf6; font-weight: bold', 'color: inherit');
                });
              }

              if (batch.last_fetched_at) {
                setLastFetched((prev: string | null) =>
                  !prev || batch.last_fetched_at! > prev ? batch.last_fetched_at! : prev
                );
              }
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
      if (err.name === 'AbortError') {
        if (showLogs) console.warn(`%c[ACTION-LOAD] %cfetchAirportRange ABORTED | Airport: ${code}`, 'color: #f59e0b; font-weight: bold', 'color: inherit');
      } else {
        if (showLogs) console.error(`%c[ACTION-LOAD] %cfetchAirportRange FAIL | Airport: ${code}, Err:`, 'color: #ef4444; font-weight: bold', 'color: inherit', err);
        setError(err.message ?? 'Failed to load flights');
      }
    } finally {
      if (perAirportFetchingRef.current.get(code) === toMs) {
        perAirportFetchingRef.current.delete(code);
      }
      setPerAirportLoading((prev: Record<string, boolean>) => ({ ...prev, [code]: false }));
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

  useEffect(() => {
    const showLogs = useSettingsStore.getState().showConsoleLogs;
    if (!timezone || airportCodes.length === 0) {
      if (airportCodes.length > 0) console.log("%c[ACTION-LOAD] %cEFFECT ABORT | Missing primary timezone", 'color: #ef4444; font-weight: bold', 'color: inherit');
      return;
    }

    console.log("%c[ACTION-LOAD] %cMOUNT", 'color: #3b82f6; font-weight: bold', 'color: inherit');
    
    const normalizedCodes = airportCodes.map(c => (c || '').toUpperCase()).filter(Boolean);
    const codesKey  = JSON.stringify([...new Set(normalizedCodes)].sort());
    const now    = Date.now();
    const nowMin = now - (now % MIN_MS);
    const todayInTZ  = getTodayInTz(timezone);

    // Guard: when timezone changes, travelDate may still be "today in old TZ" for 1 render
    // (before useTravelDate fires). Detect this transient state and force today mode.
    const prevTimezone = prevTimezoneRef.current;
    prevTimezoneRef.current = timezone;
    const tzJustChanged  = timezone !== prevTimezone && !!prevTimezone;
    const todayInPrevTZ  = (tzJustChanged && prevTimezone)
      ? getTodayInTz(prevTimezone)
      : null;
    const arrivalDay = tripArrivalTimeUTC
      ? getIsoDate(new Date(tripArrivalTimeUTC), timezone)
      : null;
    const arrivalDayInPrevTZ = (tzJustChanged && prevTimezone && tripArrivalTimeUTC)
      ? getIsoDate(new Date(tripArrivalTimeUTC), prevTimezone)
      : null;
    const todayInBrowser = getTodayInTz();

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
    
    // [LEGACY LOGIC]: isAdditionOnly = tylko nowe lotniska dodane, żadne nie usunięte.
    // Pozwala ominąć pełny reset i dociągnąć tylko brakujące zakresy.
    // ensureLoaded() ma wbudowany per-airport gap-guard, więc nie re-fetchuje już załadowanych.
    const isAdditionOnly = isNewSet && prevCodes.length > 0 && prevCodes.every(c => normalizedCodes.includes(c));
    
    const dateOrAirportsChanged = prevCacheKey !== cacheKey;

    if (showLogs) console.log(`%c[ACTION-LOAD] %cEFFECT TRIGGER | CacheKey: ${cacheKey}, changed: ${dateOrAirportsChanged}, addition: ${isAdditionOnly}`, 'color: #8b5cf6; font-weight: bold', 'color: inherit');
    
    if (dateOrAirportsChanged) cacheKeyRef.current = cacheKey;

    if (isNewSet && !isAdditionOnly) {
      // Lotnisko usunięte, wymiana zestawu / pierwszy load → pełny reset.
      if (showLogs) console.log(`%c[ACTION-LOAD] %cRESET (New Set) | ${prevCodesKey} -> ${codesKey}`, 'color: #8b5cf6; font-weight: bold', 'color: inherit');
      if (abortControllerRef.current) abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();

      setFlightsData([]);
      loadedFlightKeysRef.current = new Set();
      perAirportLoadedRef.current = new Map();
      perAirportFetchingRef.current = new Map();
      setPerAirportLoading({});
      setError(null);
      dateOrderRef.current = [];
    } else if (dateOrAirportsChanged && !isAdditionOnly) {
      // Zmiana daty przy tych samych lotniskach → czyścimy historię fetchy, aby wymusić nowe okna
      if (!tzJustChanged) {
        if (showLogs) console.log(`%c[ACTION-LOAD] %cCLEAR (Date) | ${travelDate}`, 'color: #8b5cf6; font-weight: bold', 'color: inherit');
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

        setFlightsData([]);
        loadedFlightKeysRef.current = new Set();
        perAirportLoadedRef.current = new Map();
        perAirportFetchingRef.current = new Map();
      }
    }
    // isAdditionOnly → nie robimy nic poza dociągnięciem nowych lotnisk (poniżej)

    // Poczekaj aż wszystkie timezone lotnisk będą znane
    if (airportCodes.some(c => !airportTimezones?.[c])) return;

    // ── Wyznacz globalne okno UTC ──────────────────────────────────────────────
    let fromMs: number;
    let toMs: number;

    if (showLogs) console.log(`%c[ACTION-LOAD] %cCOMPUTE WINDOW | Codes: ${airportCodes.join(',')}, Date: ${travelDate}, Mode: ${isTodayMode ? 'Today' : 'Manual'}, TZ: ${timezone}`, 'color: #8b5cf6; font-weight: bold', 'color: inherit');

    if (tripArrivalTimeUTC && isTodayMode) {
      // Tryb podróży w dniu przylotu: okno od momentu przylotu do :59 następnego dnia
      fromMs = Math.floor(new Date(tripArrivalTimeUTC).getTime() / MIN_MS) * MIN_MS;
      const arrObj = new Date(fromMs);
      const minutes = arrObj.getMinutes();
      toMs = fromMs + WINDOW_MS - (minutes + 1) * MIN_MS;
    } else if (isTodayMode) {
      // [LEGACY]: Okno od aktualnej minuty, wyrównane do :59 poprzedniej godziny następnego dnia.
      fromMs = Math.floor(now / ALIGN_MS) * ALIGN_MS;
      const nowObj = new Date(fromMs);
      const minutes = nowObj.getMinutes();
      toMs = fromMs + WINDOW_MS - (minutes + 1) * MIN_MS;
    } else {
      // Manualna data: unia midnight dla wszystkich stref lotnisk
      const tzs = new Set<string>([timezone]);
      Object.values(airportTimezones ?? {}).forEach(tz => { if (tz) tzs.add(tz); });
      fromMs = Infinity;
      toMs   = -Infinity;
      for (const tz of tzs) {
        const midnight = getUtcMidnight(travelDate, tz);
        if (midnight < fromMs) fromMs = midnight;
        if (midnight + WINDOW_MS > toMs) toMs = midnight + WINDOW_MS;
      }
    }

    // Wywołaj ensureLoaded dla każdego lotniska.
    // ensureLoaded() sam sprawdza czy zakres jest już załadowany (per-airport gap guard) — 
    // więc dla 'isAdditionOnly' nie re-fetchuje starych lotnisk, tylko nowe.
    airportCodes.forEach(code => {
      const airportTZ = airportTimezones?.[code] ?? timezone;
      ensureLoaded(code, fromMs, toMs, airportTZ);
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airportCodes, timezone, travelDate, airportTimezones, tripArrivalTimeUTC]);

  // ── Refresh ─────────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    if (loaderMutexRef.current) return;
    loaderMutexRef.current = true;
    
    try {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();

      setFlightsData([]);
      loadedFlightKeysRef.current = new Set();
      perAirportLoadedRef.current = new Map();
      setPerAirportLoading({});
      setError(null);
      dateOrderRef.current = [];
      if (!timezone || airportCodes.length === 0) return;

      const now    = Date.now();
      const nowMin = now - (now % MIN_MS);
      let fromMs: number, toMs: number;

      if (tripArrivalTimeUTC) {
        // [LEGACY SYNC]
        fromMs = Math.floor(new Date(tripArrivalTimeUTC).getTime() / MIN_MS) * MIN_MS;
        const nowObj = new Date(fromMs);
        const minutes = nowObj.getMinutes();
        toMs = fromMs + WINDOW_MS - (minutes + 1) * MIN_MS;
      } else {
        // [LEGACY SYNC]
        fromMs = nowMin;
        const nowObj = new Date(fromMs);
        const minutes = nowObj.getMinutes();
        toMs = fromMs + WINDOW_MS - (minutes + 1) * MIN_MS;
      }

      await Promise.all(airportCodes.map(code => {
        const airportTZ = airportTimezones?.[code] ?? timezone;
        return fetchAirportRange(code, fromMs, toMs, airportTZ);
      }));
    } finally {
      loaderMutexRef.current = false;
    }
  }, [airportCodes, timezone, airportTimezones, tripArrivalTimeUTC, fetchAirportRange]);

  return { rawFlights, error, lastFetched, perAirportLoading, anyLoading, flightsByDate, dateOrderRef, handleRefresh };
}
