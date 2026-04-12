/**
 * HOOK INTERAKCJI MAPY (useMapHover.ts - WERSJA ATOMYCZNA v18.40)
 * 
 * Implementuje logikę "Snajperskiej Precyzji" - hit-testing idealnie zgrany z rozmiarem GPU.
 * Przygotowuje dane (Feature) dla Heartbeata w MapComponent.
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
  hoverFeatureDataRef: React.MutableRefObject<any | null>;
  applyColors: (mode: 'all' | 'hover-only') => void;
  applyHoverRef: React.MutableRefObject<((code: string | null) => void) | null>;
  mapStyle: string;
  selectedAirportCode: string | null;
  // TRYB PODRÓŻY (v16.15/80)
  isTripActive: boolean;
}

export function useMapHover(refs: MapHoverRefs, mapLoaded: boolean, showAirports: boolean): void {
  const language = useSettingsStore(s => s.language);

  useEffect(() => {
    if (!mapLoaded || !refs.map.current) return;
    const m = refs.map.current;
    const canvas = m.getCanvas();

    // 1. DYNAMICZNE KESZOWANIE CECH (v15.80: Reactive Features)
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
      if (!feat) return;

      // RDZEŃ BLOKADY INTERAKCJI (v16.80: Selective Interaction)
      // W trybie podróży ignorujemy wszystko, co nie jest Selected/Dest/Trip
      if (refs.isTripActive && !feat.properties.is_high) {
        applyHover(null);
        return;
      }

      refs.hoveredAirportCodeRef.current = code;
      const hoverFeature = JSON.parse(JSON.stringify(feat));
      const cS = useColorStore.getState();
      const isImg = (refs.mapStyle || '').toLowerCase().includes('imagery');

      let type: 'selected' | 'destination' | 'trip' | 'general' = 'general';
      const currentZoom = m.getZoom();
      const isGroupingPhase = currentZoom < 7.0;
      let activeIdx = -1;

      if (isGroupingPhase && feat.properties.is_city_primary) {
        if (feat.properties.is_city_selected) {
          type = 'selected';
          activeIdx = n(feat.properties.la_city_sel_idx, -1);
        } else if (feat.properties.is_city_dest) {
          type = 'destination';
        } else if (feat.properties.is_city_trip) {
          type = 'trip';
        }
      } else {
        if (feat.properties.is_selected) {
          type = 'selected';
          activeIdx = n(feat.properties.la_sel_idx, -1);
        } else if (feat.properties.is_dest) {
          type = 'destination';
        } else if (feat.properties.is_trip) {
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
      hoverFeature.properties.h_off_n = feat.properties.la_off_n || [0, 0];
      hoverFeature.properties.h_off_f = feat.properties.la_off_f || [0, 0];

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
        } catch(e) {}
      }
    };

    refs.applyHoverRef.current = applyHover;

    const prevNaturalHits = new Set<string>();
    const lastMoveTimeRef = { current: 0 };

    const processInteraction = (x: number, y: number, candidates: Array<{code: string, distance: number}>) => {
      refreshFeatureMap();
      const zoom = m.getZoom();
      const cS = useColorStore.getState();
      const currentHovered = refs.hoveredAirportCodeRef.current;
      
      const sac = refs.selectedAirportCodesRef.current || [];
      const ha = refs.highlightedAirportsRef.current || [];
      const tvac = refs.tripVisibleAirportCodesRef.current || [];
      const eac = refs.explorationAirportCodesRef.current || [];
      const mtac = (window as any).manualTransferAirportCodes || [];

      // 1. Wyznaczamy Trafienia Naturalne
      const currentNaturalHits = new Map<string, { dist: number }>();
      const HIT_MARGIN = 1.0;

      candidates.forEach(cand => {
        // RDZEŃ BLOKADY (Interaction Guard v16.80)
        if (refs.isTripActive) {
          const feat = cachedAirportsMap.get(cand.code.toUpperCase());
          if (!feat || !feat.properties.is_high) return;
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
        requestAnimationFrame(() => {
          refs.applyColors('all');
        });
      }
    };

    const handleMouseMove = (e: MouseEvent | { clientX: number, clientY: number }) => {
      if (!showAirports || !spatialIndex) return;
      if (Date.now() < refs.hoverLockUntilRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
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
      const candidates: Array<{code: string, distance: number}> = [];
      const seen = new Set<string>();

      nearby.forEach(cand => {
        const feat = cachedAirportsMap.get(cand.code.toUpperCase());
        if (feat && !seen.has(cand.code)) {
          // RDZEŃ BLOKADY (Interaction Guard v16.80)
          if (refs.isTripActive && !feat.properties.is_high) return;

          const p = m.project(feat.geometry.coordinates as [number, number]);
          const dist = Math.sqrt((lastPos.x - p.x)**2 + (lastPos.y - p.y)**2);
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

    // --- SNIPER CLICK HANDLING (v24.30: Hover-Perfect Interaction) ---
    const handleClick = (e: MouseEvent) => {
      refreshFeatureMap();
      
      // [PRIORITY]: Kliknięcie odbywa się na tym, co jest aktualnie HOVEROWANE
      // Gwarantuje to trafienie w powiększoną kropkę (Sniper Precision)
      const code = refs.hoveredAirportCodeRef.current;
      if (!code) return;

      const fullFeat = cachedAirportsMap.get(code.toUpperCase());
      if (!fullFeat) return;

      const tripState = useTripStore.getState().tripState;
      const currentTripActive = !!(tripState && tripState.legs && tripState.legs.length > 0);
      
      // [PROTECTIVE GUARDS v24.50]: 
      // 1. Nigdy nie filtrujemy "Selected" (punktów startowych)
      if (fullFeat.properties.is_selected) return;

      if (currentTripActive) {
        // 2. W trybie podróży filtrujemy TYLKO aktualne cele (destinations)
        if (!fullFeat.properties.is_high && !fullFeat.properties.is_dest) {
          return;
        }

        // [MULTI-SELECT SYNC v24.40]: Dodawanie/usuwanie z tablicy zamiast zastępowania
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

        if (useSettingsStore.getState().showConsoleLogs) {
           console.log(`[MAP-CLICK|MULTI] Toggling ${code}. New list: ${nextAirports.join(', ')}`);
        }
        
        useFilterStore.getState().setDestinationFilter(nextFilter);
        return;
      }

      // TRYB ZWYKŁY (Wybór lotniska)
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
    };
  }, [mapLoaded, showAirports, language, refs.map]);
}
