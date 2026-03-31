import maplibregl from 'maplibre-gl';

/**
 * Adds all route sources and layers to the map.
 * Called once per map style load (from addLayers).
 */
export function setupRouteLayers(map: maplibregl.Map): void {
  // Permanent trip route
  map.addSource('trip-permanent-routes', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'trip-permanent-routes-line',
    type: 'line',
    source: 'trip-permanent-routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#1565C0', 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [3, 2] },
  });

  // Transfer preview (single airport selection)
  map.addSource('transfer-preview-route', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'transfer-preview-route-line',
    type: 'line',
    source: 'transfer-preview-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#1565C0', 'line-width': 3, 'line-opacity': 0.45, 'line-dasharray': [3, 2] },
  });

  // Manual transfer preview (static dashed semi-transparent lines)
  map.addSource('manual-transfer-preview', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'manual-transfer-preview-line',
    type: 'line',
    source: 'manual-transfer-preview',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#9C27B0', 'line-width': 2, 'line-opacity': 0.45, 'line-dasharray': [4, 4] },
  });

  // Animated selected routes
  map.addSource('selected-routes', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'selected-routes',
    type: 'line',
    source: 'selected-routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#b13b6b', '#ed6498'],
      'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 4, 2],
      'line-opacity': 0.8,
    },
  });
}
