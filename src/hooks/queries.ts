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

/**
 * MODULARNA WARSTWA DANYCH (Zero-Transformation Architecture)
 */

export const useMetadataQuery = () => {
  return useQuery({
    queryKey: ['metadata'],
    queryFn: getMetadata,
    staleTime: Infinity,
  });
};

export const useSearchQuery = () => {
  const language = useSettingsStore(s => s.language) as 'en' | 'pl';
  return useQuery({
    queryKey: ['searchIndex', language],
    queryFn: () => getSearchIndex(language),
    staleTime: Infinity,
  });
};

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
 * Ten hook stanowi fundament wydajności systemu. Buduje precyzyjne mapy (HashMaps) 
 * umożliwiające natychmiastowy dostęp do danych geograficznych.
 * 
 * Wydajność:
 * - Budowa: O(N) przy zmianie meta/search.
 * - Odczyt: O(1) dla całej aplikacji - brak przeszukiwania dużych tablic w pętli renderowania.
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
      cityAirportsMap: meta.airportCityMap,
      countryAirportsMap: meta.countryAirportsMap,
      cityLabelCodes: meta.cityLabelCodes,
      cityLabelCodeByCity: meta.cityLabelCodeByCity
    };
    const end = performance.now();

    if (useSettingsStore.getState().showConsoleLogs) {
      console.log(`%c[QUERY-WATCH] %cuseAirportIndexes rebuilt in ${(end - start).toFixed(2)}ms`, 'color: #3b82f6; font-weight: bold', 'color: inherit');
    }

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

/** Oblicza lokalny czas i datę dla danej strefy czasowej. */
function computeAirportInfo(time_zone: string, referenceDate: Date = new Date()): AirportInfo {
  const localTs = getTimestampInTz(referenceDate, time_zone);
  const localDate = new Date(localTs);
  const current_local_datetime = localDate.toISOString().substring(0, 19); 
  return { time_zone, current_local_date: current_local_datetime.substring(0, 10), current_local_datetime };
}

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

/** Pobiera listę lotnisk dla danego kraju (używane w panelu bocznym). */
export const useAirportsByCountryQuery = (countryCode: string | null) => {
  const { countryAirportsMap, airportFeaturesMap, namesMap } = useAirportIndexes();

  return useMemo(() => {
    if (!countryCode || !countryAirportsMap) return { data: undefined };
    const codes = countryAirportsMap[countryCode.toUpperCase()] || [];
    return { data: codes.map((code: string) => {
      const f = airportFeaturesMap[code];
      return {
        code,
        name: namesMap[code] || code,
        time_zone: f?.properties.time_zone ?? null,
      };
    })};
  }, [countryCode, countryAirportsMap, airportFeaturesMap, namesMap]);
};

export const useCityAirports = (cityCode: string | null) => {
  const { cityAirportsMap, airportFeaturesMap, namesMap } = useAirportIndexes();

  return useMemo<Airport[]>(() => {
    if (!cityCode) return [];
    const upperCode = cityCode.toUpperCase();
    
    // Optymalizacja O(1): Korzystamy z bezpośredniej mapy kody lotnisk -> miasto z metadanych.
    const codes = cityAirportsMap[upperCode] || [];
    
    if (useSettingsStore.getState().showConsoleLogs) {
      console.log(`%c[QUERY-WATCH] %cuseCityAirports(city: ${upperCode}) | Found airports: ${codes.length}`, 'color: #3b82f6; font-weight: bold', 'color: inherit');
    }

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

/** Pobiera oferty cenowe dla wybranej trasy (Aviasales API). */
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
  });

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
 * Agreguje wszystkie źródła podświetleń lotnisk.
 * Używane do optymalizacji warstw WebGL i mechanizmu hover.
 * Inżynierski Smaczek: Wykorzystuje Set dla stałej złożoności O(1) przy renderingu.
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
    // if (end - start > 2) console.warn(`[Performance] useHighlightedState took ${(end-start).toFixed(2)}ms`);
    return state;
  }, [highlightedAirports, selectedAirportCodes, explorationItems]);
};
