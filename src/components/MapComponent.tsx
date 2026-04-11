/**
 * KOMPONENT MAPY (MapComponent.tsx - WERSJA ATOMYCZNA v9.2)
 * 
 * Implementuje serce systemu: Atomyczny Heartbeat (RAF), który synchronizuje
 * wyświetlanie hovera, ukrywanie bazowych kropek oraz okluzję etykiet.
 */

import { forwardRef, useRef, useState, useEffect, useCallback, useMemo, useImperativeHandle } from 'react';
import maplibregl, { FlyToOptions } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { arcGISTransformRequest, resolveMapStyle } from './map/styleResolver';

import type { SelectedItem, Viewport, Flight } from '../types';
import { useMapStore } from '../stores/mapStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useTripStore } from '../stores/tripStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useColorStore } from '../stores/colorStore';
import { useAirportsQuery } from '../hooks/queries';
import { THEME_COLORS } from '../constants/theme';
import { CONFIG } from '../constants/config';
import { spatialIndex } from '../utils/spatialIndex';

import { addAirportsLayer } from './map/airportsLayer';
import { setupRouteLayers } from './map/layerSetup';
import { useMapHover } from './map/useMapHover';
import type { MapHoverRefs } from './map/useMapHover';
import { applyMapColors } from './map/colorApplier';
import { mergeFilterConditions } from './map/utils';
import { useRouteAnimation } from './map/useRouteAnimation';
import { setupRouteHoverListeners } from './map/routeHover';
import type { RouteHoverRefs } from './map/routeHover';

import './MapComponent.css';

export interface MapComponentRef {
  flyTo: (options: FlyToOptions) => void;
  getZoom: () => number | undefined;
  once: (event: string, callback: (...args: unknown[]) => void) => void;
  fitBounds: (bounds: [[number, number], [number, number]], options?: { padding?: number; duration?: number; maxZoom?: number }) => void;
}

interface MapComponentProps {
  onViewportChange: (viewport: Viewport) => void;
  onSelectItem: (item: SelectedItem) => void;
  rightPanelRef: React.RefObject<any>;
}

