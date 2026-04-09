import maplibregl from 'maplibre-gl';
import type React from 'react';
import type { Flight } from '../../types';
import { useColorStore } from '../../stores/colorStore';
import { useFilterStore } from '../../stores/filterStore';
import { CONFIG } from '../../constants/config';
import { THEME_COLORS } from '../../constants/theme';
import { getUTCOffH } from './popupHelpers';
import { buildFlightRow, buildPopupHtml, formatGroupDateLabel, buildHeaderDuration } from './popupBuilder';

export interface RouteHoverRefs {
  map: React.MutableRefObject<maplibregl.Map | null>;
  projectedAirportsRef: React.MutableRefObject<Array<{ code: string; x: number; y: number }>>;
  hoveredAirportCodeRef: React.MutableRefObject<string | null>;
  hoveredRouteId: React.MutableRefObject<string | number | null>;
  hoveredTripRouteId: React.MutableRefObject<string | number | null>;
  hoveredTransferRouteId: React.MutableRefObject<string | number | null>;
  isRouteHoveredRef: React.MutableRefObject<boolean>;
  tripVisibleAirportCodesRef: React.MutableRefObject<string[] | null>;
  highlightedAirportsRef: React.MutableRefObject<string[]>;
  selectedAirportCodeRef: React.MutableRefObject<string | null>;
  selectedAirportCodesRef: React.MutableRefObject<string[]>;
  explorationAirportCodesRef: React.MutableRefObject<string[]>;
  manualTransferAirportCodesRef: React.MutableRefObject<string[]>;
  airportsDataRef: React.MutableRefObject<any>;
  airportCityKeyRef: React.MutableRefObject<Record<string, string>>;
  cityLabelCodeByCityRef: React.MutableRefObject<Record<string, string>>;
  highlightedCityLabelCodesRef: React.MutableRefObject<string[]>;
  flightDetailsMap: React.MutableRefObject<Record<string, Flight[]>>;
  /** INDEKS GRUPOWY (Faza 2): Map<"ORIGIN-DEST", Flight[]> dla O(1) popupów */
  flightsByRouteGroupMapRef: React.MutableRefObject<Map<string, Flight[]>>;
  airportNamesMap: React.MutableRefObject<Record<string, string>>;
  airportCoordsMapRef: React.MutableRefObject<Record<string, [number, number]>>;
  currentPopup: React.MutableRefObject<maplibregl.Popup | null>;
  routeHoverAtPointRef: React.MutableRefObject<((point: { x: number; y: number }) => void) | null>;
  clearRouteHoverRef: React.MutableRefObject<((opts?: { keepLabels?: boolean }) => void) | null>;
  applyAirportFilters: () => void;
  texts: {
    noFlightsForDate: string;
    clickRouteToFilter: string;
    unknown: string;
  };
}

function isAirportNearPoint(
  m: maplibregl.Map,
  projectedAirports: Array<{ code: string; x: number; y: number }>,
  point: { x: number; y: number },
): boolean {
  const {
    highlightedAirportHoverRadiusMin,
    highlightedAirportHoverRadiusMax,
    generalAirportHoverRadiusMin,
    generalAirportHoverRadiusMax,
    zoomRangeMin,
    zoomRangeMax,
  } = useColorStore.getState();
  const zMin = Math.min(zoomRangeMin, zoomRangeMax);
  const zMax = Math.max(zoomRangeMin, zoomRangeMax);
  const z = m.getZoom();
  const interp = (min: number, max: number) => {
    if (zMin === zMax) return max;
    const clamped = Math.min(Math.max(z, zMin), zMax);
    const t = (clamped - zMin) / (zMax - zMin);
    return min + (max - min) * t;
  };
  const hoverRadius = Math.max(
    CONFIG.HOVER_RADIUS_FALLBACK,
    interp(highlightedAirportHoverRadiusMin, highlightedAirportHoverRadiusMax),
    interp(generalAirportHoverRadiusMin, generalAirportHoverRadiusMax),
  );
  const threshold = hoverRadius + CONFIG.HOVER_KEEP_RADIUS_EXTRA;
  const tSq = threshold * threshold;
  for (const ap of projectedAirports) {
    const dx = ap.x - point.x;
    const dy = ap.y - point.y;
    if (dx * dx + dy * dy <= tSq) return true;
  }
  return false;
}

