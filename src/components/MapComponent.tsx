/**
 * KOMPONENT MAPY (MapComponent.tsx)
 * Główny moduł wizualizacji kartograficznej oparty na MapLibre GL.
 * Implementuje architekturę Ultra-Lean (Zero-Waste) z optymalizacjami O(1).
 */

// console.log('MapComponent.tsx module loaded');

import { forwardRef, useRef, useState, useEffect, useMemo, useCallback, useImperativeHandle } from 'react';
import maplibregl, { LngLatBoundsLike, FlyToOptions } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  resolveMapStyle,
  arcGISTransformRequest,
  BLANK_STYLE
} from './map/styleResolver';

import type { SelectedItem, Viewport, Flight } from '../types';
import { useMapStore } from '../stores/mapStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useTripStore } from '../stores/tripStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useColorStore } from '../stores/colorStore';
import {
  useAirportsQuery,
  useAirportIndexes,
  useTripVisibleAirports,
  useHighlightedState
} from '../hooks/queries';
import { addAirportsLayer, removeAirportsLayer } from './map/airportsLayer';

import './MapComponent.css';
import './FlightCard.css';
import { setupRouteLayers, removeRouteLayers } from './map/layerSetup';
import { useMapHover } from './map/useMapHover';
import type { MapHoverRefs } from './map/useMapHover';
import { useMapColors } from './map/useMapColors';
import { applyMapColors } from './map/colorApplier';
import { useRouteAnimation } from './map/useRouteAnimation';
import { startPreviewAnimation } from './map/routeAnimations';
import { generateGreatCircle } from './map/utils';
import type { GCPath } from './map/routeAnimations';
import { applyMapAirportFilters } from './map/filterApplier';
import { setupRouteHoverListeners } from './map/routeHover';
import type { RouteHoverRefs } from './map/routeHover';

export interface MapComponentRef {
  flyTo: (options: FlyToOptions) => void;
  getZoom: () => number | undefined;
  once: (event: string, callback: (...args: unknown[]) => void) => void;
  fitBounds: (bounds: [[number, number], [number, number]], options?: { padding?: number; duration?: number; maxZoom?: number }) => void;
}

interface MapComponentProps {
  onViewportChange: (viewport: Viewport) => void;
  onSelectItem: (item: SelectedItem) => void;
  rightPanelRef: React.RefObject<{ scrollToFlight: (code: string) => void } | null>;
}

