import React, { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import FlightCard from './FlightCard';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useSelectionStore } from '../stores/selectionStore';
import { useTripStore } from '../stores/tripStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFilterStore } from '../stores/filterStore';
import { useAirportIndexes, useFlightFilter } from '../hooks/queries';
import { useFlightLoader } from '../hooks/useFlightLoader';
import { getTripCurrentArrivalTimeUTC, getIsoDate, getTodayInTz } from '../utils/dateFormatting';
import type { Flight } from '../types';
import './FlightsList.css';
import { useTexts } from '../hooks/useTexts';
import { CONFIG } from '../constants/config';
import dayjs from '../lib/dayjs';


interface FlightsListProps {
  airportCodes: string[];          // 1-6 airport codes
  timezone?: string;               // selected/display timezone
  initialFromDatetime?: string;    // start datetime (single-airport mode)
  airportTimezones?: Record<string, string>; // per-airport IANA timezone
  originalAirportCode?: string | null; // the "arrival" airport in trip mode (others are transfer airports)
  tripArrivalTimeUTC?: string | null;  // UTC arrival time in trip mode — used as start time for all airports
  travelDateOverride?: string;     // synchronous travel date to avoid stale store value on timezone change
  onAddToTrip: (flight: Flight) => void;
}

const FlightsList = forwardRef<unknown, FlightsListProps>(
  ({ airportCodes, timezone, initialFromDatetime, airportTimezones, originalAirportCode, tripArrivalTimeUTC, travelDateOverride, onAddToTrip }, ref) => {
    const t = useTexts();
    // ── STABILITY SHIELD (Phase 10) ──────────────────────────────────────────
    // Aby uniknąć "Pętli Przerywania" (Abort Loop), zamrażamy referencje tablic i obiektów.
    // Dzięki temu useFlightLoader nie restartuje się, jeśli dane są takie same.
    const stableAirportCodesJson = JSON.stringify(airportCodes);
    const stableAirportCodes = useMemo(() => JSON.parse(stableAirportCodesJson), [stableAirportCodesJson]);
    
    const stableAirportTimezonesJson = JSON.stringify(airportTimezones);
    const stableAirportTimezones = useMemo(() => JSON.parse(stableAirportTimezonesJson), [stableAirportTimezonesJson]);

    // ── Stores ────────────────────────────────────────────────────────────────
    const { travelDate, minTransferHours, minManualTransferHours, showRefreshButton } = useSettingsStore();
    const { setHighlightedAirports, setHighlightedCities, setDisplayedFlights } = useSelectionStore();
    const { tripState } = useTripStore();
    const { airportFeaturesMap, cityMap, countryMap } = useAirportIndexes();
    const { flightsData: globalFlightsData } = useSelectionStore();

    // ── Data loading ──────────────────────────────────────────────────────────
    const { error, lastFetched, perAirportLoading, anyLoading, flightsByDate, handleRefresh } =
      useFlightLoader({ 
        airportCodes: stableAirportCodes, 
        timezone, 
        initialFromDatetime, 
        airportTimezones: stableAirportTimezones, 
        tripArrivalTimeUTC, 
        travelDateOverride 
      });

    // ── Derived from tripState ────────────────────────────────────────────────
    const tripStartAirport = tripState?.startAirport ?? null;

    const tripCurrentArrivalTimeUTC = useMemo(() => getTripCurrentArrivalTimeUTC(tripState), [tripState]);


    // ── Misc refs ─────────────────────────────────────────────────────────────
    const prevHighlightedAirportsRef = useRef<Set<string>>(new Set());
    const prevHighlightedCitiesRef = useRef<Set<string>>(new Set());
    // const isManualJumpRef = useRef(false); // [DISABLED] date-jump navigation
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const flightRefsMap = useRef(new Map());

    // ── Synchronized minute timer for real-time past-flight filtering ──────────
    // Starts at this moment (for isToday check), then locks on to the full-minute boundary.
    const [nowMs, setNowMs] = useState(() => Date.now());
    useEffect(() => {
      let intervalId: ReturnType<typeof setInterval>;
      const tick = () => setNowMs(Date.now());
      const msToNextMinute = 60000 - (Date.now() % 60000);
      const timeoutId = setTimeout(() => {
        tick();
        intervalId = setInterval(tick, 60000);
      }, msToNextMinute);
      return () => { clearTimeout(timeoutId); clearInterval(intervalId); };
    }, []);

    useEffect(() => {
      console.log("%c[ACTION-LOAD] %cFlightsList MOUNT", 'color: #3b82f6; font-weight: bold', 'color: inherit');
      return () => {
        console.log("%c[ACTION-LOAD] %cFlightsList UNMOUNT", 'color: #ef4444; font-weight: bold', 'color: inherit');
      };
    }, []);

    // ── Expansion state (Smart Collapse) ──────────────────────────────────────
    const [expandedFlightIds, setExpandedFlightIds] = useState<string[]>([]);
    const { currency } = useSettingsStore();

    // Kiedy waluta się zmienia, zwijamy wszystko oprócz ostatnio rozwiniętego lotu
    useEffect(() => {
      if (expandedFlightIds.length > 1) {
        const lastId = expandedFlightIds[expandedFlightIds.length - 1];
        setExpandedFlightIds([lastId]);
      }
    }, [currency]);

    const handleToggleExpand = useCallback((id: string) => {
      setExpandedFlightIds(prev => 
        prev.includes(id) 
          ? prev.filter(x => x !== id) 
          : [...prev, id] // Dodajemy na koniec (ostatni rozwinięty)
      );
    }, []);

    // ── Unfiltered flights for the selected day only ───────────────────────────
    const todayFlights = useMemo(
      () => (flightsByDate[travelDate] || []),
      [flightsByDate, travelDate]
    );

    // Wykorzystujemy współdzieloną logikę filtrowania (DRY).
    const { matchesFilter, isFilterActive } = useFlightFilter();

    /** Przefiltrowana lista lotów na wybrany dzień. */
    const displayedFlatFlights = useMemo(() => {
      // Optymalizacja: filtrujemy najpierw po źródłowych lotniskach wg aktualnej selekcji
      const validOrigins = new Set(airportCodes.map((c: string) => c.toUpperCase()));
      let flights = todayFlights.filter(f => validOrigins.has((f.origin_airport_code || '').toUpperCase()));
      
      // Następnie aplikujemy ręczne filtry użytkownika
      flights = flights.filter(matchesFilter);
      
      // Jeśli nie jesteśmy w trybie planowania trasy, ukrywamy loty, które odleciały dawno.
      if (!tripArrivalTimeUTC) {
        const selectedTodayStr = timezone ? getTodayInTz(timezone) : getTodayInTz();
        console.log(`%c[ACTION-LOAD] %cFiltering Flights | Today: ${selectedTodayStr}, TravelDate: ${travelDate}, Before Grace: ${todayFlights.length}, Filtered: ${flights.length}`, 'color: #10b981; font-weight: bold', 'color: inherit');

        if (travelDate === selectedTodayStr) {
          // Ukrywamy wszystkie loty, które już odleciały.
          // Używamy dayjs.utc(), ponieważ scheduled_departure_utc z API nie ma znaku 'Z'.
          flights = flights.filter(f =>
            !f.scheduled_departure_utc || dayjs.utc(f.scheduled_departure_utc).valueOf() > nowMs
          );
        }
      }
      const finalCount = flights.length;
      if (finalCount === 0 && todayFlights.length > 0) {
        console.warn(`%c[ACTION-LOAD] %cREBOUND DETECTED | todayFlights: ${todayFlights.length}, finalCount: 0. Keys in flightsByDate: ${Object.keys(flightsByDate).join(',')}, travelDate: ${travelDate}, timezone: ${timezone}`, 'color: #f59e0b; font-weight: bold', 'color: inherit');
      }
      console.log(`%c[ACTION-LOAD] %cFiltering Flights | Final Count: ${finalCount}`, 'color: #10b981; font-weight: bold', 'color: inherit');
      // Wymuszamy ścisłą chronologię UTC (Przywrócenie logiki LEGACY)
      flights.sort((a, b) => 
        dayjs.utc(a.scheduled_departure_utc).valueOf() - dayjs.utc(b.scheduled_departure_utc).valueOf()
      );

      return flights;
    }, [todayFlights, matchesFilter, tripArrivalTimeUTC, nowMs, travelDate, timezone, flightsByDate]);

    // ── Synchronizacja podświetlenia na mapie (Phase 2: Ultra-Lean) ───────────
    // Wysyłamy dane tylko gdy faktycznie się zmieniły, żeby uniknąć thrashingu WebGL.
    useEffect(() => {
      // Wybieramy źródło danych w zależności od stanu filtra (O(1) switch)
      const sourceFlights = isFilterActive ? displayedFlatFlights : todayFlights;

      // Aktualizacja globalnego stanu widocznych lotów (używane przez MapComponent)
      setDisplayedFlights(sourceFlights);

      // Budujemy zestawy unikalnych kodów (O(N))
      const newAirports = new Set<string>();
      const newCities = new Set<string>();
      
      sourceFlights.forEach(f => {
        const rawCode = f.destination_airport_code;
        if (rawCode) {
          const code = rawCode.toUpperCase();
          newAirports.add(code);
          const cCode = cityMap[code];
          if (cCode) newCities.add(cCode);
        }
      });

      // Sprawdzanie różnic (Dirty Checking) przed aktualizacją store'a
      const prevA = prevHighlightedAirportsRef.current;
      const airportsChanged = newAirports.size !== prevA.size || 
                             Array.from(newAirports).some(c => !prevA.has(c));
                             
      if (airportsChanged) {
        prevHighlightedAirportsRef.current = newAirports;
        setHighlightedAirports(Array.from(newAirports));
      }

      const prevC = prevHighlightedCitiesRef.current;
      const citiesChanged = newCities.size !== prevC.size || 
                           Array.from(newCities).some(c => !prevC.has(c));
                           
      if (citiesChanged) {
        prevHighlightedCitiesRef.current = newCities;
        setHighlightedCities(Array.from(newCities));
      }
    }, [displayedFlatFlights, todayFlights, isFilterActive, setHighlightedAirports, setHighlightedCities, setDisplayedFlights, cityMap]);

    // ── Imperative handle ─────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      // jumpToDate: [DISABLED] date-jump navigation
      // jumpToDate: (dateStr: string) => {
      //   if (dateOrderRef.current.includes(dateStr)) return;
      //   isManualJumpRef.current = true;
      //   setRawFlights([]);
      //   perAirportHasMoreRef.current = new Map(airportCodes.map(c => [c, true]));
      //   perAirportNextWindowRef.current = new Map(airportCodes.map(c => [c, null]));
      //   loadedWindowsRef.current = new Set();
      //   setError(null);
      //   dateOrderRef.current = [];
      //   airportCodes.forEach(code => {
      //     const fromDatetime = getFromDatetimeForAirport(dateStr, code);
      //     loadFlightsFromDatetime(code, fromDatetime);
      //   });
      //   setTimeout(() => { isManualJumpRef.current = false; }, CONFIG.MANUAL_JUMP_TIMEOUT_MS);
      // },
      jumpToDate: (_dateStr: string) => { /* [DISABLED] date-jump navigation */ },
      scrollToFlight: (_destCode: string) => { /* scroll removed */ },
    }));

    // ── getTripHighlight ──────────────────────────────────────────────────────
    const getTripHighlight = useCallback(
      (flight: Flight) => {
        if (!tripStartAirport) return null;
        const destCode = (flight.destination_airport_code || '').toUpperCase();
        const destCityCode = cityMap[destCode];
        const destCountry = countryMap[destCode];
        if (destCode === tripStartAirport.code) return 'airport';
        if (destCityCode && destCityCode === tripStartAirport.city_code) return 'city';
        if (destCountry && destCountry === tripStartAirport.country_code)
          return 'country';
        if (tripCurrentArrivalTimeUTC) {
          const arrMs = new Date(tripCurrentArrivalTimeUTC).getTime();
          const depMs = new Date(flight.scheduled_departure_utc ?? '').getTime();
          // Flights from original airport use only minTransferHours;
          // flights from transfer airports also need minManualTransferHours
          const isFromOriginal = !originalAirportCode || flight.origin_airport_code === originalAirportCode;
          const thresholdMs = isFromOriginal
            ? arrMs + minTransferHours * CONFIG.HOUR_IN_MS
            : arrMs + (minTransferHours + minManualTransferHours) * CONFIG.HOUR_IN_MS;
          if (depMs < thresholdMs) return 'soon';
        }
        return null;
      },
      [tripStartAirport, airportFeaturesMap, tripCurrentArrivalTimeUTC, originalAirportCode, minTransferHours, minManualTransferHours]
    );

    // ── [DISABLED] handleEndReached — scroll-triggered infinite loading ────────
    // const handleEndReached = useCallback(() => {
    //   for (const [code, hasMoreCode] of perAirportHasMoreRef.current.entries()) {
    //     if (hasMoreCode) {
    //       const nextWindow = perAirportNextWindowRef.current.get(code);
    //       if (nextWindow && !perAirportLoadingRef.current.get(code)) {
    //         loadFlightsFromDatetime(code, nextWindow);
    //       }
    //     }
    //   }
    // }, [loadFlightsFromDatetime]);

    // ── Formatters ────────────────────────────────────────────────────────────
    const formatLastFetched = (timestamp: string | null) => {
      if (!timestamp) return t.flights.never;
      const d = dayjs(timestamp);
      const diffMins = dayjs().diff(d, 'minute');

      if (diffMins < 1) return t.flights.justNow;
      if (diffMins < 60) return t.flights.minutesAgo(diffMins);
      if (diffMins < 1440) return t.flights.hoursAgo(Math.floor(diffMins / 60));
      
      return d.format('DD MMM, HH:mm');
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
                <div key={code}>{t.flights.loadingFrom(code)}</div>
              ))}
            </div>
          )}
          {anyLoading && !multiAirport && (
            <div className="loading-more">
              <div className="spinner"></div>
              <div>{t.panel.loadingFlights}</div>
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
            <div className="error-icon"></div>
            <div className="error-message">{error}</div>
            <button onClick={handleRefresh} className="retry-button">{t.buttons.tryAgain}</button>
          </div>
        </div>
      );
    }

    // ── Render ────────────────────────────────────────────────────────────────
    return (
      <div className="flights-list">
        <div className="flights-header">
          <div className="flights-info">
            <div className="flights-title-row">
              <h4>{t.panel.departingFlights}</h4>
              <span className="data-attribution">{t.flights.scheduleDataBy} <a href="https://www.aerodatabox.com" target="_blank" rel="noopener noreferrer" className="attribution-link">AeroDataBox</a></span>
            </div>
            {lastFetched && (
              <div className="last-fetched">{t.flights.lastUpdated} {formatLastFetched(lastFetched)}</div>
            )}
          </div>
          {showRefreshButton && (
            <button onClick={handleRefresh} disabled={anyLoading} className="refresh-button">{t.buttons.refresh}</button>
          )}
        </div>

        {displayedFlatFlights.length === 0 && !anyLoading ? (
          <div className="no-flights">
            <div className="no-flights-icon"></div>
            <div className="no-flights-message">
              {isFilterActive && todayFlights.length > 0
                ? t.flights.noFlightsMatchFilters
                : t.flights.noFlightsForDate(travelDate)}
            </div>
            <div className="no-flights-hint">
              {isFilterActive && todayFlights.length > 0
                ? t.flights.tryAdjustFilters
                : t.flights.tryDifferentDate}
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
                const flightKey = `${flight.flight_number}-${flight.scheduled_departure_utc}`;
                return (
                  <FlightCard
                    key={flightKey}
                    flight={flight}
                    ref={(el: HTMLDivElement | null) => { if (el) flightRefsMap.current.set(flightKey, el); }}
                    tripHighlight={getTripHighlight(flight) ?? undefined}
                    onAddToTrip={onAddToTrip}
                    displayTimezone={timezone}
                    airportTimezone={airportTimezones?.[flight.origin_airport_code]}
                    isExpanded={expandedFlightIds.includes(flightKey)}
                    onToggleExpand={() => handleToggleExpand(flightKey)}
                  />
                );
              }}
              // endReached={handleEndReached} // [DISABLED] scroll-triggered infinite loading
              overscan={CONFIG.VIRTUOSO_OVERSCAN}
              components={{ Footer }}
            />
          </div>
        )}
      </div>
    );
  }
);

export default FlightsList;
