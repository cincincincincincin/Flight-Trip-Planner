import React, { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import FlightCard from './FlightCard';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { getFlights } from '../api/flights';
import { useSelectionStore } from '../stores/selectionStore';
import { useTripStore } from '../stores/tripStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFilterStore } from '../stores/filterStore';
import { useAirportsQuery } from '../hooks/queries';
import type { Flight } from '../types';
import './FlightsList.css';


interface FlightsListProps {
  airportCodes: string[];          // 1-6 airport codes
  timezone?: string;               // selected/display timezone
  initialFromDatetime?: string;    // start datetime (single-airport mode)
  airportTimezones?: Record<string, string>; // per-airport IANA timezone
  originalAirportCode?: string | null; // the "arrival" airport in trip mode (others are transfer airports)
  tripArrivalTimeUTC?: string | null;  // UTC arrival time in trip mode — used as start time for all airports
  onAddToTrip: (flight: Flight) => void;
}

// Shape of the raw API response (extends the partial typing in types/index.ts)
interface RawFlightsResponse {
  success: boolean;
  data: Flight[];
  range_end_datetime?: string;
  last_fetched_at?: string;
}

const FlightsList = forwardRef<unknown, FlightsListProps>(
  ({ airportCodes, timezone, initialFromDatetime, airportTimezones, originalAirportCode, tripArrivalTimeUTC, onAddToTrip }, ref) => {
    // ── Stores ────────────────────────────────────────────────────────────────
    const { travelDate, minTransferHours, minManualTransferHours, showRefreshButton } = useSettingsStore();
    const { setHighlightedAirports, setHighlightedCities, appendFlights } = useSelectionStore();
    const { tripState } = useTripStore();
    const { data: airportsData } = useAirportsQuery();
    const { destinationFilter, airlineFilter } = useFilterStore();

    // ── Derived from tripState ────────────────────────────────────────────────
    const tripStartAirport = tripState?.startAirport ?? null;

    const tripCurrentArrivalTimeUTC = useMemo(() => {
      if (!tripState?.legs?.length) return null;
      for (let i = tripState.legs.length - 1; i >= 0; i--) {
        const leg = tripState.legs[i];
        if ((leg as { type?: string }).type !== 'manual' && leg.flight?.scheduled_arrival_utc) {
          return leg.flight.scheduled_arrival_utc;
        }
      }
      return null;
    }, [tripState]);


    const airportCountryMap = useMemo<Record<string, string>>(() => {
      if (!airportsData) return {};
      const map: Record<string, string> = {};
      airportsData.features.forEach(f => {
        if (f.properties.code) map[f.properties.code] = f.properties.country_code ?? '';
      });
      return map;
    }, [airportsData]);

    const airportCityMap = useMemo<Record<string, string>>(() => {
      if (!airportsData) return {};
      const map: Record<string, string> = {};
      airportsData.features.forEach(f => {
        if (f.properties.code && f.properties.city_code) {
          map[f.properties.code] = f.properties.city_code;
        }
      });
      return map;
    }, [airportsData]);

    // ── Local state ───────────────────────────────────────────────────────────
    const [rawFlights, setRawFlights] = useState<Flight[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [lastFetched, setLastFetched] = useState<string | null>(null);
    const [perAirportLoading, setPerAirportLoading] = useState<Record<string, boolean>>({});

    // ── Timezone-reactive flight grouping ─────────────────────────────────────
    const flightsByDate = useMemo<Record<string, Flight[]>>(() => {
      const byDate: Record<string, Flight[]> = {};
      rawFlights.forEach(flight => {
        let dateStr: string;
        if (flight.scheduled_departure_utc && timezone) {
          dateStr = new Date(flight.scheduled_departure_utc)
            .toLocaleDateString('en-CA', { timeZone: timezone });
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

    // ── Per-airport refs ──────────────────────────────────────────────────────
    const perAirportLoadingRef = useRef<Map<string, boolean>>(new Map());
    const perAirportHasMoreRef = useRef<Map<string, boolean>>(new Map());
    const perAirportNextWindowRef = useRef<Map<string, string | null>>(new Map());
    /** keyed as "${airportCode}:${fromDatetime}" */
    const loadedWindowsRef = useRef<Set<string>>(new Set());

    const dateOrderRef = useRef<string[]>([]);
    const currentAirportCodesRef = useRef<string>('');
    const prevHighlightedAirportsRef = useRef<Set<string>>(new Set());
    const prevHighlightedCitiesRef = useRef<Set<string>>(new Set());
    const isManualJumpRef = useRef(false);
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const flightRefsMap = useRef(new Map());

    // ── Derived loading / hasMore (combined) ──────────────────────────────────
    // These are computed from the per-airport maps; we also keep the React state
    // versions in sync so the UI re-renders correctly.
    const anyLoading = Object.values(perAirportLoading).some(Boolean);

    // ── Unfiltered flights for the selected day only ───────────────────────────
    const todayFlights = useMemo(
      () => (flightsByDate[travelDate] || []),
      [flightsByDate, travelDate]
    );

    // ── Filter integration ────────────────────────────────────────────────────
    const isFilterActive = useMemo(
      () =>
        destinationFilter.airports.length > 0 ||
        destinationFilter.cities.length > 0 ||
        destinationFilter.countries.length > 0 ||
        airlineFilter.length > 0,
      [destinationFilter, airlineFilter]
    );

    const matchesFilter = useCallback(
      (flight: Flight): boolean => {
        if (!isFilterActive) return true;
        const destAirport = flight.destination_airport_code;
        const destCity = flight.destination_city_code || airportCityMap[destAirport];
        const destCountry = airportCountryMap[destAirport];
        const airline = flight.airline_code;

        const destFilterActive =
          destinationFilter.airports.length > 0 ||
          destinationFilter.cities.length > 0 ||
          destinationFilter.countries.length > 0;

        let destMatch = true;
        if (destFilterActive) {
          destMatch =
            !!(destAirport && destinationFilter.airports.includes(destAirport)) ||
            !!(destCity && destinationFilter.cities.includes(destCity)) ||
            !!(destCountry && destinationFilter.countries.includes(destCountry));
        }

        let airlineMatch = true;
        if (airlineFilter.length > 0) {
          airlineMatch = !!(airline && airlineFilter.includes(airline));
        }

        return !!(destMatch && airlineMatch);
      },
      [destinationFilter, airlineFilter, airportCityMap, airportCountryMap, isFilterActive]
    );

    /** Filtered view for the selected day only */
    const displayedFlatFlights = useMemo(
      () => todayFlights.filter(matchesFilter),
      [todayFlights, matchesFilter]
    );

    // Returns the local datetime string for a given airport when loading from `dateStr`
    // (which is expressed in the selected/display timezone).
    const getFromDatetimeForAirport = useCallback(
      (dateStr: string, airportCode: string): string => {
        const airportTZ = airportTimezones?.[airportCode] ?? timezone;

        // In trip mode: if dateStr is the arrival date, start from the arrival time
        // (not from midnight or current time).
        if (tripArrivalTimeUTC && timezone) {
          const arrivalDate = new Date(tripArrivalTimeUTC).toLocaleDateString('en-CA', { timeZone: timezone });
          if (dateStr === arrivalDate) {
            if (!airportTZ) return dateStr + 'T00:00:00';
            const arrivalLocal = new Date(tripArrivalTimeUTC).toLocaleString('sv-SE', {
              timeZone: airportTZ,
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit',
            });
            return arrivalLocal.replace(' ', 'T').substring(0, 19);
          }
        }

        const now = new Date();

        // Is dateStr "today" in the selected (display) timezone?
        const selectedTodayStr = timezone
          ? now.toLocaleDateString('en-CA', { timeZone: timezone })
          : now.toISOString().split('T')[0];
        const isToday = dateStr === selectedTodayStr;

        if (isToday) {
          // Use current moment expressed in airport's local timezone
          if (!airportTZ) return dateStr + 'T00:00:00';
          const s = now.toLocaleString('sv-SE', {
            timeZone: airportTZ,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          });
          const parts = s.replace(' ', 'T').split(':');
          return parts[0] + ':' + parts[1] + ':00';
        }

        // For non-today: convert midnight of dateStr in selectedTZ → airport local time
        if (!timezone || !airportTZ || timezone === airportTZ) {
          return dateStr + 'T00:00:00';
        }
        // Find UTC of midnight in selectedTZ by anchoring at noon UTC
        const noonUTC = new Date(`${dateStr}T12:00:00Z`);
        const localNoon = noonUTC.toLocaleString('sv-SE', { timeZone: timezone });
        const [, localTime] = localNoon.split(' ');
        const [h, m, s2] = localTime.split(':').map(Number);
        const utcMidnight = new Date(noonUTC.getTime() - h * 3600000 - m * 60000 - s2 * 1000);
        const airportLocal = utcMidnight.toLocaleString('sv-SE', { timeZone: airportTZ });
        return airportLocal.replace(' ', 'T').substring(0, 19);
      },
      [timezone, airportTimezones, tripArrivalTimeUTC]
    );

    // ── Core load function ────────────────────────────────────────────────────
    const loadFlightsFromDatetime = useCallback(
      async function loadFn(airportCode: string, fromDatetime: string): Promise<void> {
        if (!fromDatetime || !airportCode || !timezone) return;
        // Normalize to minute precision — prevents duplicate loads when initialFromDatetime
        // has seconds (e.g. "T19:38:29") vs getFromDatetimeForAirport rounds to "T19:38:00"
        const normalizedDatetime = fromDatetime.substring(0, 16) + ':00';
        const windowKey = `${airportCode}:${normalizedDatetime}`;
        if (loadedWindowsRef.current.has(windowKey)) return;
        if (perAirportLoadingRef.current.get(airportCode)) return;

        loadedWindowsRef.current.add(windowKey);
        perAirportLoadingRef.current.set(airportCode, true);
        setPerAirportLoading(prev => ({ ...prev, [airportCode]: true }));
        setError(null);

        let autoLoadNext: string | null = null;
        try {
          const response = (await getFlights(airportCode, {
            from_local_datetime: normalizedDatetime,
            limit: 200,
          })) as unknown as RawFlightsResponse;

          if (response.success) {
            const newFlights = response.data;
            const rangeEnd = response.range_end_datetime;

            // Merge into rawFlights (dedup by id, maintain UTC sort order)
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

            // If the API window ended within the same day, auto-load the next window
            // immediately so we always show the full day without waiting for scroll-to-end.
            if (rangeEnd && rangeEnd.split('T')[0] === normalizedDatetime.split('T')[0]) {
              autoLoadNext = rangeEnd;
              perAirportHasMoreRef.current.set(airportCode, true);
              perAirportNextWindowRef.current.set(airportCode, rangeEnd);
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
          perAirportLoadingRef.current.set(airportCode, false);
          setPerAirportLoading(prev => ({ ...prev, [airportCode]: false }));
        }
        // Auto-load next window after finally releases the loading lock
        if (autoLoadNext) await loadFn(airportCode, autoLoadNext);
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [timezone, appendFlights]
    );

    // ── Highlighted airports + cities effect (filter-aware) ──────────────────
    // Only dispatch when the SET CONTENT changes, not on every rawFlights append.
    // This prevents the route animation from restarting for each 12h window load.
    useEffect(() => {
      const sourceFlights = isFilterActive ? displayedFlatFlights : todayFlights;

      const newAirports = new Set<string>(
        sourceFlights.map(f => f.destination_airport_code).filter(Boolean) as string[]
      );
      const prevA = prevHighlightedAirportsRef.current;
      if (newAirports.size !== prevA.size || Array.from(newAirports).some(c => !prevA.has(c))) {
        prevHighlightedAirportsRef.current = newAirports;
        setHighlightedAirports(Array.from(newAirports));
      }

      const newCities = new Set<string>(
        sourceFlights.map(f => f.destination_city_code).filter(Boolean) as string[]
      );
      const prevC = prevHighlightedCitiesRef.current;
      if (newCities.size !== prevC.size || Array.from(newCities).some(c => !prevC.has(c))) {
        prevHighlightedCitiesRef.current = newCities;
        setHighlightedCities(Array.from(newCities));
      }
    }, [displayedFlatFlights, todayFlights, isFilterActive, setHighlightedAirports, setHighlightedCities]);

    // ── Sync dateOrderRef ─────────────────────────────────────────────────────
    useEffect(() => { dateOrderRef.current = dateOrder; }, [dateOrder]);

    // ── Clear window cache when display timezone changes ───────────────────────
    // When the user switches the display timezone the 00:00-23:59 window shifts,
    // so previously loaded flights are no longer correct for the new timezone.
    // Clear everything before the load effect fires so it triggers a fresh load.
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

    // ── Multi-airport initial load ────────────────────────────────────────────
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
          // Full reset for replacement/removal changes
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
              // In multi-airport mode, skip airports whose timezone isn't known yet.
              // They'll be loaded once airportTimezones updates (via the "same airports" branch).
              if (airportCodes.length > 1 && !airportTimezones?.[code]) return;
              const fromDatetime = initialFromDatetime ?? getFromDatetimeForAirport(travelDate, code);
              if (!loadedWindowsRef.current.has(`${code}:${fromDatetime}`)) {
                loadFlightsFromDatetime(code, fromDatetime);
              }
            });
          }
        } else {
            // Incremental: initialize state for new airports only, keep existing flights
            addedCodes.forEach(c => {
              perAirportHasMoreRef.current.set(c, true);
              perAirportNextWindowRef.current.set(c, null);
            });

            if (timezone) {
              addedCodes.forEach(code => {
                if (airportCodes.length > 1 && !airportTimezones?.[code]) return;
                const fromDatetime = getFromDatetimeForAirport(travelDate, code);
                if (!loadedWindowsRef.current.has(`${code}:${fromDatetime}`)) {
                  loadFlightsFromDatetime(code, fromDatetime);
                }
              });
            }
        }
      } else if (!isNewAirportSet && timezone) {
        // Same airports: triggered when airportTimezones loads (enabling correct per-airport from-datetime)
        // or when a previously unloaded date is needed. Skip if we already have data and the
        // current travelDate is covered — prevents spurious reloads on timezone switch.
        airportCodes.forEach(code => {
          if (!perAirportLoadingRef.current.get(code)) {
            if (airportCodes.length > 1 && !airportTimezones?.[code]) return;
            const hasAnyWindow = Array.from(loadedWindowsRef.current).some(k => k.startsWith(`${code}:`));
            if (hasAnyWindow && dateOrderRef.current.includes(travelDate)) return;
            const fromDatetime = initialFromDatetime ?? getFromDatetimeForAirport(travelDate, code);
            if (!loadedWindowsRef.current.has(`${code}:${fromDatetime}`)) {
              loadFlightsFromDatetime(code, fromDatetime);
            }
          }
        });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [airportCodes, timezone, initialFromDatetime, travelDate, getFromDatetimeForAirport, loadFlightsFromDatetime]);

    // ── travelDate change → load missing date for all airports ───────────────
    useEffect(() => {
      if (!travelDate || !timezone) return;
      if (isManualJumpRef.current) return;
      if (dateOrderRef.current.includes(travelDate)) return;
      airportCodes.forEach(code => {
        const fromDatetime = getFromDatetimeForAirport(travelDate, code);
        const windowKey = `${code}:${fromDatetime}`;
        if (!loadedWindowsRef.current.has(windowKey) && !perAirportLoadingRef.current.get(code)) {
          loadFlightsFromDatetime(code, fromDatetime);
        }
      });
    }, [travelDate, timezone, airportCodes, getFromDatetimeForAirport, loadFlightsFromDatetime]);

    // ── Imperative handle (jumpToDate) ────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      jumpToDate: (dateStr: string) => {
        if (dateOrderRef.current.includes(dateStr)) return; // already loaded, display filter handles it
        isManualJumpRef.current = true;
        setRawFlights([]);
        perAirportHasMoreRef.current = new Map(airportCodes.map(c => [c, true]));
        perAirportNextWindowRef.current = new Map(airportCodes.map(c => [c, null]));
        loadedWindowsRef.current = new Set();
        setError(null);
        dateOrderRef.current = [];
        airportCodes.forEach(code => {
          const fromDatetime = getFromDatetimeForAirport(dateStr, code);
          loadFlightsFromDatetime(code, fromDatetime);
        });
        setTimeout(() => { isManualJumpRef.current = false; }, 500);
      },
      scrollToFlight: (_destCode: string) => { /* scroll removed */ },
    }));

    // ── getTripHighlight ──────────────────────────────────────────────────────
    const getTripHighlight = useCallback(
      (flight: Flight) => {
        if (!tripStartAirport) return null;
        const destCode = flight.destination_airport_code;
        const destCityCode = flight.destination_city_code;
        if (destCode === tripStartAirport.code) return 'airport';
        if (destCityCode && destCityCode === tripStartAirport.city_code) return 'city';
        if (airportCountryMap?.[destCode] && airportCountryMap[destCode] === tripStartAirport.country_code)
          return 'country';
        if (tripCurrentArrivalTimeUTC) {
          const arrMs = new Date(tripCurrentArrivalTimeUTC).getTime();
          const depMs = new Date(flight.scheduled_departure_utc ?? '').getTime();
          // Flights from original airport use only minTransferHours;
          // flights from transfer airports also need minManualTransferHours
          const isFromOriginal = !originalAirportCode || flight.origin_airport_code === originalAirportCode;
          const thresholdMs = isFromOriginal
            ? arrMs + minTransferHours * 3600000
            : arrMs + (minTransferHours + minManualTransferHours) * 3600000;
          if (depMs < thresholdMs) return 'soon';
        }
        return null;
      },
      [tripStartAirport, airportCountryMap, tripCurrentArrivalTimeUTC, originalAirportCode, minTransferHours, minManualTransferHours]
    );

    // ── handleEndReached ──────────────────────────────────────────────────────
    const handleEndReached = useCallback(() => {
      for (const [code, hasMoreCode] of perAirportHasMoreRef.current.entries()) {
        if (hasMoreCode) {
          const nextWindow = perAirportNextWindowRef.current.get(code);
          if (nextWindow && !perAirportLoadingRef.current.get(code)) {
            loadFlightsFromDatetime(code, nextWindow);
          }
        }
      }
    }, [loadFlightsFromDatetime]);

    // ── handleRefresh ─────────────────────────────────────────────────────────
    const handleRefresh = async () => {
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
    };

    // ── Formatters ────────────────────────────────────────────────────────────
    const formatLastFetched = (timestamp: string | null) => {
      if (!timestamp) return 'Never';
      const date = new Date(timestamp);
      const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins} min ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

// ── Footer component ──────────────────────────────────────────────────────
    const Footer = useCallback(() => {
      const loadingCodes = airportCodes.filter(c => perAirportLoading[c]);
      const multiAirport = airportCodes.length > 1;
      return (
        <>
          {anyLoading && multiAirport && (
            <div className="loading-more">
              <div className="spinner"></div>
              {loadingCodes.map(code => (
                <div key={code}>Loading flights from {code}...</div>
              ))}
            </div>
          )}
          {anyLoading && !multiAirport && (
            <div className="loading-more">
              <div className="spinner"></div>
              <div>Loading flights...</div>
            </div>
          )}
        </>
      );
    }, [airportCodes, perAirportLoading, anyLoading]);

    // ── Early return on hard error ────────────────────────────────────────────
    if (error && displayedFlatFlights.length === 0 && todayFlights.length === 0) {
      return (
        <div className="flights-list">
          <div className="flights-error">
            <div className="error-icon">⚠️</div>
            <div className="error-message">{error}</div>
            <button onClick={handleRefresh} className="retry-button">🔄 Try Again</button>
          </div>
        </div>
      );
    }

    // ── Render ────────────────────────────────────────────────────────────────
    return (
      <div className="flights-list">
        <div className="flights-header">
          <div className="flights-info">
            <h4>✈️ Departing Flights</h4>
            {lastFetched && (
              <div className="last-fetched">Last updated: {formatLastFetched(lastFetched)}</div>
            )}
          </div>
          {showRefreshButton && (
            <button onClick={handleRefresh} disabled={anyLoading} className="refresh-button">
              {anyLoading ? '⏳' : '🔄'} Refresh
            </button>
          )}
        </div>

        {displayedFlatFlights.length === 0 && !anyLoading ? (
          <div className="no-flights">
            <div className="no-flights-icon">✈️</div>
            <div className="no-flights-message">
              {isFilterActive && todayFlights.length > 0
                ? 'No flights match the current filters'
                : `No flights for ${travelDate}`}
            </div>
            <div className="no-flights-hint">
              {isFilterActive && todayFlights.length > 0
                ? 'Try adjusting or clearing filters'
                : 'Try selecting a different date'}
            </div>
          </div>
        ) : (
          <div className="flights-virtuoso-wrapper">
            <Virtuoso
              ref={virtuosoRef}
              totalCount={displayedFlatFlights.length}
              itemContent={(index: number) => {
                const flight = displayedFlatFlights[index];
                if (!flight) return null;
                return (
                  <FlightCard
                    flight={flight}
                    ref={(el: unknown) => { flightRefsMap.current.set(flight.id, el); }}
                    tripHighlight={getTripHighlight(flight) ?? undefined}
                    onAddToTrip={onAddToTrip}
                    displayTimezone={timezone}
                    airportTimezone={airportTimezones?.[flight.origin_airport_code]}
                  />
                );
              }}
              endReached={handleEndReached}
              overscan={200}
              components={{ Footer }}
            />
          </div>
        )}
      </div>
    );
  }
);

export default FlightsList;
