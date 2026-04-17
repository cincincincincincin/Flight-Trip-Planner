/**
 * HOOK INTERAKCJI MAPY
 * Implementuje logikę precyzyjnego wykrywania obiektów pod kursorem.
 */

import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import type { SelectedItem, AirportFeatureProps } from '../../types';
import { useColorStore } from '../../stores/colorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTripStore } from '../../stores/tripStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useFilterStore } from '../../stores/filterStore';
import { CONFIG } from '../../constants/config';
import { EMPTY_DESTINATION_FILTER } from '../../constants/filters';
import { spatialIndex } from '../../utils/spatialIndex';
import { getLocalizedProp } from '../../utils/i18n';
import { getLabelPaint, isSystemColor, mergeFilterConditions, getVisualRadius } from './utils';
import { logger } from '../../utils/logger';

interface AirportFeature {
  properties: AirportFeatureProps;
  geometry: { coordinates: number[] };
}

interface AirportsGeoJSON {
  features: AirportFeature[];
}

const n = (v: any, fallback: number): number => {
  const num = Number(v);
  return isNaN(num) ? fallback : num;
};

export interface MapHoverRefs {
  map: React.RefObject<maplibregl.Map | null>;
  projectedAirportsRef: React.RefObject<Array<{ code: string; x: number; y: number }>>;
  hoveredAirportCodeRef: React.RefObject<string | null>;
  lastDetectedCodeRef: React.RefObject<string | null>;
  hoverSampleCountRef: React.RefObject<number>;
  mouseStopTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  hoverClearTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  hoverLockUntilRef: React.RefObject<number>;
  isRouteHoveredRef: React.RefObject<boolean>;
  hoveredRouteId: React.RefObject<string | number | null>;
  airportCityKeyRef: React.RefObject<Record<string, string>>;
  cityLabelCodeByCityRef: React.RefObject<Record<string, string>>;
  cityLabelCodesRef: React.RefObject<string[]>;
  highlightedLabelCodesRef: React.RefObject<string[]>;
  highlightedCityLabelCodesRef: React.RefObject<string[]>;
  highlightedAirportsRef: React.RefObject<string[]>;
  selectedAirportCodesRef: React.RefObject<string[]>;
  explorationAirportCodesRef: React.RefObject<string[]>;
  tripVisibleAirportCodesRef: React.RefObject<string[] | null>;
  airportsDataRef: React.RefObject<AirportsGeoJSON | undefined>;
  onSelectItemRef: React.RefObject<(item: SelectedItem) => void>;
  hoverFeatureDataRef: React.RefObject<any | null>;
  applyColors: (mode: 'all' | 'hover-only') => void;
  applyHoverRef: React.RefObject<((code: string | null) => void) | null>;
  mapStyle: string;
  selectedAirportCode: string | null;
  isTripActiveRef: React.RefObject<boolean>;
}

