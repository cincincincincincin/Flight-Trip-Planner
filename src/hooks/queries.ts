import { useQuery } from '@tanstack/react-query';
import { getMetadata, getSearchIndex, getAirportsGeoJSON } from '../api/geo';
import { CONFIG } from '../constants/config';
import { getOffers } from '../api/offers';
import type { AirportInfo, FlightOffer, AirportFeatureProps, Airport } from '../types';
import type { FeatureCollection, Point, Feature } from 'geojson';
import { useSettingsStore } from '../stores/settingsStore';
import { useMemo } from 'react';
import { getTimestampInTz } from '../utils/dateFormatting';
import { useFilterStore } from '../stores/filterStore';
import { useTripStore } from '../stores/tripStore';
import { useSelectionStore } from '../stores/selectionStore';
import { logger } from '../utils/logger';

/**
 * MODULARNA WARSTWA DANYCH (Zero-Transformation Architecture)
 * Zarządza pobieraniem metadanych geograficznych, indeksów wyszukiwania i ofert lotów.
 * Wykorzystuje TanStack Query (React Query) do zarządzania stanem asynchronicznym i cache'owaniem.
 */

// Pobiera globalne metadane (mapy współrzędnych, przypisania lotnisk do miast/krajów itp.).
// Dane te są pobierane raz i przechowywane w cache (staleTime: Infinity).
export const useMetadataQuery = () => {
  return useQuery({
    queryKey: ['metadata'],
    queryFn: getMetadata,
    staleTime: Infinity,
  });
};

// Pobiera indeks wyszukiwarki (nazwy lotnisk/miast/krajów) dopasowany do wybranego języka interfejsu.
export const useSearchQuery = () => {
  const language = useSettingsStore(s => s.language) as 'en' | 'pl';
  return useQuery({
    queryKey: ['searchIndex', language],
    queryFn: () => getSearchIndex(language),
    staleTime: Infinity,
  });
};

// Pobiera surowe dane GeoJSON wszystkich lotnisk potrzebne do renderowania warstw kropkowych na mapie.
export const useAirportsQuery = () => {
  return useQuery({
    queryKey: ['geojson'],
    queryFn: getAirportsGeoJSON,
    staleTime: Infinity,
  });
};

export const useCountryCentersQuery = () => {
  const { data: search } = useSearchQuery();
  return {
    data: search?.countryInfo,
    isLoading: !search
  };
};

/** 
 * [STRATEGIA O(1)]: ZUNIFIKOWANE INDEKSY
 * Ten hook stanowi fundament wydajności systemu. Agreguje surowe metadane i indeksy wyszukiwania,
 * tworząc gotowe do użycia mapy (HashMaps). Dzięki temu inne komponenty mogą pobierać dane
 * o lotniskach po kodzie IATA natychmiastowo, bez przeszukiwania pętli.
 * 
 * Wydajność:
 * - Przebudowa: Tylko gdy zmienią się metadane (np. zmiana języka).
 * - Dostęp: O(1) - najwyższa możliwa wydajność przy renderowaniu tysięcy punktów na mapie.
 */
export const useAirportIndexes = () => {
  const { data: meta } = useMetadataQuery();
  const { data: search } = useSearchQuery();

  return useMemo(() => {
    if (!meta || !search) return {
      airportFeaturesMap: {} as Record<string, Feature<Point, AirportFeatureProps>>,
      coordsMap: {} as Record<string, [number, number]>,
      cityMap: {} as Record<string, string>,
      countryMap: {} as Record<string, string>,
      namesMap: {} as Record<string, string>,
      cityNamesMap: {} as Record<string, string>,
      cityAirportsMap: {} as Record<string, string[]>,
      countryAirportsMap: {} as Record<string, string[]>,
      cityLabelCodes: [] as string[],
      cityLabelCodeByCity: {} as Record<string, string>,
    };

    const start = performance.now();
    const result = {
      airportFeaturesMap: meta.airportFeaturesMap,
      coordsMap: meta.coordsMap,
      cityMap: meta.cityMap,
      countryMap: meta.countryMap,
      namesMap: search.names,
      cityNamesMap: Object.fromEntries(
        Object.entries(meta.cityMap).map(([apCode, cityCode]) => [
          apCode,
          search.cityInfo[cityCode]?.name || apCode
        ])
      ),
      cityAirportsMap: meta.airportCityMap,
      countryAirportsMap: meta.countryAirportsMap,
      cityLabelCodes: meta.cityLabelCodes,
      cityLabelCodeByCity: meta.cityLabelCodeByCity
    };
    const end = performance.now();

    logger.log(`%c[QUERY-WATCH] %cuseAirportIndexes przebudowany w ${(end - start).toFixed(2)}ms`, 'color: #3b82f6; font-weight: bold', 'color: inherit');

    return result;
  }, [meta, search]);
};

