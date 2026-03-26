import apiClient from './client';
import type { AirportFeatureProps, CityFeatureProps, RouteFeatureProps, CountryAirport } from '../types';
import type { FeatureCollection, Point, LineString } from 'geojson';

export const getAirportsGeoJSON = (lang = 'en'): Promise<FeatureCollection<Point, AirportFeatureProps>> =>
  apiClient.get('/airports/geojson', { params: { lang } }).then(r => r.data);

export const getCitiesGeoJSON = (lang = 'en'): Promise<FeatureCollection<Point, CityFeatureProps>> =>
  apiClient.get('/cities/geojson', { params: { lang } }).then(r => r.data);

/*
export const getRoutesGeoJSON = (): Promise<FeatureCollection<LineString, RouteFeatureProps>> =>
  apiClient.get('/routes/geojson').then(r => r.data);

export const getRoute = (id: string | number): Promise<RouteFeatureProps> =>
  apiClient.get(`/routes/${id}`).then(r => r.data);
*/

export const getAirportsByCountry = (countryCode: string, lang = 'en'): Promise<CountryAirport[]> =>
  apiClient.get(`/airports/by-country/${countryCode}`, { params: { lang } }).then(r => r.data.data);