export function useMapHover(refs: MapHoverRefs, mapLoaded: boolean, showAirports: boolean): void {
  const language = useSettingsStore(s => s.language);

  useEffect(() => {
    if (!mapLoaded || !refs.map.current) return;
    const m = refs.map.current;
    const canvas = m.getCanvas();

    let canvasRect = canvas.getBoundingClientRect();
    const updateCanvasRect = () => {
      if (canvas) canvasRect = canvas.getBoundingClientRect();
    };
    window.addEventListener('resize', updateCanvasRect);
    window.addEventListener('scroll', updateCanvasRect, true);
    // Wykrywa zmianę rozmiaru/pozycji canvasu gdy otwiera się panel boczny.
    const resizeObs = new ResizeObserver(updateCanvasRect);
    resizeObs.observe(canvas);
    // Też aktualizuj gdy kursor wchodzi na canvas (po layoutshift bez resize).
    canvas.addEventListener('mouseenter', updateCanvasRect);

    // 1. Dynamiczne buforowanie cech
    let cachedAirportsMap = new Map<string, AirportFeature>();
    let lastDataRef: any = null;

    const refreshFeatureMap = () => {
      if (!refs.airportsDataRef.current || refs.airportsDataRef.current === lastDataRef) return;
      const newMap = new Map<string, AirportFeature>();
      refs.airportsDataRef.current.features.forEach(f => {
        newMap.set(f.properties.code.toUpperCase(), f);
      });
      cachedAirportsMap = newMap;
      lastDataRef = refs.airportsDataRef.current;
    };

    refreshFeatureMap();

    const applyHover = (code: string | null) => {
      const m = refs.map.current;
      if (!m || !(m as any).getStyle()) return;

      if (code === null) {
        refs.hoveredAirportCodeRef.current = null;
        refs.hoverFeatureDataRef.current = null;
        if (canvas) canvas.style.cursor = '';
        const s = m.getSource('airports-hover-single') as maplibregl.GeoJSONSource;
        if (s) s.setData({ type: 'FeatureCollection', features: [] });
        return;
      }

      refreshFeatureMap();
      const feat = cachedAirportsMap.get(code.toUpperCase());
      if (!feat) {
        // Jeśli kod istnieje w SpatialIndex, ale nie w danych, czyścimy hover.
        applyHover(null);
        return;
      }

      // Odczyt bezpośrednio ze store — refs mogą być przestarzałe gdy applyHover jest wywoływany
      // z applyColors (po usunięciu lotniska ref jeszcze nie zaktualizowany przez useEffect).
      const selState = useSelectionStore.getState();
      const tripStoreState = useTripStore.getState();
      const sac = selState.selectedAirportCodes || [];
      const ha = selState.highlightedAirports || [];
      const eac = selState.explorationItems.flatMap((i: any) => i.airportCodes);
      const tvac = tripStoreState.tripState?.legs?.flatMap((l: any) => [l.fromAirportCode, l.toAirportCode]) || [];
      const mtac = tripStoreState.manualTransferAirportCodes || [];

      // W trybie podróży ignorujemy wszystko, co nie jest widoczne (wyróżnione)
      if (refs.isTripActiveRef.current) {
        const isVisibleInTrip = sac.includes(code) || ha.includes(code) || tvac.includes(code) || eac.includes(code) || mtac.includes(code);
        if (!isVisibleInTrip) {
          applyHover(null);
          return;
        }
      }

      refs.hoveredAirportCodeRef.current = code;
      const hoverFeature = JSON.parse(JSON.stringify(feat));
      const cS = useColorStore.getState();
      const isImg = (refs.mapStyle || '').toLowerCase().includes('imagery');

      let type: 'selected' | 'destination' | 'trip' | 'general' = 'general';
      const currentZoom = refs.map.current?.getZoom() || 0;
      const isGroupingPhase = currentZoom < 7.0;
      let activeIdx = -1;

      const tripCodes = Array.from(new Set([...tvac, ...mtac]));

      const isSelected = sac.includes(code);
      const isDest = ha.includes(code);
      const isTrip = tripCodes.includes(code);

      const cityCode = feat.properties.city_code;
      const cityKeyMap = refs.airportCityKeyRef.current || {};
      
      const citySelectedCodes = Array.from(new Set(sac.map(c => cityKeyMap[c]).filter(Boolean)));
      const cityDestCodes = Array.from(new Set(ha.map(c => cityKeyMap[c]).filter(Boolean)));
      const cityTripCodes = Array.from(new Set(tripCodes.map(c => cityKeyMap[c]).filter(Boolean)));

      const isCitySelected = cityCode ? citySelectedCodes.includes(cityCode) : false;
      const isCityDest = cityCode ? cityDestCodes.includes(cityCode) : false;
      const isCityTrip = cityCode ? cityTripCodes.includes(cityCode) : false;
      const isCityPrimary = feat.properties.is_city_primary;

      if (isGroupingPhase) {
        if (isSelected) {
          type = 'selected';
          activeIdx = sac.indexOf(code);
        } else if (isCitySelected && isCityPrimary) {
          type = 'selected';
          const firstSelectedCode = sac.find(c => cityKeyMap[c] === cityCode);
          if (firstSelectedCode) activeIdx = sac.indexOf(firstSelectedCode);
        } else if (isDest) {
          type = 'destination';
        } else if (isCityDest && isCityPrimary) {
          type = 'destination';
        } else if (isTrip) {
          type = 'trip';
        } else if (isCityTrip && isCityPrimary) {
          type = 'trip';
        }
      } else {
        if (isSelected) {
          type = 'selected';
          activeIdx = sac.indexOf(code);
        } else if (isDest) {
          type = 'destination';
        } else if (isTrip) {
          type = 'trip';
        }
      }

      const isHigh = type !== 'general';
      hoverFeature.properties.h_r_min = isHigh ? cS.highlightedAirportHoverRadiusMin : cS.generalAirportHoverRadiusMin;
      hoverFeature.properties.h_r_max = isHigh ? cS.highlightedAirportHoverRadiusMax : cS.generalAirportHoverRadiusMax;
      hoverFeature.properties.h_f_min = isHigh ? cS.highlightedLabelHoverSizeMin : cS.generalLabelHoverSizeMin;
      hoverFeature.properties.h_f_max = isHigh ? cS.highlightedLabelHoverSizeMax : cS.generalLabelHoverSizeMax;

      let color = cS.generalAirportHover;
      let textColor = cS.generalLabelHoverColor;

      if (type === 'selected' && activeIdx !== -1) {
        const sp = cS.startPoints[activeIdx];
        color = sp?.airportHover || '#2563eb';
        textColor = sp?.labelHover || '#ffffff';
      } else if (type === 'destination') {
        color = cS.destinationAirportHover;
        textColor = cS.destinationLabelHoverColor;
      } else if (type === 'trip') {
        color = cS.tripAirportHover;
        textColor = cS.tripLabelHoverColor;
      }

      hoverFeature.properties.h_color = color;
      hoverFeature.properties.h_text_color = textColor;
      hoverFeature.properties.h_type = type;
      const pad = 3;
      // Offset hover labela: używamy HOVER radius (h_r_min/max), nie BASE radius
      const hRMin = hoverFeature.properties.h_r_min;
      const hRMax = hoverFeature.properties.h_r_max;
      const hFMin = hoverFeature.properties.h_f_min;
      const hFMax = hoverFeature.properties.h_f_max;
      hoverFeature.properties.h_off_n = [0, (hRMin + pad) / (hFMin || 16)];
      hoverFeature.properties.h_off_f = [0, (hRMax + pad) / (hFMax || 26)];

      const data = { type: 'FeatureCollection', features: [hoverFeature] };
      refs.hoverFeatureDataRef.current = data;
      if (canvas) canvas.style.cursor = 'pointer';

      const s = m.getSource('airports-hover-single') as maplibregl.GeoJSONSource;
      if (s) {
        s.setData(data as any);
        try {
          if (m.getLayer('airports-hover-single-circle')) {
            m.setPaintProperty('airports-hover-single-circle', 'circle-stroke-color', isImg ? '#000000' : '#ffffff');
          }
          if (m.getLayer('airports-hover-single-label')) {
            m.setPaintProperty('airports-hover-single-label', 'text-halo-color', isImg ? '#000000' : 'rgba(255,255,255,0.95)');
            m.setPaintProperty('airports-hover-single-label', 'text-halo-width', isImg ? 2.5 : 2.0);
          }
        } catch (e) { }
      }
    };

    refs.applyHoverRef.current = applyHover;

    const prevNaturalHits = new Set<string>();
    const lastMoveTimeRef = { current: 0 };
    let applyColorsTimeout: ReturnType<typeof setTimeout> | null = null;

    const processInteraction = (x: number, y: number, candidates: Array<{ code: string, distance: number }>) => {
      refreshFeatureMap();
      const zoom = m.getZoom();
      const cS = useColorStore.getState();
      const currentHovered = refs.hoveredAirportCodeRef.current;

      const selStateP = useSelectionStore.getState();
      const tripStoreStateP = useTripStore.getState();
      const sac = selStateP.selectedAirportCodes || [];
      const ha = selStateP.highlightedAirports || [];
      const eac = selStateP.explorationItems.flatMap((i: any) => i.airportCodes);
      const tvac = tripStoreStateP.tripState?.legs?.flatMap((l: any) => [l.fromAirportCode, l.toAirportCode]) || [];
      const mtac = tripStoreStateP.manualTransferAirportCodes || [];

      const currentNaturalHits = new Map<string, { dist: number }>();
      const HIT_MARGIN = 1.0;

      candidates.forEach(cand => {
        if (refs.isTripActiveRef.current) {
          const isVisibleInTrip = sac.includes(cand.code) || ha.includes(cand.code) || tvac.includes(cand.code) || eac.includes(cand.code) || mtac.includes(cand.code);
          if (!isVisibleInTrip) return;
        }

        const radius = getVisualRadius(cand.code, zoom, cS, false, sac, ha, tvac, eac, mtac);
        if (cand.distance <= radius + HIT_MARGIN) {
          currentNaturalHits.set(cand.code, { dist: cand.distance });
        }
      });

      let newlyEnteredCode: string | null = null;
      let minNewDist = Infinity;

      currentNaturalHits.forEach((data, code) => {
        if (!prevNaturalHits.has(code)) {
          if (data.dist < minNewDist) {
            newlyEnteredCode = code;
            minNewDist = data.dist;
          }
        }
      });

      let finalCode: string | null = null;
      if (newlyEnteredCode) {
        finalCode = newlyEnteredCode;
      } else if (currentNaturalHits.size > 0) {
        let minGlobalDist = Infinity;
        currentNaturalHits.forEach((data, code) => {
          if (data.dist < minGlobalDist) {
            minGlobalDist = data.dist;
            finalCode = code;
          }
        });
      } else if (currentHovered) {
        const cand = candidates.find(c => c.code === currentHovered);
        if (cand) {
          const stickyRadius = getVisualRadius(currentHovered, zoom, cS, true, sac, ha, tvac, eac, mtac);
          if (cand.distance <= stickyRadius + HIT_MARGIN) {
            finalCode = currentHovered;
          }
        }
      }

      prevNaturalHits.clear();
      currentNaturalHits.forEach((_, code) => prevNaturalHits.add(code));

      if (finalCode !== refs.lastDetectedCodeRef.current) {
        refs.lastDetectedCodeRef.current = finalCode;
        applyHover(finalCode);

        // OPTYMALIZACJA: Debouncing aktualizacji filtrów i kolorów. 
        // setFilter w MapLibre jest operacją ciężką, nie należy jej wywoływać w każdej klatce hovera.
        if (applyColorsTimeout) clearTimeout(applyColorsTimeout);
        applyColorsTimeout = setTimeout(() => {
          requestAnimationFrame(() => {
            refs.applyColors('all');
          });
        }, 80); // Debounce dla ciężkich operacji logicznych (hover dot jest aktualizowany natychmiast)
      }
    };

    const handleMouseMove = (e: MouseEvent | { clientX: number, clientY: number }) => {
      if (!showAirports || !spatialIndex) return;
      if (Date.now() < refs.hoverLockUntilRef.current) return;

      const x = e.clientX - canvasRect.left;
      const y = e.clientY - canvasRect.top;
      const SCAN_DIST = 45;
      const candidates = spatialIndex.searchRadius(x, y, SCAN_DIST);
      processInteraction(x, y, candidates);
    };

    const onMoveStart = () => { refs.hoverLockUntilRef.current = 9999999999999; };
    const onMove = () => {
      if (!refs.map.current || !spatialIndex) return;
      refreshFeatureMap();
      const now = Date.now();
      if (now - lastMoveTimeRef.current < 40) return;
      lastMoveTimeRef.current = now;
      const lastPos = (m as any)._mousePos;
      if (!lastPos) return;
      const nearby = spatialIndex.searchRadius(lastPos.x, lastPos.y, 100);
      const candidates: Array<{ code: string, distance: number }> = [];
      const seen = new Set<string>();

      nearby.forEach(cand => {
        const feat = cachedAirportsMap.get(cand.code.toUpperCase());
        if (feat && !seen.has(cand.code)) {
          if (refs.isTripActiveRef.current) {
            const _sel = useSelectionStore.getState();
            const _trip = useTripStore.getState();
            const _sac = _sel.selectedAirportCodes || [];
            const _ha = _sel.highlightedAirports || [];
            const _eac = _sel.explorationItems.flatMap((i: any) => i.airportCodes);
            const _tvac = _trip.tripState?.legs?.flatMap((l: any) => [l.fromAirportCode, l.toAirportCode]) || [];
            const _mtac = _trip.manualTransferAirportCodes || [];
            const visible = _sac.includes(cand.code) || _ha.includes(cand.code) || _tvac.includes(cand.code) || _eac.includes(cand.code) || _mtac.includes(cand.code);
            if (!visible) return;
          }

          const p = m.project(feat.geometry.coordinates as [number, number]);
          const dist = Math.sqrt((lastPos.x - p.x) ** 2 + (lastPos.y - p.y) ** 2);
          if (dist < 100) {
            candidates.push({ code: cand.code, distance: dist });
            seen.add(cand.code);
          }
        }
      });
      processInteraction(lastPos.x, lastPos.y, candidates);
    };

    const onMoveEnd = () => {
      requestAnimationFrame(() => {
        refs.hoverLockUntilRef.current = 0;
        const m = refs.map.current;
        if (!m) return;
        const lastPos = (m as any)._mousePos;
        if (lastPos) handleMouseMove({ clientX: lastPos.x, clientY: lastPos.y });
      });
    };

    m.on('movestart', onMoveStart); m.on('move', onMove); m.on('moveend', onMoveEnd);
    canvas.addEventListener('mousemove', handleMouseMove);

    const handleClick = (e: MouseEvent) => {
      refreshFeatureMap();

      const code = refs.hoveredAirportCodeRef.current;
      if (!code) return;

      const fullFeat = cachedAirportsMap.get(code.toUpperCase());
      if (!fullFeat) return;

      const tripState = useTripStore.getState().tripState;
      const currentTripActive = !!(tripState && tripState.legs && tripState.legs.length > 0);

      const sac = refs.selectedAirportCodesRef.current || [];
      const ha = refs.highlightedAirportsRef.current || [];
      const tvac = refs.tripVisibleAirportCodesRef.current || [];
      const eac = refs.explorationAirportCodesRef.current || [];
      const mtac = (window as any).manualTransferAirportCodes || [];

      // Jeśli lotnisko jest już wybrane (selected), ignorujemy kliknięcie
      if (sac.includes(code)) return;

      if (currentTripActive) {
        const isHighOrDest = sac.includes(code) || ha.includes(code) || tvac.includes(code) || eac.includes(code) || mtac.includes(code);
        if (!isHighOrDest) {
          return;
        }

        const currentFilter = useFilterStore.getState().destinationFilter;
        const airports = currentFilter.airports || [];
        const isAlreadyFiltered = airports.includes(code);

        let nextAirports: string[];
        if (isAlreadyFiltered) {
          nextAirports = airports.filter(a => a !== code);
        } else {
          nextAirports = [...airports, code];
        }

        const nextFilter = {
          ...currentFilter,
          airports: nextAirports
        };

        logger.log(`[MAP-CLICK|MULTI] Przełączanie ${code}. Nowa lista: ${nextAirports.join(', ')}`);

        useFilterStore.getState().setDestinationFilter(nextFilter);
        return;
      }

      // TRYB STANDARDOWY (Wybór lotniska)
      const data = {
        code: fullFeat.properties.code,
        name: getLocalizedProp(fullFeat.properties, 'name', language),
        city_code: fullFeat.properties.city_code,
        city_name: getLocalizedProp(fullFeat.properties, 'city_name', language),
        country_code: fullFeat.properties.country_code,
        country_name: getLocalizedProp(fullFeat.properties, 'country_name', language),
        time_zone: fullFeat.properties.time_zone || null,
        coordinates: { lon: fullFeat.geometry.coordinates[0], lat: fullFeat.geometry.coordinates[1] },
      };

      refs.onSelectItemRef.current({
        type: 'airport',
        data: data as any,
        isHighlighted: useSelectionStore.getState().highlightedAirports.includes(code),
        fromMap: true
      });
    };

    canvas.addEventListener('click', handleClick, { capture: true });

    return () => {
      m.off('movestart', onMoveStart); m.off('move', onMove); m.off('moveend', onMoveEnd);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick, { capture: true });
      window.removeEventListener('resize', updateCanvasRect);
      window.removeEventListener('scroll', updateCanvasRect, true);
      resizeObs.disconnect();
      canvas.removeEventListener('mouseenter', updateCanvasRect);
      if (applyColorsTimeout) clearTimeout(applyColorsTimeout);
    };
  }, [mapLoaded, showAirports, language, refs.map]);
}
