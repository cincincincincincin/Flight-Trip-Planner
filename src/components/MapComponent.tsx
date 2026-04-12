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
import { useFilterStore } from '../stores/filterStore';
import { useAirportsQuery } from '../hooks/queries';
import { EMPTY_DESTINATION_FILTER } from '../constants/filters';
import { THEME_COLORS } from '../constants/theme';
import { CONFIG } from '../constants/config';
import { spatialIndex } from '../utils/spatialIndex';

import { addAirportsLayer } from './map/airportsLayer';
import { setupRouteLayers } from './map/layerSetup';
import { useMapHover } from './map/useMapHover';
import type { MapHoverRefs } from './map/useMapHover';
import { applyMapColors } from './map/colorApplier';
import { mergeFilterConditions, generateGreatCircle } from './map/utils';
import { useRouteAnimation } from './map/useRouteAnimation';
import { getLocalizedProp } from '../utils/i18n';
import { getSingleAirportLabel } from './search/searchUtils';
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
  const { highlightedAirports, selectedAirportCode, selectedAirportCodes, explorationItems, displayedFlights, isFlightsLoading } = useSelectionStore();
  const { tripState, manualTransferAirportCodes } = useTripStore();
  const { language } = useSettingsStore();
  const { destinationFilter } = useFilterStore();
  
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
  const hoveredTripRouteId = useRef<string | number | null>(null);
  const hoveredTransferRouteId = useRef<string | number | null>(null);
  const routeHoverAtPointRef = useRef<((point: { x: number; y: number }) => void) | null>(null);
  const clearRouteHoverRef = useRef<((opts?: { keepLabels?: boolean }) => void) | null>(null);
  
  const airportCityKeyRef = useRef<Record<string, string>>({});
  const cityLabelCodeByCityRef = useRef<Record<string, string>>({});
  const cityLabelCodesRef = useRef<string[]>([]);
  const highlightedLabelCodesRef = useRef<string[]>([]);
  const highlightedCityLabelCodesRef = useRef<string[]>([]);
  const highlightedAirportsRef = useRef(highlightedAirports);
  const selectedAirportCodesRef = useRef(selectedAirportCodes);
  const tripVisibleAirportCodesRef = useRef<string[] | null>(null);
  
  // --- KONTEKST ANIMACJI TRAS (Persistent Memory v12.1-12.4) ---
  const completedPathsRef = useRef<any[]>([]);
  const currentAnimatingRef = useRef<any[]>([]);
  const animationRef = useRef<number | null>(null);
  const renderedHighlightedRef = useRef<Set<string>>(new Set());
  const displayedFlightsRef = useRef<Flight[]>([]);

  // --- REFERENCJE ATOMYCZNE (Dla pętli Heartbeat) ---
  const explorationAirportCodesRef = useRef<string[]>([]);
  const manualTransferAirportCodesRef = useRef(manualTransferAirportCodes);
  const airportsDataRef = useRef(airportsData);
  const onSelectItemRef = useRef(onSelectItem);

  // --- REFERENCJE DANYCH LOTÓW (Dla Popupów) ---
  const flightDetailsMap = useRef<Record<string, Flight[]>>({});
  const flightsByRouteGroupMapRef = useRef<Map<string, Flight[]>>(new Map());
  const airportNamesMap = useRef<Record<string, string>>({});
  const airportCoordsMapRef = useRef<Record<string, [number, number]>>({});
  const currentPopup = useRef<maplibregl.Popup | null>(null);

  useEffect(() => { displayedFlightsRef.current = displayedFlights; }, [displayedFlights]);
  useEffect(() => { manualTransferAirportCodesRef.current = manualTransferAirportCodes; }, [manualTransferAirportCodes]);
  useEffect(() => { highlightedAirportsRef.current = highlightedAirports; }, [highlightedAirports]);
  useEffect(() => { selectedAirportCodesRef.current = selectedAirportCodes; }, [selectedAirportCodes]);
  
  useEffect(() => {
    explorationAirportCodesRef.current = explorationItems.flatMap(it => it.airportCodes);
  }, [explorationItems]);

  useEffect(() => {
    tripVisibleAirportCodesRef.current = tripState?.legs?.flatMap(l => [l.fromAirportCode, l.toAirportCode]) || null;
  }, [tripState]);


  const enrichedAirportsData = useMemo(() => {
    if (!airportsData) return null;
    console.log("[GPU_SYNC] Enriching airportsData for City Grouping & Sniper Labels...");
    
    // 1. Grupowanie po miastach (v11.8)
    const cityMap = new Map<string, any[]>();
    airportsData.features.forEach(f => {
      const cityCode = f.properties.city_code || 'UNKNOWN';
      if (!cityMap.has(cityCode)) cityMap.set(cityCode, []);
      cityMap.get(cityCode)!.push(f);
    });

    // 2. Weryfikacja przynależności dla offsetów (v12.8.9)
    const haSet = new Set((highlightedAirports || []).map(c => c.toUpperCase()));
    const sacSet = new Set((selectedAirportCodes || []).map(c => c.toUpperCase()));
    const tvacSet = new Set((tripState?.legs?.flatMap(l => [l.fromAirportCode, l.toAirportCode]) || []).map(c => c.toUpperCase()));

    // --- CITY-LEVEL PRIORITY DETECTION (v13.71/76/24.15) ---
    const citySelectedIdxMap = new Map<string, number>(); // cityCode -> first startPoint index
    const cityDestSet = new Set<string>();
    const cityTripSet = new Set<string>();
    
    // [NEW 24.15]: Zbiory lotnisk destynacji per miasto do wyliczenia lokalnego lidera
    const cityDestsMap = new Map<string, any[]>();
    const cityTripsMap = new Map<string, any[]>();

    airportsData.features.forEach(f => {
      const code = f.properties.code;
      const cityCode = f.properties.city_code || 'UNKNOWN';
      const selIdx = (selectedAirportCodes || []).findIndex(c => c.toUpperCase() === code);
      if (selIdx !== -1) {
        if (!citySelectedIdxMap.has(cityCode)) citySelectedIdxMap.set(cityCode, selIdx);
      }
      if (haSet.has(code)) {
        cityDestSet.add(cityCode);
        if (!cityDestsMap.has(cityCode)) cityDestsMap.set(cityCode, []);
        cityDestsMap.get(cityCode)!.push(f);
      }
      if (tvacSet.has(code)) {
        cityTripSet.add(cityCode);
        if (!cityTripsMap.has(cityCode)) cityTripsMap.set(cityCode, []);
        cityTripsMap.get(cityCode)!.push(f);
      }
    });

    // Wyznaczamy "lokalnych liderów" (primary) tylko dla aktywnych warstw
    const cityDestPrimaryMap = new Map<string, string>();
    cityDestsMap.forEach((airports, cityCode) => {
      const top = [...airports].sort((a, b) => (b.properties.rank || 0) - (a.properties.rank || 0))[0];
      cityDestPrimaryMap.set(cityCode, top.properties.code);
    });

    const cityTripPrimaryMap = new Map<string, string>();
    cityTripsMap.forEach((airports, cityCode) => {
      const top = [...airports].sort((a, b) => (b.properties.rank || 0) - (a.properties.rank || 0))[0];
      cityTripPrimaryMap.set(cityCode, top.properties.code);
    });

    // 3. Wstrzykiwanie metadanych i PRE-CALC LABELI (v11.13)
    const newFeatures = airportsData.features.map(f => {
      const cityCode = f.properties.city_code || 'UNKNOWN';
      const cityAirports = cityMap.get(cityCode) || [];
      
      const sorted = [...cityAirports].sort((a, b) => (b.properties.rank || 0) - (a.properties.rank || 0));
      const isPrimary = sorted[0].properties.code === f.properties.code;

      const cityName = getLocalizedProp(f.properties as any, 'city_name', language);
      const airportName = getLocalizedProp(f.properties as any, 'name', language);

      const searchLabelBase = getSingleAirportLabel(cityName, airportName, false);
      const code = f.properties.code;

      const cS = useColorStore.getState();
      const isSelected = sacSet.has(code);
      const selIdx = (selectedAirportCodes || []).findIndex(c => c.toUpperCase() === code);
      const isTrip = tvacSet.has(code);
      const isDest = haSet.has(code);
      const isHigh = isSelected || isDest || isTrip;
      
      const citySelIdx = citySelectedIdxMap.has(cityCode) ? citySelectedIdxMap.get(cityCode) : -1;
      const isCitySelected = citySelIdx !== -1;
      const isCityDest = cityDestSet.has(cityCode);
      const isCityTrip = cityTripSet.has(cityCode);
      const isCityHigh = isCitySelected || isCityDest || isCityTrip;

      // [NEW 24.15]: Czy to lotnisko jest liderem etykiety w swoim kontekście?
      const isCityDestPrimary = cityDestPrimaryMap.get(cityCode) === code;
      const isCityTripPrimary = cityTripPrimaryMap.get(cityCode) === code;
      
      const rMin = isHigh ? (cS.highlightedAirportRadiusMin || 4) : (cS.generalAirportRadiusMin || 2);
      const rMax = isHigh ? (cS.highlightedAirportRadiusMax || 16) : (cS.generalAirportRadiusMax || 8);
      const fMin = isHigh ? (cS.highlightedLabelSizeMin || 12) : (cS.generalAirportLabelSizeMin || 10);
      const fMax = isHigh ? (cS.highlightedLabelSizeMax || 18) : (cS.generalAirportLabelSizeMax || 14);
      const pad = 3;

      return {
        ...f,
        properties: {
          ...f.properties,
          city_airport_count: cityAirports.length,
          is_city_primary: isPrimary,
          is_high: isHigh,
          is_selected: isSelected,
          is_dest: isDest,
          is_trip: isTrip,
          // CITY PRIORITY FLAGS (v13.71)
          is_city_high: isCityHigh,
          is_city_selected: isCitySelected,
          is_city_dest: isCityDest,
          is_city_trip: isCityTrip,
          // LOCAL PRIMARY FLAGS (v24.15)
          is_city_dest_primary: isCityDestPrimary,
          is_city_trip_primary: isCityTripPrimary,
          // INDEXING FOR START POINTS (v13.76)
          la_sel_idx: selIdx,
          la_city_sel_idx: citySelIdx,
          // PRE-CALCULATED LOGIC FOR ROBUST GPU SYNC (v13.49)
          la_is_high_num: isHigh ? 1 : 0, 
          // PRE-CALCULATED OFFSETS (v14.70: Strict Sanitation)
          la_off_n: [0, (() => { const v = (rMin + pad) / (fMin || 11); return Number.isFinite(v) ? v : 1.3; })()] as [number, number],
          la_off_f: [0, (() => { const v = (rMax + pad) / (fMax || 13); return Number.isFinite(v) ? v : 1.8; })()] as [number, number],
          // PRE-RENDERED LABELS (Kartografia v12)
          cl_search: `${searchLabelBase} (${code})`,
          cl_grouped: cityName,
          cl_high: `${airportName} ${code}`,
          cl_hl_low: getSingleAirportLabel(cityName, airportName, false),
          cl_hl_high: `${getSingleAirportLabel(cityName, airportName, false)} (${code})`
        }
      };
    });

    const isTripActive = (tripState?.legs?.length || 0) > 0;
    
    // FILTR WRAŻLIWY NA TRYB PODRÓŻY (v16.15: selective visibility)
    const filteredFeatures = isTripActive
      ? newFeatures.filter(f => f.properties.is_high)
      : newFeatures;

    return { ...airportsData, features: filteredFeatures };
  }, [airportsData, language, highlightedAirports, selectedAirportCodes, explorationItems, tripState]);

  // SYNC DANYCH DLA USEMAPHOVER (v18.20: Fixed Hoisting)
  useEffect(() => {
    airportsDataRef.current = (enrichedAirportsData as any) || undefined;
  }, [enrichedAirportsData]);

  // SYNCHRONIZACJA DANYCH DLA POPUPÓW (v11.19)
  useEffect(() => {
    if (!enrichedAirportsData) return;
    
    // 1. Nazwy i Współrzędne
    const names: Record<string, string> = {};
    const coords: Record<string, [number, number]> = {};
    enrichedAirportsData.features.forEach(f => {
      const code = f.properties.code;
      names[code] = getLocalizedProp(f.properties as any, 'name', language);
      coords[code] = f.geometry.coordinates as [number, number];
    });
    airportNamesMap.current = names;
    airportCoordsMapRef.current = coords;

    // 2. Indeksowanie Lotów (O(1) dla popupu)
    const byDest: Record<string, Flight[]> = {};
    const byGroup = new Map<string, Flight[]>();

    displayedFlights.forEach(f => {
      const src = (f.origin_airport_code || '').toUpperCase();
      const dst = (f.destination_airport_code || '').toUpperCase();
      if (!src || !dst) return;

      // Group by Dest
      if (!byDest[dst]) byDest[dst] = [];
      byDest[dst].push(f);

      // Group by Route (SRC-DST)
      const key = `${src}-${dst}`;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(f);
    });

    flightDetailsMap.current = byDest;
    flightsByRouteGroupMapRef.current = byGroup;
  }, [displayedFlights, enrichedAirportsData, language]);

  useEffect(() => {
    const unsub = useSelectionStore.subscribe(state => {
      highlightedAirportsRef.current = state.highlightedAirports;
    });
    return unsub;
  }, []);

  useEffect(() => {
    selectedAirportCodesRef.current = selectedAirportCodes;
    explorationAirportCodesRef.current = explorationItems.flatMap(i => i.airportCodes);
    airportsDataRef.current = enrichedAirportsData as any;
    onSelectItemRef.current = onSelectItem;
  }, [selectedAirportCodes, explorationItems, enrichedAirportsData, onSelectItem]);

  const tripVisibleAirportCodes = useMemo(() => {
    if (!tripState) return null;
    const codes = new Set<string>();
    codes.add(tripState.startAirport.code);
    tripState.legs.forEach(l => {
      codes.add(l.fromAirportCode);
      codes.add(l.toAirportCode);
    });
    return Array.from(codes);
  }, [tripState]);
  useEffect(() => { tripVisibleAirportCodesRef.current = tripVisibleAirportCodes; }, [tripVisibleAirportCodes]);

  // --- SYNCHRONIZACJA TRAS PODRÓŻY (v13.29/24.15) ---
  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded || !coordsMap) return;

    const features: any[] = [];
    if (tripState) {
    tripState.legs.forEach((leg, i) => {
      const from = coordsMap[leg.fromAirportCode];
      const to = coordsMap[leg.toAirportCode];
      if (from && to) {
        const gc = generateGreatCircle(from, to);
        if (gc.length > 0) {
          features.push({
            type: 'Feature',
            id: i + 1, // NUMERYCZNY IDENTYFIKATOR DLA GPU (v24.15)
            geometry: { type: 'LineString', coordinates: gc },
            properties: { 
              srcCode: leg.fromAirportCode,
              destCode: leg.toAirportCode,
              srcIdx: 0, // Domyślnie 0 dla głównej trasy (v24.15)
              legIdx: i
            }
          });
        }
      }
    });
    }

    const source = m.getSource('trip-permanent-routes') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData({ type: 'FeatureCollection', features });
    }
  }, [mapLoaded, tripState, coordsMap]);

  // --- LOGIKA STYLU ---
  // --- LOGIKA STYLU ---
  const lastAppliedFingerprintRef = useRef<string>('');

  const applyColors = useCallback(() => {
    const m = map.current;
    if (!m || !mapLoaded) return;
    
    if (!(m as any).getStyle()) {
      console.warn("[GPU_SYNC] Style not ready, skipping applyColors.");
      return;
    }

    try {
      if (!m.getLayer('airports-circles')) {
        console.warn("[GPU_SYNC] Layers missing in applyColors. Skipping...");
        return;
      }

      // STRAŻNIK STANU (v11.20.1): Monitorujemy WSZYSTKIE parametry wizualne (kolory i rozmiary)
      const colorState = useColorStore.getState();
      const selection = useSelectionStore.getState();
      const trip = useTripStore.getState();

      const visualSettings = Object.fromEntries(
        Object.entries(colorState).filter(([_, v]) => typeof v === 'string' || typeof v === 'number')
      );

      // [v24.97-FIX]: Read state DIRECTLY from stores to avoid stale Ref race conditions
      const currentSAC = selection.selectedAirportCodes || [];
      const currentHA = selection.highlightedAirports || [];
      const currentEAC = (selection.explorationItems || []).flatMap(i => i.airportCodes);
      const currentSACode = selection.selectedAirportCode;
      const currentMTAC = trip.manualTransferAirportCodes || [];
      const currentTripState = trip.tripState;

      const tvac: string[] = [];
      if (currentTripState) {
        tvac.push(currentTripState.startAirport.code);
        currentTripState.legs.forEach(l => {
          tvac.push(l.fromAirportCode);
          tvac.push(l.toAirportCode);
        });
      }
      const tvacUnique = Array.from(new Set(tvac));

      const fingerprint = JSON.stringify({
        ...visualSettings,
        sac: currentSAC,
        tvac: tvacUnique,
        ha: currentHA,
        mtac: currentMTAC,
        eac: currentEAC,
        sacode: currentSACode,
        lang: language,
        style: mapStyle, // STYL W ODCISKU (v11.46)
        startPoints: colorState.startPoints, 
        hover: hoveredAirportCodeRef.current
      });

      if (fingerprint === lastAppliedFingerprintRef.current) {
        return; // Brak zmian wizualnych -> pomijamy ciężką synchronizację
      }
      lastAppliedFingerprintRef.current = fingerprint;

      applyMapColors(m, {
        selectedAirportCodes: currentSAC,
        tripVisibleAirportCodes: tvacUnique.length > 0 ? tvacUnique : null,
        highlightedAirports: currentHA,
        manualTransferAirportCodes: currentMTAC,
        explorationAirportCodes: currentEAC,
        selectedAirportCode: currentSACode,
        highlightedLabelCodes: highlightedLabelCodesRef.current,
        colorState: colorState,
        hoveredAirportCode: hoveredAirportCodeRef.current,
        styleId: mapStyle || '', // JAWNE PRZEKAZANIE (v11.46)
      });

      if (applyHoverRef.current && hoveredAirportCodeRef.current) {
        applyHoverRef.current(hoveredAirportCodeRef.current);
      }
    } catch (err) {
      console.error("[GPU_SYNC] applyColors CRITICAL ERROR:", err);
    }
  }, [mapLoaded, language, mapStyle]); // USUNIĘTO selectedAirportCode (v11.52) - synchro idzie przez Refy w pętli lub subskrypcję

  // --- SYNCHRONIZACJA ŹRÓDŁA GPU (v13.12) ---
  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded || !enrichedAirportsData) return;
    const source = m.getSource('airports') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(enrichedAirportsData);
    }
  }, [mapLoaded, enrichedAirportsData]);

  const addLayers = useCallback((initialData: any) => {
    const dataToUse = initialData || airportsDataRef.current;
    console.log("[GPU_SYNC] addLayers() invoked. Data available:", !!dataToUse);
    if (!map.current || !mapLoaded || !dataToUse) return;
    
    const m = map.current;
    const colorState = useColorStore.getState();
    
    setupRouteLayers(m);
    addAirportsLayer(m, dataToUse, mapStyle, language, colorState); 
    
    // WYMUSZENIE SYNCHRONIZACJI (v11.15)
    lastAppliedFingerprintRef.current = '';
    applyColors();
  }, [mapLoaded, mapStyle, language, applyColors]);

  // GŁÓWNA SYNCHRONIZACJA (v15.25: Reactive Selection)
  useEffect(() => {
    (window as any).applyColorsManual = () => { console.log("[GPU_DEBUG] Manual sync"); applyColors(); };
    
    // Subskrypcja obu sklepów gwarantuje reaktywność na kolory ORAZ na selekcję (np. po Add to Trip)
    const unsubColor = useColorStore.subscribe(() => applyColors());
    const unsubSelection = useSelectionStore.subscribe(() => applyColors());
    const unsubTrip = useTripStore.subscribe(() => applyColors());
    
    if (mapLoaded) applyColors();
    
    return () => {
      unsubColor();
      unsubSelection();
      unsubTrip();
    };
  }, [applyColors, mapLoaded]);

  // --- ATOMOWE CZYSZCZENIE MAPY (v15.25: Hard Reset) ---
  // Gwarantuje, że po zamknięciu panelu (stan pusty) wszystkie źródła tras zostaną wyzerowane.
  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded) return;

    const noSelection = (selectedAirportCodes || []).length === 0 && !selectedAirportCode && highlightedAirports.length === 0;
    const noTrip = !tripState || !tripState.legs || tripState.legs.length === 0;

    if (noSelection && noTrip) {
      console.log("[GPU_SYNC] State empty - Performing Hard Reset of route sources...");
      const sourcesToClear = ['selected-routes', 'trip-arc', 'route-arc', 'route-line', 'route-shadow', 'trip-permanent-routes', 'manual-transfer-preview'];
      sourcesToClear.forEach(id => {
        try {
          const s = m.getSource(id) as maplibregl.GeoJSONSource;
          if (s) s.setData({ type: 'FeatureCollection', features: [] });
        } catch (e) {}
      });
      // Wyłączamy też animacje
      (window as any).stopAllAnimations?.();
    }
  }, [selectedAirportCode, selectedAirportCodes, highlightedAirports, tripState, mapLoaded]);

  // Reaktywne dodawanie warstw przy inicjalizacji i zmianie stylu (v13.12)
  useEffect(() => {
    const m = map.current;
    if (mapLoaded && enrichedAirportsData && m) {
      try {
        if (!m.getLayer('airports-circles')) {
          addLayers(enrichedAirportsData);
        } else {
          // Gwarantujemy Z-Index przy każdym re-renderze danych (v15.25)
          ensureAirportsOnTop(m);
        }
      } catch (e) {
        addLayers(enrichedAirportsData);
      }
    }
  }, [mapLoaded, mapStyle, enrichedAirportsData, addLayers, tripState, highlightedAirports, selectedAirportCodes]); 

  // --- HIERARCHIA WARSTW (v18.30: Hover-on-Top) ---
  const ensureAirportsOnTop = (m: maplibregl.Map) => {
    const layers = [
      'airports-circles', 
      'airports-trip', 
      'airports-highlighted', 
      'airports-selected',
      'airports-labels',
      'airports-labels-selected',
      'airports-hover-single-circle',
      'airports-hover-single-label'
    ];
    layers.forEach(id => {
      if (m.getLayer(id)) {
        m.moveLayer(id); // Przenosi na sam wierzch
      }
    });
  };

  const isTripActive = (tripState?.legs?.length || 0) > 0;

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
    applyHoverRef,
    mapStyle: mapStyle || '', // PRZEKAZANIE STYLU (v11.49)
    selectedAirportCode: selectedAirportCode, // PRZEKAZANIE (v15.25.4)
    isTripActive,
  };
  useMapHover(hoverRefs, mapLoaded, showAirports);

  const routeHoverRefs: RouteHoverRefs = {
    map, projectedAirportsRef, hoveredAirportCodeRef, hoveredRouteId,
    hoveredTripRouteId, hoveredTransferRouteId,
    isRouteHoveredRef, tripVisibleAirportCodesRef, highlightedAirportsRef,
    selectedAirportCodeRef: { current: selectedAirportCode }, selectedAirportCodesRef, explorationAirportCodesRef,
    manualTransferAirportCodesRef: { current: manualTransferAirportCodes }, airportsDataRef,
    airportCityKeyRef, cityLabelCodeByCityRef, highlightedCityLabelCodesRef,
    flightDetailsMap, flightsByRouteGroupMapRef,
    airportNamesMap, airportCoordsMapRef, currentPopup,
    routeHoverAtPointRef, clearRouteHoverRef,
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

  const lastAppliedZoomRangesRef = useRef({ min: -1, max: -1 });

  // --- TRWAŁOŚĆ KAMERY (v13.2): Zachowanie widoku przy zmianie stylu ---
  const lastCameraStateRef = useRef({
    center: [19.0, 52.0] as [number, number],
    zoom: 4,
    pitch: 0,
    bearing: 0
  });

  useRouteAnimation({
    map, mapLoaded, highlightedAirports, coordsMap, selectedAirportCode,
    selectedAirportCodes, displayedFlights, displayedFlightsRef,
    completedPathsRef, currentAnimatingRef,
    animationRef, renderedHighlightedRef,
    manualTransferAirportCodes,
    isFlightsLoading
  });

  // --- KESZOWANIE POZYCJI (v13.98: Repair Scope) ---
  useEffect(() => {
    const m = map.current;
    if (!mapLoaded || !m || !enrichedAirportsData) return;

    const rebuildProjectedPositions = () => {
      if (!m || !airportsData) return;
      const res = airportsData.features.map(f => {
        const px = m.project(f.geometry.coordinates as [number, number]);
        return { code: f.properties.code, x: px.x, y: px.y };
      });
      spatialIndex.update(res);
      projectedAirportsRef.current = res;
    };

    rebuildProjectedPositions();
    m.on('moveend', rebuildProjectedPositions);
    return () => { m.off('moveend', rebuildProjectedPositions); };
  }, [mapLoaded, enrichedAirportsData]);

  // --- STABILIZACJA WZGLĘDNA RÓWNIKOWA (v11.34) ---
  // lastStablePerceivedZoomRef: Przechowuje "wyczuwany" przez użytkownika zoom, znormalizowany do Równika.
  // zoomRelativeOffsetRef: Przechowuje różnicę między surowym silnikiem a naszym stabilnym licznikem.
  const lastStablePerceivedZoomRef = useRef<number>(CONFIG.DEFAULT_MAP_ZOOM);
  const zoomRelativeOffsetRef = useRef<number>(0);
  const isZoomInteractingRef = useRef<boolean>(false);
  const lastEngineMaxRef = useRef<number>(-1);

  useImperativeHandle(ref, () => ({
    flyTo: (opts: any) => map.current?.flyTo(opts),
    fitBounds: (bounds: any, opts: any) => map.current?.fitBounds(bounds, opts),
    getZoom: () => map.current?.getZoom(),
    once: (ev: string, cb: any) => map.current?.once(ev, cb),
  }));

  useEffect(() => {
    if (map.current && mapLoaded) {
      map.current.setProjection({ type: globeMode ? 'globe' : 'mercator' });
    }
  }, [globeMode, mapLoaded]);

  // SYNCHRONIZACJA LIMITÓW ZOOMU (v11.21)
  useEffect(() => {
    if (map.current && mapLoaded) {
      const { zoomRangeMin, zoomRangeMax } = colorState;
      
      // ZABEZPIECZENIE PRZED JITTEREM (v11.23): Wywołujemy funkcje silnika tylko przy zmianie
      if (lastAppliedZoomRangesRef.current.min !== zoomRangeMin || lastAppliedZoomRangesRef.current.max !== zoomRangeMax) {
        const minZ = Math.max(0, Math.min(zoomRangeMin, zoomRangeMax));
        const maxZ = Math.min(24, Math.max(zoomRangeMin, zoomRangeMax));
        map.current.setMinZoom(minZ);
        map.current.setMaxZoom(maxZ);
        lastAppliedZoomRangesRef.current = { min: zoomRangeMin, max: zoomRangeMax };
      }
    }
  }, [colorState.zoomRangeMin, colorState.zoomRangeMax, mapLoaded]);

  // SYNCHRONIZACJA KOLORÓW SYSTEMOWYCH W STORE (v11.47)
  useEffect(() => {
    if (mapLoaded) {
      useColorStore.getState().adaptToStyle(mapStyle);
    }
  }, [mapStyle, mapLoaded]);

  useEffect(() => {
    if (!mapContainer.current) return;
    const instance = new maplibregl.Map({
      container: mapContainer.current,
      style: resolveMapStyle(mapStyle, false) as string,
      center: lastCameraStateRef.current.center,
      zoom: lastCameraStateRef.current.zoom,
      pitch: lastCameraStateRef.current.pitch,
      bearing: lastCameraStateRef.current.bearing,
      transformRequest: arcGISTransformRequest,
      renderWorldCopies: true,
      maxPitch: 85
    } as any);
    map.current = instance;

    // --- ZAPIS STANU KAMERY (v13.2) ---
    instance.on('moveend', () => {
      const center = instance.getCenter();
      lastCameraStateRef.current = {
        center: [center.lng, center.lat],
        zoom: instance.getZoom(),
        pitch: instance.getPitch(),
        bearing: instance.getBearing()
      };
    });

    instance.on('load', () => { setMapLoaded(true); addLayers(null); });
    
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

    // OGRANICZENIE CZĘSTOTLIWOŚCI AKTUALIZACJI VIEWPORTU (v11.22)
    let lastUpdate = 0;

    instance.on('move', () => {
      const raw = instance.getZoom();
      const center = instance.getCenter();
      
      // 1. OBLICZANIE ZOOMU ZNORMALIZOWANEGO (v11.35):
      // W trybie Globe skala rośnie ku biegunom (więcej pikseli na metr).
      // Aby wrócić do skali równikowej, musimy ODJĄĆ korektę (którą jest ujemny log2(cos)).
      const latRad = (center.lat * Math.PI) / 180;
      const correction = Math.log2(Math.cos(Math.min(Math.abs(latRad), 1.565)));
      const currentPerceived = raw - correction; // raw - (-log) = raw + log

      // 2. DYNAMIZACJA LIMITÓW SILNIKA:
      // Synchronizujemy fizyczne bariery silnika z szerokością geograficzną.
      const { zoomRangeMin, zoomRangeMax } = useColorStore.getState();
      const minZ = Math.min(zoomRangeMin, zoomRangeMax);
      const maxZ = Math.max(zoomRangeMin, zoomRangeMax);

      const targetEngineMax = Math.max(0.1, maxZ + correction);
      const targetEngineMin = Math.max(-2.0, minZ + correction); // TWARDA BARIERA (MapLibre Safety)

      // 2. DYNAMIZACJA LIMITÓW (Asynchroniczna - v11.36):
      // Stosujemy requestAnimationFrame, aby odseparować mutacje od cyklu 'move'.
      // Zapobiega to błędowi "Attempting to run(), but is already running".
      if (Math.abs(targetEngineMax - lastEngineMaxRef.current) > 0.1) {
        requestAnimationFrame(() => {
          if (!map.current) return;
          try {
            map.current.setMaxZoom(targetEngineMax);
            map.current.setMinZoom(targetEngineMin);
          } catch (e) {
            console.warn("[GPU_SAFETY] Engine limit update failed (normal during fast moves):", e);
          }
        });
        lastEngineMaxRef.current = targetEngineMax;
      }

      // 3. LOGIKA DYFERENCJALNA (Brak skoków i driftu):
      if (instance.isZooming()) {
        if (!isZoomInteractingRef.current) {
          // Początek zoomowania: zapamiętujemy offset względem stabilnej bazy
          zoomRelativeOffsetRef.current = currentPerceived - lastStablePerceivedZoomRef.current;
          isZoomInteractingRef.current = true;
        }
        // Aktualizujemy bazę odejmując offset (płynny start)
        lastStablePerceivedZoomRef.current = currentPerceived - zoomRelativeOffsetRef.current;
      } else {
        // Koniec interakcji lub sama rotacja - lockujemy stan
        isZoomInteractingRef.current = false;
      }

      // 4. CLAMPING I RAPORTOWANIE:
      const finalPerceived = Math.max(minZ, Math.min(maxZ, lastStablePerceivedZoomRef.current));
      lastStablePerceivedZoomRef.current = finalPerceived;

      const now = Date.now();
      if (now - lastUpdate < 100) return; // Throttle 10Hz
      lastUpdate = now;

      onViewportChange({ 
        center: [center.lng, center.lat], 
        zoom: lastStablePerceivedZoomRef.current, // UI widzi idealnie stabilną skalę
        pitch: instance.getPitch(), 
        bearing: instance.getBearing() 
      });
    });

    return () => { instance.remove(); setMapLoaded(false); };
  }, [mapStyle]);

  return (
    <div className="map-root">
      <div ref={mapContainer} className="map" />
      {!mapLoaded && <div className="map-loader">Ładowanie mapy...</div>}
    </div>
  );
});

MapComponent.displayName = 'MapComponent';
export default MapComponent;