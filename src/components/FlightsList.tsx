import React, { useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import FlightCard from './FlightCard';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useSelectionStore } from '../stores/selectionStore';
import { useTripStore } from '../stores/tripStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFilterStore } from '../stores/filterStore';
import { useAirportsQuery } from '../hooks/queries';
import { useFlightLoader } from '../hooks/useFlightLoader';
import type { Flight } from '../types';
import './FlightsList.css';
import { useTexts } from '../hooks/useTexts';
import { FORMAT_LOCALES } from '../constants/format';
import { CONFIG } from '../constants/config';


interface FlightsListProps {
  airportCodes: string[];          // 1-6 airport codes
  timezone?: string;               // selected/display timezone
  initialFromDatetime?: string;    // start datetime (single-airport mode)
  airportTimezones?: Record<string, string>; // per-airport IANA timezone
  originalAirportCode?: string | null; // the "arrival" airport in trip mode (others are transfer airports)
  tripArrivalTimeUTC?: string | null;  // UTC arrival time in trip mode — used as start time for all airports
  onAddToTrip: (flight: Flight) => void;
}

const FlightsList = forwardRef<unknown, FlightsListProps>(
  ({ airportCodes, timezone, initialFromDatetime, airportTimezones, originalAirportCode, tripArrivalTimeUTC, onAddToTrip }, ref) => {
    const t = useTexts();
    // ── Stores ────────────────────────────────────────────────────────────────
    const { travelDate, minTransferHours, minManualTransferHours, showRefreshButton } = useSettingsStore();
    const { setHighlightedAirports, setHighlightedCities, setDisplayedFlights } = useSelectionStore();
    const { tripState } = useTripStore();
    const { data: airportsData } = useAirportsQuery();
    const { destinationFilter, airlineFilter } = useFilterStore();

    // ── Data loading ──────────────────────────────────────────────────────────
    const { error, lastFetched, perAirportLoading, anyLoading, flightsByDate, handleRefresh } =
      useFlightLoader({ airportCodes, timezone, initialFromDatetime, airportTimezones, tripArrivalTimeUTC });

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

    // ── Misc refs ─────────────────────────────────────────────────────────────
    const prevHighlightedAirportsRef = useRef<Set<string>>(new Set());
    const prevHighlightedCitiesRef = useRef<Set<string>>(new Set());
    // const isManualJumpRef = useRef(false); // [DISABLED] date-jump navigation
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const flightRefsMap = useRef(new Map());

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

    // ── Highlighted airports + cities effect (filter-aware) ──────────────────
    // Only dispatch when the SET CONTENT changes, not on every rawFlights append.
    // This prevents the route animation from restarting for each 12h window load.
    useEffect(() => {
      const sourceFlights = isFilterActive ? displayedFlatFlights : todayFlights;

      // Keep the store in sync with exactly what the list currently shows.
      // MapComponent uses displayedFlights for route drawing and popup content.
      setDisplayedFlights(sourceFlights);

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
    }, [displayedFlatFlights, todayFlights, isFilterActive, setHighlightedAirports, setHighlightedCities, setDisplayedFlights]);

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
            ? arrMs + minTransferHours * CONFIG.HOUR_IN_MS
            : arrMs + (minTransferHours + minManualTransferHours) * CONFIG.HOUR_IN_MS;
          if (depMs < thresholdMs) return 'soon';
        }
        return null;
      },
      [tripStartAirport, airportCountryMap, tripCurrentArrivalTimeUTC, originalAirportCode, minTransferHours, minManualTransferHours]
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
      const date = new Date(timestamp);
      const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
      if (diffMins < 1) return t.flights.justNow;
      if (diffMins < 60) return t.flights.minutesAgo(diffMins);
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return t.flights.hoursAgo(diffHours);
      return date.toLocaleDateString(FORMAT_LOCALES.GB, {
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
