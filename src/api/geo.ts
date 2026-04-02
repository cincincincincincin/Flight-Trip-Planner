import apiClient from './client';
import type { AirportFeatureProps, CountryAirport } from '../types';
import type { FeatureCollection, Point } from 'geojson';

export interface InitData {
  geojson: FeatureCollection<Point, AirportFeatureProps>;
  country_centers: Record<string, { lon: number; lat: number; zoom: number }>;
}

export const getInitData = (lang = 'en'): Promise<InitData> =>
  apiClient.get('/init', { params: { lang } }).then(r => r.data);

// Kept for manual testing only — not called by the app
export const getAirportsGeoJSON = (lang = 'en'): Promise<FeatureCollection<Point, AirportFeatureProps>> =>
  apiClient.get('/airports/geojson', { params: { lang } }).then(r => r.data);

// Kept for manual testing only — not called by the app (replaced by local GeoJSON filter)
export const getAirportsByCountry = (countryCode: string, lang = 'en'): Promise<CountryAirport[]> =>
  apiClient.get(`/airports/by-country/${countryCode}`, { params: { lang } }).then(r => r.data.data);

// Kept for manual testing only — not called by the app (replaced by /init)
export const getCountryCenters = (): Promise<Record<string, { lon: number; lat: number; zoom: number }>> =>
  apiClient.get('/countries/centers').then(r => r.data);
