import type { AirportFeatureProps, Airport } from '../types';
import type { FeatureCollection, Point, Feature } from 'geojson';

export interface Metadata {
  airportFeaturesMap: Record<string, Feature<Point, AirportFeatureProps>>;
  coordsMap: Record<string, [number, number]>;
  cityMap: Record<string, string>;
  countryMap: Record<string, string>;
  cityLabelCodes: string[];
  cityLabelCodeByCity: Record<string, string>;
  airportCityMap: Record<string, string[]>;
  countryAirportsMap: Record<string, string[]>;
}

export interface SearchIndex {
  names: Record<string, string>;
  cityInfo: Record<string, { name: string; country_code: string; airportCount: number }>;
  countryInfo: Record<string, { 
    name: string; 
    lon: number; 
    lat: number; 
    bbox: [number, number, number, number]; 
    airportCount: number 
  }>;
  searchIndex: Record<string, {
    name: string;
    n: string;
    cities: Record<string, {
      name: string;
      n: string;
      airports: Airport[];
    }>;
  }>;
  iataMap: Record<string, Airport>;
}

export const getMetadata = async (): Promise<Metadata> => {
  const res = await fetch('/data/metadata.json');
  return res.json();
};

export const getSearchIndex = async (lang = 'en'): Promise<SearchIndex> => {
  const res = await fetch('/data/search.json');
  const all = await res.json();
  return all[lang];
};

export const getAirportsGeoJSON = async (): Promise<FeatureCollection<Point, AirportFeatureProps>> => {
  const res = await fetch('/data/airports.geojson');
  return res.json();
};