const MapComponent = forwardRef<MapComponentRef, MapComponentProps>(({
  onSelectItem,
}, ref) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const { mapStyle, showAirports, globeMode } = useMapStore();
  const {
    selectedItem,
    displayedFlights,
    flightsByRouteMap,
    flightsByRouteGroupMap
  } = useSelectionStore();
  const { tripState, tripRoutes, previewAirportCode, manualTransferAirportCodes } = useTripStore();
  const tripVisibleAirportCodes = useTripVisibleAirports();
  const { highlightedAirports, selectedAirportCodes, explorationCodes } = useHighlightedState();
  const { language, travelDate, timezone } = useSettingsStore();

  const { coordsMap, cityMap, cityLabelCodes, cityLabelCodeByCity } = useAirportIndexes();
  const { data: airportsGeoJSON } = useAirportsQuery();
  const { zoomRangeMin, zoomRangeMax } = useColorStore();

  // --- REFS FOR HOOKS ---
  const projectedAirportsRef = useRef<Array<{ code: string; x: number; y: number }>>([]);
  const spatialGridRef = useRef<Record<string, string[]>>({}); // SIATKA (Faza 1): Key: "row,col", Value: [codes]
  const hoveredAirportCodeRef = useRef<string | null>(null);
  const lastDetectedCodeRef = useRef<string | null>(null);
  const hoveredRouteId = useRef<string | number | null>(null);
  const isRouteHoveredRef = useRef<boolean>(false);
  const mouseStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverSampleCountRef = useRef<number>(0);
  const hoverLockUntilRef = useRef<number>(0);
  const pendingStyleChangeRef = useRef<boolean>(false); // ZERO WASTE: Strażnik transformacji stylu

  const highlightedLabelCodesRef = useRef<string[]>([]);
  const highlightedCityLabelCodesRef = useRef<string[]>([]);
  const highlightedAirportsRef = useRef<string[]>([]);
  const selectedAirportCodesRef = useRef<string[]>([]);
  const explorationAirportCodesRef = useRef<string[]>([]);
  const tripVisibleAirportCodesRef = useRef<string[] | null>(null);
  const renderedHighlightedRef = useRef<Set<string>>(new Set());
  const completedPathsRef = useRef<GCPath[]>([]);
  const currentAnimatingRef = useRef<GCPath[]>([]);
  const animationRef = useRef<number | null>(null);

  // POPUP & HOVER TRACKING (Faza 2)
  const currentPopup = useRef<maplibregl.Popup | null>(null);
  const routeHoverAtPointRef = useRef<((point: { x: number; y: number }) => void) | null>(null);
  const clearRouteHoverRef = useRef<((opts?: { keepLabels?: boolean }) => void) | null>(null);
  const hoveredTripRouteId = useRef<string | number | null>(null);
  const hoveredTransferRouteId = useRef<string | number | null>(null);
  const previewAnimationRef = useRef<number | null>(null);

  const tripRoutesRef = useRef<any[]>(tripRoutes || []);
  const tripStateRef = useRef<any>(tripState);
  const coordsMapRef = useRef<Record<string, [number, number]>>(coordsMap || {});

  const displayedFlightsRef = useRef<Flight[]>(displayedFlights);
  const onSelectItemRef = useRef(onSelectItem);
  const airportCityKeyRef = useRef(cityMap);
  const cityLabelCodeByCityRef = useRef(cityLabelCodeByCity);
  const cityLabelCodesInternalRef = useRef<string[]>([]);
  const airportsDataRef = useRef(airportsGeoJSON);

  // Sync Refs (Zero-Waste: automatyczna synchronizacja z selektorami queries.ts)
  useEffect(() => { displayedFlightsRef.current = displayedFlights; }, [displayedFlights]);
  useEffect(() => { onSelectItemRef.current = onSelectItem; }, [onSelectItem]);
  useEffect(() => { airportCityKeyRef.current = cityMap; }, [cityMap]);
  useEffect(() => { cityLabelCodeByCityRef.current = cityLabelCodeByCity; }, [cityLabelCodeByCity]);
  useEffect(() => { cityLabelCodesInternalRef.current = cityLabelCodes; }, [cityLabelCodes]);
  useEffect(() => { airportsDataRef.current = airportsGeoJSON; }, [airportsGeoJSON]);
  
  useEffect(() => { highlightedAirportsRef.current = highlightedAirports; }, [highlightedAirports]);
  useEffect(() => { selectedAirportCodesRef.current = selectedAirportCodes; }, [selectedAirportCodes]);
  useEffect(() => { explorationAirportCodesRef.current = explorationCodes; }, [explorationCodes]);
  useEffect(() => { tripVisibleAirportCodesRef.current = tripVisibleAirportCodes; }, [tripVisibleAirportCodes]);
  useEffect(() => { tripRoutesRef.current = tripRoutes || []; }, [tripRoutes]);
  useEffect(() => { tripStateRef.current = tripState; }, [tripState]);
  useEffect(() => { coordsMapRef.current = coordsMap || {}; }, [coordsMap]);

  const addLayersRef = useRef<((mapInstance?: maplibregl.Map) => void) | null>(null);
  const applyAirportFiltersRef = useRef<(() => void) | null>(null);

  const selectedAirportCode = useMemo(() =>
    selectedItem?.type === 'airport' ? selectedItem.data.code : null
    , [selectedItem]);

  // --- HOOKS ---
  // Sync flight map for O(1) lookup during hover
  const flightsByRouteMapRef = useRef(flightsByRouteMap);
  const flightsByRouteGroupMapRef = useRef(flightsByRouteGroupMap);
  useEffect(() => {
    flightsByRouteMapRef.current = flightsByRouteMap;
    flightsByRouteGroupMapRef.current = flightsByRouteGroupMap;
  }, [flightsByRouteMap, flightsByRouteGroupMap]);

  const hoverRefs: MapHoverRefs = {
    map, projectedAirportsRef, spatialGridRef, hoveredAirportCodeRef, lastDetectedCodeRef,
    hoverSampleCountRef, mouseStopTimerRef, hoverClearTimerRef, hoverLockUntilRef,
    isRouteHoveredRef, hoveredRouteId, airportCityKeyRef, cityLabelCodeByCityRef,
    cityLabelCodesRef: cityLabelCodesInternalRef, highlightedLabelCodesRef,
    highlightedCityLabelCodesRef, highlightedAirportsRef, selectedAirportCodesRef,
    explorationAirportCodesRef, tripVisibleAirportCodesRef, airportsDataRef,
    onSelectItemRef,
    flightsByRouteMapRef,
    selectedAirportCodeRef: { current: selectedAirportCode },
    tripRoutesRef,
    tripStateRef,
    coordsMapRef
  };

  useMapHover(hoverRefs, mapLoaded, showAirports);
  const colors = useMapColors();
  // --- OPTYMALIZACJA WEBGL: Throttling Kolorów ---
  const lastColorUpdateTimeRef = useRef<number>(0);
  const colorUpdateRequestedRef = useRef<boolean>(false);

  const throttledApplyColors = useCallback(() => {
    const now = performance.now();
    const wait = 32; // Inżynierski kompromis: ~30 FPS (płynna zmiana kolorów bez thrashingu GPU)
    
    if (now - lastColorUpdateTimeRef.current >= wait) {
      if (map.current && mapLoaded) {
        const context = {
          selectedAirportCodes: selectedAirportCodesRef.current,
          tripVisibleAirportCodes: tripVisibleAirportCodesRef.current,
          highlightedAirports: highlightedAirportsRef.current,
          manualTransferAirportCodes: manualTransferAirportCodes,
          explorationAirportCodes: explorationAirportCodesRef.current,
          selectedAirportCode: selectedAirportCode,
          highlightedLabelCodes: highlightedLabelCodesRef.current,
        };
        applyMapColors(map.current, context);
      }
      lastColorUpdateTimeRef.current = now;
      colorUpdateRequestedRef.current = false;
    } else if (!colorUpdateRequestedRef.current) {
      colorUpdateRequestedRef.current = true;
      setTimeout(throttledApplyColors, wait - (now - lastColorUpdateTimeRef.current));
    }
  }, [mapLoaded, selectedAirportCode, manualTransferAirportCodes, mapStyle]);

  useEffect(() => {
    if (mapLoaded) throttledApplyColors();
  }, [mapLoaded, colors, selectedAirportCode, manualTransferAirportCodes, mapStyle, throttledApplyColors]);

  useRouteAnimation({
    map, mapLoaded, highlightedAirports, coordsMap,
    selectedAirportCode, selectedAirportCodes, displayedFlights,
    displayedFlightsRef, completedPathsRef, currentAnimatingRef,
    animationRef, renderedHighlightedRef
  });

  useImperativeHandle(ref as React.Ref<MapComponentRef>, () => ({
    flyTo: (options: maplibregl.FlyToOptions) => {
      if (map.current) map.current.flyTo(options);
    },
    getZoom: () => map.current?.getZoom(),
    once: (event: string, callback: (...args: unknown[]) => void) => {
      if (map.current) map.current.once(event, callback as any);
    },
    fitBounds: (bounds: [[number, number], [number, number]], options?: { padding?: number; duration?: number; maxZoom?: number }) => {
      if (map.current) map.current.fitBounds(bounds as LngLatBoundsLike, options);
    },
  }));

  // --- LOGIKA FILTROWANIA I WARSTW ---

  const applyAirportFilters = useCallback(() => {
    if (!map.current) return;
    applyMapAirportFilters(
      map.current,
      {
        tripVisibleAirportCodes: tripVisibleAirportCodesRef.current || [],
        highlightedAirports: highlightedAirportsRef.current,
        selectedAirportCode: selectedAirportCode,
        selectedAirportCodes: selectedAirportCodesRef.current ?? [],
        explorationAirportCodes: explorationAirportCodesRef.current ?? [],
        hoveredAirportCode: hoveredAirportCodeRef.current,
        cityLabelCodes: cityLabelCodesInternalRef.current || [],
        airportCityKeyMap: airportCityKeyRef.current,
        cityLabelCodeByCity: cityLabelCodeByCityRef.current,
        manualTransferAirportCodes: manualTransferAirportCodes,
        isRouteHovered: isRouteHoveredRef.current,
        tripRoutes: tripRoutes || [],
        tripState: tripState,
        coordsMap: coordsMap || {},
      },
      { highlightedLabelCodesRef, highlightedCityLabelCodesRef },
    );
  }, [mapLoaded, mapStyle, selectedAirportCode, manualTransferAirportCodes, tripState]);

  useEffect(() => {
    applyAirportFiltersRef.current = applyAirportFilters;
  }, [applyAirportFilters]);

  useEffect(() => {
    if (mapLoaded) applyAirportFilters();
  }, [mapLoaded, applyAirportFilters]);

  const addControls = useCallback(() => {
    if (!map.current) return;
    if (!map.current.hasControl(new maplibregl.NavigationControl() as any)) {
      map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    }
  }, []);

  const rebuildProjectedCache = useCallback(() => {
    if (!map.current || !airportsDataRef.current) return;
    const m = map.current;
    
    const b = m.getBounds();
    const pad = 1.0; 
    const minLng = b.getWest() - pad, maxLng = b.getEast() + pad;
    const minLat = b.getSouth() - pad, maxLat = b.getNorth() + pad;

    const projected = airportsDataRef.current.features
      .filter(f => {
        const [lng, lat] = f.geometry.coordinates;
        return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
      })
      .map(f => {
        const p = m.project(f.geometry.coordinates as [number, number]);
        return { code: f.properties.code, x: p.x, y: p.y };
      });

    projectedAirportsRef.current = projected;

    // INŻYNIERSKA OPTYMALIZACJA (Faza 1): Budowa siatki przestrzennej (Spatial Grid)
    // Pozwala na wyszukiwanie lotnisk w czasie O(1) podczas ruchu myszy.
    // Używamy requestIdleCallback, aby nie blokować głównego wątku podczas zoomu/pan.
    const GRID_SIZE = 60;
    const processGrid = () => {
      const grid: Record<string, string[]> = {};
      projected.forEach(ap => {
        const col = Math.floor(ap.x / GRID_SIZE);
        const row = Math.floor(ap.y / GRID_SIZE);
        const key = `${row},${col}`;
        if (!grid[key]) grid[key] = [];
        grid[key].push(ap.code);
      });
      spatialGridRef.current = grid;
      projectedAirportsRef.current = projected;
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => processGrid(), { timeout: 100 });
    } else {
      processGrid();
    }

    // const end = performance.now();
    // if (showConsoleLogs) console.debug(`[MapComponent] Projected ${projectedAirportsRef.current.length} airports in ${(end - start).toFixed(2)}ms`);
  }, [airportsGeoJSON]);

  // PROSTA IMPLEMENTACJA THROTTLE (Brak loda-sh - oszczędność bundle size)
  const lastRebuildTimeRef = useRef<number>(0);
  const rebuildRequestedRef = useRef<boolean>(false);

  const throttledRebuild = useCallback(() => {
    const now = performance.now();
    const wait = 24; // Celujemy w ~40 FPS dla aktualizacji rzutowania (płynny hover)
    
    if (now - lastRebuildTimeRef.current >= wait) {
      rebuildProjectedCache();
      lastRebuildTimeRef.current = now;
      rebuildRequestedRef.current = false;
    } else if (!rebuildRequestedRef.current) {
      rebuildRequestedRef.current = true;
      setTimeout(throttledRebuild, wait - (now - lastRebuildTimeRef.current));
    }
  }, [rebuildProjectedCache]);

  const addLayers = useCallback((mapInstance?: maplibregl.Map) => {
    const m = mapInstance || map.current;
    if (!m) return;

    const currentSession = currentSessionIdRef.current;
    if ((m as any)._sessionId !== currentSession) {
      console.log(`addLayers: ABORTING, map session ${(m as any)._sessionId} !== current session ${currentSession}`);
      return;
    }

    const geoData = airportsDataRef.current;
    
    console.log(`[RACE-DEBUG] {MapComponent} -> addLayers check [sess:${(m as any)._sessionId}]`, {
      isStyleLoaded: m.isStyleLoaded(),
      isLoaded: m.loaded(),
      hasGeoJSON: !!geoData,
      geoFeatures: geoData?.features?.length ?? 0
    });
    
    if (!m || !m.isStyleLoaded() || !geoData) return;
    
    try {
      setupRouteLayers(m);
      addAirportsLayer(
        m, 
        geoData, 
        mapStyle, 
        language,
        (m as any)._sessionId
      );
      console.log(`[RACE-DEBUG] {MapComponent} -> addLayers SUCCESS [sess:${(m as any)._sessionId}] | Total layers: ${m.getStyle().layers?.length}`);
    } catch (err) {
      console.error(`[RACE-DEBUG] {MapComponent} -> addLayers FAIL [sess:${(m as any)._sessionId}]`, err);
    }
    
    const routeHoverRefs: RouteHoverRefs = {
      map,
      projectedAirportsRef,
      hoveredAirportCodeRef,
      hoveredRouteId,
      hoveredTripRouteId,
      hoveredTransferRouteId,
      isRouteHoveredRef,
      tripVisibleAirportCodesRef,
      highlightedAirportsRef,
      selectedAirportCodeRef: { current: selectedAirportCode },
      selectedAirportCodesRef,
      explorationAirportCodesRef,
      manualTransferAirportCodesRef: { current: manualTransferAirportCodes },
      airportsDataRef,
      airportCityKeyRef,
      cityLabelCodeByCityRef,
      highlightedCityLabelCodesRef,
      flightDetailsMap: { current: {} },
      flightsByRouteGroupMapRef,
      airportNamesMap: { current: {} },
      airportCoordsMapRef: { current: coordsMap || {} },
      currentPopup,
      routeHoverAtPointRef,
      clearRouteHoverRef,
      applyAirportFilters,
      texts: {
        noFlightsForDate: 'Brak lotów w tym dniu',
        clickRouteToFilter: 'Kliknij, aby filtrować trasy',
        unknown: 'Nieznane'
      }
    };
    setupRouteHoverListeners(m as NonNullable<maplibregl.Map>, routeHoverRefs);

    applyAirportFilters();
    rebuildProjectedCache(); 
  }, [mapStyle, language, applyAirportFilters, rebuildProjectedCache, coordsMap, manualTransferAirportCodes, selectedAirportCode]);

  useEffect(() => {
    addLayersRef.current = addLayers;
  }, [addLayers]);

  const currentSessionIdRef = useRef<number>(0);

  const doCreateMap = (styleUrl: string | maplibregl.StyleSpecification) => {
    const sessionId = ++currentSessionIdRef.current;
    const finalStyle = typeof styleUrl === 'string' ? `${styleUrl}?t=${Date.now()}` : styleUrl;
    
    console.log(`[RACE-DEBUG] {MapComponent} -> doCreateMap [NEW session:${sessionId}] | Style:`, typeof finalStyle === 'string' ? finalStyle : 'spec');
    
    if (!mapContainer.current) {
      console.warn('doCreateMap: mapContainer.current is null!');
      return;
    }

    // Clean up previous map if exists (atomic replace)
    if (map.current) {
      console.log(`doCreateMap [session:${sessionId}]: cleaning up previous map instance`);
      map.current.remove();
      map.current = null;
    }

    try {
      const instance = new maplibregl.Map({
        container: mapContainer.current,
        style: finalStyle,
        center: [19.0, 52.0],
        zoom: 4,
        attributionControl: true as any,
        antialias: true,
        transformRequest: (url: string, resourceType?: string) => {
          return arcGISTransformRequest(url, resourceType);
        },
      } as any);

      map.current = instance;
      (instance as any)._sessionId = sessionId;
      (instance as any)._currentStyleUrl = finalStyle;

      instance.on('load', () => {
        if (sessionId !== currentSessionIdRef.current) {
          console.warn(`[RACE-DEBUG] {MapComponent} -> on(load) ABORTED [sess:${sessionId} !== current:${currentSessionIdRef.current}]`);
          return;
        }
        console.log(`[RACE-DEBUG] {MapComponent} -> on(load) [sess:${sessionId}]`);
        setMapLoaded(true);
        addControls();
        addLayersRef.current?.(instance);
        applyAirportFiltersRef.current?.();
      });

      instance.on('styledata', () => {
        if (sessionId !== currentSessionIdRef.current) return;
        const isLoaded = instance.isStyleLoaded();
        console.log(`[RACE-DEBUG] {MapComponent} -> on(styledata) [sess:${sessionId}] | isLoaded: ${isLoaded}`);
        
        // Zero-Waste: Tylko jeśli styl jest w pełni gotowy i nie jesteśmy w trakcie zmiany
        if (isLoaded && !pendingStyleChangeRef.current) {
          addLayersRef.current?.(instance);
          applyAirportFiltersRef.current?.();
        }
      });

      instance.on('styleimagemissing', (e: any) => {
        if (sessionId !== currentSessionIdRef.current) return;
        const id = e.id;
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const data = ctx.getImageData(0, 0, 1, 1).data;
          instance.addImage(id, { width: 1, height: 1, data: new Uint8Array(data) });
        }
      });

      instance.on('move', () => {
        if (sessionId !== currentSessionIdRef.current) return;
        throttledRebuild();
      });
    } catch (e) {
      console.error('Failed to create map:', e);
    }
  };

  // --- CYKL ŻYCIA MAPY (Initialization & Zero-Waste Style Switching) ---

  // Inicjalizacja i czyszczenie (Tylko raz przy mountowaniu komponentu)
  useEffect(() => {
    const initialState = useMapStore.getState();
    doCreateMap(resolveMapStyle(initialState.mapStyle, initialState.globeMode));
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      setMapLoaded(false);
    };
  }, []);

  // Płynna zmiana stylu (Faza 2: Style Diffing & Atomic Re-addition)
  useEffect(() => {
    if (!mapLoaded || !map.current || pendingStyleChangeRef.current) return;
    
    const rawUrl = resolveMapStyle(mapStyle, globeMode);
    const m = map.current;
    if (!m) return;

    // Zero-Waste: Unikaj resetowania stylu, jeśli jest taki sam
    if ((m as any)._currentStyleUrl === rawUrl) return;

    pendingStyleChangeRef.current = true;
    (m as any)._currentStyleUrl = rawUrl;
    
    const isArcGIS = mapStyle.startsWith('ArcGIS_');
    const styleWithBuster = typeof rawUrl === 'string' ? `${rawUrl}?t=${Date.now()}` : rawUrl;

    console.log(`[RACE-DEBUG] {MapComponent} -> setStyle START [sess:${(m as any)._sessionId}] | Style: ${mapStyle}, Diff: ${!isArcGIS}`);

    // JAWNE CZYSZCZENIE przed zmianą (Zapobiega konfliktom w silniku Placement)
    removeAirportsLayer(m);
    removeRouteLayers(m);

    m.setStyle(styleWithBuster, { diff: !isArcGIS });

    const finalize = () => {
      if ((m as any)._sessionId === currentSessionIdRef.current) {
        console.log(`[RACE-DEBUG] {MapComponent} -> setStyle FINALIZED (idle) [sess:${(m as any)._sessionId}]`);
        addLayers(m);
        pendingStyleChangeRef.current = false;
      }
    };

    // Hybrydowy strażnik: czekamy na 'idle' (ciężkie style) lub 'styledata' (lekkie)
    m.once('idle', finalize);
  }, [mapStyle, globeMode, mapLoaded, addLayers]);

  // Reakcja na dane (tylko jeśli mapa już jest stabilna)
  useEffect(() => {
    if (mapLoaded && airportsGeoJSON && !pendingStyleChangeRef.current) {
      addLayers();
    }
  }, [mapLoaded, airportsGeoJSON, addLayers]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const minZ = Math.min(zoomRangeMin, zoomRangeMax);
    const maxZ = Math.max(zoomRangeMin, zoomRangeMax);
    map.current.setMinZoom(minZ);
    map.current.setMaxZoom(maxZ);
  }, [mapLoaded, zoomRangeMin, zoomRangeMax]);

  // --- RESTORED: TRIP PREVIEWS (Animation) ---

  // Preview Animation (Pulsing Circle)
  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded || !airportsGeoJSON) return;
    const sessionId = (m as any)._sessionId;

    if (sessionId !== currentSessionIdRef.current) return;
    startPreviewAnimation(m, previewAnimationRef, previewAirportCode, selectedAirportCode, coordsMap);

    return () => {
      if (previewAnimationRef.current) {
        cancelAnimationFrame(previewAnimationRef.current);
        previewAnimationRef.current = null;
      }
    };
  }, [previewAirportCode, selectedAirportCode, airportsGeoJSON, mapLoaded]);


  return (
    <div className="map-root">
      <div
        ref={mapContainer}
        className="map"
      />
      {!mapLoaded && <div className="map-loader">Ładowanie mapy...</div>}
    </div>
  );
});

MapComponent.displayName = 'MapComponent';
export default MapComponent;