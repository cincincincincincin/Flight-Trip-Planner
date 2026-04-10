/**
 * HOOK INTERAKCJI MAPY (useMapHover.ts)
 * Zarządza logiką hover, selekcji oraz dynamicznego filtrowania warstw etykiet.
 * Wykorzystuje Spatial Grid Indexing (O(1)) dla zapewnienia wysokiego FPS przy 3000+ lotniskach.
 */
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import type { SelectedItem, AirportFeatureProps, Flight } from '../../types';
import { useColorStore } from '../../stores/colorStore';
import { useFilterStore } from '../../stores/filterStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { getLocalizedProp } from '../../utils/i18n';
import { CONFIG } from '../../constants/config';
import { applyMapAirportFilters } from './filterApplier';
import { spatialIndex } from '../../utils/spatialIndex';
import { useTripStore } from '../../stores/tripStore';

interface AirportFeature {
  properties: AirportFeatureProps;
  geometry: { coordinates: number[] };
}

interface AirportsGeoJSON {
  features: AirportFeature[];
}

export interface MapHoverRefs {
  map: React.MutableRefObject<maplibregl.Map | null>;
  projectedAirportsRef: React.MutableRefObject<Array<{ code: string; x: number; y: number }>>;
  hoveredAirportCodeRef: React.MutableRefObject<string | null>;
  lastDetectedCodeRef: React.MutableRefObject<string | null>;
  hoverSampleCountRef: React.MutableRefObject<number>;
  mouseStopTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  hoverClearTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  hoverLockUntilRef: React.MutableRefObject<number>;
  isRouteHoveredRef: React.MutableRefObject<boolean>;
  hoveredRouteId: React.MutableRefObject<string | number | null>;
  airportCityKeyRef: React.MutableRefObject<Record<string, string>>;
  cityLabelCodeByCityRef: React.MutableRefObject<Record<string, string>>;
  cityLabelCodesRef: React.MutableRefObject<string[]>;
  highlightedLabelCodesRef: React.MutableRefObject<string[]>;
  highlightedCityLabelCodesRef: React.MutableRefObject<string[]>;
  highlightedAirportsRef: React.MutableRefObject<string[]>;
  selectedAirportCodesRef: React.MutableRefObject<string[]>;
  explorationAirportCodesRef: React.MutableRefObject<string[]>;
  tripVisibleAirportCodesRef: React.MutableRefObject<string[] | null>;
  airportsDataRef: React.MutableRefObject<AirportsGeoJSON | undefined>;
  onSelectItemRef: React.MutableRefObject<(item: SelectedItem) => void>;
  flightsByRouteMapRef: React.MutableRefObject<Map<string, Flight>>;
  selectedAirportCodeRef: React.MutableRefObject<string | null>;
  tripRoutesRef: React.MutableRefObject<any[]>;
  tripStateRef: React.MutableRefObject<any>;
  coordsMapRef: React.MutableRefObject<Record<string, [number, number]>>;
}

