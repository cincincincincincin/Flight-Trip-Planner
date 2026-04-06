import type { AirportFeatureProps } from '../types';
import type { FeatureCollection, Point } from 'geojson';

export interface InitData {
  geojson: FeatureCollection<Point, AirportFeatureProps>;
  country_centers: Record<string, { lon: number; lat: number; airport_count: number }>;
}

export const getInitData = async (_lang = 'en'): Promise<InitData> => {
  const [geojson, country_centers] = await Promise.all([
    fetch('/airports.geojson').then(r => r.json()),
    fetch('/countries.json').then(r => r.json()),
  ]);
  return { geojson, country_centers };
};
