import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { supabase } from '../lib/supabaseClient';
import type { Flight } from '../types';
import { CONFIG } from '../constants/config';
import { getIsoDate, getIsoDatetime, getTodayInTz } from '../utils/dateFormatting';
import dayjs from '../lib/dayjs';
import { logger } from '../utils/logger';

// 24 godziny — stały rozmiar okna UTC dla widoku jednodniowego (kroczący w trybie "dzisiaj")
const WINDOW_MS = 24 * 60 * 60_000;
const MIN_MS = 60_000;
const ALIGN_MS = 60_000; // Wyrównanie do 1 minuty dla precyzyjnego startu okna

// Helpers
const toLocalMinute = (ms: number, tz: string) => dayjs(ms).tz(tz).format('YYYY-MM-DDTHH:mm');

/** 
 * Wyznacza UTC timestamp dla północy (00:00:00) danej daty w podanej strefie czasowej.
 * Obsługuje poprawnie DST i UTC±14. Zastępuje uproszczony algorytm "noon-probe".
 */
const utcMidnightOf = (dateStr: string, tz: string): number =>
  dayjs.tz(`${dateStr}T00:00:00`, tz).valueOf();

/**
 * Strategia ładowania lotów: NDJSON Streaming & RAF Batching
 * Kluczowy element wydajności aplikacji. Zamiast czekać na pełną odpowiedź JSON, system przetwarza
 * strumień danych binarnych (ReadableStream) wiersz po wierszu. Pozwala to na natychmiastowe 
 * wyświetlanie pierwszych wyników na mapie, nawet gdy pobierane są tysiące lotów.
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
  initialFromDatetime?: string; // zachowane dla kompatybilności API, nieużywane w nowej logice
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
  dateOrderRef: React.RefObject<string[]>;
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
  const { appendFlights, setFlightsData, removeAirportsData, setHighlightedAirports, flightsData: rawFlights } = useSelectionStore();

  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [perAirportLoading, setPerAirportLoading] = useState<Record<string, boolean>>({});
  const [perAirportFullyLoaded, setPerAirportFullyLoaded] = useState<Record<string, boolean>>({});

  // Zakres UTC ms pobrany dla każdego lotniska: { fromMs, toMs }
  const perAirportLoadedRef = useRef<Map<string, { fromMs: number; toMs: number }>>(new Map());
  // Klucze: kod, Wartość: aktualny docelowy czas toMs — zapobiega nadmiarowym żądaniom dla tego samego portu
  const perAirportFetchingRef = useRef<Map<string, number>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flightUpdateBufferRef = useRef<Flight[]>([]);
  const flightBatchTimerRef = useRef<number | null>(null);
  const cacheKeyRef = useRef<string>('');
  const prevTimezoneRef = useRef<string>(timezone ?? '');
  const dateOrderRef = useRef<string[]>([]);

  /** Szybkie sprawdzanie kluczy lotów dla całej aplikacji (O(1)). */
  const loadedFlightKeysRef = useRef<Set<string>>(new Set());
  /** Blokada ładowania zapobiegająca nakładaniu się procesów odświeżania. */
  const loaderMutexRef = useRef(false);

  const anyLoading = Object.values(perAirportLoading).some(Boolean);

  // Grupowanie lotów według daty wylotu w wybranej strefie czasowej.
  // Intl.DateTimeFormat (natywny) jest ~10× szybszy niż dayjs.tz() dla konwersji masowej.
  const flightsByDate = useMemo<Record<string, Flight[]>>(() => {
    const byDate: Record<string, Flight[]> = {};

    // Tworzymy formatter RAZ - en-CA daje format YYYY-MM-DD natywnie
    const fmt = timezone
      ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      : null;

    rawFlights.forEach((flight: Flight) => {
      let dateStr: string;
      if (flight.scheduled_departure_utc && fmt) {
        // API zwraca UTC bez 'Z' - dodajemy żeby Date() wiedział że to UTC
        const utcStr = flight.scheduled_departure_utc.endsWith('Z')
          ? flight.scheduled_departure_utc
          : flight.scheduled_departure_utc + 'Z';
        const ms = Date.parse(utcStr);
        dateStr = isNaN(ms) ? '' : fmt.format(ms);
      } else {
        dateStr = flight.scheduled_departure_local?.split('T')[0] ?? '';
      }
      if (!dateStr) return;
      (byDate[dateStr] ??= []).push(flight);
    });

    return byDate;
  }, [rawFlights, timezone]);

  const dateOrder = useMemo(() => Object.keys(flightsByDate).sort(), [flightsByDate]);
  useEffect(() => { dateOrderRef.current = dateOrder; }, [dateOrder]);

  // Północ UTC dla podanej daty w danej strefie
  const getUtcMidnight = useCallback((dateStr: string, tz: string): number => {
    return utcMidnightOf(dateStr, tz);
  }, []);

  // Konwersja UTC ms na lokalny ciąg daty z dokładnością do minuty
  const localMinute = useCallback((utcMs: number, tz: string): string => {
    return getIsoDatetime(new Date(utcMs), tz);
  }, []);

  // ── Pobieranie zakresu lotów dla jednego lotniska (NDJSON) ──────────────────
  const fetchAirportRange = useCallback(async (
    code: string,
    fromMs: number,
    toMs: number,
    airportTZ: string,
    signal: AbortSignal
  ): Promise<void> => {
    // Dedup: pomijamy zapytanie, jeśli trwa już pobieranie pokrywające ten sam zakres dla tego lotniska.
    const currentlyFetchingTo = perAirportFetchingRef.current.get(code);
    if (currentlyFetchingTo !== undefined && currentlyFetchingTo >= toMs) return;
    perAirportFetchingRef.current.set(code, toMs);

    const showLogs = useSettingsStore.getState().showConsoleLogs;
    setPerAirportLoading((prev: Record<string, boolean>) => ({ ...prev, [code]: true }));
    setError(null);

    try {
      const fromLocal = localMinute(fromMs, airportTZ);
      const toLocal = localMinute(toMs, airportTZ);

      logger.log(`%c[ACTION-LOAD] %cfetchAirportRange START | Port: ${code}, Od: ${fromLocal}, Do: ${toLocal}`, 'color: #8b5cf6; font-weight: bold', 'color: inherit');

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
        buffer = lines.pop() ?? ''; // Zachowaj niepełną linię w buforze

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const batch = JSON.parse(line) as RawScheduleResponse & { error?: string };

            if (batch.success === false) {
              logger.warn(`%c[ACTION-LOAD] %cfetchAirportRange BŁĄD PACZKI | Port: ${code}, Błąd: ${batch.error}`, 'color: #ef4444; font-weight: bold', 'color: inherit');
              setError(batch.error ?? 'Failed to load flights batch');
              continue;
            }

            if (batch.data) {
              // Dodajemy loty do bufora aktualizacji zamiast bezpośrednio do stanu.
              flightUpdateBufferRef.current.push(...batch.data);

              // Aktualizacja stanów przez requestAnimationFrame, aby aktualizować Reacta
              // w rytm odświeżania monitora (60fps). Zapobiega to blokowaniu wątku głównego.
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
              toMs: prevLoad ? Math.max(prevLoad.toMs, batchEndMs) : batchEndMs,
            });

          } catch (e) {
            logger.error('Nie udało się przeanalizować linii NDJSON:', e);
          }
        }
      }

      const lastLoad = perAirportLoadedRef.current.get(code);
      perAirportLoadedRef.current.set(code, {
        fromMs: lastLoad ? Math.min(lastLoad.fromMs, fromMs) : fromMs,
        toMs: lastLoad ? Math.max(lastLoad.toMs, toMs) : toMs,
      });

    } catch (err: any) {
      if (err.name === 'AbortError') {
        logger.warn(`%c[ACTION-LOAD] %cfetchAirportRange ANULOWANO | Port: ${code}`, 'color: #f59e0b; font-weight: bold', 'color: inherit');
      } else {
        logger.error(`%c[ACTION-LOAD] %cfetchAirportRange FAIL | Port: ${code}, Błąd:`, 'color: #ef4444; font-weight: bold', 'color: inherit', err);
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

  /**
   * Zarządzanie lukami: Sprawdza, które fragmenty czasu dla danego lotniska
   * są już w pamięci. Jeśli brakuje "kawałka" czasu (np. po zmianie daty),
   * inicjuje pobieranie tylko brakującego zakresu (Gap Fill).
   */
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
    const gapAfter = targetToMs > loaded.toMs;
    if (!gapBefore && !gapAfter) return;
    if (gapBefore) await fetchAirportRange(code, targetFromMs, Math.min(loaded.fromMs, targetToMs), airportTZ, signal);
    if (gapAfter) await fetchAirportRange(code, Math.max(loaded.toMs, targetFromMs), targetToMs, airportTZ, signal);
  }, [fetchAirportRange]);

  useEffect(() => {
    const showLogs = useSettingsStore.getState().showConsoleLogs;

    // Agresywne przerywanie poprzednich żądań
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      if (!timezone || airportCodes.length === 0) return;

      const normalizedCodes = airportCodes.map(c => (c || '').toUpperCase()).filter(Boolean);
      const codesKey = JSON.stringify([...new Set(normalizedCodes)].sort());
      const now = Date.now();
      const todayInTZ = getTodayInTz(timezone);

      const prevTimezone = prevTimezoneRef.current;
      prevTimezoneRef.current = timezone;
      const tzJustChanged = timezone !== prevTimezone && !!prevTimezone;
      const arrivalDay = tripArrivalTimeUTC
        ? getIsoDate(new Date(tripArrivalTimeUTC), timezone)
        : null;

      const todayInBrowser = getTodayInTz();
      const isTodayMode = (arrivalDay ? travelDate === arrivalDay : (travelDate === todayInTZ || travelDate === todayInBrowser));

      const cacheKeyDate = isTodayMode ? 'today' : travelDate;
      const cacheKey = `${cacheKeyDate}|${codesKey}`;

      const prevCacheKey = cacheKeyRef.current;
      const prevDate = prevCacheKey ? prevCacheKey.split('|')[0] : '';
      const prevCodesKey = prevCacheKey ? prevCacheKey.split('|')[1] : '';
      const prevCodes: string[] = prevCodesKey ? JSON.parse(prevCodesKey) : [];

      const dateChanged = prevDate !== cacheKeyDate;
      const airportsChanged = prevCodesKey !== codesKey;

      if (dateChanged || airportsChanged) cacheKeyRef.current = cacheKey;

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // --- OPTYMALIZACJA SELEKCJI ---
      if (dateChanged) {
        // Jeśli zmieniła się data, robimy pełny reset (nowy kontekst czasowy).
        // Czyścimy wszystkie pamięci podręczne lotów i indeksy.
        setFlightsData([]);
        setHighlightedAirports([]);
        loadedFlightKeysRef.current = new Set();
        perAirportLoadedRef.current = new Map();
        perAirportFetchingRef.current = new Map();
        setPerAirportLoading({});
        setPerAirportFullyLoaded({});
        setError(null);
      } else if (airportsChanged) {
        // Jeśli zmieniły się tylko wybrane lotniska, usuwamy tylko te, 
        // które zniknęły z listy zaznaczenia (Granular Clearing).
        const removedCodes = prevCodes.filter(c => !normalizedCodes.includes(c));

        if (removedCodes.length > 0) {
          logger.log(`%c[ACTION-LOAD] %cUsuwanie danych dla lotnisk: ${removedCodes.join(', ')}`, 'color: #f59e0b; font-weight: bold', 'color: inherit');

          // 1. Usuwamy loty i podświetlenia tylko dla usuniętych lotnisk.
          removeAirportsData(removedCodes);

          // 2. Czyścimy cache wewnętrzny haka dla tych konkretnych kodów.
          removedCodes.forEach(code => {
            perAirportLoadedRef.current.delete(code);
            perAirportFetchingRef.current.delete(code);
            setPerAirportLoading(prev => { const n = { ...prev }; delete n[code]; return n; });
            setPerAirportFullyLoaded(prev => { const n = { ...prev }; delete n[code]; return n; });

            // Czyścimy też klucze lotów, aby móc je ponownie zaimportować jeśli lotnisko wróci
            // Uwaga: To jest uproszczone, bo nie wiemy które klucze należały do którego lotniska.
            // Ale appendFlights i tak sprawdza duplikaty, więc to bezpieczne.
          });

          // Resetujemy globalny Set kluczy, zostanie odbudowany przy kolejnych appendFlights
          // lub możemy go zostawić (appendFlights używa state._dedupKeys, który jest aktualizowany w removeAirportsData)
          loadedFlightKeysRef.current = new Set();
        }
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
        toMs = -Infinity;
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
