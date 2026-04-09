import maplibregl from 'maplibre-gl';

type MapLibreMap = maplibregl.Map;

/**
 * Inicjalizuje źródła i warstwy dla tras (selekcja i podróż).
 * ZERO WASTE: Dodaje tylko jeśli nie istnieją, zapobiegając błędom duplikacji przy przełączaniu stylów.
 */
export const setupRouteLayers = (map: MapLibreMap) => {
  if (!map || !map.isStyleLoaded()) return;

  // 1. ŹRÓDŁA
  const sources = [
    'selected-routes',
    'trip-permanent-routes',
    'manual-transfer-preview'
  ];

  sources.forEach(id => {
    if (!map.getSource(id)) {
      map.addSource(id, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        lineMetrics: true,
      });
    }
  });

  // 2. WARSTWA DLA WYBRANYCH TRAS (Wyszukiwanie/Hover) - LINIA CIĄGŁA
  if (!map.getLayer('selected-routes')) {
    map.addLayer({
      id: 'selected-routes',
      type: 'line',
      source: 'selected-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#3b82f6',
        'line-width': 3,
        'line-opacity': 0.8,
        // Usunięto line-dasharray - teraz linia jest ciągła
      },
    });
  }

  // 3. WARSTWA DLA TRWAŁEJ PODRÓŻY (Główna linia trasy) - LINIA PRZERYWANA
  if (!map.getLayer('trip-permanent-routes')) {
    map.addLayer({
      id: 'trip-permanent-routes',
      type: 'line',
      source: 'trip-permanent-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#10b981',
        'line-width': 4,
        'line-opacity': 0.9,
        'line-dasharray': [0.5, 2], // Linia przerywana dla zatwierdzonej podróży
      },
    });
  }

  // 4. WARSTWA PODGLĄDU PRZESIADEK (Transfer Preview) - LINIA PRZERYWANA
  if (!map.getLayer('manual-transfer-preview')) {
    map.addLayer({
      id: 'manual-transfer-preview',
      type: 'line',
      source: 'manual-transfer-preview',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#f59e0b',
        'line-width': 3,
        'line-opacity': 0.7,
        'line-dasharray': [2, 2], // Linia przerywana dla podglądu
      },
    });
  }
};

/**
 * Bezpiecznie usuwa wszystkie warstwy i źródła tras.
 * Wywoływane przed zmianą stylu, aby zapobiec konfliktom w silniku Placement.
 */
export function removeRouteLayers(map: MapLibreMap): void {
  const routeLayers = [
    'trip-permanent-routes',
    'selected-routes',
    'manual-transfer-preview'
  ];
  const routeSources = [
    'trip-permanent-routes',
    'selected-routes',
    'manual-transfer-preview'
  ];

  routeLayers.forEach(layerId => {
    try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch (e) {}
  });
  routeSources.forEach(sourceId => {
    try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch (e) {}
  });
}
