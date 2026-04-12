/**
 * APLIKACJA KOLORÓW I ROZMIARÓW (colorApplier.ts - ATOMYCZNA SYNCHRONIZACJA v9.2)
 * 
 * Zarządza statycznymi stanami priorytetowymi (Selected > Dest > Trip > General).
 * Wykorzystuje Guarded Filters, aby nie nadpisywać okluzji wstrzykiwanych przez Heartbeata.
 */

import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { getLabelPaint, isSystemColor, mergeFilterConditions } from './utils';

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
    styleId: string; // JAWNY STYL (v11.46)
  }
) {
  if (!map || !(map as any).getStyle()) return;

  const { colorState, hoveredAirportCode, styleId } = extra;
  const labelPaint = getLabelPaint(styleId);

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
  
  const zooLayers = [
    'airports-circles', 'airports-trip', 'airports-highlighted', 'airports-selected',
    'airports-labels'
  ];
  zooLayers.forEach(id => {
    if (map.getLayer(id)) {
      (map as any).setLayerZoomRange(id, 0, 24); 
    }
  });

  // 2. PARAMETRY ROZMIARÓW (DYN.)
  const rGen = ['interpolate', ['linear'], ['zoom'], zMin, n(colorState?.generalAirportRadiusMin, 2), zMax, n(colorState?.generalAirportRadiusMax, 8)];
  const rHigh = ['interpolate', ['linear'], ['zoom'], zMin, n(colorState?.highlightedAirportRadiusMin, 4), zMax, n(colorState?.highlightedAirportRadiusMax, 16)];
  
  // Etykiety (v13.71)
  const fGen = ['interpolate', ['linear'], ['zoom'], zMin, n(colorState?.generalAirportLabelSizeMin, 10), zMax, n(colorState?.generalAirportLabelSizeMax, 14)];
  const fHigh = ['interpolate', ['linear'], ['zoom'], zMin, n(colorState?.highlightedLabelSizeMin, 12), zMax, n(colorState?.highlightedLabelSizeMax, 18)];

  // 3. KOLORY WYBRANYCH (v13.76: Precyzyjne rozdzielenie Dot vs Label)
  const buildSelectedExpr = (type: 'airport' | 'label', propName: 'la_sel_idx' | 'la_city_sel_idx', fallback: string) => {
    const pairs: any[] = [];
    (colorState?.startPoints || []).forEach((sp: any, i: number) => {
      const color = type === 'airport' ? sp.airport : sp.label;
      if (color) pairs.push(i, color);
    });
    if (pairs.length === 0) return fallback;
    return ['match', ['get', propName], ...pairs, fallback];
  };

  const cSelCircle = buildSelectedExpr('airport', 'la_sel_idx', '#000000');
  const cSelLabel = buildSelectedExpr('label', 'la_sel_idx', labelPaint.textColor);
  const cCitySelCircle = buildSelectedExpr('airport', 'la_city_sel_idx', '#000000');
  const cCitySelLabel = buildSelectedExpr('label', 'la_city_sel_idx', labelPaint.textColor);

  // --- 4. APLIKACJA STYLU KROPEK ---
  const isImg = (styleId || '').toLowerCase().includes('imagery');
  const strokeColor = isImg ? '#000000' : '#ffffff';

  const applyPointStyle = (id: string, r: any, c: any) => {
    if (map.getLayer(id)) {
      map.setPaintProperty(id, 'circle-radius', r);
      map.setPaintProperty(id, 'circle-color', c);
      map.setPaintProperty(id, 'circle-opacity', 1);
      map.setPaintProperty(id, 'circle-stroke-color', strokeColor);
      map.setLayoutProperty(id, 'visibility', 'visible');
    }
  };

  applyPointStyle('airports-circles', rGen, colorState?.generalAirport || '#FF6B6B');
  applyPointStyle('airports-trip', rHigh, cTrip);
  applyPointStyle('airports-highlighted', rHigh, cDest);
  applyPointStyle('airports-selected', rHigh, cSelCircle);

  // --- 5. APLIKACJA STYLU ETYKIET (MASTER LABEL PIPELINE v13.76: Pixel-Perfect Priority) ---
  const destLabelC = colorState?.destinationLabelColor || labelPaint.textColor;
  const tripLabelC = colorState?.tripLabelColor || labelPaint.textColor;
  const genLabelC = colorState?.generalLabelColor || labelPaint.textColor;

  const isSelected = ['get', 'is_selected'];
  const isTrip = ['get', 'is_trip'];
  const isDest = ['get', 'is_high']; 

  const isCitySelected = ['get', 'is_city_selected'];
  const isCityTrip = ['get', 'is_city_trip'];
  const isCityDest = ['get', 'is_city_dest'];

  const textColorExpr: any = [
    'step',
    ['zoom'],
    // Zoom < 7.0: Priorytet na poziomie MIASTA (Grouping)
    ['case',
      isCitySelected, cCitySelLabel,
      isCityDest, destLabelC,
      isCityTrip, tripLabelC,
      genLabelC
    ],
    7.0,
    // Zoom >= 7.0: Priorytet na poziomie KONKRETNEGO LOTNISKA
    ['case',
      isSelected, cSelLabel,
      isDest, destLabelC,
      isTrip, tripLabelC,
      genLabelC
    ]
  ];

  if (map.getLayer('airports-labels')) {
    // Rozmiar: Wyróżnione (Selected/Dest/Trip) zawsze używają Highlighted (v13.76)
    const textSizeExpr: any = [
      'interpolate', ['linear'], ['zoom'],
      zMin, ['case', ['get', 'is_city_high'], n(colorState?.highlightedLabelSizeMin, 12), n(colorState?.generalAirportLabelSizeMin, 10)],
      zMax, ['case', ['get', 'is_high'], n(colorState?.highlightedLabelSizeMax, 18), n(colorState?.generalAirportLabelSizeMax, 14)]
    ];

    map.setLayoutProperty('airports-labels', 'text-size', textSizeExpr);
    map.setPaintProperty('airports-labels', 'text-color', textColorExpr);
    map.setPaintProperty('airports-labels', 'text-halo-color', labelPaint.haloColor);
    map.setPaintProperty('airports-labels', 'text-halo-width', ['case', ['get', 'is_city_high'], 2.5, labelPaint.haloWidth] as any);
    map.setLayoutProperty('airports-labels', 'visibility', 'visible');
  }

  // --- 6. AKTUALIZACJA TRAS (v11.57/58: Multi-source & Hover Fix) ---
  const getLineStyles = (pref: string, isSelection = false) => {
    // 1. Definicja par Kolor -> srcIdx dla trybu Multi-start
    const routeColors: any[] = [];
    const routeHoverColors: any[] = [];
    
    // pref to np. 'transferRoute' (kolory) lub 'routeLine' (szerokości)
    // UWAGA UX: szerokości w store mają klucz 'routeLine', ale kolory 'transferRoute'.
    const colorKey = pref === 'routeLine' ? 'transferRoute' : pref;

    (colorState?.startPoints || []).forEach((sp: any, i: number) => {
      routeColors.push(i, sp.route || colorState?.[colorKey] || '#3b82f6');
      routeHoverColors.push(i, sp.routeHover || colorState?.[`${colorKey}Hover`] || '#2563eb');
    });

    // 2. Kolor bazowy
    const baseColor = isSelection && routeColors.length > 0 
      ? ['match', ['get', 'srcIdx'], ...routeColors, colorState?.[colorKey] || '#3b82f6']
      : colorState?.[colorKey] || '#3b82f6';
    
    // 3. Kolor hover (z użyciem srcIdx dla precyzji w multi-start)
    const hoverColor = isSelection && routeHoverColors.length > 0
      ? ['match', ['get', 'srcIdx'], ...routeHoverColors, colorState?.[`${colorKey}Hover`] || '#2563eb']
      : colorState?.[`${colorKey}Hover`] || '#2563eb';

    return {
      color: ['case', ['boolean', ['feature-state', 'hover'], false], hoverColor, baseColor],
      width: ['interpolate', ['linear'], ['zoom'], zMin, 
        ['case', ['boolean', ['feature-state', 'hover'], false], n(colorState?.[`${pref}HoverWidthMin`], 6), n(colorState?.[`${pref}WidthMin`], 2)], 
        zMax, 
        ['case', ['boolean', ['feature-state', 'hover'], false], n(colorState?.[`${pref}HoverWidthMax`], 15), n(colorState?.[`${pref}WidthMax`], 4)]
      ]
    };
  };

  const tripStyles = getLineStyles('tripRoute', true); 
  if (map.getLayer('trip-permanent-routes')) {
    map.setPaintProperty('trip-permanent-routes', 'line-color', tripStyles.color);
    map.setPaintProperty('trip-permanent-routes', 'line-width', tripStyles.width);
  }

  const globalStyles = getLineStyles('routeLine', true); 
  if (map.getLayer('selected-routes')) {
    map.setPaintProperty('selected-routes', 'line-color', globalStyles.color);
    map.setPaintProperty('selected-routes', 'line-width', globalStyles.width);
  }

  // --- 7. SYNC FILTRÓW (STABILNY v11.8 - Grupownie Miast) ---
  const sac = Array.from(new Set((extra.selectedAirportCodes || []).map(c => c.toUpperCase())));
  const mtac = Array.from(new Set((extra.manualTransferAirportCodes || []).map(c => c.toUpperCase())));
  const eac = Array.from(new Set((extra.explorationAirportCodes || []).map(c => c.toUpperCase())));
  const ha = Array.from(new Set((extra.highlightedAirports || []).map(c => c.toUpperCase())));
  const tvac = Array.from(new Set((extra.tripVisibleAirportCodes || []).map(c => c.toUpperCase())));
  
  const hCodes = Array.from(new Set([...sac, ...ha, ...tvac, ...mtac, ...eac]));
  
  // Filtr grupowania dla labeli: poniżej zooma 7 tylko is_city_primary (v24.20: Flat Logic)
  const labelGroupFilter = [
    'case',
    ['<', ['zoom'], 7.0],
    ['case',
      ['get', 'is_city_dest'], ['get', 'is_city_dest_primary'],
      ['get', 'is_city_trip'], ['get', 'is_city_trip_primary'],
      ['get', 'is_city_primary']
    ],
    true
  ];

  const tripCodes = Array.from(new Set([...tvac, ...mtac]));

  safeSetFilter('airports-selected', ['match', ['get', 'code'], sac.length > 0 ? sac : ['_NONE_'], true, false]);
  safeSetFilter('airports-highlighted', ['match', ['get', 'code'], ha.length > 0 ? ha : ['_NONE_'], true, false]);
  safeSetFilter('airports-trip', ['match', ['get', 'code'], tripCodes.length > 0 ? tripCodes : ['_NONE_'], true, false]);
  safeSetFilter('airports-circles', ['match', ['get', 'code'], hCodes.length > 0 ? hCodes : ['_NONE_'], false, true]);
  
  // APLIKACJA FILTRÓW DLA LABELI (MASTER LABEL PIPELINE v13.42 / v21.65)
  // [ROBUST OCCLUSION]: Rozdzielamy na dwie warstwy, aby Selected (wymuszone nakładanie) 
  // nie dublowało się z warstwą ogólną.
  const isSelectedFilter = ['==', ['get', 'is_selected'], true];
  const notSelectedFilter = ['!=', ['get', 'is_selected'], true];

  // 1. Warstwa ogólna (Pozostałe - Standardowa okluzja)
  safeSetFilter('airports-labels', mergeFilterConditions(labelGroupFilter, notSelectedFilter));
  
  // 2. Warstwa wybrana (Selected Only - Zawsze widoczna)
  safeSetFilter('airports-labels-selected', isSelectedFilter);

  // Synchronizacja stylów dla OBU warstw etykiet (v21.65)
  const labelIds = ['airports-labels', 'airports-labels-selected'];
  labelIds.forEach(id => {
    if (map.getLayer(id)) {
      const textSizeExpr: any = [
        'interpolate', ['linear'], ['zoom'],
        zMin, ['case', ['get', 'is_city_high'], n(colorState?.highlightedLabelSizeMin, 12), n(colorState?.generalAirportLabelSizeMin, 10)],
        zMax, ['case', ['get', 'is_high'], n(colorState?.highlightedLabelSizeMax, 18), n(colorState?.generalAirportLabelSizeMax, 14)]
      ];
      map.setLayoutProperty(id, 'text-size', textSizeExpr);
      map.setPaintProperty(id, 'text-color', textColorExpr);
      map.setPaintProperty(id, 'text-halo-color', labelPaint.haloColor);
      map.setPaintProperty(id, 'text-halo-width', ['case', ['get', 'is_city_high'], 2.5, labelPaint.haloWidth] as any);
      map.setLayoutProperty(id, 'visibility', 'visible');
    }
  });

  map.triggerRepaint();
}