export const useAirportsMap = () => useAirportIndexes().airportFeaturesMap;
export const useAirportCoordsMap = () => useAirportIndexes().coordsMap;
export const useAirportCityMap = () => useAirportIndexes().cityMap;
export const useAirportCountryMap = () => useAirportIndexes().countryMap;
export const useAirportNamesMap = () => useAirportIndexes().namesMap;

export const useCityInfoMap = () => {
  const { data: search } = useSearchQuery();
  return useMemo(() => search?.cityInfo || {}, [search]);
};

export const useCountryInfoMap = () => {
  const { data: search } = useSearchQuery();
  return useMemo(() => search?.countryInfo || {}, [search]);
};

export const useCityAirportsMap = () => useAirportIndexes().cityAirportsMap;
export const useCityLabelCodes = () => useAirportIndexes().cityLabelCodes;

/** 
 * ZWRACA INDEKS WYSZUKIWANIA (Lokalizowany)
 */
export const useSearchIndex = () => {
  const { data: search } = useSearchQuery();

  return useMemo(() => {
    if (!search) return { countryMap: {}, iataMap: {} };
    return {
      countryMap: search.searchIndex,
      iataMap: search.iataMap
    };
  }, [search]);
};

/** 
 * Oblicza lokalny czas i datę dla danej strefy czasowej.
 * Wykorzystuje funkcję pomocniczą getTimestampInTz, aby uwzględnić przesunięcie czasowe lotniska.
 */
function computeAirportInfo(time_zone: string, referenceDate: Date = new Date()): AirportInfo {
  const localTs = getTimestampInTz(referenceDate, time_zone);
  const localDate = new Date(localTs);
  const current_local_datetime = localDate.toISOString().substring(0, 19);
  return { time_zone, current_local_date: current_local_datetime.substring(0, 10), current_local_datetime };
}

/** 
 * Pobiera pełny obiekt danych o lotnisku na podstawie kodu IATA.
 * Łączy dane z indeksu wyszukiwania (nazwa, miasto) z metadatami geograficznymi (strefa czasowa, współrzędne).
 */
export const useAirportData = (code: string | null) => {
  const { airportFeaturesMap } = useAirportIndexes();
  const { iataMap } = useSearchIndex();

  return useMemo<Airport | null>(() => {
    if (!code) return null;
    const upperCode = code.toUpperCase();
    // iataMap klucze są małe (z scripts/generate_static.py), metadata używa wielkich liter
    const ap = iataMap[upperCode.toLowerCase()];

    if (ap) {
      const feat = airportFeaturesMap[upperCode];
      if (feat) {
        return {
          ...ap,
          time_zone: feat.properties.time_zone || undefined,
          coordinates: { lon: feat.geometry.coordinates[0], lat: feat.geometry.coordinates[1] }
        };
      }
      return ap;
    }
    return null;
  }, [code, iataMap, airportFeaturesMap]);
};

/** Hook dla pojedynczego lotniska - zwraca czas lokalny i strefę czasową. */
export const useAirportInfoQuery = (code: string | null) => {
  const airportFeaturesMap = useAirportsMap();
  return useMemo(() => {
    if (!code) return { data: undefined };
    const tz = airportFeaturesMap[code.toUpperCase()]?.properties.time_zone;
    return { data: tz ? computeAirportInfo(tz) : undefined };
  }, [code, airportFeaturesMap]);
};

