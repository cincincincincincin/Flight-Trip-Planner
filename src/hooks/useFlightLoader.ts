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
  perAirportFullyLoaded: Record<string, boolean>;
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
  const { appendFlights, setFlightsData, setHighlightedAirports, flightsData: rawFlights } = useSelectionStore();

  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [perAirportLoading, setPerAirportLoading] = useState<Record<string, boolean>>({});
  const [perAirportFullyLoaded, setPerAirportFullyLoaded] = useState<Record<string, boolean>>({});

  // UTC ms range that has been fetched per airport: { fromMs, toMs }
  const perAirportLoadedRef = useRef<Map<string, { fromMs: number; toMs: number }>>(new Map());
  // Keys: code, Value: current target toMs — prevents concurrent redundant fetches for the same airport
  const perAirportFetchingRef = useRef<Map<string, number>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    
    rawFlights.forEach((flight: Flight) => {
      const dateStr = (flight.scheduled_departure_utc && timezone)
        ? getIsoDate(flight.scheduled_departure_utc, timezone)
        : (flight.scheduled_departure_local?.split('T')[0] ?? '');
      if (!dateStr) return;
      (byDate[dateStr] ??= []).push(flight);
    });

    return byDate;
  }, [rawFlights, timezone]);

  const dateOrder = useMemo(() => Object.keys(flightsByDate).sort(), [flightsByDate]);
  useEffect(() => { dateOrderRef.current = dateOrder; }, [dateOrder]);

  // ── UTC midnight of dateStr in tz ────────────
  const getUtcMidnight = useCallback((dateStr: string, tz: string): number => {
    return utcMidnightOf(dateStr, tz);
  }, []);

  // ── UTC ms → local datetime string at minute precision ─────────────────────
  const localMinute = useCallback((utcMs: number, tz: string): string => {
    return getIsoDatetime(new Date(utcMs), tz);
  }, []);

  // ── Fetch one airport for a bounded UTC range ───────────────────────────────
  const fetchAirportRange = useCallback(async (
    code: string,
    fromMs: number,
    toMs: number,
    airportTZ: string,
    signal: AbortSignal
  ): Promise<void> => {
    // Dedup: skip if a fetch for this airport is already aimed at covering [fromMs, toMs]
    const currentlyFetchingTo = perAirportFetchingRef.current.get(code);
    if (currentlyFetchingTo !== undefined && currentlyFetchingTo >= toMs) return;
    perAirportFetchingRef.current.set(code, toMs);

    const showLogs = useSettingsStore.getState().showConsoleLogs;
    setPerAirportLoading((prev: Record<string, boolean>) => ({ ...prev, [code]: true }));
    setError(null);

    try {
      const fromLocal = localMinute(fromMs, airportTZ);
      const toLocal = localMinute(toMs, airportTZ);
      
      if (showLogs) console.log(`%c[ACTION-LOAD] %cfetchAirportRange START | Airport: ${code}, From: ${fromLocal}, To: ${toLocal}`, 'color: #8b5cf6; font-weight: bold', 'color: inherit');

      const url = `${CONFIG.API_BASE_URL}/schedules/${code}?from_local_datetime=${fromLocal}&to_local_datetime=${toLocal}&limit=${CONFIG.FLIGHT_LIMIT}`;
      const response = await fetch(url, { signal });

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
              flightUpdateBufferRef.current.push(...batch.data);
              
              if (flightBatchTimerRef.current === null) {
                flightBatchTimerRef.current = requestAnimationFrame(() => {
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

                  if (fresh.length > 0 && !signal.aborted) {
                    appendFlights(fresh);
                  }
                });
              }

              if (batch.last_fetched_at) {
                setLastFetched((prev: string | null) =>
                  !prev || batch.last_fetched_at! > prev ? batch.last_fetched_at! : prev
                );
              }
            }

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
      if (!signal.aborted) {
        setPerAirportFullyLoaded((prev: Record<string, boolean>) => ({ ...prev, [code]: true }));
      }
    }
  }, [localMinute, appendFlights]);

  // ── Ensure airport is loaded for [targetFromMs, targetToMs], filling gaps ──
  const ensureLoaded = useCallback(async (
    code: string,
    targetFromMs: number,
    targetToMs: number,
    airportTZ: string,
    signal: AbortSignal
  ): Promise<void> => {
    const loaded = perAirportLoadedRef.current.get(code);
    if (!loaded) {
      await fetchAirportRange(code, targetFromMs, targetToMs, airportTZ, signal);
      return;
    }
    const gapBefore = targetFromMs < loaded.fromMs;
    const gapAfter  = targetToMs   > loaded.toMs;
    if (!gapBefore && !gapAfter) return;
    if (gapBefore) await fetchAirportRange(code, targetFromMs, Math.min(loaded.fromMs, targetToMs), airportTZ, signal);
    if (gapAfter)  await fetchAirportRange(code, Math.max(loaded.toMs, targetFromMs), targetToMs, airportTZ, signal);
  }, [fetchAirportRange]);

  useEffect(() => {
    const showLogs = useSettingsStore.getState().showConsoleLogs;

    // [v24.80]: Agresywne przerywanie poprzednich żądań
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      if (!timezone || airportCodes.length === 0) return;

      const normalizedCodes = airportCodes.map(c => (c || '').toUpperCase()).filter(Boolean);
      const codesKey  = JSON.stringify([...new Set(normalizedCodes)].sort());
      const now    = Date.now();
      const todayInTZ  = getTodayInTz(timezone);

      const prevTimezone = prevTimezoneRef.current;
      prevTimezoneRef.current = timezone;
      const tzJustChanged  = timezone !== prevTimezone && !!prevTimezone;
      const arrivalDay = tripArrivalTimeUTC
        ? getIsoDate(new Date(tripArrivalTimeUTC), timezone)
        : null;
      
      const todayInBrowser = getTodayInTz();
      const isTodayMode = (arrivalDay ? travelDate === arrivalDay : (travelDate === todayInTZ || travelDate === todayInBrowser));

      const cacheKeyDate = isTodayMode ? 'today' : travelDate;
      const cacheKey = `${cacheKeyDate}|${codesKey}`;

      const prevCacheKey = cacheKeyRef.current;
      const prevCodesKey = prevCacheKey ? prevCacheKey.split('|')[1] : '';
      const isNewSet = prevCodesKey !== codesKey;
      const prevCodes: string[] = prevCodesKey ? JSON.parse(prevCodesKey) : [];
      
      const isAdditionOnly = isNewSet && prevCodes.length > 0 && prevCodes.every(c => normalizedCodes.includes(c));
      const dateOrAirportsChanged = prevCacheKey !== cacheKey;

      if (dateOrAirportsChanged) cacheKeyRef.current = cacheKey;

      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (isNewSet && !isAdditionOnly) {
        setFlightsData([]);
        setHighlightedAirports([]);
        loadedFlightKeysRef.current = new Set();
        perAirportLoadedRef.current = new Map();
        perAirportFetchingRef.current = new Map();
        setPerAirportLoading({});
        setPerAirportFullyLoaded({});
        setError(null);
      } else if (dateOrAirportsChanged && !isAdditionOnly) {
        perAirportLoadedRef.current = new Map();
        perAirportFetchingRef.current = new Map();
        setPerAirportLoading({});
        setPerAirportFullyLoaded({});
        setError(null);
      }

      if (airportCodes.some(c => !airportTimezones?.[c])) return;

      let fromMs: number;
      let toMs: number;

      if (tripArrivalTimeUTC && isTodayMode) {
        fromMs = Math.floor(new Date(tripArrivalTimeUTC).getTime() / MIN_MS) * MIN_MS;
        const arrObj = new Date(fromMs);
        const minutes = arrObj.getMinutes();
        toMs = fromMs + WINDOW_MS - (minutes + 1) * MIN_MS;
      } else if (isTodayMode) {
        fromMs = Math.floor(now / ALIGN_MS) * ALIGN_MS;
        const nowObj = new Date(fromMs);
        const minutes = nowObj.getMinutes();
        toMs = fromMs + WINDOW_MS - (minutes + 1) * MIN_MS;
      } else {
        const tzs = new Set<string>([timezone]);
        Object.values(airportTimezones ?? {}).forEach(tz => { if (tz) tzs.add(tz); });
        fromMs = Infinity;
        toMs   = -Infinity;
        for (const tz of tzs) {
          const midnight = getUtcMidnight(travelDate, tz);
          const windowEnd = midnight + WINDOW_MS - ALIGN_MS;
          if (midnight < fromMs) fromMs = midnight;
          if (windowEnd > toMs) toMs = windowEnd;
        }
      }

      airportCodes.forEach(code => {
        const airportTZ = airportTimezones?.[code] ?? timezone;
        ensureLoaded(code, fromMs, toMs, airportTZ, controller.signal);
      });
    }, 150);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [airportCodes, timezone, travelDate, airportTimezones, tripArrivalTimeUTC, ensureLoaded, getUtcMidnight, setFlightsData, setHighlightedAirports]);

  const handleRefresh = useCallback(async () => {
    if (loaderMutexRef.current) return;
    loaderMutexRef.current = true;
    
    try {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setFlightsData([]);
      loadedFlightKeysRef.current = new Set();
      perAirportLoadedRef.current = new Map();
      perAirportFetchingRef.current = new Map();
      setPerAirportLoading({});
      setPerAirportFullyLoaded({});
      setError(null);
      
      if (!timezone || airportCodes.length === 0) return;

      const now = Date.now();
      let fromMs: number, toMs: number;

      if (tripArrivalTimeUTC) {
        fromMs = Math.floor(new Date(tripArrivalTimeUTC).getTime() / MIN_MS) * MIN_MS;
        const nowObj = new Date(fromMs);
        const minutes = nowObj.getMinutes();
        toMs = fromMs + WINDOW_MS - (minutes + 1) * MIN_MS;
      } else {
        fromMs = Math.floor(now / ALIGN_MS) * ALIGN_MS;
        const nowObj = new Date(fromMs);
        const minutes = nowObj.getMinutes();
        toMs = fromMs + WINDOW_MS - (minutes + 1) * MIN_MS;
      }

      airportCodes.forEach(code => {
        const airportTZ = airportTimezones?.[code] ?? timezone;
        fetchAirportRange(code, fromMs, toMs, airportTZ, controller.signal);
      });
    } finally {
      loaderMutexRef.current = false;
    }
  }, [airportCodes, timezone, airportTimezones, tripArrivalTimeUTC, fetchAirportRange, setFlightsData, setHighlightedAirports]);

  return { rawFlights, error, lastFetched, perAirportLoading, perAirportFullyLoaded, anyLoading, flightsByDate, dateOrderRef, handleRefresh };
}
