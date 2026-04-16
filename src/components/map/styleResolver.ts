/**
 * MODUŁ ROZWIĄZYWANIA STYLÓW (styleResolver.ts)
 * Zarządza mapowaniem symbolicznych nazw stylów na konkretne URL-e oraz
 * implementuje logikę transformacji zapytań dla usług ArcGIS.
 * 
 * Mechanizm ten pozwala na bezpieczne użycie statycznych plików JSON stylu.
 */

import maplibregl from 'maplibre-gl';
import { MAP_STYLES, isArcGISUrl } from '../../constants/mapStyles';

export const ARCGIS_API_KEY = (import.meta as any).env.VITE_ARCGIS_API_KEY ?? '';

export const LOCAL_STYLE_IDS = new Set(Object.values(MAP_STYLES));

export function isLocalStyleId(style: string): boolean {
  return LOCAL_STYLE_IDS.has(style as any);
}

/**
 * Zwraca URL do lokalnego, spatchowanego pliku JSON stylu.
 */
export function getLocalStyleUrl(styleId: string, globeMode: boolean): string {
  const suffix = globeMode ? "_globe" : "";
  return `/data/styles/${styleId}${suffix}.json`;
}

/** Transformacja zapytań ArcGIS. */
export function arcGISTransformRequest(url: string, _resourceType?: string): { url: string } {
  if (!url || typeof url !== 'string') return { url: url || '' };

  // 1. Obsługa placeholderów
  if (url.includes('{{ARCGIS_API_KEY}}')) {
    return { url: url.replace(/{{ARCGIS_API_KEY}}/g, ARCGIS_API_KEY) };
  }

  // 2. Obsługa bezpośrednich żądań do usług ArcGIS (Kafelki/WFS)
  const isArcGIS = url.includes('arcgis.com') || (typeof isArcGISUrl === 'function' && isArcGISUrl(url));
  if (isArcGIS && ARCGIS_API_KEY && !url.includes('token=')) {
    const separator = url.includes('?') ? '&' : '?';
    return { url: `${url}${separator}token=${ARCGIS_API_KEY}` };
  }

  return { url };
}



export const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': 'rgba(0,0,0,0)' }
    }
  ],
};

/**
 * ROZWIĄZYWANIE MODULARNE (Bez transformacji):
 * Zwraca URL do lokalnego pliku JSON zamiast budować obiekt w pamięci.
 */
export function resolveMapStyle(style: string, globeMode: boolean): string | maplibregl.StyleSpecification {
  // Mapowanie starych nazw na ArcGIS ID
  if (style === 'Satelita' || style === 'Satelite' || style === 'satellite' || style === 'SATELLITE') {
    style = MAP_STYLES.ARCGIS_IMAGERY;
  }

  // Jeśli to styl lokalny (ArcGIS lub MapLibre), używamy lokalnej kopii
  if (isLocalStyleId(style)) {
    return getLocalStyleUrl(style, globeMode);
  }

  return style;
}