/** Pobiera zbiorcze informacje (czas lokalny) dla listy kodów lotnisk. */
export const useAirportInfosQuery = (codes: string[]) => {
  const airportFeaturesMap = useAirportsMap();
  return useMemo(() => {
    if (Object.keys(airportFeaturesMap).length === 0) return codes.map(() => ({ data: undefined }));
    const now = new Date();
    return codes.map(code => {
      const tz = airportFeaturesMap[code.toUpperCase()]?.properties.time_zone;
      return { data: tz ? computeAirportInfo(tz, now) : undefined };
    });
  }, [codes, airportFeaturesMap]);
};

/** 
 * Filtruje lotniska należące do konkretnego kraju.
 * Wykorzystuje countryAirportsMap zbudowaną w useAirportIndexes dla wydajnego filtrowania.
 */
export const useAirportsByCountryQuery = (countryCode: string | null) => {
  const { countryAirportsMap, airportFeaturesMap, namesMap } = useAirportIndexes();

  return useMemo(() => {
    if (!countryCode || !countryAirportsMap) return { data: undefined };
    const codes = countryAirportsMap[countryCode.toUpperCase()] || [];
    return {
      data: codes.map((code: string) => {
        const f = airportFeaturesMap[code];
        return {
          code,
          name: namesMap[code] || code,
          time_zone: f?.properties.time_zone ?? null,
        };
      })
    };
  }, [countryCode, countryAirportsMap, airportFeaturesMap, namesMap]);
};

export const useCityAirports = (cityCode: string | null) => {
  const { cityAirportsMap, airportFeaturesMap, namesMap } = useAirportIndexes();

  return useMemo<Airport[]>(() => {
    if (!cityCode) return [];
    const upperCode = cityCode.toUpperCase();

    // Optymalizacja O(1): Korzystamy z bezpośredniej mapy kody lotnisk -> miasto z metadanych.
    const codes = cityAirportsMap[upperCode] || [];

    logger.log(`%c[QUERY-WATCH] %cuseCityAirports(miasto: ${upperCode}) | Znaleziono lotnisk: ${codes.length}`, 'color: #3b82f6; font-weight: bold', 'color: inherit');

    return codes.map(code => {
      const feat = airportFeaturesMap[code];
      if (!feat) return null;

      return {
        code,
        name: namesMap[code] || (feat.properties as any).name_en || code,
        city_name: (feat.properties as any).city_name_en || '',
        coordinates: {
          lon: feat.geometry.coordinates[0],
          lat: feat.geometry.coordinates[1]
        },
        time_zone: feat.properties.time_zone || undefined
      };
    }).filter(Boolean) as Airport[];
  }, [cityCode, cityAirportsMap, airportFeaturesMap, namesMap]);
};

/** Zwraca listę miast i lotnisk dla danego kraju (posortowane). */
export const useCountryData = (countryCode: string | null) => {
  const { countryMap } = useSearchIndex();
  return useMemo(() => {
    if (!countryCode) return { cities: [], flatAirports: [] };
    const countryData = countryMap[countryCode.toUpperCase()];
    if (!countryData) return { cities: [], flatAirports: [] };

    const cities = Object.values(countryData.cities).sort((a: any, b: any) => a.name.localeCompare(b.name));
    const flatAirports = cities.flatMap((c: any) => c.airports || []);
    return { cities, flatAirports };
  }, [countryCode, countryMap]);
};

/** 
 * Pobiera oferty cenowe dla wybranej trasy wykorzystując backend FTP i API Aviasales.
 * 
 * Optymalizacja: 
 * - Zapytanie jest wyłączone (enabled: false), dopóki nie mamy wszystkich parametrów.
 * - Wykorzystuje normalizację czasu (minuty), aby zwiększyć trafność cache'owania zapytań.
 * - Obsługuje błędy 404/204 (brak ofert) jako stany stabilne, nie ponawiając prób (retry).
 */
export const useFlightOffersQuery = (origin: string | null, dest: string | null, params: Record<string, unknown>, enabled: boolean) =>
  useQuery<FlightOffer>({
    queryKey: ['flightOffers', origin, dest, params],
    queryFn: () => {
      const { departure_at, ...rest } = params;
      // Normalizacja daty do pełnych minut dla lepszego cache'owania na backendzie
      const minuteDepartureAt = typeof departure_at === 'string' ? departure_at.substring(0, 16) : departure_at;
      return getOffers({ origin, destination: dest, departure_at: minuteDepartureAt, ...rest });
    },
    enabled: Boolean(enabled),
    staleTime: CONFIG.CACHE_AIRPORT_INFO_MS,
    retry: (failureCount, error: any) => {
      // Nie ponawiamy, jeśli backend jawnie mówi, że brak biletu (404/204)
      if (error?.response?.status === 404 || error?.response?.status === 204) return false;
      return failureCount < 2;
    }
  });

