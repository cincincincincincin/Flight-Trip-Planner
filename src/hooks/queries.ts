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
 * ZUNIFIKOWANE INDEKSY (O(1) Access)
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
    
    return { 
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
 * INDEKS WYSZUKIWANIA
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
    const ap = iataMap[code.toLowerCase()];
    if (ap) {
      const feat = airportFeaturesMap[code];
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

export const useAirportInfoQuery = (code: string | null) => {
  const airportFeaturesMap = useAirportsMap();
  return useMemo(() => {
    if (!code) return { data: undefined };
    const tz = airportFeaturesMap[code]?.properties.time_zone;
    if (!tz) return { data: undefined };
    return { data: computeAirportInfo(tz) };
  }, [code, airportFeaturesMap]);
};

export const useAirportInfosQuery = (codes: string[]) => {
  const airportFeaturesMap = useAirportsMap();
  return useMemo(() => {
    if (Object.keys(airportFeaturesMap).length === 0) return codes.map(() => ({ data: undefined }));
    const now = new Date();
    return codes.map(code => {
      const tz = airportFeaturesMap[code]?.properties.time_zone;
      if (!tz) return { data: undefined };
      return { data: computeAirportInfo(tz, now) };
    });
  }, [codes, airportFeaturesMap]);
};

export const useAirportsByCountryQuery = (countryCode: string | null) => {
  const { countryAirportsMap, airportFeaturesMap, namesMap } = useAirportIndexes();

  return useMemo(() => {
    if (!countryCode || !countryAirportsMap) return { data: undefined };
    const codes = countryAirportsMap[countryCode] || [];
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
  const { countryMap } = useSearchIndex();
  const cityInfoMap = useCityInfoMap();

  return useMemo<Airport[]>(() => {
    if (!cityCode) return [];
    const cityInfo = cityInfoMap[cityCode];
    if (!cityInfo || !cityInfo.country_code) return [];
    return countryMap[cityInfo.country_code]?.cities[cityCode]?.airports || [];
  }, [cityCode, countryMap, cityInfoMap]);
};

export const useCountryData = (countryCode: string | null) => {
  const { countryMap } = useSearchIndex();
  return useMemo(() => {
    if (!countryCode || !countryMap[countryCode]) return { cities: [], flatAirports: [] };
    const countryData = countryMap[countryCode];
    const cities = Object.values(countryData.cities).sort((a: any, b: any) => a.name.localeCompare(b.name));
    const flatAirports = cities.flatMap((c: any) => c.airports || []);
    return { cities, flatAirports };
  }, [countryCode, countryMap]);
};

export const useFlightOffersQuery = (origin: string | null, dest: string | null, params: Record<string, unknown>, enabled: boolean) =>
  useQuery<FlightOffer>({
    queryKey: ['flightOffers', origin, dest, params],
    queryFn: () => {
      const { departure_at, ...rest } = params;
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
      const destAirport = flight.destination_airport_code;
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
 */
export const useHighlightedState = () => {
  const highlightedAirports = useSelectionStore(s => s.highlightedAirports);
  const selectedAirportCodes = useSelectionStore(s => s.selectedAirportCodes);
  const explorationItems = useSelectionStore(s => s.explorationItems);
  
  return useMemo(() => {
    const explorationCodes = explorationItems.flatMap(i => i.airportCodes);
    return {
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
  }, [highlightedAirports, selectedAirportCodes, explorationItems]);
};
