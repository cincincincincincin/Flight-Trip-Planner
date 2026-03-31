import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import type { SelectedItem, AirportFeatureProps } from '../../types';
import { useColorStore } from '../../stores/colorStore';
import { useFilterStore } from '../../stores/filterStore';
import { getAirport } from '../../api/search';
import { CONFIG } from '../../constants/config';

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
}

export function useMapHover(refs: MapHoverRefs, mapLoaded: boolean, showAirports: boolean): void {
  useEffect(() => {
    if (!mapLoaded || !refs.map.current) return;
    const m = refs.map.current;
    const canvas = m.getCanvas();
    const HOVER_SAMPLE_EVERY = CONFIG.HOVER_SAMPLE_EVERY;
    const LABEL_CLEAR_RADIUS = CONFIG.LABEL_CLEAR_RADIUS;

    const getNearbyAirportCodes = (point: { x: number; y: number }) => {
      const rSq = LABEL_CLEAR_RADIUS * LABEL_CLEAR_RADIUS;
      const codes = new Set<string>();
      for (const ap of refs.projectedAirportsRef.current) {
        const dx = ap.x - point.x;
        const dy = ap.y - point.y;
        if (dx * dx + dy * dy <= rSq) codes.add(ap.code);
      }
      return [...codes];
    };

    const applyHover = (code: string | null, point?: { x: number; y: number }) => {
      const sameCode = code === refs.hoveredAirportCodeRef.current;
      if (sameCode && !point) return;
      refs.hoveredAirportCodeRef.current = code;
      if (m.getCanvas()) {
        m.getCanvas().style.cursor = code ? 'pointer' : '';
      }
      if (m.getLayer('airports-hover')) {
        m.setFilter('airports-hover', ['==', 'code', code ?? '']);
      }
      const prevRouteId = refs.hoveredRouteId.current;
      if (code !== null && prevRouteId != null) {
        m.setFeatureState({ source: 'selected-routes', id: prevRouteId }, { hover: false });
        refs.hoveredRouteId.current = null;
        m.setFilter('airports-route-hover', ['==', 'code', '']);
        m.setFilter('airports-labels-hover', ['==', 'code', '']);
        m.setFilter('airports-labels-hover-general', ['==', 'code', '']);
      }
      if (code !== null || refs.hoveredRouteId.current === null) {
        const isFocused =
          code !== null &&
          (refs.highlightedAirportsRef.current.includes(code) ||
            refs.selectedAirportCodesRef.current.includes(code) ||
            refs.explorationAirportCodesRef.current.includes(code) ||
            (refs.tripVisibleAirportCodesRef.current?.includes(code) ?? false));
        if (m.getLayer('airports-labels-hover')) {
          m.setFilter('airports-labels-hover', [
            '==',
            'code',
            isFocused || code === null ? code ?? '' : '',
          ]);
        }
        if (m.getLayer('airports-labels-hover-general')) {
          m.setFilter('airports-labels-hover-general', [
            '==',
            'code',
            !isFocused && code !== null ? code : '',
          ]);
        }
      }
      // Exclude nearby labels around hover to avoid overlaps
      const inTripMode = !!(refs.tripVisibleAirportCodesRef.current?.length);
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
      if (m.getLayer('airports-labels-normal')) {
        if (inTripMode) {
          m.setFilter('airports-labels-normal', ['==', 'code', '']);
        } else {
          const baseFilter: maplibregl.LegacyFilterSpecification | null =
            refs.highlightedLabelCodesRef.current.length > 0
              ? ['!in', 'code', ...refs.highlightedLabelCodesRef.current]
              : null;
          if (excludeCodes.length > 0 && baseFilter) {
            m.setFilter('airports-labels-normal', [
              'all',
              baseFilter,
              ['!in', 'code', ...excludeCodes],
            ] as maplibregl.FilterSpecification);
          } else if (excludeCodes.length > 0) {
            m.setFilter('airports-labels-normal', ['!in', 'code', ...excludeCodes]);
          } else if (baseFilter) {
            m.setFilter('airports-labels-normal', baseFilter);
          } else {
            m.setFilter('airports-labels-normal', null);
          }
        }
      }
      if (m.getLayer('airports-labels-normal-city')) {
        if (inTripMode) {
          m.setFilter('airports-labels-normal-city', ['==', 'code', '']);
        } else {
          const baseCityFilter: maplibregl.LegacyFilterSpecification | null =
            refs.cityLabelCodesRef.current.length > 0
              ? ['in', 'code', ...refs.cityLabelCodesRef.current]
              : null;
          const highlightedCityFilter: maplibregl.LegacyFilterSpecification | null =
            refs.highlightedCityLabelCodesRef.current.length > 0
              ? ['!in', 'code', ...refs.highlightedCityLabelCodesRef.current]
              : null;
          const hoverCityFilter: maplibregl.LegacyFilterSpecification | null =
            excludeCodes.length > 0 ? ['!in', 'code', ...excludeCodes] : null;
          const allFilters = [baseCityFilter, highlightedCityFilter, hoverCityFilter].filter(
            Boolean,
          ) as maplibregl.FilterSpecification[];
          if (allFilters.length > 1) {
            m.setFilter('airports-labels-normal-city', [
              'all',
              ...allFilters,
            ] as maplibregl.FilterSpecification);
          } else if (allFilters.length === 1) {
            m.setFilter('airports-labels-normal-city', allFilters[0]);
          } else {
            m.setFilter('airports-labels-normal-city', null);
          }
        }
      }
      // Don't update highlighted labels while route hover is active
      if (!refs.isRouteHoveredRef.current) {
        const hlCodes = refs.highlightedLabelCodesRef.current;
        const filteredHl =
          excludeCodes.length > 0 ? hlCodes.filter(c => !excludeCodes.includes(c)) : hlCodes;
        const hlFilter: maplibregl.FilterSpecification =
          filteredHl.length === 0 ? ['==', 'code', ''] : ['in', 'code', ...filteredHl];
        if (m.getLayer('airports-labels-highlighted'))
          m.setFilter('airports-labels-highlighted', hlFilter);
        if (m.getLayer('airports-labels-highlighted-city')) {
          const hlCityCodes = refs.highlightedCityLabelCodesRef.current;
          const filteredCity =
            excludeCodes.length > 0
              ? hlCityCodes.filter(c => !excludeCodes.includes(c))
              : hlCityCodes;
          const hlCityFilter: maplibregl.FilterSpecification =
            filteredCity.length === 0 ? ['==', 'code', ''] : ['in', 'code', ...filteredCity];
          m.setFilter('airports-labels-highlighted-city', hlCityFilter);
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!refs.map.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      let code: string | null = null;
      if (showAirports) {
        const THRESHOLD = CONFIG.HOVER_RADIUS_FALLBACK;
        const tSq = THRESHOLD * THRESHOLD;
        let bestDist = Infinity;
        for (const ap of refs.projectedAirportsRef.current) {
          const dx = ap.x - x;
          const dy = ap.y - y;
          const dist = dx * dx + dy * dy;
          if (dist <= tSq && dist < bestDist) {
            bestDist = dist;
            code = ap.code;
          }
        }
        if (code !== null) {
          refs.hoverLockUntilRef.current = Date.now() + CONFIG.HOVER_LOCK_DURATION_MS;
          const tripCodes = refs.tripVisibleAirportCodesRef.current;
          if (tripCodes && tripCodes.length > 0) {
            if (!new Set([...tripCodes, ...refs.highlightedAirportsRef.current]).has(code))
              code = null;
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
        const keepRadius =
          Math.max(
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
          applyHover(code, { x, y });
        }
      } else if (refs.hoverClearTimerRef.current !== null) {
        clearTimeout(refs.hoverClearTimerRef.current);
        refs.hoverClearTimerRef.current = null;
      }

      // After mouse stops moving: snap to exact current position
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

      const inTripMode =
        refs.tripVisibleAirportCodesRef.current &&
        refs.tripVisibleAirportCodesRef.current.length > 0;

      if (inTripMode) {
        useFilterStore
          .getState()
          .setDestinationFilter({ airports: [code], cities: [], countries: [] });
        return;
      }

      const isHighlighted = refs.highlightedAirportsRef.current.includes(code);
      (async () => {
        try {
          const data = await getAirport(code);
          refs.onSelectItemRef.current?.({ type: 'airport', data, isHighlighted, fromMap: true });
        } catch {
          refs.onSelectItemRef.current?.({
            type: 'airport',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: feat.properties as any,
            isHighlighted,
            fromMap: true,
          });
        }
      })();
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('click', handleClick);
      if (refs.mouseStopTimerRef.current !== null) {
        clearTimeout(refs.mouseStopTimerRef.current);
        refs.mouseStopTimerRef.current = null;
      }
      if (refs.hoverClearTimerRef.current !== null) {
        clearTimeout(refs.hoverClearTimerRef.current);
        refs.hoverClearTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, showAirports]);
}
