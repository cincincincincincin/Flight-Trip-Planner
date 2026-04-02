import { useQuery } from '@tanstack/react-query';
import { getInitData } from '../api/geo';
import { CONFIG } from '../constants/config';
import { getFlightOffers } from '../api/flights';
import type { AirportInfo, FlightOffersResponse } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { useMemo } from 'react';

// Single startup request — returns both GeoJSON and country centers
export const useInitQuery = () => {
  const language = useSettingsStore(s => s.language);
  return useQuery({
    queryKey: ['init', language],
    queryFn: () => getInitData(language),
    staleTime: Infinity,
  });
};

// Thin wrapper — consumers unchanged
export const useAirportsQuery = () => {
  const { data, ...rest } = useInitQuery();
  return { data: data?.geojson, ...rest };
};

// Thin wrapper — consumers unchanged
export const useCountryCentersQuery = () => {
  const { data, ...rest } = useInitQuery();
  return { data: data?.country_centers, ...rest };
};

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

// Airport timezone/date info — derived from GeoJSON data (no extra requests)
export const useAirportInfoQuery = (code: string | null) => {
  const { data: airportsData } = useAirportsQuery();
  return useMemo(() => {
    if (!code || !airportsData) return { data: undefined };
    const tz = airportsData.features.find((f: { properties: { code: string; time_zone?: string | null } }) => f.properties.code === code)?.properties.time_zone;
    if (!tz) return { data: undefined };
    return { data: computeAirportInfo(tz) };
  }, [code, airportsData]);
};

// Batch airport info — derived from GeoJSON data (no extra requests)
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

// Local filter — replaces GET /airports/by-country (no network request)
export const useAirportsByCountryQuery = (countryCode: string | null) => {
  const { data: airportsData } = useAirportsQuery();
  return useMemo(() => {
    if (!countryCode || !airportsData) return { data: undefined };
    const airports = airportsData.features
      .filter(f => f.properties.country_code === countryCode)
      .map(f => ({
        code: f.properties.code,
        name: f.properties.name,
        time_zone: f.properties.time_zone ?? null,
      }));
    return { data: airports };
  }, [countryCode, airportsData]);
};

// Flight price offers — 5 min cache, disabled until explicitly triggered
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