const MapComponent = forwardRef<MapComponentRef, MapComponentProps>(({
  onSelectItem,
  onViewportChange,
}, ref) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const { mapStyle, showAirports, globeMode } = useMapStore();
  const { highlightedAirports, selectedAirportCode, selectedAirportCodes, explorationItems, displayedFlights } = useSelectionStore();
  const { tripState, manualTransferAirportCodes } = useTripStore();
  const { language } = useSettingsStore();
  
  const colorState = useColorStore();
  const { data: airportsData } = useAirportsQuery();

  // Memozidacja mapy współrzędnych dla animacji dróg
  const coordsMap = useMemo(() => {
    if (!airportsData) return undefined;
    const map: Record<string, [number, number]> = {};
    airportsData.features.forEach(f => {
      map[f.properties.code] = f.geometry.coordinates as [number, number];
    });
    return map;
  }, [airportsData]);

  // --- REFERENCJE ATOMYCZNE (Dla pętli Heartbeat) ---
  const projectedAirportsRef = useRef<Array<{ code: string; x: number; y: number }>>([]);
  const hoveredAirportCodeRef = useRef<string | null>(null);
  const hoverFeatureDataRef = useRef<any | null>(null);
  const lastDetectedCodeRef = useRef<string | null>(null);
  const applyHoverRef = useRef<((code: string | null) => void) | null>(null);
  
  const mouseStopTimerRef = useRef<any>(null);
  const hoverClearTimerRef = useRef<any>(null);
  const hoverLockUntilRef = useRef<number>(0);
  const hoverSampleCountRef = useRef<number>(0);
  const isRouteHoveredRef = useRef<boolean>(false);
  const hoveredRouteId = useRef<string | number | null>(null);
  
  const airportCityKeyRef = useRef<Record<string, string>>({});
  const cityLabelCodeByCityRef = useRef<Record<string, string>>({});
  const cityLabelCodesRef = useRef<string[]>([]);
  const highlightedLabelCodesRef = useRef<string[]>([]);
  const highlightedCityLabelCodesRef = useRef<string[]>([]);
  const highlightedAirportsRef = useRef(highlightedAirports);
  const selectedAirportCodesRef = useRef(selectedAirportCodes);
  const tripVisibleAirportCodesRef = useRef<string[] | null>(null);
  const explorationAirportCodesRef = useRef<string[]>([]);
  const manualTransferAirportCodesRef = useRef(manualTransferAirportCodes);
  const airportsDataRef = useRef(airportsData);
  const onSelectItemRef = useRef(onSelectItem);

  useEffect(() => { manualTransferAirportCodesRef.current = manualTransferAirportCodes; }, [manualTransferAirportCodes]);

  const enrichedAirportsData = useMemo(() => {
    if (!airportsData) return null;
    console.log("[GPU_SYNC] Enriching airportsData for City Grouping...");
    
    // 1. Grupowanie po miastach
    const cityMap = new Map<string, any[]>();
    airportsData.features.forEach(f => {
      const cityCode = f.properties.city_code || 'UNKNOWN';
      if (!cityMap.has(cityCode)) cityMap.set(cityCode, []);
      cityMap.get(cityCode)!.push(f);
    });

    // 2. Wstrzykiwanie metadanych
    const newFeatures = airportsData.features.map(f => {
      const cityCode = f.properties.city_code || 'UNKNOWN';
      const cityAirports = cityMap.get(cityCode) || [];
      
      // Sortujemy po randze (lub kodzie jeśli brak), żeby wyłonić "Lidera" miasta
      const sorted = [...cityAirports].sort((a, b) => (b.properties.rank || 0) - (a.properties.rank || 0));
      const isPrimary = sorted[0].properties.code === f.properties.code;

      return {
        ...f,
        properties: {
          ...f.properties,
          city_airport_count: cityAirports.length,
          is_city_primary: isPrimary
        }
      };
    });

    return { ...airportsData, features: newFeatures };
  }, [airportsData]);

  useEffect(() => {
    highlightedAirportsRef.current = highlightedAirports;
    selectedAirportCodesRef.current = selectedAirportCodes;
    explorationAirportCodesRef.current = explorationItems.flatMap(i => i.airportCodes);
    airportsDataRef.current = enrichedAirportsData as any;
    onSelectItemRef.current = onSelectItem;
  }, [highlightedAirports, selectedAirportCodes, explorationItems, enrichedAirportsData, onSelectItem]);

  const tripVisibleAirportCodes = useMemo(() => {
    if (!tripState) return null;
    return [tripState.startAirport.code, ...tripState.legs.map(l => l.toAirportCode)];
  }, [tripState]);
  useEffect(() => { tripVisibleAirportCodesRef.current = tripVisibleAirportCodes; }, [tripVisibleAirportCodes]);

  // --- LOGIKA STYLU ---
  // --- LOGIKA STYLU ---
  const applyColors = useCallback(() => {
    const m = map.current;
    if (!m || !mapLoaded) return;
    
    if (!(m as any).getStyle()) {
      console.warn("[GPU_SYNC] Style not ready, skipping applyColors.");
      return;
    }

    try {
      if (!m.getLayer('airports-circles')) {
        if (airportsDataRef.current) {
          console.warn("[GPU_SYNC] Self-healing: Layers missing, triggering addLayers()");
          addLayers();
          return;
        } else {
          console.warn("[GPU_SYNC] AirportsData is still NULL. Waiting for load...");
          return;
        }
      }

      applyMapColors(m, {
        selectedAirportCodes: selectedAirportCodesRef.current || [],
        tripVisibleAirportCodes: tripVisibleAirportCodesRef.current,
        highlightedAirports: highlightedAirportsRef.current,
        manualTransferAirportCodes: manualTransferAirportCodesRef.current || [],
        explorationAirportCodes: explorationAirportCodesRef.current || [],
        selectedAirportCode,
        highlightedLabelCodes: highlightedLabelCodesRef.current,
        colorState: useColorStore.getState(),
        hoveredAirportCode: hoveredAirportCodeRef.current,
      });

      if (applyHoverRef.current && hoveredAirportCodeRef.current) {
        applyHoverRef.current(hoveredAirportCodeRef.current);
      }
    } catch (err) {
      console.error("[GPU_SYNC] applyColors CRITICAL ERROR:", err);
    }
  }, [mapLoaded, selectedAirportCode]); // decoupled addLayers

  const addLayers = useCallback(() => {
    console.log("[GPU_SYNC] addLayers() invoked. EnrichedData:", enrichedAirportsData ? "READY" : "NULL");
    if (!map.current || !mapLoaded || !enrichedAirportsData) return;
    
    const m = map.current;
    setupRouteLayers(m);
    addAirportsLayer(m, enrichedAirportsData, mapStyle, language);
    applyColors();
  }, [mapLoaded, enrichedAirportsData, mapStyle, language, applyColors]);

  // GŁÓWNA SYNCHRONIZACJA (v10.7+)
  useEffect(() => {
    (window as any).applyColorsManual = () => { console.log("[GPU_DEBUG] Manual sync"); applyColors(); };
    const unsub = useColorStore.subscribe(() => applyColors());
    if (mapLoaded) applyColors();
    return unsub;
  }, [applyColors, mapLoaded]);

  // Reaktywne dodawanie warstw gdy mapa i dane są gotowe (v9.6)
  useEffect(() => {
    console.log("[GPU_SYNC] Data-Flow Sync: mapLoaded=", mapLoaded, "airportsData=", !!airportsData);
    if (mapLoaded && airportsData) {
      addLayers();
    }
  }, [mapLoaded, airportsData, addLayers]);

  // --- INTERAKCJA ---
  const hoverRefs: MapHoverRefs = {
    map, projectedAirportsRef, hoveredAirportCodeRef, lastDetectedCodeRef,
    hoverSampleCountRef, mouseStopTimerRef, hoverClearTimerRef, hoverLockUntilRef,
    isRouteHoveredRef, hoveredRouteId, airportCityKeyRef, cityLabelCodeByCityRef,
    cityLabelCodesRef, highlightedLabelCodesRef, highlightedCityLabelCodesRef,
    highlightedAirportsRef, selectedAirportCodesRef, explorationAirportCodesRef,
    tripVisibleAirportCodesRef, airportsDataRef, onSelectItemRef,
    hoverFeatureDataRef,
    applyColors: (mode) => { if (mode === 'all') applyColors(); },
    applyHoverRef
  };
  useMapHover(hoverRefs, mapLoaded, showAirports);

  const routeHoverRefs: RouteHoverRefs = {
    map, projectedAirportsRef, hoveredAirportCodeRef, hoveredRouteId,
    hoveredTripRouteId: { current: null } as any, hoveredTransferRouteId: { current: null } as any,
    isRouteHoveredRef, tripVisibleAirportCodesRef, highlightedAirportsRef,
    selectedAirportCodeRef: { current: selectedAirportCode }, selectedAirportCodesRef, explorationAirportCodesRef,
    manualTransferAirportCodesRef: { current: manualTransferAirportCodes }, airportsDataRef,
    airportCityKeyRef, cityLabelCodeByCityRef, highlightedCityLabelCodesRef,
    flightDetailsMap: { current: {} }, flightsByRouteGroupMapRef: { current: new Map() },
    airportNamesMap: { current: {} }, airportCoordsMapRef: { current: {} }, currentPopup: { current: null },
    routeHoverAtPointRef: { current: null } as any, clearRouteHoverRef: { current: null } as any,
    applyAirportFilters: applyColors,
    texts: { noFlightsForDate: 'Brak lotów', clickRouteToFilter: 'Kliknij aby filtrować', unknown: '?' }
  };

  useEffect(() => {
    if (map.current && mapLoaded) {
      setupRouteHoverListeners(map.current, routeHoverRefs);
      // Mouse pos tracking for occlusion resume (v11.10)
      const track = (e: any) => { 
        const original = e.originalEvent;
        if (original) {
          (map.current as any)._mousePos = { x: original.clientX, y: original.clientY }; 
        }
      };
      map.current.on('mousemove', track);
      return () => { map.current?.off('mousemove', track); };
    }
  }, [mapLoaded]);

  useRouteAnimation({
    map, mapLoaded, highlightedAirports, coordsMap, selectedAirportCode,
    selectedAirportCodes, displayedFlights, displayedFlightsRef: { current: displayedFlights },
    completedPathsRef: { current: [] } as any, currentAnimatingRef: { current: [] } as any,
    animationRef: { current: null } as any, renderedHighlightedRef: { current: new Set() } as any
  });

  // --- KESZOWANIE POZYCJI ---
  useEffect(() => {
    if (!mapLoaded || !map.current || !airportsData) return;
    const m = map.current;
    const rebuild = () => {
      const res = airportsData.features.map(f => {
        const px = m.project(f.geometry.coordinates as [number, number]);
        return { code: f.properties.code, x: px.x, y: px.y };
      });
      spatialIndex.update(res);
      projectedAirportsRef.current = res;
    };
    rebuild();
    m.on('move', rebuild);
    m.on('moveend', rebuild);
    return () => { m.off('move', rebuild); m.off('moveend', rebuild); };
  }, [mapLoaded, airportsData]);

  useImperativeHandle(ref, () => ({
    flyTo: (opts) => map.current?.flyTo(opts),
    getZoom: () => map.current?.getZoom(),
    once: (ev, cb) => map.current?.once(ev, cb as any),
    fitBounds: (b, o) => map.current?.fitBounds(b as any, o)
  }));

  useEffect(() => {
    if (!mapContainer.current) return;
    const instance = new maplibregl.Map({
      container: mapContainer.current,
      style: resolveMapStyle(mapStyle, globeMode) as string,
      center: [19.0, 52.0],
      zoom: 4,
      transformRequest: arcGISTransformRequest
    } as any);
    map.current = instance;
    instance.on('load', () => { setMapLoaded(true); addLayers(); });
    
    // Obsługa brakujących assetów w stylach ArcGIS (np. "Disputed label point")
    instance.on('styleimagemissing', (e) => {
      const id = e.id;
      if (!instance.hasImage(id)) {
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const imgData = ctx.createImageData(1, 1);
          instance.addImage(id, imgData as any);
        }
      }
    });

    instance.on('move', () => {
      const center = instance.getCenter();
      onViewportChange({ center: [center.lng, center.lat], zoom: instance.getZoom(), pitch: instance.getPitch(), bearing: instance.getBearing() });
    });
    return () => { instance.remove(); setMapLoaded(false); };
  }, [mapStyle, globeMode]);

  return (
    <div className="map-root">
      <div ref={mapContainer} className="map" />
      {!mapLoaded && <div className="map-loader">Ładowanie mapy...</div>}
    </div>
  );
});

MapComponent.displayName = 'MapComponent';
export default MapComponent;