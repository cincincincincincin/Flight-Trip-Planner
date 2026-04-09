/**
 * KONFIGURACJA WARSTW LOTNISK (airportsLayer.ts)
 * Zarządza definicjami warstw MapLibre dla punktów (circles) i etykiet (symbols).
 * Implementuje zaawansowany system hierarchii (sort-key), zapewniający czytelność
 * przy gęstym rozmieszczeniu lotnisk w Europie i Azji.
 */

import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { AirportFeatureProps } from '../../types';
import { getLabelPaint } from './utils';
import { THEME_COLORS } from '../../constants/theme';
import { CONFIG } from '../../constants/config';

/** Kolejność warstw etykiet zapewniająca poprawne nadpisywanie się (Z-Index) */
export const AIRPORT_LABEL_LAYERS = [
  'airports-labels-normal',
  'airports-labels-normal-city',
  'airports-labels-highlighted-city',
  'airports-labels-highlighted',
  'airports-labels-hover-general',
  'airports-labels-hover',
] as const;

export function airportLabelField(lang: string): maplibregl.ExpressionSpecification {
  return ['get', `name_${lang}`] as maplibregl.ExpressionSpecification;
}

export function airportCityLabelField(lang: string): maplibregl.ExpressionSpecification {
  return ['coalesce', ['get', `city_name_${lang}`], ['get', `name_${lang}`]] as maplibregl.ExpressionSpecification;
}

/**
 * Sprawdza aktualny styl mapy i zwraca bezpieczny stos czcionek.
 * Zapobiega to błędowi 'Unimplemented type: 3' poprzez użycie czcionek
 * gwarantowanych przez serwer glifów danego stylu.
 */
function getSafeFontsFromStyle(map: MapLibreMap, bold: boolean): string[] {
  const style = map.getStyle();
  const glyphsUrl = style.glyphs || '';

  // Jeśli styl pochodzi z ArcGIS (Esri)
  if (glyphsUrl.includes('arcgis.com')) {
    return bold ? ["Arial Bold"] : ["Arial Regular"];
  }

  // Jeśli styl pochodzi z MapLibre Demotiles (np. Light)
  // Na podstawie analizy MapLibre_Light_globe.json wiemy, że używa on Open Sans Semibold
  return ["Open Sans Semibold"];
}

/**
 * Główna funkcja inicjalizująca warstwę lotnisk.
 * Obsługuje zarówno pierwsze dodanie źródła, jak i reaktywną aktualizację danych (setData).
 */
