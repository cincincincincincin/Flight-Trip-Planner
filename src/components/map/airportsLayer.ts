/**
 * WARSTWA LOTNISK (airportsLayer.ts - WERSJA ATOMYCZNA v9.2)
 * 
 * Definiuje strukturę warstw GPU z pełną interpolacją rozmiarów i offsetów.
 * Warstwa HOVER jest umieszczona na samym szczycie dla idealnej widoczności.
 */

import maplibregl from 'maplibre-gl';
import { airportLabelField, getSafeFontsFromStyle } from './utils';

export const AIRPORT_LAYERS_ALL = [
  'airports-circles', 'airports-trip', 'airports-highlighted', 'airports-selected',
  'airports-labels-normal', 'airports-labels-highlighted',
  'airports-hover-single-circle', 'airports-hover-single-label'
];

export function addAirportsLayer(
  map: maplibregl.Map,
  airports: any,
  styleId: string | undefined,
  lang: string
) {
  console.log("[GPU_INIT] addAirportsLayer started");
  const zMin = 1.3;
  const zMax = 12.0;

  try {
    // 1. BEZPIECZNE CZYSZCZENIE (v10.8)
    AIRPORT_LAYERS_ALL.forEach(id => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch(e) {}
    });
    try { if (map.getSource('airports')) map.removeSource('airports'); } catch(e) {}
    try { if (map.getSource('airports-hover-single')) map.removeSource('airports-hover-single'); } catch(e) {}

    // 2. DODANIE ŹRÓDEŁ
    map.addSource('airports', {
      type: 'geojson',
      data: airports,
      generateId: true
    });
    map.addSource('airports-hover-single', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    // 3. DEFINICJA WARSTW
    const fonts = getSafeFontsFromStyle(map);
    const fontsBold = getSafeFontsFromStyle(map, true);

    // Warstwy kółek (Circles)
    addCircleLayer(map, 'airports-circles', ['all']); // General
    addCircleLayer(map, 'airports-trip', ['==', 'code', '']);
    addCircleLayer(map, 'airports-highlighted', ['==', 'code', '']);
    addCircleLayer(map, 'airports-selected', ['==', 'code', '']);

    // Warstwy etykiet (Symbols)
    addLabelLayer(map, 'airports-labels-normal', ['all'], fonts, lang);
    addLabelLayer(map, 'airports-labels-highlighted', ['==', 'code', ''], fontsBold, lang);

    // 4. WARSTWY HOVER (Na szczycie)
    try {
      map.addLayer({
        id: 'airports-hover-single-circle',
        type: 'circle',
        source: 'airports-hover-single',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], zMin, ['get', 'h_r_min'], zMax, ['get', 'h_r_max']],
          'circle-color': ['get', 'h_color'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.9
        }
      });
  
      map.addLayer({
        id: 'airports-hover-single-label',
        type: 'symbol',
        source: 'airports-hover-single',
        layout: {
          'text-field': airportLabelField(lang, false),
          'text-font': fontsBold,
          'text-size': ['interpolate', ['linear'], ['zoom'], zMin, ['get', 'h_f_min'], zMax, ['get', 'h_f_max']],
          'text-anchor': 'top',
          'text-offset': ['interpolate', ['linear'], ['zoom'], zMin, ['get', 'h_off_n'], zMax, ['get', 'h_off_f']],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': ['get', 'h_text_color'],
          'text-halo-color': 'rgba(255,255,255,0.95)',
          'text-halo-width': 2.0
        }
      });
    } catch (e) {
      console.warn("[GPU_INIT] Hover layers already exist or failed to add", e);
    }

    console.log("[GPU_INIT] addAirportsLayer finished successfully");
  } catch (err) {
    console.error("[GPU_INIT] CRITICAL ERROR in addAirportsLayer:", err);
  }
}

function addCircleLayer(map: maplibregl.Map, id: string, filter: any) {
  try {
    map.addLayer({
      id, type: 'circle', source: 'airports',
      filter,
      paint: {
        'circle-stroke-width': 1.0,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 1.0
      }
    });
  } catch (e) { console.warn(`[GPU_INIT] Failed to add circle: ${id}`, e); }
}

function addLabelLayer(map: maplibregl.Map, id: string, filter: any, fonts: string[], lang: string) {
  try {
    map.addLayer({
      id, type: 'symbol', source: 'airports',
      filter,
      layout: {
        'text-field': airportLabelField(lang, true),
        'text-font': fonts,
        'text-anchor': 'top',
        'text-justify': 'center',
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-padding': 2
      },
      paint: {
        'text-halo-color': 'rgba(255,255,255,0.95)',
        'text-halo-width': 1.5,
        'text-halo-blur': 0.5
      }
    });
  } catch (e) { console.warn(`[GPU_INIT] Failed to add label: ${id}`, e); }
}
