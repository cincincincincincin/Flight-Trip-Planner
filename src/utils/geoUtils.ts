import { FeatureCollection, Point } from 'geojson';
import { AirportFeatureProps, SelectedItem } from '../types';
import { getLocalizedProp } from './i18n';
import { Language } from '../constants/text';

/**
 * Narzędzia do przetwarzania danych geograficznych. 
 * 
 * ARCHITEKTURA TOTAL SYNERGY: Większość operacji grupowania została przeniesiona
 * do etapu budowania (Python). Poniższe funkcje stanowią lekkie utilities 
 * pomocnicze do obsługi obiektów MapLibre/GeoJSON.
 */

/**
 * Wyciąganie współrzędnych [lon, lat] z różnych formatów (Mapbox/GeoJSON).
 */
export const extractCoords = (item: SelectedItem): { lon: number; lat: number } | null => {
  if (!item || !item.data) return null;

  // Czasem mamy współrzędne bezpośrednio w obiekcie
  if (item.type === 'airport' && item.data.coordinates) {
    return { lon: item.data.coordinates.lon, lat: item.data.coordinates.lat };
  }

  // Fallback dla MapLibre / surowego GeoJSON
  const data = item.data as Record<string, any>;
  const coords = data.coordinates || (data.geometry as any)?.coordinates;

  if (Array.isArray(coords) && coords.length >= 2) {
    return { lon: coords[0], lat: coords[1] };
  }

  return null;
};

/**
 * Zwraca zlokalizowaną nazwę (lotnisko/miasto/kraj) w zależności od typu.
 */
export const getGeoName = (props: AirportFeatureProps, type: 'airport' | 'city' | 'country', lang: Language): string => {
  if (type === 'airport') return getLocalizedProp(props, 'name', lang) || props.code;
  if (type === 'city') return getLocalizedProp(props, 'city_name', lang) || props.city_code || '';
  if (type === 'country') return getLocalizedProp(props, 'country_name', lang) || props.country_code || '';
  return props.code;
};