/** 
 * Dostarcza logikę filtrowania lotów na podstawie aktualnych ustawień w RightPanel.
 * Wykorzystuje airportCityMap dla błyskawicznego mapowania kodu na miasto/kraj podczas filtrowania.
 */
export const useFlightFilter = () => {
  const { destinationFilter, airlineFilter } = useFilterStore();
  const airportCityMap = useAirportCityMap();
  const airportCountryMap = useAirportCountryMap();

  return useMemo(() => {
    const isFilterActive = destinationFilter.airports.length > 0 ||
      destinationFilter.cities.length > 0 ||
      destinationFilter.countries.length > 0 ||
      airlineFilter.length > 0;

    const matchesFilter = (flight: { destination_airport_code: string; airline_code?: string }): boolean => {
      if (!isFilterActive) return true;
      const destAirport = (flight.destination_airport_code || '').toUpperCase();
      const destCity = airportCityMap[destAirport];
      const destCountry = airportCountryMap[destAirport];
      const airline = flight.airline_code;
      const destMatch = (destinationFilter.airports.length === 0 || destinationFilter.airports.includes(destAirport)) &&
        (destinationFilter.cities.length === 0 || (destCity && destinationFilter.cities.includes(destCity))) &&
        (destinationFilter.countries.length === 0 || (destCountry && destinationFilter.countries.includes(destCountry)));
      const airlineMatch = airlineFilter.length === 0 || (!!airline && airlineFilter.includes(airline));
      return !!(destMatch && airlineMatch);
    };
    return { matchesFilter, isFilterActive };
  }, [destinationFilter, airlineFilter, airportCityMap, airportCountryMap]);
};

/**
 * ZUNIFIKOWANE SELEKTORY STANU (Faza 2: DRY)
 * Centralne miejsce wyliczania kontekstu widoczności i podświetleń dla mapy.
 */

/** Zwraca listę kodów lotnisk wchodzących w skład aktualnej trasy. */
export const useTripVisibleAirports = () => {
  const tripState = useTripStore(s => s.tripState);

  return useMemo(() => {
    if (!tripState) return null;
    const set = new Set([tripState.startAirport.code]);
    tripState.legs.forEach(l => {
      set.add(l.fromAirportCode);
      set.add(l.toAirportCode);
    });
    return Array.from(set);
  }, [tripState]);
};

/** 
 * Agreguje wszystkie źródła podświetleń lotnisk (hover, zaznaczenie, kafelki eksploracji).
 * Używane do optymalizacji warstw WebGL na mapie.
 * 
 * Wydajność: 
 * Tworzy Set wszystkich aktywnych kodów, co pozwala na sprawdzenie stanu podświetlenia 
 * dowolnego lotniska w czasie O(1) podczas renderowania mapy.
 */
export const useHighlightedState = () => {
  const highlightedAirports = useSelectionStore(s => s.highlightedAirports);
  const selectedAirportCodes = useSelectionStore(s => s.selectedAirportCodes);
  const explorationItems = useSelectionStore(s => s.explorationItems);

  return useMemo(() => {
    // const start = performance.now();
    const explorationCodes = explorationItems.flatMap(i => i.airportCodes);
    const state = {
      highlightedAirports,
      selectedAirportCodes,
      explorationCodes,
      // Sumaryczny Set dla szybkiego O(1) sprawdzenia czy cokolwiek jest "aktywne"
      allActiveSet: new Set([
        ...highlightedAirports,
        ...selectedAirportCodes,
        ...explorationCodes
      ])
    };
    // const end = performance.now();
    // if (end - start > 2) logger.warn(`[Performance] useHighlightedState zajął ${(end-start).toFixed(2)}ms`);
    return state;
  }, [highlightedAirports, selectedAirportCodes, explorationItems]);
};
