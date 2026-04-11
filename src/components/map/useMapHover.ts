/**
 * HOOK INTERAKCJI MAPY (useMapHover.ts - WERSJA ATOMYCZNA v9.2)
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
import { CONFIG } from '../../constants/config';
import { spatialIndex } from '../../utils/spatialIndex';
import { getLocalizedProp } from '../../utils/i18n';

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
}

export function useMapHover(refs: MapHoverRefs, mapLoaded: boolean, showAirports: boolean): void {
  const language = useSettingsStore(s => s.language);

  useEffect(() => {
    if (!mapLoaded || !refs.map.current) return;
    const m = refs.map.current;
    const canvas = m.getCanvas();

    // 1. KESZOWANIE CECH (O(1))
    const airportFeaturesMap = new Map<string, AirportFeature>();
    if (refs.airportsDataRef.current) {
      refs.airportsDataRef.current.features.forEach(f => {
        airportFeaturesMap.set(f.properties.code.toUpperCase(), f);
      });
    }

    /**
     * SNAJPERSKI RADIUS (v11.6)
     * Oblicza promień klikalności na podstawie zooma i typu punktu.
     * @param isHover - jeśli true, zwraca większy promień powiększonej kropki GPU.
     */
    const getVisualRadius = (code: string, zoom: number, cS: any, isHover = false): number => {
      const isSelected = refs.selectedAirportCodesRef.current.includes(code);
      const isDest = refs.highlightedAirportsRef.current.includes(code);
      const tvac = refs.tripVisibleAirportCodesRef.current || [];
      const isTrip = tvac.includes(code);

      const zMin = n(cS.zoomRangeMin, 1.3);
      const zMax = n(cS.zoomRangeMax, 12);
      const t = Math.max(0, Math.min(1, (zoom - zMin) / (zMax - zMin)));

      // Wyznaczamy progi na podstawie tego, czy obiekt jest "Ważny"
      const isHigh = isSelected || isDest || isTrip;
      
      let minR, maxR;
      if (isHover) {
        // Promień HOVER (Powiększony)
        minR = isHigh ? n(cS.highlightedAirportHoverRadiusMin, 10) : n(cS.generalAirportHoverRadiusMin, 6);
        maxR = isHigh ? n(cS.highlightedAirportHoverRadiusMax, 22) : n(cS.generalAirportHoverRadiusMax, 14);
      } else {
        // Promień NORMALNY
        minR = isHigh ? n(cS.highlightedAirportRadiusMin, 6) : n(cS.generalAirportRadiusMin, 2);
        maxR = isHigh ? n(cS.highlightedAirportRadiusMax, 16) : n(cS.generalAirportRadiusMax, 8);
      }

      return minR + t * (maxR - minR);
    };

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

      refs.hoveredAirportCodeRef.current = code;
      const feat = airportFeaturesMap.get(code.toUpperCase());
      if (feat) {
        const hoverFeature = JSON.parse(JSON.stringify(feat));
        const cS = useColorStore.getState();

        // Wyznaczanie typu dla kolorów (Priorytety)
        let type: 'selected' | 'destination' | 'trip' | 'general' = 'general';
        const sac = refs.selectedAirportCodesRef.current || [];
        const ha = refs.highlightedAirportsRef.current || [];
        const tvac = refs.tripVisibleAirportCodesRef.current || [];

        if (sac.includes(code)) type = 'selected';
        else if (tvac.includes(code)) type = 'trip';
        else if (ha.includes(code)) type = 'destination';

        const isHigh = type !== 'general';
        
        // Ustawianie parametrów dynamicznych w Feature (dla GPU)
        hoverFeature.properties.h_r_min = isHigh ? cS.highlightedAirportHoverRadiusMin : cS.generalAirportHoverRadiusMin;
        hoverFeature.properties.h_r_max = isHigh ? cS.highlightedAirportHoverRadiusMax : cS.generalAirportHoverRadiusMax;
        hoverFeature.properties.h_f_min = isHigh ? cS.highlightedLabelHoverSizeMin : cS.generalLabelHoverSizeMin;
        hoverFeature.properties.h_f_max = isHigh ? cS.highlightedLabelHoverSizeMax : cS.generalLabelHoverSizeMax;

        let color = cS.generalAirportHover;
        let textColor = cS.generalLabelHoverColor;

        if (type === 'selected') {
          const idx = sac.indexOf(code);
          color = cS.startPoints[idx === -1 ? 0 : idx]?.airportHover || '#2563eb';
          textColor = cS.startPoints[idx === -1 ? 0 : idx]?.labelHover || '#ffffff';
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

        const pad = 4;
        hoverFeature.properties.h_off_n = [0, (n(hoverFeature.properties.h_r_min, 6) + pad) / (n(hoverFeature.properties.h_f_min, 11) || 11)];
        hoverFeature.properties.h_off_f = [0, (n(hoverFeature.properties.h_r_max, 10) + pad) / (n(hoverFeature.properties.h_f_max, 13) || 13)];

        const data = { type: 'FeatureCollection', features: [hoverFeature] };
        refs.hoverFeatureDataRef.current = data;
        if (canvas) canvas.style.cursor = 'pointer';

        const s = m.getSource('airports-hover-single') as maplibregl.GeoJSONSource;
        if (s) s.setData(data as any);
      }
    };

    refs.applyHoverRef.current = applyHover;

    const handleMouseMove = (e: MouseEvent | { clientX: number, clientY: number }) => {
      if (!showAirports || !spatialIndex) return;
      if (Date.now() < refs.hoverLockUntilRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const zoom = m.getZoom();
      const cS = useColorStore.getState();

      // 1. ZASADA HISTEREZY (v11.6): Najpierw sprawdzamy, czy wciąż jesteśmy nad AKTUALNIE podświetlonym punktem
      const currentHovered = refs.hoveredAirportCodeRef.current;
      if (currentHovered) {
        const dist = spatialIndex.getDistance(currentHovered, x, y);
        const stickyRadius = getVisualRadius(currentHovered, zoom, cS, true);
        if (dist <= stickyRadius) {
          // Jesteśmy wciąż wewnątrz powiększonej kropki GPU -> Zostajemy tutaj!
          if (canvas) canvas.style.cursor = 'pointer';
          return;
        }
      }

      // 2. NORMALNY SKAN (Broad search)
      const SCAN_DIST = 35; // Zwiększony zasięg dla ogólnego skanu
      const candidates = spatialIndex.searchRadius(x, y, SCAN_DIST);
      
      let bestCode: string | null = null;
      let minDistance = Infinity;
      let highestPriority = -1;

      for (const cand of candidates) {
        const visualR = getVisualRadius(cand.code, zoom, cS, false);
        const HIT_MARGIN = 2; // Mały margines błędu dla normalnych kropek
        
        if (cand.distance <= visualR + HIT_MARGIN) {
          // Priorytetyzacja (hierarchia)
          let priority = 0; // general
          if (refs.selectedAirportCodesRef.current.includes(cand.code)) priority = 3;
          else if (refs.highlightedAirportsRef.current.includes(cand.code)) priority = 2;
          else if (refs.tripVisibleAirportCodesRef.current?.includes(cand.code)) priority = 1;

          if (priority > highestPriority) {
            highestPriority = priority;
            bestCode = cand.code;
            minDistance = cand.distance;
          } else if (priority === highestPriority && cand.distance < minDistance) {
            bestCode = cand.code;
            minDistance = cand.distance;
          }
        }
      }

      if (bestCode !== refs.lastDetectedCodeRef.current) {
        refs.lastDetectedCodeRef.current = bestCode;
        applyHover(bestCode);
        refs.applyColors('all');
      }
    };

    // 4. TRANSFORM LOCK (v11.10)
    const onMoveStart = () => {
      refs.hoverLockUntilRef.current = 9999999999999; // LOCK
      applyHover(null);
      refs.applyColors('all');
    };

    const onMoveEnd = () => {
      refs.hoverLockUntilRef.current = 0; // UNLOCK
      // Trigger scan after movement stops
      const lastPos = (m as any)._mousePos;
      if (lastPos) {
         handleMouseMove({ clientX: lastPos.x, clientY: lastPos.y });
      }
    };

    m.on('movestart', onMoveStart);
    m.on('moveend', onMoveEnd);

    window.addEventListener('mousemove', handleMouseMove);
    const handleClick = (_e: MouseEvent) => {
      const code = refs.hoveredAirportCodeRef.current;
      if (!code || !refs.airportsDataRef.current) return;

      const feat = airportFeaturesMap.get(code.toUpperCase());
      if (!feat) return;

      const isTrip = (refs.tripVisibleAirportCodesRef.current || []).includes(code);
      if (isTrip) return;

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

      refs.onSelectItemRef.current({
        type: 'airport',
        data: data as any,
        isHighlighted: refs.highlightedAirportsRef.current.includes(code),
        fromMap: true
      });
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);
    return () => {
      m.off('movestart', onMoveStart);
      m.off('moveend', onMoveEnd);
      window.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
    };
  }, [mapLoaded, showAirports, language, refs.map]);
}
