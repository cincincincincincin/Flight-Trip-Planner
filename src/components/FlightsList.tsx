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
import { logger } from '../utils/logger';


interface FlightsListProps {
  airportCodes: string[];          // kody lotnisk (1-6)
  timezone?: string;               // wybrana strefa czasowa wyświetlania
  initialFromDatetime?: string;    // data/godzina początkowa (tryb pojedynczego lotniska)
  airportTimezones?: Record<string, string>; // strefy czasowe IANA dla poszczególnych lotnisk
  originalAirportCode?: string | null; // "docelowe" lotnisko w trybie podróży
  tripArrivalTimeUTC?: string | null;  // czas przylotu UTC w trybie podróży (używany jako start dla transferów)
  travelDateOverride?: string;     // synchroniczna data podróży dla stabilności stref czasowych
  onAddToTrip: (flight: Flight) => void;
}

const FlightsList = forwardRef<unknown, FlightsListProps>(
  ({ airportCodes, timezone, initialFromDatetime, airportTimezones, originalAirportCode, tripArrivalTimeUTC, travelDateOverride, onAddToTrip }, ref) => {
    const t = useTexts();
    // TARCZA STABILNOŚCI: Zamrażamy referencje tablic i obiektów, aby uniknąć zbędnych restartów ładowania.
    const stableAirportCodesJson = JSON.stringify(airportCodes);
    const stableAirportCodes = useMemo(() => JSON.parse(stableAirportCodesJson), [stableAirportCodesJson]);
    
    const stableAirportTimezonesJson = JSON.stringify(airportTimezones);
    const stableAirportTimezones = useMemo(() => JSON.parse(stableAirportTimezonesJson), [stableAirportTimezonesJson]);

    // Kontenery stanu (Stores)
    const { travelDate, minTransferHours, minManualTransferHours, showRefreshButton } = useSettingsStore();
    const { setHighlightedAirports, setHighlightedCities, setDisplayedFlights } = useSelectionStore();
    const { tripState } = useTripStore();
    const { airportFeaturesMap, cityMap, countryMap } = useAirportIndexes();
    const { flightsData: globalFlightsData } = useSelectionStore();

    // Ładowanie danych
    const { error, lastFetched, perAirportLoading, perAirportFullyLoaded, anyLoading, flightsByDate, handleRefresh } =
      useFlightLoader({ 
        airportCodes: stableAirportCodes, 
        timezone, 
        initialFromDatetime, 
        airportTimezones: stableAirportTimezones, 
        tripArrivalTimeUTC, 
        travelDateOverride 
      });

    // Dane pochodne z tripState
    const tripStartAirport = tripState?.startAirport ?? null;

    const tripCurrentArrivalTimeUTC = useMemo(() => getTripCurrentArrivalTimeUTC(tripState), [tripState]);


    // Referencje pomocnicze
    const prevHighlightedAirportsRef = useRef<Set<string>>(new Set());
    const prevHighlightedCitiesRef = useRef<Set<string>>(new Set());
    // const isManualJumpRef = useRef(false); // nawigacja po datach
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const flightRefsMap = useRef(new Map());

    // Timer synchronizujący odfiltrowywanie przeszłych lotów w czasie rzeczywistym
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
      logger.log("%c[ACTION-LOAD] %cFlightsList ZAMONTOWANO", 'color: #3b82f6; font-weight: bold', 'color: inherit');
      return () => {
        logger.log("%c[ACTION-LOAD] %cFlightsList ODDAWNA", 'color: #ef4444; font-weight: bold', 'color: inherit');
      };
    }, []);

    // Stan rozwijania kart lotów
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

    // Loty nieprzefiltrowane tylko dla wybranego dnia
    const { setIsFlightsLoading } = useSelectionStore();
    useEffect(() => {
      setIsFlightsLoading(anyLoading);
    }, [anyLoading, setIsFlightsLoading]);

    const todayFlights = useMemo(
      () => (flightsByDate[travelDate] || []),
      [flightsByDate, travelDate]
    );

    // Wykorzystujemy współdzieloną logikę filtrowania (DRY).
    const { matchesFilter, isFilterActive } = useFlightFilter();

    const displayedFlatFlights = useMemo(() => {
      // Optymalizacja: filtrujemy najpierw po źródłowych lotniskach
      const validOrigins = new Set(airportCodes.map((c: string) => c.toUpperCase()));
      let flights = todayFlights.filter(f => validOrigins.has((f.origin_airport_code || '').toUpperCase()));
      
      // Następnie aplikujemy ręczne filtry użytkownika (zawiera destynację z mapy)
      flights = flights.filter(matchesFilter);
      
      // FILTROWANIE DLA TRANSFERÓW: 
      // Jeśli jesteśmy w trybie planowania trasy, ukrywamy loty, które odlatują przed przylotem.
      // Pre-compute UTC timestamps raz (O(n)) żeby uniknąć O(n log n × dayjs.parse) w sort/filter
      let withTs = flights.map(f => ({
        f,
        ts: f.scheduled_departure_utc ? dayjs.utc(f.scheduled_departure_utc).valueOf() : 0
      }));

      if (tripArrivalTimeUTC) {
        const arrMs = new Date(tripArrivalTimeUTC).getTime();
        withTs = withTs.filter(x => x.f.scheduled_departure_utc && x.ts >= arrMs);
      } else {
        const selectedTodayStr = timezone ? getTodayInTz(timezone) : getTodayInTz();
        logger.log(`%c[ACTION-LOAD] %cFiltrowanie lotów | Dzisiaj: ${selectedTodayStr}, DataPodróży: ${travelDate}, Przed filtrem: ${todayFlights.length}, Po filtrze: ${flights.length}`, 'color: #10b981; font-weight: bold', 'color: inherit');

        if (travelDate === selectedTodayStr) {
          withTs = withTs.filter(x => !x.f.scheduled_departure_utc || x.ts > nowMs);
        }
      }

      const finalCount = withTs.length;
      if (finalCount === 0 && todayFlights.length > 0) {
        logger.warn(`%c[ACTION-LOAD] %cWYKRYTO REBOUND | todayFlights: ${todayFlights.length}, finalCount: 0. Klucze w flightsByDate: ${Object.keys(flightsByDate).join(',')}, travelDate: ${travelDate}, timezone: ${timezone}`, 'color: #f59e0b; font-weight: bold', 'color: inherit');
      }
      logger.log(`%c[ACTION-LOAD] %cFiltrowanie lotów | Ostateczna liczba: ${finalCount}`, 'color: #10b981; font-weight: bold', 'color: inherit');

      withTs.sort((a, b) => a.ts - b.ts);
      return withTs.map(x => x.f);
    }, [todayFlights, matchesFilter, tripArrivalTimeUTC, nowMs, travelDate, timezone, flightsByDate]);

    // Synchronizacja podświetlenia na mapie
    // Wysyłamy dane tylko gdy faktycznie się zmieniły, żeby uniknąć thrashingu WebGL.
    useEffect(() => {
      // MASTER FIX: Podświetlamy mapę na podstawie WSZYSTKICH dostępnych lotów (bez filtra destynacji).
      // Dzięki temu kliknięcie w jedną kropkę nie chowa pozostałych opcji.
      // Stosujemy jednak ten sam filtr CZASOWY co displayedFlatFlights, żeby mapa zgadzała się z panelem.
      const validOrigins = new Set(airportCodes.map((c: string) => c.toUpperCase()));
      let mapWithTs = todayFlights
        .filter(f => validOrigins.has((f.origin_airport_code || '').toUpperCase()))
        .map(f => ({
          f,
          ts: f.scheduled_departure_utc ? dayjs.utc(f.scheduled_departure_utc).valueOf() : 0
        }));

      if (tripArrivalTimeUTC) {
        const arrMs = new Date(tripArrivalTimeUTC).getTime();
        mapWithTs = mapWithTs.filter(x => x.f.scheduled_departure_utc && x.ts >= arrMs);
      } else {
        const selectedTodayStr = timezone ? getTodayInTz(timezone) : getTodayInTz();
        if (travelDate === selectedTodayStr) {
          mapWithTs = mapWithTs.filter(x => !x.f.scheduled_departure_utc || x.ts > nowMs);
        }
      }

      // Filtr daty: wykluczamy loty spoza travelDate pobrane w szerokim 24h oknie.
      // Używamy tego samego algorytmu co flightsByDate, żeby być spójnym z grupowaniem.
      if (timezone) {
        const dateFmt = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        });
        mapWithTs = mapWithTs.filter(x => {
          if (!x.f.scheduled_departure_utc) return true;
          const utcStr = x.f.scheduled_departure_utc.endsWith('Z')
            ? x.f.scheduled_departure_utc
            : x.f.scheduled_departure_utc + 'Z';
          const ms = Date.parse(utcStr);
          return !isNaN(ms) && dateFmt.format(ms) === travelDate;
        });
      } else {
        mapWithTs = mapWithTs.filter(x => {
          const localDate = x.f.scheduled_departure_local?.split('T')[0];
          return !localDate || localDate === travelDate;
        });
      }

      const mapSourceFlights = mapWithTs.map(x => x.f);

      // Gdy panel nie wyświetla żadnych lotów, wyczyść też destinacje na mapie.
      if (displayedFlatFlights.length === 0 || mapSourceFlights.length === 0) {
        setHighlightedAirports([]);
        setHighlightedCities([]);
        setDisplayedFlights([]);
        prevHighlightedAirportsRef.current = new Set();
        prevHighlightedCitiesRef.current = new Set();
        return;
      }

      // MASTER FILTER SYNC: Jeśli aktywny jest filtr destynacji, filtrujemy trasy (arcs), ale zachowujemy kropki.
      const isAnyFilterActive = isFilterActive;
      setDisplayedFlights(isAnyFilterActive ? displayedFlatFlights : mapSourceFlights);

      // Budujemy zestawy unikalnych kodów dla całej mapy (kropki)
      const newAirports = new Set<string>();
      const newCities = new Set<string>();

      mapSourceFlights.forEach(f => {
        const rawCode = f.destination_airport_code;
        if (rawCode) {
          const code = rawCode.toUpperCase();
          newAirports.add(code);
          const cCode = cityMap[code];
          if (cCode) newCities.add(cCode);
        }
      });

      // Sprawdzanie różnic (Dirty Checking) przed aktualizacją stanu
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
    }, [displayedFlatFlights, todayFlights, isFilterActive, setHighlightedAirports, setHighlightedCities, setDisplayedFlights, cityMap, airportCodes, nowMs, travelDate, timezone, tripArrivalTimeUTC]);

    // Czyszczenie mapy gdy komponent zostaje odmontowany (deselected airport)
    useEffect(() => {
      return () => {
        setHighlightedAirports([]);
        setHighlightedCities([]);
        setDisplayedFlights([]);
        prevHighlightedAirportsRef.current = new Set();
        prevHighlightedCitiesRef.current = new Set();
      };
    }, [setHighlightedAirports, setHighlightedCities, setDisplayedFlights]);

    // Interfejs imperatywny (Imperative handle)
    useImperativeHandle(ref, () => ({
      // jumpToDate: nawigacja skokowa po datach
      jumpToDate: (_dateStr: string) => { /* nawigacja skokowa po datach */ },
      scrollToFlight: (_destCode: string) => { /* przewijanie usunięte */ },
    }));

    // Pobieranie wyróżnienia dla trybu planowania trasy
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
          // Loty z lotniska początkowego używają tylko minTransferHours;
          // loty z lotnisk przesiadkowych wymagają dodatkowo minManualTransferHours
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

    // Automatyczne ładowanie przy przewijaniu (obecnie wyłączone)
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

    // Formattery
    const formatLastFetched = (timestamp: string | null) => {
      if (!timestamp) return t.flights.never;
      const d = dayjs(timestamp);
      const diffMins = dayjs().diff(d, 'minute');

      if (diffMins < 1) return t.flights.justNow;
      if (diffMins < 60) return t.flights.minutesAgo(diffMins);
      if (diffMins < 1440) return t.flights.hoursAgo(Math.floor(diffMins / 60));
      
      return d.format('DD MMM, HH:mm');
    };

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

    // Wczesny powrót w przypadku krytycznego błędu
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

    // Renderowanie komponentu
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
                    isAirportLoaded={perAirportFullyLoaded[flight.origin_airport_code]}
                  />
                );
              }}
              // endReached={handleEndReached} // nieskończone ładowanie wyzwalane przewijaniem
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