/**
 * Registers all route-hover event listeners on the map.
 * Called once per addLayers() invocation (after layers are set up).
 * Sets routeHoverAtPointRef and clearRouteHoverRef so other parts of the
 * component can trigger or clear route hover programmatically.
 */
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
    isRouteHoveredRef.current = false;
    const keepLabels = opts?.keepLabels ?? false;
    const routeId = hoveredRouteId.current;
    if (routeId != null) {
      map.current?.setFeatureState({ source: 'selected-routes', id: routeId }, { hover: false });
      hoveredRouteId.current = null;
    }
    map.current?.setFilter('airports-route-hover', ['==', 'code', '']);
    if (!keepLabels) {
      map.current?.setFilter('airports-labels-hover', ['==', 'code', '']);
      map.current?.setFilter('airports-labels-hover-general', ['==', 'code', '']);
      // Restore highlighted label filter when clearing route hover
      applyAirportFilters();
    }
    if (currentPopup.current) { currentPopup.current.remove(); currentPopup.current = null; }
  };

  const applyRouteHoverAtPoint = (point: { x: number; y: number }) => {
    if (!map.current) return;

    // Immediately mark route hover as active to block any concurrent updates
    isRouteHoveredRef.current = true;

    // Searched route takes priority — clear any active trip/transfer route hover
    if (hoveredTripRouteId.current !== null) {
      m.setFeatureState({ source: 'trip-permanent-routes', id: hoveredTripRouteId.current }, { hover: false });
      hoveredTripRouteId.current = null;
    }
    if (hoveredTransferRouteId.current !== null) {
      m.setFeatureState({ source: 'manual-transfer-preview', id: hoveredTransferRouteId.current }, { hover: false });
      hoveredTransferRouteId.current = null;
    }

    if (hoveredAirportCodeRef.current) {
      clearRouteHover({ keepLabels: true });
      return;
    }
    if (isAirportNearPoint(m, projectedAirportsRef.current, point)) {
      clearRouteHover();
      return;
    }

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
    const destCode = (feature.properties as { destCode?: string })?.destCode ?? '';
    if (featureId == null) {
      clearRouteHover();
      return;
    }

    const prevRouteId = hoveredRouteId.current;
    if (prevRouteId != null && prevRouteId !== featureId) {
      m.setFeatureState({ source: 'selected-routes', id: prevRouteId }, { hover: false });
    }
    m.setFeatureState({ source: 'selected-routes', id: featureId }, { hover: true });
    hoveredRouteId.current = featureId ?? null;

    // Hide the highlighted label for destCode FIRST to prevent a frame where both
    // the highlighted label and the hover label are visible simultaneously.
    const tvac = tripVisibleAirportCodesRef.current ?? [];
    const ha = highlightedAirportsRef.current;
    const sac = selectedAirportCodeRef.current;
    const sacMulti = selectedAirportCodesRef.current ?? [];
    const explorationCodes = explorationAirportCodesRef.current ?? [];
    const manualCodes = manualTransferAirportCodesRef.current ?? [];

    const allHighlighted = [...new Set([
      ...ha,
      ...tvac,
      ...sacMulti,
      ...explorationCodes,
      ...(sac ? [sac] : []),
      ...manualCodes,
    ])];

    const filterCodes = allHighlighted.filter(c => c !== destCode);
    const hlFilter: maplibregl.FilterSpecification = filterCodes.length === 0
      ? ['==', 'code', '']
      : ['in', 'code', ...filterCodes];
    if (m.getLayer('airports-labels-highlighted')) m.setFilter('airports-labels-highlighted', hlFilter);

    // Also hide highlighted city label for destCode's city
    if (m.getLayer('airports-labels-highlighted-city')) {
      const hlCityCodes = highlightedCityLabelCodesRef.current;
      const destCityKey = airportCityKeyRef.current[destCode];
      const destCityCode = destCityKey ? cityLabelCodeByCityRef.current[destCityKey] : null;
      const filteredCityCodes = hlCityCodes.filter(c => c !== destCityCode);
      const hlCityFilter: maplibregl.FilterSpecification = filteredCityCodes.length === 0
        ? ['==', 'code', '']
        : ['in', 'code', ...filteredCityCodes];
      m.setFilter('airports-labels-highlighted-city', hlCityFilter);
    }

    // Now show hover label and dot — highlighted label for destCode is already hidden above
    m.setFilter('airports-labels-hover', ['==', 'code', destCode]);
    m.setFilter('airports-labels-hover-general', ['==', 'code', '']);
    m.setFilter('airports-route-hover', ['==', 'code', destCode]);

    const srcIdx = (feature.properties as { srcIdx?: number })?.srcIdx ?? 0;
    const startCodes = selectedAirportCodesRef.current.length > 0
      ? selectedAirportCodesRef.current
      : explorationAirportCodesRef.current.length > 0
        ? explorationAirportCodesRef.current
        : (selectedAirportCodeRef.current ? [selectedAirportCodeRef.current] : []);
    const srcCode = startCodes[srcIdx] ?? startCodes[0] ?? '';

    // INŻYNIERSKA OPTYMALIZACJA (O(1)): Pobieramy grupę lotów bezpośrednio z indeksu.
    // Zamiast filtrować tysiące rekordów, robimy stały odczyt po kluczu origin-dest.
    const routeKey = `${srcCode}-${destCode}`;
    const displayFlights = (refs.flightsByRouteGroupMapRef.current.get(routeKey) || []);

    const shownFlights = displayFlights.slice(0, CONFIG.MAX_POPUP_FLIGHTS);
    const extraCount = displayFlights.length - shownFlights.length;

    // Group shown flights by departure airport local date (for multi-day windows)
    const dateGroups = new Map<string, typeof shownFlights>();
    for (const f of shownFlights) {
      const key = f.scheduled_departure_local?.split('T')[0] ?? '';
      if (!dateGroups.has(key)) dateGroups.set(key, []);
      dateGroups.get(key)!.push(f);
    }
    // Check if source airports have flights on different calendar days
    const sourceDates = new Set<string>();
    for (const src of startCodes) {
      for (const flights of Object.values(flightDetailsMap.current)) {
        const flight = flights.find(f => f.origin_airport_code === src);
        if (flight?.scheduled_departure_local) {
          sourceDates.add(flight.scheduled_departure_local.split('T')[0]);
          break;
        }
      }
    }
    const sourcesHaveDifferentDays = sourceDates.size > 1;
    const showDateHeaders = dateGroups.size > 1 || sourcesHaveDifferentDays;
    const srcAirportName = airportNamesMap.current[srcCode] ?? srcCode ?? texts.unknown;
    const destAirportName = airportNamesMap.current[destCode] ?? destCode;
    const srcCityName = srcAirportName;
    const destCityName = destAirportName;

    // ── Route duration for header ──────────────────────────────────────────────
    const { durationStr: headerDurationStr, estimated: headerDurationEstimated } = buildHeaderDuration(
      displayFlights, srcCode, destCode, airportCoordsMapRef.current,
    );
    const headerDurationHtml = headerDurationStr
      ? headerDurationEstimated
        ? `<div class="mc-popup-duration-est" style="background:${THEME_COLORS.goldBg};color:${THEME_COLORS.goldText};border-color:${THEME_COLORS.goldBorder}">${headerDurationStr}</div>`
        : `<div class="mc-popup-duration-exact">${headerDurationStr}</div>`
      : `<div class="mc-popup-arrow">→</div>`;

    // ── Per-flight rows ────────────────────────────────────────────────────────
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

    // Get timezones from airportsDataRef to ensure correct local time formatting
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

    const rowOpts = { airportCoordsMap: airportCoordsMapRef.current, destUTCOffset, srcUTCOffset, destTimezone, srcTimezone };
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

  // Click on animated route line → filter flights by destination
  m.on('click', 'selected-routes', (e) => {
    if (isAirportNearPoint(m, projectedAirportsRef.current, e.point)) return;
    if (e.features && e.features.length > 0) {
      const destCode = e.features[0].properties?.destCode;
      if (destCode) {
        useFilterStore.getState().setDestinationFilter({ airports: [destCode], cities: [], countries: [] });
      }
    }
  });

  // Hover on animated route lines → popup with flight info
  m.on('mousemove', 'selected-routes', (e) => {
    routeHoverAtPointRef.current?.({ x: e.point.x, y: e.point.y });
  });

  m.on('mouseleave', 'selected-routes', () => {
    clearRouteHoverRef.current?.();
  });

  m.on('mouseenter', 'selected-routes', () => {
    m.getCanvas().style.cursor = 'pointer';
  });
  m.on('mouseleave', 'selected-routes', () => {
    m.getCanvas().style.cursor = '';
  });

  const bindLineHover = (
    layerId: string,
    sourceId: string,
    hoverRef: { current: string | number | null },
  ) => {
    m.on('mousemove', layerId, (e) => {
      // Searched flight route has priority — suppress trip/transfer hover
      if (isRouteHoveredRef.current) {
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
      hoverRef.current = featureId ?? null;
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

  bindLineHover('trip-permanent-routes-line', 'trip-permanent-routes', hoveredTripRouteId);
  bindLineHover('manual-transfer-preview-line', 'manual-transfer-preview', hoveredTransferRouteId);
}
