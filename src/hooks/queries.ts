import { useQuery } from '@tanstack/react-query';
import { getAirportsGeoJSON, getCitiesGeoJSON, /* getRoutesGeoJSON, */ getAirportsByCountry } from '../api/geo';
import { CONFIG } from '../constants/config';
import { getFlightOffers } from '../api/flights';
import type { AirportInfo, FlightOffersResponse } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { useMemo } from 'react';

// GeoJSON – essentially static data, cache per language
export const useAirportsQuery = () => {
  const language = useSettingsStore(s => s.language);
  return useQuery({
    queryKey: ['airports', language],
    queryFn: () => getAirportsGeoJSON(language),
    staleTime: Infinity,
  });
};

export const useCitiesQuery = (enabled: boolean) => {
  const language = useSettingsStore(s => s.language);
  return useQuery({
    queryKey: ['cities', language],
    queryFn: () => getCitiesGeoJSON(language),
    enabled,
    staleTime: Infinity,
  });
};

/*
export const useRoutesQuery = (enabled: boolean) =>
  useQuery({
    queryKey: ['routes'],
    queryFn: getRoutesGeoJSON,
    enabled,
    staleTime: Infinity,
  });
*/

function computeAirportInfo(time_zone: string): AirportInfo {
  const now = new Date();
  const local = now.toLocaleString('sv-SE', {
    timeZone: time_zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const current_local_datetime = local.replace(' ', 'T');
  return { time_zone, current_local_date: current_local_datetime.substring(0, 10), current_local_datetime };
}

// Airport timezone/date info – derived from GeoJSON data (no extra requests)
export const useAirportInfoQuery = (code: string | null) => {
  const { data: airportsData } = useAirportsQuery();
  return useMemo(() => {
    if (!code || !airportsData) return { data: undefined };
    const tz = airportsData.features.find((f: { properties: { code: string; time_zone?: string | null } }) => f.properties.code === code)?.properties.time_zone;
    if (!tz) return { data: undefined };
    return { data: computeAirportInfo(tz) };
  }, [code, airportsData]);
};

// Batch airport info – derived from GeoJSON data (no extra requests)
export const useAirportInfosQuery = (codes: string[]) => {
  const { data: airportsData } = useAirportsQuery();
  return useMemo(() => {
    if (!airportsData) return codes.map(() => ({ data: undefined }));
    return codes.map(code => {
      const tz = airportsData.features.find((f: { properties: { code: string; time_zone?: string | null } }) => f.properties.code === code)?.properties.time_zone;
      if (!tz) return { data: undefined };
      return { data: computeAirportInfo(tz) };
    });
  }, [codes, airportsData]);
};

// Wszystkie lotniska dla danego kraju z danymi stref czasowych – cache 24h (zgodnie z backendem)
export const useAirportsByCountryQuery = (countryCode: string | null) => {
  const language = useSettingsStore(s => s.language);
  return useQuery({
    queryKey: ['airportsByCountry', countryCode, language],
    queryFn: () => getAirportsByCountry(countryCode!, language),
    enabled: !!countryCode,
    staleTime: 24 * 60 * 60 * 1000,
  });
};

// Flight price offers – 5 min cache, disabled until explicitly triggered
export const useFlightOffersQuery = (
  origin: string | null,
  dest: string | null,
  params: Record<string, unknown>,
  enabled: boolean,
) =>
  useQuery<FlightOffersResponse>({
    queryKey: ['flightOffers', origin, dest, params],
    queryFn: () => getFlightOffers(origin!, dest!, params),
    enabled: !!enabled,
    staleTime: CONFIG.CACHE_AIRPORT_INFO_MS,
  });