export function addAirportsLayer(
  map: MapLibreMap,
  data: FeatureCollection<Point, AirportFeatureProps>,
  currentMapStyle: string,
  lang = 'en',
  sessionId?: number
) {
  if (!map) {
    console.warn('[RACE-DEBUG] {airportsLayer} -> ABORT | Reason: map is null');
    return;
  }
  if (!map.getStyle()) {
     console.warn(`[RACE-DEBUG] {airportsLayer} -> ABORT [sess:${sessionId}] | Reason: style object missing`);
     return;
  }
  if (!data) {
    console.warn(`[RACE-DEBUG] {airportsLayer} -> ABORT [sess:${sessionId}] | Reason: data (GeoJSON) is missing`);
    return;
  }

  console.log(`[RACE-DEBUG] {airportsLayer} -> PROCESSING [sess:${sessionId}] | Features: ${data.features.length}, Style: ${currentMapStyle}`);

  const labelPaint = getLabelPaint(currentMapStyle);
  const strokeColor = labelPaint.circleStrokeColor;

  const source = map.getSource('airports') as maplibregl.GeoJSONSource | undefined;
  if (!source) {
    console.log('addAirportsLayer: adding new source "airports"');
    // Pierwsza inicjalizacja źródła - optymalizacja pod kątem wydajności (buffer: 0)
    map.addSource('airports', { 
      type: 'geojson', 
      data,
      tolerance: 0,
      buffer: 0,
      maxzoom: 12
    });
  } else {
    console.log('addAirportsLayer: updating existing source data');
    // Szybka aktualizacja bez przebudowy całego stylu (Zero-Waste)
    source.setData(data);
  }

  // Idempotentna inicjalizacja warstw - zapobiega duplikatom przy przełączaniu stylów
  const layers = [
    {
      id: 'airports-circles',
      type: 'circle',
      source: 'airports',
      paint: {
        'circle-radius': CONFIG.MAP_AIRPORT_LAYER.RADIUS_TINY,
        'circle-color': THEME_COLORS.cRose,
        'circle-stroke-width': 1,
        'circle-stroke-color': strokeColor
      }
    },
    {
      id: 'airports-trip',
      type: 'circle',
      source: 'airports',
      filter: ['in', 'code', ''],
      paint: {
        'circle-radius': CONFIG.MAP_AIRPORT_LAYER.RADIUS_SMALL,
        'circle-color': THEME_COLORS.textBlack,
        'circle-stroke-width': 1,
        'circle-stroke-color': strokeColor
      }
    },
    {
      id: 'airports-highlighted',
      type: 'circle',
      source: 'airports',
      filter: ['in', 'code', ''],
      paint: {
        'circle-radius': CONFIG.MAP_AIRPORT_LAYER.RADIUS_SMALL,
        'circle-color': THEME_COLORS.accent,
        'circle-stroke-width': 1,
        'circle-stroke-color': strokeColor
      }
    },
    {
      id: 'airports-hover',
      type: 'circle',
      source: 'airports',
      filter: ['==', 'code', ''],
      paint: {
        'circle-radius': CONFIG.MAP_AIRPORT_LAYER.RADIUS_MEDIUM,
        'circle-color': THEME_COLORS.red,
        'circle-stroke-width': 2,
        'circle-stroke-color': strokeColor,
        'circle-radius-transition': { duration: 0 },
        'circle-color-transition': { duration: 0 },
        'circle-stroke-width-transition': { duration: 0 },
        'circle-opacity-transition': { duration: 0 },
      }
    },
    {
      id: 'airports-selected',
      type: 'circle',
      source: 'airports',
      filter: ['==', 'code', ''],
      paint: {
        'circle-radius': CONFIG.MAP_AIRPORT_LAYER.RADIUS_MEDIUM,
        'circle-color': THEME_COLORS.textBlack,
        'circle-stroke-width': 2,
        'circle-stroke-color': strokeColor
      }
    },
    {
      id: 'airports-route-hover',
      type: 'circle',
      source: 'airports',
      filter: ['==', 'code', ''],
      paint: {
        'circle-radius': CONFIG.MAP_AIRPORT_LAYER.RADIUS_LARGE,
        'circle-color': THEME_COLORS.cGold,
        'circle-stroke-width': 2,
        'circle-stroke-color': strokeColor
      }
    },
    {
      id: 'airports-labels-normal',
      type: 'symbol',
      source: 'airports',
      minzoom: 5,
      layout: {
        'text-field': airportLabelField(lang),
        'text-size': CONFIG.MAP_AIRPORT_LAYER.TEXT_SMALL,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-max-width': 8,
        'text-font': getSafeFontsFromStyle(map, false),
        'symbol-sort-key': 1,
      },
      paint: {
        'text-color': labelPaint.textColor,
        'text-halo-color': labelPaint.haloColor,
        'text-halo-width': labelPaint.haloWidth
      }
    },
    {
      id: 'airports-labels-normal-city',
      type: 'symbol',
      source: 'airports',
      maxzoom: 5,
      filter: ['in', 'code', ''],
      layout: {
        'text-field': airportCityLabelField(lang),
        'text-size': CONFIG.MAP_AIRPORT_LAYER.TEXT_MEDIUM,
        'text-font': getSafeFontsFromStyle(map, false),
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-max-width': 8,
        'symbol-sort-key': 1,
      },
      paint: {
        'text-color': labelPaint.textColor,
        'text-halo-color': labelPaint.haloColor,
        'text-halo-width': labelPaint.haloWidth
      }
    },
    {
      id: 'airports-labels-highlighted-city',
      type: 'symbol',
      source: 'airports',
      maxzoom: 5,
      filter: ['in', 'code', ''],
      layout: {
        'text-field': airportCityLabelField(lang),
        'text-size': CONFIG.MAP_AIRPORT_LAYER.TEXT_LARGE,
        'text-font': getSafeFontsFromStyle(map, true),
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-max-width': 8,
        'symbol-sort-key': 2,
      },
      paint: {
        'text-color': labelPaint.textColor,
        'text-halo-color': labelPaint.haloColor,
        'text-halo-width': labelPaint.haloWidth
      }
    },
    {
      id: 'airports-labels-highlighted',
      type: 'symbol',
      source: 'airports',
      minzoom: 5,
      filter: ['in', 'code', ''],
      layout: {
        'text-field': airportLabelField(lang),
        'text-size': CONFIG.MAP_AIRPORT_LAYER.TEXT_LARGE,
        'text-font': getSafeFontsFromStyle(map, true),
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-max-width': 8,
        'symbol-sort-key': 2,
      },
      paint: {
        'text-color': labelPaint.textColor,
        'text-halo-color': labelPaint.haloColor,
        'text-halo-width': labelPaint.haloWidth
      }
    },
    {
      id: 'airports-labels-hover-general',
      type: 'symbol',
      source: 'airports',
      filter: ['==', 'code', ''],
      layout: {
        'text-field': airportLabelField(lang),
        'text-size': CONFIG.MAP_AIRPORT_LAYER.TEXT_LARGE,
        'text-font': getSafeFontsFromStyle(map, true),
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-max-width': 8,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'symbol-sort-key': 3,
      },
      paint: {
        'text-color': THEME_COLORS.textBlack,
        'text-halo-color': labelPaint.haloColor,
        'text-halo-width': 1.5,
        'text-opacity-transition': { duration: 0 },
        'text-color-transition': { duration: 0 },
      }
    },
    {
      id: 'airports-labels-hover',
      type: 'symbol',
      source: 'airports',
      filter: ['==', 'code', ''],
      layout: {
        'text-field': airportLabelField(lang),
        'text-size': CONFIG.MAP_AIRPORT_LAYER.TEXT_LARGE,
        'text-font': getSafeFontsFromStyle(map, true),
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-max-width': 8,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'symbol-sort-key': 3,
      },
      paint: {
        'text-color': THEME_COLORS.cGold,
        'text-halo-color': labelPaint.haloColor,
        'text-halo-width': 1.5,
        'text-opacity-transition': { duration: 0 },
        'text-color-transition': { duration: 0 },
      }
    }
  ];

  layers.forEach((layerDef) => {
    const layerId = layerDef.id;
    const existing = map.getLayer(layerId);
    
    if (!existing) {
      try {
        map.addLayer(layerDef as any);

        // Rejestracja zdarzeń kursora - wykonywana tylko raz przy tworzeniu warstwy
        const cursorLayers = ['airports-hover', 'airports-circles', 'airports-trip', 'airports-highlighted', 'airports-selected'];
        if (cursorLayers.includes(layerId)) {
          map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
          });
        }
      } catch (err) {
        console.error(`addAirportsLayer: error adding layer ${layerId}`, err);
      }
    } else {
      // ZERO WASTE: Synchronizacja stylów tylko gdy warstwa już istnieje
      // Skip updates if paint properties haven't changed (MapLibre optimization)
      if (layerDef.paint) {
        Object.entries(layerDef.paint).forEach(([key, val]) => {
          try {
            // map.setPaintProperty handles internal diffing, but we can avoid the call if we track state
            map.setPaintProperty(layerId, key, val);
          } catch (err) {
            console.warn(`addAirportsLayer: warning updating ${key} for ${layerId}`, err);
          }
        });
      }
    }
  });

  // GWARANCJA WIDOCZNOŚCI (Z-Index Fix): Przesunięcie warstw na wierzch tylko jeśli to konieczne
  // W MapLibre moveLayer bez drugiego argumentu przesuwa na samą górę.
  // Zrobimy to tylko raz dla całego zestawu by nie thrashować silnika.
  const lastLayer = layers[layers.length - 1].id;
  if (map.getLayer(lastLayer)) {
    try {
      map.moveLayer(lastLayer);
      // Przesuwamy resztę względem ostatniej by zachować kolejność wewnętrzną
      for (let i = layers.length - 2; i >= 0; i--) {
        map.moveLayer(layers[i].id, layers[i+1].id);
      }
    } catch (e) { /* ignore */ }
  }

  console.log('addAirportsLayer: finished processing all layers');
}

/**
 * Bezpiecznie usuwa wszystkie warstwy i źródła lotnisk.
 * Wywoływane przed zmianą stylu, aby zapobiec konfliktom w silniku Placement.
 */
export function removeAirportsLayer(map: MapLibreMap) {
  const airportLayers = [
    ...AIRPORT_LABEL_LAYERS,
    'airports-circles',
    'airports-trip',
    'airports-highlighted',
    'airports-selected',
    'airports-hover',
    'airports-route-hover'
  ];

  airportLayers.forEach(layerId => {
    try {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    } catch (e) {
      console.warn(`[RACE-DEBUG] {airportsLayer} -> removeLayer FAIL | Layer: ${layerId}`, e);
    }
  });

  try {
    if (map.getSource('airports')) map.removeSource('airports');
  } catch (e) {
    console.warn('removeAirportsLayer: could not remove source "airports"', e);
  }
}
