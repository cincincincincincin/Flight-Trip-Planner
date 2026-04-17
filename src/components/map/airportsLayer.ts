/**
 * WARSTWA LOTNISK
 * Definiuje strukturę warstw GPU z pełną interpolacją rozmiarów i offsetów.
 */

import { airportLabelField, airportHighlightedLabelField, getSafeFontsFromStyle, getLabelPaint, n } from './utils';
import { logger } from '../../utils/logger';

export const AIRPORT_LAYERS_ALL = [
  'airports-circles', 'airports-trip', 'airports-highlighted', 'airports-selected',
  'airports-labels', 'airports-labels-selected',
  'airports-hover-single-circle', 'airports-hover-single-label'
];

export function addAirportsLayer(
  map: maplibregl.Map,
  airports: any,
  styleId: string | undefined,
  lang: string,
  colorState: any
) {
  logger.log("[GPU_INIT] addAirportsLayer rozpoczęte");

  const rawMin = n(colorState?.zoomRangeMin, 1.3);
  const rawMax = n(colorState?.zoomRangeMax, 12.0);
  // ZABEZPIECZENIE: Silnik MapLibre wymaga zMin < zMax dla interpolacji
  const zMin = Math.min(rawMin, rawMax);
  const zMax = Math.max(zMin + 0.001, rawMax);

  try {
    // 1. CZYSZCZENIE
    AIRPORT_LAYERS_ALL.forEach(id => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch (e) { }
    });
    try { if (map.getSource('airports')) map.removeSource('airports'); } catch (e) { }
    try { if (map.getSource('airports-hover-single')) map.removeSource('airports-hover-single'); } catch (e) { }

    // 2. DODANIE ŹRÓDEŁ
    map.addSource('airports', {
      type: 'geojson',
      data: airports,
      generateId: true,
      buffer: 0,
      tolerance: 0
    });
    map.addSource('airports-hover-single', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    // 3. DEFINICJA WARSTW
    const fonts = getSafeFontsFromStyle(map);
    const fontsBold = getSafeFontsFromStyle(map, true);

    // Warstwy kółek (Circles)
    addCircleLayer(map, 'airports-circles', ['all'], colorState, styleId); // General
    addCircleLayer(map, 'airports-trip', ['==', 'code', ''], colorState, styleId);
    addCircleLayer(map, 'airports-highlighted', ['==', 'code', ''], colorState, styleId);
    addCircleLayer(map, 'airports-selected', ['==', 'code', ''], colorState, styleId);

    // WARSTWY ETYKIET
    // Rozdzielamy na dwie warstwy: standardowa (z okluzją) i wybrana (z wymuszonym nakładaniem).
    // Dzięki temu wybrany punkt startowy nigdy nie "zniknie" pod łukami lotów wychodzących.

    // 1. Warstwa wybrana (Selected Only - Z detekcją kolizji)
    addLabelLayer(map, 'airports-labels-selected', ['==', ['get', 'code'], '_NONE_'], fonts, lang, colorState, styleId, false);

    // 2. Warstwa ogólna (Pozostałe - Standardowa okluzja)
    addLabelLayer(map, 'airports-labels', ['all'], fonts, lang, colorState, styleId, false);

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
          'circle-stroke-opacity': 0.9,
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'map'
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
          'text-ignore-placement': true,
          'text-pitch-alignment': 'map'
        },
        paint: {
          'text-color': ['get', 'h_text_color'],
          'text-halo-color': 'rgba(255,255,255,0.95)',
          'text-halo-blur': 0.5
        }
      });
    } catch (e) {
      logger.warn("[GPU_INIT] Warstwy hover już istnieją lub błąd dodawania", e);
    }

    logger.log("[GPU_INIT] addAirportsLayer zakończone sukcesem");
  } catch (err) {
    logger.error("[GPU_INIT] BŁĄD KRYTYCZNY w addAirportsLayer:", err);
  }
}

