/**
 * APLIKACJA KOLORÓW I ROZMIARÓW
 * Zarządza statycznymi stanami priorytetowymi (Selected > Dest > Trip > General).
 */

import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { getLabelPaint, isSystemColor, mergeFilterConditions, safeSetZoomLimits } from './utils';
import { logger } from '../../utils/logger';

export function applyMapColors(
  map: MapLibreMap,
  extra: {
    airportCityKeyMap: Record<string, string>;
    selectedAirportCodes: string[];
    tripVisibleAirportCodes: string[] | null;
    highlightedAirports: string[];
    manualTransferAirportCodes: string[];
    explorationAirportCodes: string[];
    selectedAirportCode: string | null;
    highlightedLabelCodes: string[];
    colorState: any; // Dynamiczny stan ze sklepu
    hoveredAirportCode: string | null;
    previewAirportCode: string | null;
    coordsMap: Record<string, [number, number]>;
    airportCityNamesMap: Record<string, string>; // code.toUpperCase() → cityName
    tripState: any;
    styleId: string; // Identyfikator stylu
    skipLayout?: boolean; // Pomija wszystko poza filtrami labeli gdy zmienił się tylko hover
  }
) {
  if (!map || !(map as any).getStyle()) return;

  const { colorState, hoveredAirportCode, previewAirportCode, coordsMap, tripState, styleId, skipLayout = false } = extra;

  const safeSetFilter = (id: string, filter: any) => {
    try {
      if (!map.getLayer(id)) return;
      map.setFilter(id, filter);
    } catch (err) { logger.error(`BŁĄD warstwy (Filtr): ${id}`, err); }
  };

  // Minimalne obliczenia potrzebne zawsze (dla filtrów labeli)
  const sac = Array.from(new Set((extra.selectedAirportCodes || []).map(c => c.toUpperCase())));
  const mtac = Array.from(new Set((extra.manualTransferAirportCodes || []).map(c => c.toUpperCase())));
  const eac = Array.from(new Set((extra.explorationAirportCodes || []).map(c => c.toUpperCase())));
  const ha = Array.from(new Set((extra.highlightedAirports || []).map(c => c.toUpperCase())));
  const tvac = Array.from(new Set((extra.tripVisibleAirportCodes || []).map(c => c.toUpperCase())));

  const isTripActive = (extra.tripState?.legs?.length || 0) > 0;
  const tripCodes = Array.from(new Set([...tvac, ...mtac]));
  const destCodes = Array.from(new Set(ha));
  const hCodes = Array.from(new Set([...sac, ...ha, ...tvac, ...mtac, ...eac]));

  const cityKeyMap = extra.airportCityKeyMap || {};
  const cityDestCodes = Array.from(new Set(destCodes.map(c => cityKeyMap[c]).filter(Boolean)));
  const cityTripCodes = Array.from(new Set(tripCodes.map(c => cityKeyMap[c]).filter(Boolean)));

  const isCityTrip = ['match', ['get', 'city_code'], cityTripCodes.length > 0 ? cityTripCodes : ['_NONE_'], true, false];
  const isCityDest = ['match', ['get', 'city_code'], cityDestCodes.length > 0 ? cityDestCodes : ['_NONE_'], true, false];
  const isCityDestPrimary = ['all', isCityDest, ['==', ['get', 'is_city_primary'], true]];
  const isCityTripPrimary = ['all', isCityTrip, ['==', ['get', 'is_city_primary'], true]];

  const labelGroupFilter = [
    'case',
    ['<', ['zoom'], 7.0],
    ['case',
      isCityDest, isCityDestPrimary,
      isCityTrip, isCityTripPrimary,
      ['==', ['get', 'is_city_primary'], true]
    ],
    true
  ];

  const isSelectedFilter = ['match', ['get', 'code'], sac.length > 0 ? sac : ['_NONE_'], true, false];
  const notSelectedFilter = ['match', ['get', 'code'], sac.length > 0 ? sac : ['_NONE_'], false, true];

  // Okluzja hovera przez text-opacity (setPaintProperty << setFilter — nie przebudowuje collision tree)
  // airports-hover-single-label ma text-allow-overlap: true więc hover label zawsze się wyświetli.
  const hoverOpacityExpr: any = hoveredAirportCode
    ? ['case', ['==', ['get', 'code'], hoveredAirportCode], 0, 1]
    : 1;
  if (map.getLayer('airports-labels')) {
    map.setPaintProperty('airports-labels', 'text-opacity', hoverOpacityExpr);
    map.setPaintProperty('airports-labels-selected', 'text-opacity', hoverOpacityExpr);
  }
  // Ukryj centroid etykietę miasta gdy któreś lotnisko z tego miasta jest hoverowane
  if (map.getLayer('selected-city-centroid-labels')) {
    const hoveredCityCode = hoveredAirportCode ? (cityKeyMap[hoveredAirportCode.toUpperCase()] || '') : '';
    const centroidHoverOpacity: any = hoveredCityCode
      ? ['case', ['==', ['get', 'city_code'], hoveredCityCode], 0, 1]
      : 1;
    map.setPaintProperty('selected-city-centroid-labels', 'text-opacity', centroidHoverOpacity);
  }

  // Gdy zmienił się tylko hover - kończymy tutaj. Reszta (paint, circle filters, layout) nie wymaga aktualizacji.
  if (skipLayout) {
    map.triggerRepaint();
    return;
  }

  // --- FILTRY LABELI (pełna aktualizacja — nie zawierają hover, hover obsługuje text-opacity) ---
  if (isTripActive) {
    const tripLabelFilter = ['match', ['get', 'code'], hCodes.length > 0 ? hCodes : ['_NONE_'], true, false];
    safeSetFilter('airports-labels', mergeFilterConditions(mergeFilterConditions(labelGroupFilter, notSelectedFilter), tripLabelFilter));
  } else {
    safeSetFilter('airports-labels', mergeFilterConditions(labelGroupFilter, notSelectedFilter));
  }
  safeSetFilter('airports-labels-selected', isSelectedFilter);

  // --- CENTROIDY ETYKIET MIAST ---
  // Dla każdego miasta z 1+ wybranymi lotniskami: oblicz centroid i pokaż nazwę miasta.
  {
    const cityGroups = new Map<string, { lons: number[]; lats: number[]; cityName: string; cityCode: string; firstIdx: number }>();
    sac.forEach((code, i) => {
      const cityCode = cityKeyMap[code] || '';
      if (!cityCode) return;
      const coords = extra.coordsMap[code] || extra.coordsMap[code.toLowerCase()];
      if (!coords) return;
      const cityName = extra.airportCityNamesMap[code] || '';
      if (!cityGroups.has(cityCode)) {
        cityGroups.set(cityCode, { lons: [coords[0]], lats: [coords[1]], cityName, cityCode, firstIdx: i });
      } else {
        const g = cityGroups.get(cityCode)!;
        g.lons.push(coords[0]);
        g.lats.push(coords[1]);
      }
    });

    const labelPaintForCentroid = getLabelPaint(styleId);
    const centroidFeatures: any[] = [];
    cityGroups.forEach(({ lons, lats, cityName, cityCode, firstIdx }) => {
      const lon = lons.reduce((s, v) => s + v, 0) / lons.length;
      const lat = lats.reduce((s, v) => s + v, 0) / lats.length;
      const sp = colorState?.startPoints?.[firstIdx];
      const textColor = sp?.label || labelPaintForCentroid.textColor;
      centroidFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { city_label: cityName, city_code: cityCode, text_color: textColor }
      });
    });
    try {
      const centroidSrc = map.getSource('selected-city-centroids') as maplibregl.GeoJSONSource | undefined;
      if (centroidSrc) centroidSrc.setData({ type: 'FeatureCollection', features: centroidFeatures });
      if (map.getLayer('selected-city-centroid-labels')) {
        const lp = getLabelPaint(styleId);
        map.setPaintProperty('selected-city-centroid-labels', 'text-halo-color', lp.haloColor);
        map.setPaintProperty('selected-city-centroid-labels', 'text-halo-width', 2.5);
      }
    } catch (_e) {}
  }

  // ======================== PEŁNA AKTUALIZACJA ========================

  const labelPaint = getLabelPaint(styleId);

  const n = (v: any, fallback: number): number => {
    const num = Number(v);
    return isNaN(num) ? fallback : num;
  };

  const rawMin = n(colorState?.zoomRangeMin, 1.3);
  const rawMax = n(colorState?.zoomRangeMax, 12.0);
  const zMin = Math.min(rawMin, rawMax);
  let zMax = Math.max(zMin + 0.001, rawMax);

  safeSetZoomLimits(map, zMin, zMax);

  const zooLayers = [
    'airports-circles', 'airports-trip', 'airports-highlighted', 'airports-selected',
    'airports-labels'
  ];
  zooLayers.forEach(id => {
    if (map.getLayer(id)) {
      (map as any).setLayerZoomRange(id, 0, 24);
    }
  });

  const cDest = colorState?.destinationAirport || '#4CAF50';
  const cTrip = colorState?.tripAirport || '#000000';

  const rGen = ['interpolate', ['linear'], ['zoom'], zMin, n(colorState?.generalAirportRadiusMin, 2), zMax, n(colorState?.generalAirportRadiusMax, 8)];
  const rHigh = ['interpolate', ['linear'], ['zoom'], zMin, n(colorState?.highlightedAirportRadiusMin, 4), zMax, n(colorState?.highlightedAirportRadiusMax, 16)];

  const citySelectedCodes = Array.from(new Set(sac.map(c => cityKeyMap[c]).filter(Boolean)));
  const cityHighCodes = Array.from(new Set(hCodes.map(c => cityKeyMap[c]).filter(Boolean)));

  const buildSelectedExpr = (type: 'airport' | 'label', fallback: string) => {
    const pairs: any[] = [];
    (colorState?.startPoints || []).forEach((sp: any, i: number) => {
      const color = type === 'airport' ? sp.airport : sp.label;
      const code = sac[i];
      if (color && code) pairs.push(code, color);
    });
    if (pairs.length === 0) return fallback;
    return ['match', ['get', 'code'], ...pairs, fallback];
  };

  const buildCitySelectedExpr = (fallback: string) => {
    const pairs: any[] = [];
    citySelectedCodes.forEach(cityCode => {
      const selectedInCity = sac.filter(c => cityKeyMap[c] === cityCode);
      if (selectedInCity.length > 0) {
        const firstSelectedCode = selectedInCity[0];
        const i = sac.indexOf(firstSelectedCode);
        const color = colorState?.startPoints?.[i]?.label;
        if (color) pairs.push(cityCode, color);
      }
    });
    if (pairs.length === 0) return fallback;
    return ['match', ['get', 'city_code'], ...pairs, fallback];
  };

  const cSelCircle = buildSelectedExpr('airport', '#000000');
  const cSelLabel = buildSelectedExpr('label', labelPaint.textColor);
  const cCitySelLabel = buildCitySelectedExpr(labelPaint.textColor);

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

  const destLabelC = colorState?.destinationLabelColor || labelPaint.textColor;
  const tripLabelC = colorState?.tripLabelColor || labelPaint.textColor;
  const genLabelC = colorState?.generalLabelColor || labelPaint.textColor;

  const isSelected = ['match', ['get', 'code'], sac.length > 0 ? sac : ['_NONE_'], true, false];
  const isTrip = ['match', ['get', 'code'], tripCodes.length > 0 ? tripCodes : ['_NONE_'], true, false];
  const isDest = ['match', ['get', 'code'], destCodes.length > 0 ? destCodes : ['_NONE_'], true, false];

  const isCitySelected = ['match', ['get', 'city_code'], citySelectedCodes.length > 0 ? citySelectedCodes : ['_NONE_'], true, false];
  const isCityHighExpr = ['match', ['get', 'city_code'], cityHighCodes.length > 0 ? cityHighCodes : ['_NONE_'], true, false];
  const isHighExpr = ['match', ['get', 'code'], hCodes.length > 0 ? hCodes : ['_NONE_'], true, false];

  const textColorExpr: any = [
    'step',
    ['zoom'],
    ['case',
      isSelected, cSelLabel,
      isCitySelected, cCitySelLabel,
      isDest, destLabelC,
      isCityDest, destLabelC,
      isTrip, tripLabelC,
      isCityTrip, tripLabelC,
      genLabelC
    ],
    7.0,
    ['case',
      isSelected, cSelLabel,
      isDest, destLabelC,
      isTrip, tripLabelC,
      genLabelC
    ]
  ];

  if (map.getLayer('airports-labels')) {
    const textSizeExpr: any = [
      'interpolate', ['linear'], ['zoom'],
      zMin, ['case', isCityHighExpr, n(colorState?.highlightedLabelSizeMin, 12), n(colorState?.generalAirportLabelSizeMin, 10)],
      zMax, ['case', isHighExpr, n(colorState?.highlightedLabelSizeMax, 18), n(colorState?.generalAirportLabelSizeMax, 14)]
    ];

    const pad = 3;
    const off_n_low = [0, (n(colorState?.generalAirportRadiusMin, 2) + pad) / (n(colorState?.generalAirportLabelSizeMin, 10) || 11)];
    const off_f_low = [0, (n(colorState?.generalAirportRadiusMax, 8) + pad) / (n(colorState?.generalAirportLabelSizeMax, 14) || 13)];
    const off_n_high = [0, (n(colorState?.highlightedAirportRadiusMin, 4) + pad) / (n(colorState?.highlightedLabelSizeMin, 12) || 11)];
    const off_f_high = [0, (n(colorState?.highlightedAirportRadiusMax, 16) + pad) / (n(colorState?.highlightedLabelSizeMax, 18) || 13)];

    const textOffsetExpr: any = [
      'interpolate', ['linear'], ['zoom'],
      1.3, ['case', isHighExpr, ['literal', off_n_high], ['literal', off_n_low]],
      10, ['case', isHighExpr, ['literal', off_f_high], ['literal', off_f_low]]
    ];

    const textFieldExpr: any = [
      'step',
      ['zoom'],
      // zoom < 4.2: selected → '' (centroid layer przejmuje etykietę miasta)
      ['case',
        isSelected, '',
        ['all', isCityHighExpr, ['>', ['coalesce', ['get', 'city_airport_count'], 0], 1]], ['get', 'cl_grouped'],
        isHighExpr, ['get', 'cl_hl_low'],
        ['case', ['>', ['coalesce', ['get', 'city_airport_count'], 0], 1], ['get', 'cl_grouped'], ""]
      ],
      4.2,
      // zoom 4.2-7.0: selected → '' (centroid layer przejmuje etykietę miasta)
      ['case',
        isSelected, '',
        ['all', isCityHighExpr, ['>', ['coalesce', ['get', 'city_airport_count'], 0], 1]], ['get', 'cl_grouped'],
        isHighExpr, ['get', 'cl_hl_low'],
        ['case', ['>', ['coalesce', ['get', 'city_airport_count'], 0], 1], ['get', 'cl_grouped'], ['get', 'cl_search']]
      ],
      7.0,
      // zoom >= 7.0: indywidualne etykiety lotnisk jak dotychczas
      ['case', isHighExpr, ['get', 'cl_hl_high'], ['get', 'cl_high']]
    ];

    const symbolSortKeyExpr: any = [
      'step',
      ['zoom'],
      ['case',
        isCitySelected, ['-', -40000, ['coalesce', ['get', 'rank'], 0]],
        isCityDest, ['-', -30000, ['coalesce', ['get', 'rank'], 0]],
        isCityTrip, ['-', -20000, ['coalesce', ['get', 'rank'], 0]],
        ['-', 1000, ['coalesce', ['get', 'rank'], 0]]
      ],
      7.0,
      ['case',
        isSelected, ['-', -40000, ['coalesce', ['get', 'rank'], 0]],
        isDest, ['-', -30000, ['coalesce', ['get', 'rank'], 0]],
        isTrip, ['-', -20000, ['coalesce', ['get', 'rank'], 0]],
        ['-', 1000, ['coalesce', ['get', 'rank'], 0]]
      ]
    ];

    map.setLayoutProperty('airports-labels', 'text-size', textSizeExpr);
    map.setLayoutProperty('airports-labels-selected', 'text-size', textSizeExpr);
    map.setLayoutProperty('airports-labels', 'text-offset', textOffsetExpr);
    map.setLayoutProperty('airports-labels-selected', 'text-offset', textOffsetExpr);
    map.setLayoutProperty('airports-labels', 'text-field', textFieldExpr);
    map.setLayoutProperty('airports-labels-selected', 'text-field', textFieldExpr);
    map.setLayoutProperty('airports-labels', 'symbol-sort-key', symbolSortKeyExpr);
    map.setLayoutProperty('airports-labels-selected', 'symbol-sort-key', symbolSortKeyExpr);

    map.setPaintProperty('airports-labels', 'text-color', textColorExpr);
    map.setPaintProperty('airports-labels-selected', 'text-color', textColorExpr);
    map.setPaintProperty('airports-labels', 'text-halo-color', labelPaint.haloColor);
    map.setPaintProperty('airports-labels-selected', 'text-halo-color', labelPaint.haloColor);
    map.setPaintProperty('airports-labels', 'text-halo-width', ['case', isCityHighExpr, 2.5, labelPaint.haloWidth] as any);
    map.setPaintProperty('airports-labels-selected', 'text-halo-width', ['case', isCityHighExpr, 2.5, labelPaint.haloWidth] as any);
    map.setLayoutProperty('airports-labels', 'visibility', 'visible');
  }

  // AKTUALIZACJA TRAS
  const getLineStyles = (pref: string, isSelection = false) => {
    const routeColors: any[] = [];
    const routeHoverColors: any[] = [];
    const colorKey = pref === 'routeLine' ? 'transferRoute' : pref;

    (colorState?.startPoints || []).forEach((sp: any, i: number) => {
      routeColors.push(i, sp.route || colorState?.[colorKey] || '#3b82f6');
      routeHoverColors.push(i, sp.routeHover || colorState?.[`${colorKey}Hover`] || '#2563eb');
    });

    const baseColor = isSelection && routeColors.length > 0
      ? ['match', ['get', 'srcIdx'], ...routeColors, colorState?.[colorKey] || '#3b82f6']
      : colorState?.[colorKey] || '#3b82f6';

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

  const transferStyles = getLineStyles('transferRoute', false);
  if (map.getLayer('manual-transfer-preview')) {
    map.setPaintProperty('manual-transfer-preview', 'line-color', transferStyles.color);
    map.setPaintProperty('manual-transfer-preview', 'line-width', transferStyles.width);
  }

  const tripStyles = getLineStyles('tripRoute', false);
  if (map.getLayer('trip-permanent-routes')) {
    map.setPaintProperty('trip-permanent-routes', 'line-color', tripStyles.color);
    map.setPaintProperty('trip-permanent-routes', 'line-width', tripStyles.width);
  }

  const globalStyles = getLineStyles('routeLine', true);
  if (map.getLayer('selected-routes')) {
    map.setPaintProperty('selected-routes', 'line-color', globalStyles.color);
    map.setPaintProperty('selected-routes', 'line-width', globalStyles.width);
  }

  // FILTRY KÓŁEK (hover kółko nakrywa bazowe wizualnie — bez okluzji hover)
  safeSetFilter('airports-selected', ['match', ['get', 'code'], sac.length > 0 ? sac : ['_NONE_'], true, false]);
  safeSetFilter('airports-highlighted', ['match', ['get', 'code'], ha.length > 0 ? ha : ['_NONE_'], true, false]);
  safeSetFilter('airports-trip', ['match', ['get', 'code'], tripCodes.length > 0 ? tripCodes : ['_NONE_'], true, false]);

  if (isTripActive) {
    safeSetFilter('airports-circles', ['==', ['get', 'code'], '_NONE_']);
  } else {
    safeSetFilter('airports-circles', ['match', ['get', 'code'], hCodes.length > 0 ? hCodes : ['_NONE_'], false, true]);
  }

  // SYNCHRONIZACJA DANYCH PRZESIADEK
  const transferSrc = map.getSource('manual-transfer-preview') as maplibregl.GeoJSONSource | undefined;
  if (transferSrc) {
    const features: any[] = [];
    const allDraftCodes = previewAirportCode ? [...mtac, previewAirportCode] : mtac;

    if (allDraftCodes.length > 0) {
      const lastLeg = tripState?.legs?.[tripState.legs.length - 1];
      const startCode = lastLeg ? lastLeg.toAirportCode : tripState?.startAirport?.code;
      const startCoords = startCode ? coordsMap[startCode] : null;

      if (startCoords) {
        allDraftCodes.forEach((code, i) => {
          const targetCoords = coordsMap[code];
          if (targetCoords) {
            features.push({
              type: 'Feature',
              id: i,
              geometry: {
                type: 'LineString',
                coordinates: generateGreatCircle(startCoords, targetCoords)
              },
              properties: { isTransferPreview: true }
            });
          }
        });
      }
    }
    transferSrc.setData({ type: 'FeatureCollection', features });
  }

  map.triggerRepaint();
}

import { generateGreatCircle } from './utils';
