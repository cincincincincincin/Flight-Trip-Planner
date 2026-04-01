import apiClient from './client';
import type { AirportFeatureProps, CountryAirport } from '../types';
import type { FeatureCollection, Point } from 'geojson';

export const getAirportsGeoJSON = (lang = 'en'): Promise<FeatureCollection<Point, AirportFeatureProps>> =>
  apiClient.get('/airports/geojson', { params: { lang } }).then(r => r.data);

export const getAirportsByCountry = (countryCode: string, lang = 'en'): Promise<CountryAirport[]> =>
  apiClient.get(`/airports/by-country/${countryCode}`, { params: { lang } }).then(r => r.data.data);