function addCircleLayer(map: maplibregl.Map, id: string, filter: any, colorState: any, styleId: string | undefined) {
  try {
    const rawMin = n(colorState?.zoomRangeMin, 1.3);
    const rawMax = n(colorState?.zoomRangeMax, 12.0);
    const zMin = Math.min(rawMin, rawMax);
    const zMax = Math.max(zMin + 0.001, rawMax);

    // Inicjalne parametry wizualne
    const isImg = (styleId || '').toLowerCase().includes('imagery');
    const strokeColor = isImg ? '#000000' : '#ffffff';

    // Radii i Kolor
    let radius: any = 4;
    let color: string = '#FF6B6B';

    if (id === 'airports-circles') {
      radius = ['interpolate', ['linear'], ['zoom'], zMin, n(colorState?.generalAirportRadiusMin, 2), zMax, n(colorState?.generalAirportRadiusMax, 8)];
      color = colorState?.generalAirport || '#FF6B6B';
    } else {
      radius = ['interpolate', ['linear'], ['zoom'], zMin, n(colorState?.highlightedAirportRadiusMin, 4), zMax, n(colorState?.highlightedAirportRadiusMax, 16)];
      color = (id === 'airports-trip') ? (colorState?.tripAirport || '#000000') : (colorState?.destinationAirport || '#4CAF50');
    }

    map.addLayer({
      id, type: 'circle', source: 'airports',
      filter,
      paint: {
        'circle-radius': radius,
        'circle-color': color,
        'circle-stroke-width': 1.0,
        'circle-stroke-color': strokeColor,
        'circle-opacity': 1.0,
        'circle-pitch-alignment': 'map',
        'circle-pitch-scale': 'map'
      }
    });
  } catch (e) { logger.warn(`[GPU_INIT] Nie udało się dodać kółka: ${id}`, e); }
}

function addLabelLayer(
  map: maplibregl.Map, id: string, filter: any, fonts: string[], lang: string,
  colorState: any, styleId: string | undefined, forceOverlap: boolean = false
) {
  try {
    const rawMin = n(colorState?.zoomRangeMin, 1.3);
    const rawMax = n(colorState?.zoomRangeMax, 12.0);
    const zMin = Math.min(rawMin, rawMax);
    const zMax = Math.max(zMin + 0.001, rawMax);
    const labelPaint = getLabelPaint(styleId);

    const fontsRegular = fonts; // ['Noto Sans Regular']
    const fontsBold = getSafeFontsFromStyle(map, true); // ['Noto Sans Bold']

    const layout: any = {
      'text-field': ['get', 'cl_high'],
      
      // Dynamiczna czcionka w warstwach jest niestabilna przy braku glifów. MapLibre próbuje 
      // rzutować wyrażenie logiczne przy tworzeniu lokalnego canvas i wywala awarię (type: 3).
      // Zamiast tego używamy statycznej reguły per warstwa.
      'text-font': id === 'airports-labels-selected' ? ['literal', fontsBold] : ['literal', fontsRegular],

      'text-justify': 'center',
      'text-allow-overlap': forceOverlap,
      'text-ignore-placement': forceOverlap,
      'text-padding': 4.0,

      // Ścisły priorytet wyświetlania
      'symbol-sort-key': ['-', 1000, ['coalesce', ['get', 'rank'], 0]],

      'text-pitch-alignment': 'map',
      'symbol-avoid-edges': false,

      // Wielkość płynnie dopasowana
      'text-size': 12,
      'text-offset': [0, 1.3],
      'text-anchor': 'top'
    };

    // Kolor dziedziczony przez miasto
    const textColor = labelPaint.textColor;

    map.addLayer({
      id, type: 'symbol', source: 'airports', filter, layout,
      paint: {
        'text-color': textColor,
        'text-halo-color': labelPaint.haloColor,
        'text-halo-width': labelPaint.haloWidth,
        'text-halo-blur': 0.5
      }
    });
  } catch (e) { logger.warn(`[GPU_INIT] Nie udało się dodać etykiety: ${id}`, e); }
}