export function useMapHover(refs: MapHoverRefs, mapLoaded: boolean, showAirports: boolean): void {
  const language = useSettingsStore(s => s.language);

  useEffect(() => {
    if (!mapLoaded || !refs.map.current) return;
    const m = refs.map.current;
    const canvas = m.getCanvas();
    const HOVER_SAMPLE_EVERY = CONFIG.HOVER_SAMPLE_EVERY;
    const LABEL_CLEAR_RADIUS = CONFIG.LABEL_CLEAR_RADIUS;

    const getNearbyAirportCodes = (point: { x: number; y: number }) => {
      // Używamy profesjonalnego indeksu przestrzennego RBush (O(log N))
      // Zapewnia to stałą wydajność niezależnie od gęstości lotnisk.
      const results = spatialIndex.searchRadius(point.x, point.y, LABEL_CLEAR_RADIUS);
      return results.map(r => r.code);
    };

    const updateHoverSource = (code: string | null) => {
      const hoverSource = m.getSource('airports-hover-single') as maplibregl.GeoJSONSource | undefined;
      if (!hoverSource) return;

      if (code && refs.airportsDataRef.current) {
        const feat = refs.airportsDataRef.current.features.find(f => f.properties.code === code);
        if (feat) {
          hoverSource.setData({
            type: 'FeatureCollection',
            features: [JSON.parse(JSON.stringify(feat))]
          });
          if (canvas) canvas.style.cursor = 'pointer';
          return;
        }
      }
      hoverSource.setData({ type: 'FeatureCollection', features: [] });
      if (canvas) canvas.style.cursor = '';
    };

    const applyHover = (code: string | null, point?: { x: number; y: number }, isMoving = false) => {
      const sameCode = code === refs.hoveredAirportCodeRef.current;
      
      // Zero-Waste: Update the high-performance overlay immediately on every valid move
      if (!sameCode) {
        refs.hoveredAirportCodeRef.current = code;
        updateHoverSource(code);
      }

      // Expensive Silence Zone: Only re-filter the global labels when the cursor stops
      // or when explicitly forced (e.g. leaving the airport).
      if (isMoving && code !== null) {
        return; 
      }

      const prevRouteId = refs.hoveredRouteId.current;
      if (code !== null && prevRouteId != null) {
        m.setFeatureState({ source: 'selected-routes', id: prevRouteId }, { hover: false });
        refs.hoveredRouteId.current = null;
      }

      const isFocused =
        code !== null &&
        (refs.highlightedAirportsRef.current.includes(code) ||
          refs.selectedAirportCodesRef.current.includes(code) ||
          refs.explorationAirportCodesRef.current.includes(code) ||
          (refs.tripVisibleAirportCodesRef.current?.includes(code) ?? false));

      const cityKey = code ? refs.airportCityKeyRef.current[code] : null;
      const cityRep = cityKey ? refs.cityLabelCodeByCityRef.current[cityKey] : null;
      const nearbyAirports = point ? getNearbyAirportCodes(point) : [];
      const nearbyCityReps: string[] = [];
      for (const apCode of nearbyAirports) {
        const apCity = refs.airportCityKeyRef.current[apCode];
        const rep = apCity ? refs.cityLabelCodeByCityRef.current[apCity] : null;
        if (rep) nearbyCityReps.push(rep);
      }
      const nearby = [...new Set([...nearbyAirports, ...nearbyCityReps])].filter(c => c !== code);
      const excludeCodes = code ? [code, ...(cityRep ? [cityRep] : []), ...nearby] : nearby;

      const currentManualCodes = useTripStore.getState().manualTransferAirportCodes;
      const isManualTransferActive = refs.tripVisibleAirportCodesRef.current && refs.tripVisibleAirportCodesRef.current.length > 0;
      const ghostCodes = (isManualTransferActive && code && !currentManualCodes.includes(code))
        ? [...currentManualCodes, code]
        : currentManualCodes;

      applyMapAirportFilters(
        m,
        {
          tripVisibleAirportCodes: refs.tripVisibleAirportCodesRef.current,
          highlightedAirports: refs.highlightedAirportsRef.current,
          selectedAirportCode: refs.selectedAirportCodeRef.current,
          selectedAirportCodes: refs.selectedAirportCodesRef.current,
          explorationAirportCodes: refs.explorationAirportCodesRef.current,
          hoveredAirportCode: code,
          cityLabelCodes: refs.cityLabelCodesRef.current,
          airportCityKeyMap: refs.airportCityKeyRef.current,
          cityLabelCodeByCity: refs.cityLabelCodeByCityRef.current,
          manualTransferAirportCodes: ghostCodes, 
          isRouteHovered: refs.isRouteHoveredRef.current,
          tripRoutes: refs.tripRoutesRef.current,
          tripState: refs.tripStateRef.current,
          coordsMap: refs.coordsMapRef.current,
          excludeCodes,
          isHoverFocused: isFocused,
        },
        {
          highlightedLabelCodesRef: refs.highlightedLabelCodesRef,
          highlightedCityLabelCodesRef: refs.highlightedCityLabelCodesRef,
        }
      );
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!refs.map.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      let code: string | null = null;
      if (showAirports) {
        const THRESHOLD = CONFIG.HOVER_RADIUS_FALLBACK;
        // Błyskawiczne wyszukiwanie w R-Tree (Spatial Engine)
        const results = spatialIndex.searchRadius(x, y, THRESHOLD);
        if (results.length > 0) {
          // Pobierz najbliższe lotnisko z wyników
          results.sort((a, b) => a.distance - b.distance);
          code = results[0].code;
        }

        if (code !== null) {
          refs.hoverLockUntilRef.current = Date.now() + CONFIG.HOVER_LOCK_DURATION_MS;
          const tripCodes = refs.tripVisibleAirportCodesRef.current;
          const hlCodes = refs.highlightedAirportsRef.current;
          if (tripCodes && tripCodes.length > 0) {
            const isTripPart = tripCodes.includes(code);
            const isHighlighted = hlCodes.includes(code);
            if (!isTripPart && !isHighlighted) code = null;
          }
        }
      }

      if (refs.hoveredAirportCodeRef.current && (!code || code === refs.hoveredAirportCodeRef.current)) {
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
        const keepRadius = Math.max(
          CONFIG.HOVER_RADIUS_FALLBACK,
          interp(highlightedAirportHoverRadiusMin, highlightedAirportHoverRadiusMax),
          interp(generalAirportHoverRadiusMin, generalAirportHoverRadiusMax),
        ) + 6;
        const keepRadiusSq = keepRadius * keepRadius;
        const hoveredCode = refs.hoveredAirportCodeRef.current;
        const hoveredPoint = refs.projectedAirportsRef.current.find(ap => ap.code === hoveredCode);
        if (hoveredPoint) {
          const dx = hoveredPoint.x - x;
          const dy = hoveredPoint.y - y;
          if (dx * dx + dy * dy <= keepRadiusSq) {
            code = hoveredCode;
            refs.hoverLockUntilRef.current = Date.now() + CONFIG.HOVER_LOCK_EXTENSION;
          }
        }
      }

      if (!code && refs.hoveredAirportCodeRef.current && Date.now() < refs.hoverLockUntilRef.current) {
        code = refs.hoveredAirportCodeRef.current;
      }

      refs.lastDetectedCodeRef.current = code;

      if (code === null) {
        if (!refs.isRouteHoveredRef.current) {
          refs.hoverSampleCountRef.current = 0;
          if (refs.hoverClearTimerRef.current === null) {
            refs.hoverClearTimerRef.current = setTimeout(() => {
              refs.hoverClearTimerRef.current = null;
              applyHover(null);
            }, CONFIG.HOVER_CLEAR_DELAY_MS);
          }
        }
      } else if (code !== refs.hoveredAirportCodeRef.current) {
        if (refs.hoverClearTimerRef.current !== null) {
          clearTimeout(refs.hoverClearTimerRef.current);
          refs.hoverClearTimerRef.current = null;
        }
        refs.hoverSampleCountRef.current += 1;
        if (refs.hoverSampleCountRef.current >= HOVER_SAMPLE_EVERY) {
          refs.hoverSampleCountRef.current = 0;
          applyHover(code, { x, y }, true);
        }
      } else if (refs.hoverClearTimerRef.current !== null) {
        clearTimeout(refs.hoverClearTimerRef.current);
        refs.hoverClearTimerRef.current = null;
      }

      if (refs.mouseStopTimerRef.current !== null) clearTimeout(refs.mouseStopTimerRef.current);
      refs.mouseStopTimerRef.current = setTimeout(() => {
        refs.mouseStopTimerRef.current = null;
        refs.hoverSampleCountRef.current = 0;
        if (refs.hoverClearTimerRef.current !== null) {
          clearTimeout(refs.hoverClearTimerRef.current);
          refs.hoverClearTimerRef.current = null;
        }
        applyHover(refs.lastDetectedCodeRef.current, { x, y });
      }, CONFIG.HOVER_STOP_DELAY_MS);
    };

    const handleMouseLeave = () => {
      refs.lastDetectedCodeRef.current = null;
      refs.hoverSampleCountRef.current = 0;
      if (refs.mouseStopTimerRef.current !== null) {
        clearTimeout(refs.mouseStopTimerRef.current);
        refs.mouseStopTimerRef.current = null;
      }
      if (refs.hoverClearTimerRef.current !== null) {
        clearTimeout(refs.hoverClearTimerRef.current);
        refs.hoverClearTimerRef.current = null;
      }
      applyHover(null);
    };

    const handleClick = (_e: MouseEvent) => {
      if (!refs.airportsDataRef.current || !refs.map.current) return;
      const code = refs.hoveredAirportCodeRef.current;
      if (!code) return;
      const feat = refs.airportsDataRef.current.features.find(f => f.properties.code === code);
      if (!feat) return;
      const isTripAirport = (refs.tripVisibleAirportCodesRef.current ?? []).includes(code);
      if (isTripAirport) return;
      const inTripMode = refs.tripVisibleAirportCodesRef.current && refs.tripVisibleAirportCodesRef.current.length > 0;
      if (inTripMode) {
        useFilterStore.getState().setDestinationFilter({ airports: [code], cities: [], countries: [] });
        return;
      }
      const isHighlighted = refs.highlightedAirportsRef.current.includes(code);
      const data = {
        code: feat.properties.code,
        name: getLocalizedProp(feat.properties, 'name', language),
        city_code: feat.properties.city_code,
        city_name: getLocalizedProp(feat.properties, 'city_name', language),
        country_code: feat.properties.country_code,
        country_name: getLocalizedProp(feat.properties, 'country_name', language),
        time_zone: feat.properties.time_zone || null,
        coordinates: { lon: feat.geometry.coordinates[0], lat: feat.geometry.coordinates[1] },
      };
      refs.onSelectItemRef.current?.({ type: 'airport', data: data as any, isHighlighted, fromMap: true });
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('click', handleClick);

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('click', handleClick);
      if (refs.mouseStopTimerRef.current !== null) clearTimeout(refs.mouseStopTimerRef.current);
      if (refs.hoverClearTimerRef.current !== null) clearTimeout(refs.hoverClearTimerRef.current);
    };
  }, [mapLoaded, showAirports, language]);
}
