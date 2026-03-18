import apiClient from './client';
import type { AirportFeatureProps, CityFeatureProps, RouteFeatureProps, CountryAirport } from '../types';
import type { FeatureCollection, Point, LineString } from 'geojson';

export const getAirportsGeoJSON = (): Promise<FeatureCollection<Point, AirportFeatureProps>> =>
  apiClient.get('/airports/geojson', { params: { flightable_only: true } }).then(r => r.data);

export const getCitiesGeoJSON = (): Promise<FeatureCollection<Point, CityFeatureProps>> =>
  apiClient.get('/cities/geojson', { params: { has_airport_only: true } }).then(r => r.data);

export const getRoutesGeoJSON = (): Promise<FeatureCollection<LineString, RouteFeatureProps>> =>
  apiClient.get('/routes/geojson').then(r => r.data);

export const getRoute = (id: string | number): Promise<RouteFeatureProps> =>
  apiClient.get(`/routes/${id}`).then(r => r.data);

export const getAirportsByCountry = (countryCode: string): Promise<CountryAirport[]> =>
  apiClient.get(`/airports/by-country/${countryCode}`).then(r => r.data.data);
