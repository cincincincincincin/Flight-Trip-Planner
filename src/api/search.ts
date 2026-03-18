import apiClient from './client';
import type { Airport, City, SearchResponse, CityWithPagination } from '../types';

export const getAirport = (code: string, config?: object): Promise<Airport> =>
  apiClient.get(`/search/airport/${code}`, config).then(r => r.data.data);

export const getCity = (code: string): Promise<City> =>
  apiClient.get(`/search/city/${code}`).then(r => r.data.data);

export const getCountryCenter = (code: string): Promise<{ lat: number; lng: number }> =>
  apiClient.get(`/search/country/${code}/center`).then(r => r.data);

export const search = (params: Record<string, unknown>, config?: object): Promise<SearchResponse> =>
  apiClient.get('/search', { params, ...config }).then(r => r.data);

export const getCountryCities = (countryCode: string, params: Record<string, unknown>): Promise<CityWithPagination> =>
  apiClient.get(`/search/countries/${countryCode}/cities`, { params }).then(r => r.data);

export const getCityAirports = (cityCode: string, params: Record<string, unknown>): Promise<{ data: Airport[] }> =>
  apiClient.get(`/search/cities/${cityCode}/airports`, { params }).then(r => r.data);
