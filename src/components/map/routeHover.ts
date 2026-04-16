import maplibregl from 'maplibre-gl';
import type React from 'react';
import type { Flight } from '../../types';
import { useColorStore } from '../../stores/colorStore';
import { useFilterStore } from '../../stores/filterStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { CONFIG } from '../../constants/config';
import { THEME_COLORS } from '../../constants/theme';
import { getUTCOffH } from './popupHelpers';
import { buildFlightRow, buildPopupHtml, formatGroupDateLabel, buildHeaderDuration } from './popupBuilder';
import { getVisualRadius } from './utils';

export interface RouteHoverRefs {
  map: React.RefObject<maplibregl.Map | null>;
  projectedAirportsRef: React.RefObject<Array<{ code: string; x: number; y: number }>>;
  hoveredAirportCodeRef: React.RefObject<string | null>;
  hoveredRouteId: React.RefObject<string | number | null>;
  hoveredTripRouteId: React.RefObject<string | number | null>;
  hoveredTransferRouteId: React.RefObject<string | number | null>;
  isRouteHoveredRef: React.RefObject<boolean>;
  tripVisibleAirportCodesRef: React.RefObject<string[] | null>;
  highlightedAirportsRef: React.RefObject<string[]>;
  selectedAirportCodeRef: React.RefObject<string | null>;
  selectedAirportCodesRef: React.RefObject<string[]>;
  explorationAirportCodesRef: React.RefObject<string[]>;
  manualTransferAirportCodesRef: React.RefObject<string[]>;
  airportsDataRef: React.RefObject<any>;
  airportCityKeyRef: React.RefObject<Record<string, string>>;
  cityLabelCodeByCityRef: React.RefObject<Record<string, string>>;
  highlightedCityLabelCodesRef: React.RefObject<string[]>;
  flightDetailsMap: React.RefObject<Record<string, Flight[]>>;
  /** INDEKS GRUPOWY: Map<"ORIGIN-DEST", Flight[]> dla szybkiego dostępu */
  flightsByRouteGroupMapRef: React.RefObject<Map<string, Flight[]>>;
  airportNamesMap: React.RefObject<Record<string, string>>;
  airportCoordsMapRef: React.RefObject<Record<string, [number, number]>>;
  currentPopup: React.RefObject<maplibregl.Popup | null>;
  routeHoverAtPointRef: React.RefObject<((point: { x: number; y: number }) => void) | null>;
  clearRouteHoverRef: React.RefObject<((opts?: { keepLabels?: boolean }) => void) | null>;
  applyAirportFilters: () => void;
  texts: {
    noFlightsForDate: string;
    clickRouteToFilter: string;
    unknown: string;
  };
}

import { spatialIndex } from '../../utils/spatialIndex';
import { logger } from '../../utils/logger';

const n = (v: any, fallback: number): number => {
  const num = Number(v);
  return isNaN(num) ? fallback : num;
};

/**
 * TARCZA OCHRONNA
 * Sprawdza czy punkt znajduje się wewnątrz promienia lotniska.
 */
function isAirportNearPoint(
  m: maplibregl.Map,
  point: { x: number; y: number },
  refs: {
    highlightedAirportsRef: React.RefObject<string[]>,
    selectedAirportCodesRef: React.RefObject<string[]>,
    tripVisibleAirportCodesRef: React.RefObject<string[] | null>,
    explorationAirportCodesRef: React.RefObject<string[]>,
    manualTransferAirportCodesRef: React.RefObject<string[]>,
    hoveredAirportCodeRef: React.RefObject<string | null>
  }
): boolean {
  if (!spatialIndex) return false;
 
  const SCAN_DIST = 45; // Zasięg skanowania tarczy
  const candidates = spatialIndex.searchRadius(point.x, point.y, SCAN_DIST);
  if (candidates.length === 0) return false;
 
  const z = m.getZoom();
  const cS = useColorStore.getState();
  const ha = refs.highlightedAirportsRef.current ?? [];
  const sac = refs.selectedAirportCodesRef.current ?? [];
  const tvac = refs.tripVisibleAirportCodesRef.current ?? [];
  const explorationCodes = refs.explorationAirportCodesRef.current ?? [];
  const manualCodes = refs.manualTransferAirportCodesRef.current ?? [];
  const curHover = refs.hoveredAirportCodeRef.current;
 
  const HIT_MARGIN = 1.0; 

  // --- HIERARCHICZNA TARCZA ---
  
  // 1. Sprawdzamy wszystkie trafienia NATURALNE (fizyczne krawędzie)
  for (const cand of candidates) {
    const naturalR = getVisualRadius(cand.code, z, cS, false, sac, ha, tvac, explorationCodes, manualCodes);
    if (cand.distance <= naturalR + HIT_MARGIN) return true;
  }

  // 2. Sprawdzamy trafienie LEPKE (Sticky) dla aktywnego hovera
  if (curHover) {
    const cand = candidates.find(c => c.code === curHover);
    if (cand) {
      const stickyR = getVisualRadius(curHover, z, cS, true, sac, ha, tvac, explorationCodes, manualCodes);
      if (cand.distance <= stickyR + HIT_MARGIN) return true;
    }
  }

  return false;
}

