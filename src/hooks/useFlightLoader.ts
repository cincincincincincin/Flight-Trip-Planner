import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getFlights } from '../api/flights';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { Flight } from '../types';
import { FORMAT_LOCALES } from '../constants/format';
import { CONFIG } from '../constants/config';

interface RawFlightsResponse {
  success: boolean;
  data: Flight[];
  range_end_datetime?: string;
  last_fetched_at?: string;
}

interface UseFlightLoaderParams {
  airportCodes: string[];
  timezone?: string;
  initialFromDatetime?: string;
  airportTimezones?: Record<string, string>;
  tripArrivalTimeUTC?: string | null;
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
  initialFromDatetime,
  airportTimezones,
  tripArrivalTimeUTC,
}: UseFlightLoaderParams): UseFlightLoaderResult {
  const { travelDate } = useSettingsStore();
  const { appendFlights } = useSelectionStore();

  const [rawFlights, setRawFlights] = useState<Flight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [perAirportLoading, setPerAirportLoading] = useState<Record<string, boolean>>({});

  const perAirportLoadingRef = useRef<Map<string, boolean>>(new Map());
  const perAirportHasMoreRef = useRef<Map<string, boolean>>(new Map());
  const perAirportNextWindowRef = useRef<Map<string, string | null>>(new Map());
  const loadedWindowsRef = useRef<Set<string>>(new Set());
  const dateOrderRef = useRef<string[]>([]);
  const currentAirportCodesRef = useRef<string>('');

  const airportTimezonesRef = useRef(airportTimezones);
  useEffect(() => { airportTimezonesRef.current = airportTimezones; }, [airportTimezones]);

  const travelDateRef = useRef(travelDate);
  useEffect(() => { travelDateRef.current = travelDate; }, [travelDate]);

  const anyLoading = Object.values(perAirportLoading).some(Boolean);

  // ── Timezone-reactive flight grouping ───────────────────────────────────────
  const flightsByDate = useMemo<Record<string, Flight[]>>(() => {
    const byDate: Record<string, Flight[]> = {};
    rawFlights.forEach(flight => {
      let dateStr: string;
      if (flight.scheduled_departure_utc && timezone) {
        dateStr = new Date(flight.scheduled_departure_utc)
          .toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone });
      } else {
        dateStr = flight.scheduled_departure_local?.split('T')[0] || '';
      }
      if (!dateStr) return;
      if (!byDate[dateStr]) byDate[dateStr] = [];
      byDate[dateStr].push(flight);
    });
    return byDate;
  }, [rawFlights, timezone]);

  const dateOrder = useMemo(() => Object.keys(flightsByDate).sort(), [flightsByDate]);
  useEffect(() => { dateOrderRef.current = dateOrder; }, [dateOrder]);

  // ── Compute start datetime for a given airport + display date ───────────────
  const getFromDatetimeForAirport = useCallback(
    (dateStr: string, airportCode: string): string => {
      const airportTZ = airportTimezones?.[airportCode] ?? timezone;

      if (tripArrivalTimeUTC && timezone) {
        const arrivalDate = new Date(tripArrivalTimeUTC).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone });
        if (dateStr === arrivalDate) {
          if (!airportTZ) return dateStr + 'T00:00:00';
          const arrivalLocal = new Date(tripArrivalTimeUTC).toLocaleString(FORMAT_LOCALES.SE, {
            timeZone: airportTZ,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          });
          return arrivalLocal.replace(' ', 'T').substring(0, 19);
        }
      }

      const now = new Date();
      const selectedTodayStr = timezone
        ? now.toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone })
        : now.toISOString().split('T')[0];
      const isToday = dateStr === selectedTodayStr;

      if (isToday) {
        if (!airportTZ) return dateStr + 'T00:00:00';
        const s = now.toLocaleString(FORMAT_LOCALES.SE, {
          timeZone: airportTZ,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        const parts = s.replace(' ', 'T').split(':');
        return parts[0] + ':' + parts[1] + ':00';
      }

      if (!timezone || !airportTZ || timezone === airportTZ) {
        return dateStr + 'T00:00:00';
      }
      const noonUTC = new Date(`${dateStr}T12:00:00Z`);
      const localNoon = noonUTC.toLocaleString(FORMAT_LOCALES.SE, { timeZone: timezone });
      const [, localTime] = localNoon.split(' ');
      const [h, m, s2] = localTime.split(':').map(Number);
      const utcMidnight = new Date(noonUTC.getTime() - h * CONFIG.HOUR_IN_MS - m * 60000 - s2 * 1000);
      const airportLocal = utcMidnight.toLocaleString(FORMAT_LOCALES.SE, { timeZone: airportTZ });
      return airportLocal.replace(' ', 'T').substring(0, 19);
    },
    [timezone, airportTimezones, tripArrivalTimeUTC]
  );

  // ── Core load function ──────────────────────────────────────────────────────
  const loadFlightsFromDatetime = useCallback(
    async function loadFn(airportCode: string, fromDatetime: string): Promise<void> {
      if (!fromDatetime || !airportCode || !timezone) return;
      const normalizedDatetime = fromDatetime.substring(0, 16) + ':00';
      const windowKey = `${airportCode}:${normalizedDatetime}`;
      if (loadedWindowsRef.current.has(windowKey)) return;

      loadedWindowsRef.current.add(windowKey);
      setPerAirportLoading(prev => ({ ...prev, [airportCode]: true }));
      setError(null);

      let autoLoadNext: string | null = null;
      try {
        const response = (await getFlights(airportCode, {
          from_local_datetime: normalizedDatetime,
          limit: CONFIG.FLIGHT_LIMIT,
        })) as unknown as RawFlightsResponse;

        if (response.success) {
          const newFlights = response.data;
          const rangeEnd = response.range_end_datetime;

          setRawFlights(prev => {
            const existingIds = new Set(prev.map(f => f.id));
            const unique = newFlights.filter(f => !existingIds.has(f.id));
            if (unique.length === 0) return prev;
            const merged = [...prev, ...unique];
            merged.sort((a, b) => {
              const at = a.scheduled_departure_utc ?? a.scheduled_departure_local ?? '';
              const bt = b.scheduled_departure_utc ?? b.scheduled_departure_local ?? '';
              return at.localeCompare(bt);
            });
            return merged;
          });

          if (response.last_fetched_at) {
            setLastFetched(prev =>
              !prev || response.last_fetched_at! > prev ? response.last_fetched_at! : prev
            );
          }

          appendFlights(newFlights);

          // Auto-load next window if within the same local day (full-day load).
          // [DISABLED] Cross-day continuation removed.
          if (rangeEnd) {
            const sameLocalDay = rangeEnd.split('T')[0] === normalizedDatetime.split('T')[0];
            if (sameLocalDay) {
              autoLoadNext = rangeEnd;
              perAirportHasMoreRef.current.set(airportCode, true);
              perAirportNextWindowRef.current.set(airportCode, rangeEnd);
            } else {
              perAirportHasMoreRef.current.set(airportCode, false);
              perAirportNextWindowRef.current.set(airportCode, null);
            }
          } else {
            perAirportHasMoreRef.current.set(airportCode, false);
            perAirportNextWindowRef.current.set(airportCode, null);
          }
        } else {
          loadedWindowsRef.current.delete(windowKey);
          setError('Failed to load flights');
        }
      } catch (err: unknown) {
        loadedWindowsRef.current.delete(windowKey);
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(axiosErr.response?.data?.detail || 'Failed to load flights');
      } finally {
        setPerAirportLoading(prev => ({ ...prev, [airportCode]: false }));
      }
      if (autoLoadNext) await loadFn(airportCode, autoLoadNext);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timezone, appendFlights]
  );

  // ── Clear cache when display timezone changes ───────────────────────────────
  const prevTimezoneRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevTimezoneRef.current !== undefined && prevTimezoneRef.current !== timezone) {
      setRawFlights([]);
      perAirportLoadingRef.current = new Map();
      perAirportHasMoreRef.current = new Map();
      perAirportNextWindowRef.current = new Map();
      loadedWindowsRef.current = new Set();
      setPerAirportLoading({});
      setError(null);
      dateOrderRef.current = [];
    }
    prevTimezoneRef.current = timezone;
  }, [timezone]);

  // ── Multi-airport initial load ──────────────────────────────────────────────
  useEffect(() => {
    const codesKey = JSON.stringify([...airportCodes].sort());
    const prevKey = currentAirportCodesRef.current;
    const isNewAirportSet = prevKey !== codesKey;

    if (isNewAirportSet) {
      const prevCodes: string[] = prevKey ? JSON.parse(prevKey) : [];
      const isAdditionOnly = prevCodes.length > 0 && prevCodes.every(c => airportCodes.includes(c));
      const addedCodes = airportCodes.filter(c => !prevCodes.includes(c));

      currentAirportCodesRef.current = codesKey;

      if (!isAdditionOnly) {
        setRawFlights([]);
        perAirportLoadingRef.current = new Map();
        perAirportHasMoreRef.current = new Map(airportCodes.map(c => [c, true]));
        perAirportNextWindowRef.current = new Map(airportCodes.map(c => [c, null]));
        loadedWindowsRef.current = new Set();
        setPerAirportLoading({});
        setError(null);
        dateOrderRef.current = [];

        if (timezone) {
          airportCodes.forEach(code => {
            if (airportCodes.length > 1 && !airportTimezones?.[code]) return;
            const fromDatetime = initialFromDatetime ?? getFromDatetimeForAirport(travelDate, code);
            if (!loadedWindowsRef.current.has(`${code}:${fromDatetime}`)) {
              loadFlightsFromDatetime(code, fromDatetime);
            }
          });
        }
      } else {
        addedCodes.forEach(c => {
          perAirportHasMoreRef.current.set(c, true);
          perAirportNextWindowRef.current.set(c, null);
        });

        if (timezone) {
          airportCodes.forEach(code => {
            if (airportCodes.length > 1 && !airportTimezones?.[code]) return;
            const hasAnyWindow = Array.from(loadedWindowsRef.current).some(k => k.startsWith(`${code}:`));
            if (hasAnyWindow) return;
            const fromDatetime = getFromDatetimeForAirport(travelDate, code);
            if (!loadedWindowsRef.current.has(`${code}:${fromDatetime}`)) {
              loadFlightsFromDatetime(code, fromDatetime);
            }
          });
        }
      }
    } else if (!isNewAirportSet && timezone) {
      airportCodes.forEach(code => {
        if (airportCodes.length > 1 && !airportTimezones?.[code]) return;
        const fromDatetime = getFromDatetimeForAirport(travelDate, code);
        if (!loadedWindowsRef.current.has(`${code}:${fromDatetime}`)) {
          loadFlightsFromDatetime(code, fromDatetime);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airportCodes, timezone, initialFromDatetime, travelDate, getFromDatetimeForAirport, loadFlightsFromDatetime]);

  // ── Refresh ─────────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setRawFlights([]);
    perAirportLoadingRef.current = new Map();
    perAirportHasMoreRef.current = new Map(airportCodes.map(c => [c, true]));
    perAirportNextWindowRef.current = new Map(airportCodes.map(c => [c, null]));
    loadedWindowsRef.current = new Set();
    setPerAirportLoading({});
    setError(null);
    dateOrderRef.current = [];

    if (travelDate && timezone) {
      await Promise.all(
        airportCodes.map(code => loadFlightsFromDatetime(code, getFromDatetimeForAirport(travelDate, code)))
      );
    }
  }, [airportCodes, travelDate, timezone, loadFlightsFromDatetime, getFromDatetimeForAirport]);

  return {
    rawFlights,
    error,
    lastFetched,
    perAirportLoading,
    anyLoading,
    flightsByDate,
    dateOrderRef,
    handleRefresh,
  };
}
