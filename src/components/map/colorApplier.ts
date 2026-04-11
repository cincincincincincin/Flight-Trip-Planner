/**
 * APLIKACJA KOLORÓW I ROZMIARÓW (colorApplier.ts - ATOMYCZNA SYNCHRONIZACJA v9.2)
 * 
 * Zarządza statycznymi stanami priorytetowymi (Selected > Dest > Trip > General).
 * Wykorzystuje Guarded Filters, aby nie nadpisywać okluzji wstrzykiwanych przez Heartbeata.
 */

import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { getLabelPaint, mergeFilterConditions } from './utils';

export function applyMapColors(
  map: MapLibreMap,
  extra: {
    selectedAirportCodes: string[];
    tripVisibleAirportCodes: string[] | null;
    highlightedAirports: string[];
    manualTransferAirportCodes: string[];
    explorationAirportCodes: string[];
    selectedAirportCode: string | null;
    highlightedLabelCodes: string[];
    colorState: any; // Dynamiczny stan ze store'a
    hoveredAirportCode: string | null;
  }
) {
  if (!map || !(map as any).getStyle()) return;

  const { colorState, hoveredAirportCode } = extra;
  const styleId = (map as any)._appliedUrl || '';
  const labelPaint = getLabelPaint(styleId);

  console.group(`[GPU_SYNC] Version 11.7 - Style: ${styleId}`);
  console.log("[GPU_SYNC] Applying State:", colorState, "Hovered:", hoveredAirportCode);

  // 1. POMOCNIK OKLUZJI (v11.7): Każdy filtr jest automatycznie rozszerzany o wykluczenie hovera
  const wrapOcclusion = (filter: any) => {
    if (!hoveredAirportCode) return filter;
    return ['all', ['!=', ['get', 'code'], hoveredAirportCode], filter];
  };

  const safeSetFilter = (id: string, filter: any) => {
    try {
      if (!map.getLayer(id)) return;
      map.setFilter(id, wrapOcclusion(filter));
    } catch (err) { console.error(`Layer ERROR (Filter): ${id}`, err); }
  };

  // Helper dla bezpiecznych liczb (v10.6+)
  const n = (v: any, fallback: number): number => {
    const num = Number(v);
    return isNaN(num) ? fallback : num;
  };

  // 1. ZASIĘG ZOOM (TWARDE LIMITY) - v11.8
  let zMin = n(colorState?.zoomRangeMin, 1.3);
  let zMax = n(colorState?.zoomRangeMax, 12);
  if (zMin >= zMax) zMax = zMin + 1;

  // Aplikujemy hard-limits do obiektu mapy
  try {
    map.setMinZoom(zMin);
    map.setMaxZoom(zMax);
  } catch (e) {
    console.warn("[GPU_SYNC] Failed to set hard zoom limits", e);
  }

  const cDest = colorState?.destinationAirport || '#4CAF50';
  const cTrip = colorState?.tripAirport || '#000000';
  const cSelected = colorState?.tripAirport || '#000000'; // Fallback dla wybranych
  
  const zooLayers = [
    'airports-circles', 'airports-trip', 'airports-highlighted', 'airports-selected',
    'airports-labels-normal', 'airports-labels-highlighted'
  ];
  zooLayers.forEach(id => {
    if (map.getLayer(id)) {
      (map as any).setLayerZoomRange(id, 0, 24); // Odblokowujemy widoczność wewnątrz warstwy (mapa trzyma limit)
    }
  });

  // 2. PARAMETRY ROZMIARÓW (DYN.)
  const rGen = ['interpolate', ['linear'], ['zoom'], zMin, n(colorState?.generalAirportRadiusMin, 2), zMax, n(colorState?.generalAirportRadiusMax, 8)];
  const rHigh = ['interpolate', ['linear'], ['zoom'], zMin, n(colorState?.highlightedAirportRadiusMin, 4), zMax, n(colorState?.highlightedAirportRadiusMax, 16)];
  const fGen = ['interpolate', ['linear'], ['zoom'], zMin, n(colorState?.generalAirportLabelSizeMin, 10), zMax, n(colorState?.generalAirportLabelSizeMax, 14)];
  const fHigh = ['interpolate', ['linear'], ['zoom'], zMin, n(colorState?.highlightedLabelSizeMin, 12), zMax, n(colorState?.highlightedLabelSizeMax, 18)];

  // 3. KOLORY WYBRANYCH (v11.1)
  const sac = (extra.selectedAirportCodes || []).map(c => c.toUpperCase());
  const selectedPairs: any[] = [];
  sac.forEach((code, i) => {
    const color = colorState?.startPoints?.[i]?.airport || '#000000';
    selectedPairs.push(code, color);
  });
  const cSelectedExpr = selectedPairs.length > 0 ? ['match', ['get', 'code'], ...selectedPairs, '#000000'] : '#000000';


  // --- 4. APLIKACJA STYLU KROPEK ---
  const applyPointStyle = (id: string, r: any, c: any) => {
    if (map.getLayer(id)) {
      map.setPaintProperty(id, 'circle-radius', r);
      map.setPaintProperty(id, 'circle-color', c);
      map.setPaintProperty(id, 'circle-opacity', 1);
      map.setLayoutProperty(id, 'visibility', 'visible');
    }
  };

  applyPointStyle('airports-circles', rGen, colorState?.generalAirport || '#FF6B6B');
  applyPointStyle('airports-trip', rHigh, cTrip);
  applyPointStyle('airports-highlighted', rHigh, cDest);
  applyPointStyle('airports-selected', rHigh, cSelectedExpr);

  // --- 5. APLIKACJA STYLU ETYKIET (v11.8) ---
  const destLabelC = colorState?.destinationLabelColor || labelPaint.textColor;
  const tripLabelC = colorState?.tripLabelColor || labelPaint.textColor;
  const ha = (extra.highlightedAirports || []).map(c => c.toUpperCase());
  const tvac = (extra.tripVisibleAirportCodes || []).map(c => c.toUpperCase());

  const highlightedLabelPairs: any[] = [];
  sac.forEach((code, i) => {
    const color = colorState?.startPoints?.[i]?.label || labelPaint.textColor;
    highlightedLabelPairs.push(code, color);
  });
  tvac.forEach(code => { if (!sac.includes(code)) highlightedLabelPairs.push(code, tripLabelC); });
  ha.forEach(code => { if (!sac.includes(code) && !tvac.includes(code)) highlightedLabelPairs.push(code, destLabelC); });

  const cHighlightedLabelExpr = highlightedLabelPairs.length > 0
    ? ['match', ['get', 'code'], ...highlightedLabelPairs, labelPaint.textColor]
    : labelPaint.textColor;

  if (map.getLayer('airports-labels-normal')) {
    map.setLayoutProperty('airports-labels-normal', 'text-size', fGen);
    map.setPaintProperty('airports-labels-normal', 'text-color', colorState?.generalLabelColor || labelPaint.textColor);
    map.setLayoutProperty('airports-labels-normal', 'visibility', 'visible');
  }
  if (map.getLayer('airports-labels-highlighted')) {
    map.setLayoutProperty('airports-labels-highlighted', 'text-size', fHigh);
    map.setPaintProperty('airports-labels-highlighted', 'text-color', cHighlightedLabelExpr);
    map.setLayoutProperty('airports-labels-highlighted', 'visibility', 'visible');
  }

  // --- 6. AKTUALIZACJA TRAS ---
  const getLineStyles = (pref: string) => ({
    color: ['case', ['boolean', ['feature-state', 'hover'], false], colorState?.[`${pref}Hover`] || '#2563eb', colorState?.[pref] || '#3b82f6'],
    width: ['interpolate', ['linear'], ['zoom'], zMin, ['case', ['boolean', ['feature-state', 'hover'], false], n(colorState?.[`${pref}HoverWidthMin`], 6), n(colorState?.[`${pref}WidthMin`], 2)], zMax, ['case', ['boolean', ['feature-state', 'hover'], false], n(colorState?.[`${pref}HoverWidthMax`], 15), n(colorState?.[`${pref}WidthMax`], 4)]]
  });

  const tripStyles = getLineStyles('tripRoute');
  if (map.getLayer('trip-permanent-routes')) {
    map.setPaintProperty('trip-permanent-routes', 'line-color', tripStyles.color);
    map.setPaintProperty('trip-permanent-routes', 'line-width', tripStyles.width);
  }

  const globalStyles = getLineStyles('routeLine');
  if (map.getLayer('selected-routes')) {
    map.setPaintProperty('selected-routes', 'line-width', globalStyles.width);
  }

  // --- 7. SYNC FILTRÓW (STABILNY v11.8 - Grupownie Miast) ---
  const mtac = (extra.manualTransferAirportCodes || []).map(c => c.toUpperCase());
  
  const hCodes = [...new Set([...sac, ...ha, ...tvac, ...mtac])];
  
  // Filtr grupowania dla labeli: poniżej zooma 7 tylko is_city_primary
  const labelGroupFilter = [
    'case',
    ['<', ['zoom'], 7.0],
    ['==', ['get', 'is_city_primary'], true],
    true
  ];

  safeSetFilter('airports-selected', ['match', ['get', 'code'], sac.length > 0 ? sac : ['_NONE_'], true, false]);
  safeSetFilter('airports-highlighted', ['match', ['get', 'code'], ha.length > 0 ? ha : ['_NONE_'], true, false]);
  safeSetFilter('airports-trip', ['match', ['get', 'code'], [...tvac, ...mtac].length > 0 ? [...tvac, ...mtac] : ['_NONE_'], true, false]);
  safeSetFilter('airports-circles', ['match', ['get', 'code'], hCodes.length > 0 ? hCodes : ['_NONE_'], false, true]);
  
  // APLIKACJA FILTRÓW DLA LABELI (Z WYKLUCZENIEM DUPLIKATÓW MIAST)
  safeSetFilter('airports-labels-highlighted', ['all', ['match', ['get', 'code'], hCodes.length > 0 ? hCodes : ['_NONE_'], true, false], labelGroupFilter]);
  safeSetFilter('airports-labels-normal', ['all', ['match', ['get', 'code'], hCodes.length > 0 ? hCodes : ['_NONE_'], false, true], labelGroupFilter]);

  console.groupEnd();
  map.triggerRepaint();
}