export function setupRouteHoverListeners(m: maplibregl.Map, refs: RouteHoverRefs): void {
  const {
    map,
    projectedAirportsRef,
    hoveredAirportCodeRef,
    hoveredRouteId,
    hoveredTripRouteId,
    hoveredTransferRouteId,
    isRouteHoveredRef,
    tripVisibleAirportCodesRef,
    highlightedAirportsRef,
    selectedAirportCodeRef,
    selectedAirportCodesRef,
    explorationAirportCodesRef,
    manualTransferAirportCodesRef,
    airportsDataRef,
    airportCityKeyRef,
    cityLabelCodeByCityRef,
    highlightedCityLabelCodesRef,
    flightDetailsMap,
    airportNamesMap,
    airportCoordsMapRef,
    currentPopup,
    routeHoverAtPointRef,
    clearRouteHoverRef,
    applyAirportFilters,
    texts,
  } = refs;

  const clearRouteHover = (opts?: { keepLabels?: boolean }) => {
    if (isRouteHoveredRef) isRouteHoveredRef.current = false;
    const keepLabels = opts?.keepLabels ?? false;
    const routeId = hoveredRouteId.current;
    if (routeId != null) {
      map.current?.setFeatureState({ source: 'selected-routes', id: routeId }, { hover: false });
      hoveredRouteId.current = null;
    }

    if (!keepLabels) {
      applyAirportFilters();
    }
    if (currentPopup.current) { currentPopup.current.remove(); currentPopup.current = null; }
  };

  const applyRouteHoverAtPoint = (point: { x: number; y: number }) => {
    if (!map.current) return;

    if (hoveredTripRouteId.current !== null) {
      m.setFeatureState({ source: 'trip-permanent-routes', id: hoveredTripRouteId.current }, { hover: false });
      hoveredTripRouteId.current = null;
    }
    if (hoveredTransferRouteId.current !== null) {
      m.setFeatureState({ source: 'manual-transfer-preview', id: hoveredTransferRouteId.current }, { hover: false });
      hoveredTransferRouteId.current = null;
    }

    // TARCZA: Najpierw sprawdzamy ochronę lotniska.
    // Jeśli jesteśmy w obrębie kropki lotniska, przerywamy obsługę trasy.
    if (isAirportNearPoint(m, point, { highlightedAirportsRef, selectedAirportCodesRef, tripVisibleAirportCodesRef, explorationAirportCodesRef, manualTransferAirportCodesRef, hoveredAirportCodeRef })) {
      clearRouteHover();
      return;
    }

    // Dopiero teraz uznajemy trasę za potencjalnie aktywną
    if (isRouteHoveredRef) isRouteHoveredRef.current = true;

    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [point.x - 4, point.y - 4],
      [point.x + 4, point.y + 4],
    ];
    let features: maplibregl.MapGeoJSONFeature[] = [];
    try {
      features = m.queryRenderedFeatures(bbox, { layers: ['selected-routes'] });
    } catch {
      features = [];
    }
    if (!features.length) {
      clearRouteHover();
      return;
    }

    const feature = features[0];
    const featureId = feature.id;
    const destCodeRaw = (feature.properties as { destCode?: string })?.destCode ?? '';
    const destCode = destCodeRaw.toUpperCase();
    if (featureId == null) {
      clearRouteHover();
      return;
    }

    const prevRouteId = hoveredRouteId.current;
    if (prevRouteId != null && prevRouteId !== featureId) {
      m.setFeatureState({ source: 'selected-routes', id: prevRouteId }, { hover: false });
    }
    m.setFeatureState({ source: 'selected-routes', id: featureId }, { hover: true });
    hoveredRouteId.current = (featureId as any);

    const tvac = tripVisibleAirportCodesRef.current ?? [];
    const ha = highlightedAirportsRef.current ?? [];
    const sac = selectedAirportCodeRef.current;
    const sacMulti = selectedAirportCodesRef.current ?? [];
    const explorationCodes = explorationAirportCodesRef.current ?? [];
    const manualCodes = manualTransferAirportCodesRef.current ?? [];

    const allHighlighted = [...new Set([
      ...ha.map(c => c.toUpperCase()),
      ...tvac.map(c => c.toUpperCase()),
      ...sacMulti.map(c => c.toUpperCase()),
      ...explorationCodes.map(c => c.toUpperCase()),
      ...(sac ? [sac.toUpperCase()] : []),
      ...manualCodes.map(c => c.toUpperCase()),
    ])];

    const filterCodes = allHighlighted.filter(c => c !== destCode);
    const hlFilter: any = filterCodes.length === 0
      ? ['==', 'code', '']
      : ['in', 'code', ...filterCodes];
    
    // Używamy bezpośredniego setFilter
    if (m.getLayer('airports-labels-highlighted')) m.setFilter('airports-labels-highlighted', hlFilter);

    if (m.getLayer('airports-labels-highlighted-city')) {
      const hlCityCodes = highlightedCityLabelCodesRef.current ?? [];
      const destCityKey = airportCityKeyRef.current?.[destCode];
      const destCityCode = destCityKey ? cityLabelCodeByCityRef.current?.[destCityKey] : null;
      const filteredCityCodes = hlCityCodes.filter(c => c !== destCityCode);
      const hlCityFilter: any = filteredCityCodes.length === 0
        ? ['==', 'code', '']
        : ['in', 'code', ...filteredCityCodes];
      m.setFilter('airports-labels-highlighted-city', hlCityFilter);
    }

    const srcIdx = (feature.properties as { srcIdx?: number })?.srcIdx ?? 0;
    
    // UNIFIKACJA LISTY ŹRÓDEŁ
    const sourceSet = new Set<string>(selectedAirportCodesRef.current ?? []);
    (manualTransferAirportCodesRef.current ?? []).forEach(c => sourceSet.add(c));
    const sacCode = selectedAirportCodeRef.current;
    if (sacCode) sourceSet.add(sacCode);
    const startCodes = Array.from(sourceSet).map(c => c.toUpperCase());

    const srcCode = startCodes[srcIdx] ?? startCodes[0] ?? '';

    const routeKey = `${srcCode}-${destCode}`;
    const displayFlights = (refs.flightsByRouteGroupMapRef.current?.get(routeKey) || []);

    const shownFlights = displayFlights.slice(0, CONFIG.MAX_POPUP_FLIGHTS);
    const extraCount = displayFlights.length - shownFlights.length;

    const dateGroups = new Map<string, typeof shownFlights>();
    for (const f of shownFlights) {
      const key = f.scheduled_departure_local?.split('T')[0] ?? '';
      if (!dateGroups.has(key)) dateGroups.set(key, []);
      dateGroups.get(key)!.push(f);
    }
    const sourceDates = new Set<string>();
    for (const src of startCodes) {
      for (const flights of Object.values(flightDetailsMap.current ?? {})) {
        const flight = flights.find(f => f.origin_airport_code === src);
        if (flight?.scheduled_departure_local) {
          sourceDates.add(flight.scheduled_departure_local.split('T')[0]);
          break;
        }
      }
    }
    const sourcesHaveDifferentDays = sourceDates.size > 1;
    const showDateHeaders = dateGroups.size > 1 || sourcesHaveDifferentDays;
    const srcAirportName = airportNamesMap.current?.[srcCode] ?? srcCode ?? texts.unknown;
    const destAirportName = airportNamesMap.current?.[destCode] ?? destCode;
    const srcCityName = srcAirportName;
    const destCityName = destAirportName;

    const { durationStr: headerDurationStr, estimated: headerDurationEstimated } = buildHeaderDuration(
      displayFlights, srcCode, destCode, airportCoordsMapRef.current ?? {},
    );
    const headerDurationHtml = headerDurationStr
      ? headerDurationEstimated
        ? `<div class="mc-popup-duration-est" style="background:${THEME_COLORS.goldBg};color:${THEME_COLORS.goldText};border-color:${THEME_COLORS.goldBorder}">${headerDurationStr}</div>`
        : `<div class="mc-popup-duration-exact">${headerDurationStr}</div>`
      : `<div class="mc-popup-arrow">→</div>`;

    let destUTCOffset: number | null = null;
    let srcUTCOffset: number | null = null;
    for (const f of displayFlights) {
      if (destUTCOffset === null) {
        const off = getUTCOffH(f.scheduled_arrival_local, f.scheduled_arrival_utc);
        if (off !== null) destUTCOffset = off;
      }
      if (srcUTCOffset === null) {
        const off = getUTCOffH(f.scheduled_departure_local, f.scheduled_departure_utc);
        if (off !== null) srcUTCOffset = off;
      }
      if (destUTCOffset !== null && srcUTCOffset !== null) break;
    }

    let destTimezone: string | undefined = undefined;
    let srcTimezone: string | undefined = undefined;
    if (airportsDataRef.current) {
      const featD = airportsDataRef.current.features.find((f: any) => f.properties.code === destCode);
      if (featD?.properties.time_zone) {
        destTimezone = featD.properties.time_zone;
      }
      const featS = airportsDataRef.current.features.find((f: any) => f.properties.code === srcCode);
      if (featS?.properties.time_zone) {
        srcTimezone = featS.properties.time_zone;
      }
    }

    const rowOpts = { airportCoordsMap: airportCoordsMapRef.current ?? {}, destUTCOffset, srcUTCOffset, destTimezone, srcTimezone };
    const flightRows = [...dateGroups.entries()].map(([dateStr, groupFlights]) => {
      const header = showDateHeaders
        ? `<div class="mc-popup-date-header">${formatGroupDateLabel(dateStr)}</div>`
        : '';
      return header + groupFlights.map((f: Flight) => buildFlightRow(f, rowOpts)).join('');
    }).join('');

    const popupHtml = buildPopupHtml({
      srcCityName, destCityName, srcAirportName, destAirportName,
      headerDurationHtml, flightRows,
      hasFlights: shownFlights.length > 0,
      extraCount,
      noFlightsText: texts.noFlightsForDate,
      clickFilterText: texts.clickRouteToFilter,
    });
    if (currentPopup.current) currentPopup.current.remove();
    currentPopup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
      .setLngLat(m.unproject([point.x, point.y]))
      .setHTML(popupHtml)
      .addTo(m);
  };

  routeHoverAtPointRef.current = applyRouteHoverAtPoint;
  clearRouteHoverRef.current = clearRouteHover;

  m.on('click', 'selected-routes', (e) => {
    if (isAirportNearPoint(m, e.point, { highlightedAirportsRef, selectedAirportCodesRef, tripVisibleAirportCodesRef, explorationAirportCodesRef, manualTransferAirportCodesRef, hoveredAirportCodeRef })) return;
    if (e.features && e.features.length > 0) {
      const destCode = e.features[0].properties?.destCode;
      if (destCode) {
        const currentFilter = useFilterStore.getState().destinationFilter;
        const airports = currentFilter.airports || [];
        const isAlreadyFiltered = airports.includes(destCode);

        let nextAirports: string[];
        if (isAlreadyFiltered) {
          nextAirports = airports.filter(a => a !== destCode);
        } else {
          nextAirports = [...airports, destCode];
        }

        const nextFilter = {
          ...currentFilter,
          airports: nextAirports
        };

        logger.log(`[ARC-CLICK|MULTI] Przełączanie ${destCode}. Nowa lista: ${nextAirports.join(', ')}`);

        useFilterStore.getState().setDestinationFilter(nextFilter);
      }
    }
  });

  m.on('mousemove', 'selected-routes', (e) => {
    routeHoverAtPointRef.current?.({ x: e.point.x, y: e.point.y });
  });

  m.on('mouseleave', 'selected-routes', () => {
    clearRouteHoverRef.current?.();
  });

  m.on('mouseenter', 'selected-routes', () => {
    m.getCanvas().style.cursor = 'pointer';
  });
  
  const bindLineHover = (
    layerId: string,
    sourceId: string,
    hoverRef: React.RefObject<string | number | null>,
  ) => {
    m.on('mousemove', layerId, (e) => {
      // Priorytet dla lotnisk i głównych tras
      if ((isRouteHoveredRef.current) || isAirportNearPoint(m, e.point, { 
        highlightedAirportsRef, selectedAirportCodesRef, tripVisibleAirportCodesRef, explorationAirportCodesRef, manualTransferAirportCodesRef, hoveredAirportCodeRef 
      })) {
        if (hoverRef.current !== null) {
          m.setFeatureState({ source: sourceId, id: hoverRef.current }, { hover: false });
          hoverRef.current = null;
        }
        return;
      }

      if (!e.features || e.features.length === 0) return;
      const featureId = e.features[0].id;
      if (featureId == null) return;
      const prevId = hoverRef.current;
      if (prevId != null && prevId !== featureId) {
        m.setFeatureState({ source: sourceId, id: prevId }, { hover: false });
      }
      m.setFeatureState({ source: sourceId, id: featureId }, { hover: true });
      hoverRef.current = (featureId as any);
    });
    m.on('mouseenter', layerId, () => {
      m.getCanvas().style.cursor = 'pointer';
    });
    m.on('mouseleave', layerId, () => {
      if (hoverRef.current !== null) {
        m.setFeatureState({ source: sourceId, id: hoverRef.current }, { hover: false });
        hoverRef.current = null;
      }
      m.getCanvas().style.cursor = '';
    });
  };

  bindLineHover('trip-permanent-routes', 'trip-permanent-routes', (hoveredTripRouteId as any));
  bindLineHover('manual-transfer-preview', 'manual-transfer-preview', (hoveredTransferRouteId as any));
}
