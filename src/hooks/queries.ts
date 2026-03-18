import { useQuery, useQueries } from '@tanstack/react-query';
import { getAirportsGeoJSON, getCitiesGeoJSON, getRoutesGeoJSON, getAirportsByCountry } from '../api/geo';
import { getAirportInfo, getFlightOffers } from '../api/flights';
import type { FlightOffersResponse } from '../types';

// GeoJSON – essentially static data, cache forever
export const useAirportsQuery = () =>
  useQuery({
    queryKey: ['airports'],
    queryFn: getAirportsGeoJSON,
    staleTime: Infinity,
  });

export const useCitiesQuery = (enabled: boolean) =>
  useQuery({
    queryKey: ['cities'],
    queryFn: getCitiesGeoJSON,
    enabled,
    staleTime: Infinity,
  });

export const useRoutesQuery = (enabled: boolean) =>
  useQuery({
    queryKey: ['routes'],
    queryFn: getRoutesGeoJSON,
    enabled,
    staleTime: Infinity,
  });

// Airport timezone/date info – 5 min cache per airport code
export const useAirportInfoQuery = (code: string | null) =>
  useQuery({
    queryKey: ['airportInfo', code],
    queryFn: () => getAirportInfo(code!),
    enabled: !!code,
    staleTime: 5 * 60 * 1000,
  });

// Batch airport info queries – returns array of results in same order as codes
export const useAirportInfosQuery = (codes: string[]) =>
  useQueries({
    queries: codes.map(code => ({
      queryKey: ['airportInfo', code] as const,
      queryFn: () => getAirportInfo(code),
      enabled: !!code,
      staleTime: 5 * 60 * 1000,
    })),
  });

// All flightable airports for a country with timezone data – 24h cache (matches backend)
export const useAirportsByCountryQuery = (countryCode: string | null) =>
  useQuery({
    queryKey: ['airportsByCountry', countryCode],
    queryFn: () => getAirportsByCountry(countryCode!),
    enabled: !!countryCode,
    staleTime: 24 * 60 * 60 * 1000,
  });

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
    staleTime: 5 * 60 * 1000,
  });
