/**
 * KOMPONENT MAPY
 * 
 * Implementuje serce systemu: Atomyczny Heartbeat (RAF), który synchronizuje
 * wyświetlanie hovera, ukrywanie bazowych kropek oraz okluzję etykiet.
 */

// Importy

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
import { mergeFilterConditions, generateGreatCircle, safeSetZoomLimits } from './map/utils';
import { useRouteAnimation } from './map/useRouteAnimation';
import type { GCAnimationBatch } from './map/routeAnimations';
import { getLocalizedProp } from '../utils/i18n';
import { getSingleAirportLabel } from './search/searchUtils';
import { setupRouteHoverListeners } from './map/routeHover';
import type { RouteHoverRefs } from './map/routeHover';
import { logger } from '../utils/logger';

import './MapComponent.css';

/**
 * MapComponentRef - Interfejs do bezpośredniego sterowania mapą bez re-renderów.
 */
export interface MapComponentRef {
  flyTo: (options: FlyToOptions) => void;
  getZoom: () => number | undefined;
  once: (event: string, callback: (...args: unknown[]) => void) => void;
  fitBounds: (bounds: [[number, number], [number, number]], options?: { padding?: number; duration?: number; maxZoom?: number }) => void;
}

interface MapComponentProps {
  onViewportChange: (viewport: Viewport) => void;
  onSelectItem: (item: SelectedItem) => void;
  onMapInit?: (map: maplibregl.Map) => void;
  rightPanelRef: React.RefObject<any>;
}

const MapComponent = forwardRef<MapComponentRef, MapComponentProps>(({
  onSelectItem,
  onViewportChange,
  onMapInit,
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

  // Zapamiętywanie współrzędnych dla animacji
  const coordsMap = useMemo(() => {
    if (!airportsData) return undefined;
    const map: Record<string, [number, number]> = {};
    airportsData.features.forEach(f => {
      map[f.properties.code] = f.geometry.coordinates as [number, number];
    });
    return map;
  }, [airportsData]);

  // Referencje atomyczne (Dla pętli Heartbeat)
  // Przechowują szybkozmienne dane (np. przy move mapy) używane w pętli RAF.
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

  // Kontekst animacji tras
  const completedPathsRef = useRef<any[]>([]);
  const currentAnimatingRef = useRef<GCAnimationBatch[]>([]);
  const animationRef = useRef<number | null>(null);
  const renderedHighlightedRef = useRef<Set<string>>(new Set());
  const displayedFlightsRef = useRef<Flight[]>([]);

  // Referencje atomyczne (Dla pętli Heartbeat)
  const explorationAirportCodesRef = useRef<string[]>([]);
  const manualTransferAirportCodesRef = useRef(manualTransferAirportCodes);
  const airportsDataRef = useRef(airportsData);
  const onSelectItemRef = useRef(onSelectItem);

  // Dane lotów dla popupów
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


  /**
   * enrichedAirportsData - Przygotowanie danych dla GPU
   * 
   * Wzbogaca surowe lotniska o metadane potrzebne do warstwowego 
   * wyświetlania (wybór, podróż, priorytety miast).
   */
  const enrichedAirportsData = useMemo(() => {
    if (!airportsData) return null;

    // 1. Grupowanie lotnisk według miast
    const cityMap = new Map<string, any[]>();
    airportsData.features.forEach(f => {
      const cityCode = f.properties.city_code || 'UNKNOWN';
      if (!cityMap.has(cityCode)) cityMap.set(cityCode, []);
      cityMap.get(cityCode)!.push(f);
    });

    // 2. Pobranie zbiorów dla szybkiej weryfikacji (highlighted, selected, trip)
    const haSet = new Set((highlightedAirports || []).map(c => c.toUpperCase()));
    const sacSet = new Set((selectedAirportCodes || []).map(c => c.toUpperCase()));
    const tvacSet = new Set((tripState?.legs?.flatMap(l => [l.fromAirportCode, l.toAirportCode]) || []).map(c => c.toUpperCase()));

    // Wykrywanie priorytetów miasta
    // Służy to do wyboru tzw. "lidera etykiety" – jeśli w mieście jest 5 lotnisk, 
    // pokazujemy domyślnie tylko najważniejsze (według rankingu).
    const citySelectedIdxMap = new Map<string, number>();
    const cityDestSet = new Set<string>();
    const cityTripSet = new Set<string>();
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

    // Wyznaczamy liderów dla aktywnych warstw (najwyższy rank w grupie)
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

    const citySelectedPrimaryMap = new Map<string, string>();
    citySelectedIdxMap.forEach((_, cityCode) => {
      const airports = cityMap.get(cityCode) || [];
      const selInCity = airports.filter(a => sacSet.has(a.properties.code.toUpperCase()));
      if (selInCity.length > 0) {
        const top = [...selInCity].sort((a, b) => (b.properties.rank || 0) - (a.properties.rank || 0))[0];
        citySelectedPrimaryMap.set(cityCode, top.properties.code);
      }
    });

    // 3. Flagi i offsety dla etykiet
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

      const isCityDestPrimary = cityDestPrimaryMap.get(cityCode) === code;
      const isCityTripPrimary = cityTripPrimaryMap.get(cityCode) === code;
      const isCitySelectedPrimary = citySelectedPrimaryMap.get(cityCode) === code;

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
          is_city_high: isCityHigh,
          is_city_selected: isCitySelected,
          is_city_dest: isCityDest,
          is_city_trip: isCityTrip,
          is_city_dest_primary: isCityDestPrimary,
          is_city_trip_primary: isCityTripPrimary,
          is_city_selected_primary: isCitySelectedPrimary,
          la_sel_idx: selIdx,
          la_city_sel_idx: citySelIdx,
          la_is_high_num: isHigh ? 1 : 0,
          // Dynamiczne marginesy etykiet
          la_off_n: [0, (() => { const v = (rMin + pad) / (fMin || 11); return Number.isFinite(v) ? v : 1.3; })()] as [number, number],
          la_off_f: [0, (() => { const v = (rMax + pad) / (fMax || 13); return Number.isFinite(v) ? v : 1.8; })()] as [number, number],
          // Teksty etykiet
          cl_search: `${searchLabelBase} (${code})`,
          cl_grouped: cityName,
          cl_high: `${airportName} ${code}`,
          cl_hl_low: getSingleAirportLabel(cityName, airportName, false),
          cl_hl_high: `${getSingleAirportLabel(cityName, airportName, false)} (${code})`
        }
      };
    });

    return { ...airportsData, features: newFeatures };
  }, [airportsData, language, highlightedAirports, selectedAirportCodes, explorationItems, tripState]);

  // Synchronizacja dla useMapHover
  useEffect(() => {
    airportsDataRef.current = (enrichedAirportsData as any) || undefined;
  }, [enrichedAirportsData]);

  // Synchronizacja danych dla popupów
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

      // Grupowanie według celu (Dest)
      if (!byDest[dst]) byDest[dst] = [];
      byDest[dst].push(f);

      // Grupowanie według konkretnej trasy (SRC-DST)
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

  // Synchronizacja tras podróży
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
              id: i + 1, // Identyfikator dla GPU
              geometry: { type: 'LineString', coordinates: gc },
              properties: {
                srcCode: leg.fromAirportCode,
                destCode: leg.toAirportCode,
                srcIdx: 0, // Domyślnie 0
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
  const lastAppliedFingerprintRef = useRef<string>('');
  /**
   * applyColors - ARCHITEKTURA "FINGERPRINT"
   * 
   * Synchronizuje stan wizualny aplikacji z GPU. Wykorzystuje "odcisk palca"
   * stanu, aby unikać zbędnych operacji gdy nic się nie zmieniło.
   */
  const applyColors = useCallback(() => {
    const m = map.current;
    if (!m || !mapLoaded) return;

    if (!(m as any).getStyle()) return;

    try {
      if (!m.getLayer('airports-circles')) return;

      const colorState = useColorStore.getState();
      const selection = useSelectionStore.getState();
      const trip = useTripStore.getState();

      const visualSettings = Object.fromEntries(
        Object.entries(colorState).filter(([_, v]) => typeof v === 'string' || typeof v === 'number')
      );

      // Bezpośredni odczyt ze sklepów (Store)
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

      // Budowanie odcisku palca wizualnego
      const fingerprint = JSON.stringify({
        ...visualSettings,
        sac: currentSAC,
        tvac: tvacUnique,
        ha: currentHA,
        mtac: currentMTAC,
        eac: currentEAC,
        sacode: currentSACode,
        lang: language,
        style: mapStyle, // STYL W ODCISKU
        startPoints: colorState.startPoints,
        hover: hoveredAirportCodeRef.current
      });

      if (fingerprint === lastAppliedFingerprintRef.current) {
        return; // Brak zmian - pomijamy
      }
      lastAppliedFingerprintRef.current = fingerprint;

      // Wywołanie niskopoziomowej funkcji ustawiającej kolory warstw i filtry
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
        styleId: mapStyle || '', // JAWNE PRZEKAZANIE
      });

      if (applyHoverRef.current && hoveredAirportCodeRef.current) {
        applyHoverRef.current(hoveredAirportCodeRef.current);
      }
    } catch (err) {
      logger.error("[GPU_SYNC] BŁĄD KRYTYCZNY applyColors:", err);
    }
  }, [mapLoaded, language, mapStyle]); // Synchronizacja selekcji przez Refy

  // Synchronizacja źródła GPU
  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded || !enrichedAirportsData) return;
    const source = m.getSource('airports') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(enrichedAirportsData);
    }
  }, [mapLoaded, enrichedAirportsData]);

  /**
   * addLayers - Inicjalizacja warstw GPU
   * 
   * Tworzy źródła danych i warstwy dla tras oraz lotnisk.
   */
  const addLayers = useCallback((initialData: any) => {
    const dataToUse = initialData || airportsDataRef.current;
    if (!map.current || !mapLoaded || !dataToUse) return;

    const m = map.current;
    const colorState = useColorStore.getState();

    setupRouteLayers(m); // Inicjalizacja tras (linie, łuki)
    addAirportsLayer(m, dataToUse, mapStyle, language, colorState); // Inicjalizacja lotnisk

    // Wymuszenie synchronizacji
    lastAppliedFingerprintRef.current = '';
    applyColors();
  }, [mapLoaded, mapStyle, language, applyColors]);

  // Subskrypcje sklepów
  useEffect(() => {
    // Reagujemy na każdą zmianę kolorów, selekcji lub stanu podróży
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

  // Twardy reset mapy przy braku selekcji
  // Gwarantuje, że po zamknięciu panelu (stan pusty) wszystkie źródła tras zostaną wyzerowane.
  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded) return;

    const noSelection = (selectedAirportCodes || []).length === 0 && !selectedAirportCode && highlightedAirports.length === 0;
    const noTrip = !tripState || !tripState.legs || tripState.legs.length === 0;

    if (noSelection && noTrip) {
      logger.log("[GPU_SYNC] Stan pusty - resetowanie tras...");
      const sourcesToClear = ['selected-routes', 'trip-arc', 'route-arc', 'route-line', 'route-shadow', 'trip-permanent-routes', 'manual-transfer-preview'];
      sourcesToClear.forEach(id => {
        try {
          const s = m.getSource(id) as maplibregl.GeoJSONSource;
          if (s) s.setData({ type: 'FeatureCollection', features: [] });
        } catch (e) { }
      });
      // Zatrzymanie animacji
      (window as any).stopAllAnimations?.();
    }
  }, [selectedAirportCode, selectedAirportCodes, highlightedAirports, tripState, mapLoaded]);

  // Reaktywne dodawanie warstw
  useEffect(() => {
    const m = map.current;
    if (mapLoaded && enrichedAirportsData && m) {
      try {
        if (!m.getLayer('airports-circles')) {
          addLayers(enrichedAirportsData);
        } else {
          // Gwarancja Z-Index
          ensureAirportsOnTop(m);
        }
      } catch (e) {
        addLayers(enrichedAirportsData);
      }
    }
  }, [mapLoaded, mapStyle, enrichedAirportsData, addLayers, tripState, highlightedAirports, selectedAirportCodes]);

  /**
   * ensureAirportsOnTop - Hierarchia warstw
   * 
   * Gwarantuje, że lotniska i ich etykiety są zawsze nad liniami tras.
   */
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
        m.moveLayer(id); // Na wierzch stosu
      }
    });
  };

  const isTripActive = (tripState?.legs?.length || 0) > 0;

  // Interakcja i hover
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
    mapStyle: mapStyle || '', // PRZEKAZANIE STYLU
    selectedAirportCode: selectedAirportCode, // PRZEKAZANIE
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
      // Śledzenie myszy
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

  // Zachowanie widoku kamery
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

  // Keszynowanie pozycji
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

  // Stabilizacja globu
  const lastStablePerceivedZoomRef = useRef<number>(CONFIG.DEFAULT_MAP_ZOOM);
  const lastStableCenterRef = useRef<maplibregl.LngLat | null>(null);

  const isZoomInteractingRef = useRef<boolean>(false);
  const isSyncingRef = useRef<boolean>(false);
  const lastEngineMaxRef = useRef<number>(-1);

  useImperativeHandle(ref, () => ({
    flyTo: (opts: any) => map.current?.flyTo(opts),
    fitBounds: (bounds: any, opts: any) => map.current?.fitBounds(bounds, opts),
    getZoom: () => map.current?.getZoom(),
    once: (ev: string, cb: any) => map.current?.once(ev, cb),
  }));

  // Korekta wysokości globu
  const getGlobeCorrection = (lat: number): number => {
    // Clamp do 1.57 rad (~89.95 deg) - precyzyjne śledzenie krzywizny bieguna
    const latRad = (lat * Math.PI) / 180;
    return Math.log2(Math.cos(Math.min(Math.abs(latRad), 1.57)));
  };

  useEffect(() => {
    if (map.current && mapLoaded) {
      map.current.setProjection({ type: globeMode ? 'globe' : 'mercator' });
      lastEngineMaxRef.current = -1;
      const raw = map.current.getZoom();
      const { zoomRangeMin, zoomRangeMax } = useColorStore.getState();
      const minZ = Math.min(zoomRangeMin, zoomRangeMax);
      const maxZ = Math.max(zoomRangeMin, zoomRangeMax);

      if (globeMode) {
        const correction = getGlobeCorrection(map.current.getCenter().lat);
        // Perceived zoom = raw - correction
        lastStablePerceivedZoomRef.current = Math.max(minZ, Math.min(maxZ, raw - correction));
        // Matematyczna stabilizacja w pętli move
        safeSetZoomLimits(map.current, -5, 24);
      } else {
        lastStablePerceivedZoomRef.current = raw;
        safeSetZoomLimits(map.current, 0, 24);
      }
    }
  }, [globeMode, mapLoaded]);

  // Synchronizacja limitów zoomu
  useEffect(() => {
    if (map.current && mapLoaded) {
      const { zoomRangeMin, zoomRangeMax } = colorState;

      // Zabezpieczenie przed drżeniem (jitter)
      if (lastAppliedZoomRangesRef.current.min !== zoomRangeMin || lastAppliedZoomRangesRef.current.max !== zoomRangeMax) {
        const minZ = Math.min(zoomRangeMin, zoomRangeMax);
        const maxZ = Math.max(zoomRangeMin, zoomRangeMax);

        const isGlobe = map.current.getProjection()?.type === 'globe';
        if (isGlobe) {
          // W trybie globu nie ruszamy limitów silnika podczas pracy (wydajność)
          lastStablePerceivedZoomRef.current = Math.max(minZ, Math.min(maxZ, lastStablePerceivedZoomRef.current));
        } else {
          // W trybie Mercator limity są statyczne, więc możemy je ustawić bez kradzieży FPS
          safeSetZoomLimits(map.current, Math.max(0, minZ), Math.min(24, maxZ));
        }
        lastAppliedZoomRangesRef.current = { min: zoomRangeMin, max: zoomRangeMax };
      }
    }
  }, [colorState.zoomRangeMin, colorState.zoomRangeMax, mapLoaded]);

  // Synchronizacja kolorów stylu
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

    // Zapis stanu kamery
    instance.on('moveend', () => {
      const center = instance.getCenter();
      lastCameraStateRef.current = {
        center: [center.lng, center.lat],
        zoom: instance.getZoom(),
        pitch: instance.getPitch(),
        bearing: instance.getBearing()
      };
    });

    instance.on('load', () => {
      setMapLoaded(true);
      (window as any).map = instance;
      onMapInit?.(instance);
      addLayers(null);
    });

    // Obsługa brakujących ikon
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

    // Ograniczenie częstotliwości aktualizacji
    let lastUpdate = 0;

    // Stan przeciągania
    let isPanDragging = false;
    let isEasingCorrection = false;
    instance.on('dragstart', () => { isPanDragging = true; isEasingCorrection = false; });
    instance.on('dragend', () => { isPanDragging = false; });

    instance.on('move', () => {
      // Blokada synchronizacji
      if (isSyncingRef.current) return;

      const raw = instance.getZoom();
      const center = instance.getCenter();
      const isCurrentlyGlobe = instance.getProjection()?.type === 'globe';

      if (!isCurrentlyGlobe) {
        lastStablePerceivedZoomRef.current = raw;
        onViewportChange({
          center: [center.lng, center.lat],
          zoom: raw,
          pitch: instance.getPitch(),
          bearing: instance.getBearing()
        });
        return;
      }

      /**
       * Obliczanie korekty wysokości (Globe Altitude Correction)
       * Pozwala utrzymać stałą wysokość nad ziemią (GMD).
       */
      const correction = getGlobeCorrection(center.lat);
      const currentPerceived = raw - correction;

      // 1. Parametry zakresu
      const { zoomRangeMin, zoomRangeMax } = useColorStore.getState();
      const minZ = Math.min(zoomRangeMin, zoomRangeMax);
      const maxZ = Math.max(zoomRangeMin, zoomRangeMax);

      // Dostępny perceived zoom
      const engineClampedMin = Math.max(minZ, -5.0 - correction);
      const engineClampedMax = Math.min(maxZ, 24.0 - correction);

      // Pominięcie w trakcie korekty
      if (isEasingCorrection) return;

      // 2. Aktywna synchronizacja
      if (!instance.isZooming() && !isZoomInteractingRef.current) {
        // PRZESUWANIE / BEZCZYNNOŚĆ:
        if (isPanDragging) {
          // Pozwolenie na naturalny dryf przy przeciąganiu
          lastStablePerceivedZoomRef.current = raw - correction;
          lastStableCenterRef.current = center;
        } else {
          // Blokada wysokości (Lock)
          const targetRaw = lastStablePerceivedZoomRef.current + correction;
          const clampedTargetRaw = Math.max(-5, Math.min(24, targetRaw));

          if (Math.abs(raw - clampedTargetRaw) > 0.001) {
            isSyncingRef.current = true;
            instance.jumpTo({ zoom: clampedTargetRaw });
            isSyncingRef.current = false;
          }
          lastStableCenterRef.current = center;
        }
      } else {
        // Limity wysokości (Zoom/Pinch)
        const clampedPerceived = Math.max(engineClampedMin, Math.min(engineClampedMax, currentPerceived));
        lastStablePerceivedZoomRef.current = clampedPerceived;
        isZoomInteractingRef.current = true;

        if (currentPerceived < engineClampedMin || currentPerceived > engineClampedMax) {
          // Blokada zooma i środka (Overscroll)
          isSyncingRef.current = true;
          instance.jumpTo({
            zoom: clampedPerceived + correction,
            center: lastStableCenterRef.current || center
          });
          isSyncingRef.current = false;
          return;
        }
        lastStableCenterRef.current = center;
      }

      // 3. Blokowanie stanu
      if (!instance.isZooming()) {
        isZoomInteractingRef.current = false;
      }

      // 4. Raportowanie do UI
      const finalPerceived = Math.max(minZ, Math.min(maxZ, lastStablePerceivedZoomRef.current));
      lastStablePerceivedZoomRef.current = finalPerceived;

      const now = Date.now();
      if (now - lastUpdate < 100) return;
      lastUpdate = now;

      onViewportChange({
        center: [center.lng, center.lat],
        zoom: lastStablePerceivedZoomRef.current, // Wysokość (perceived zoom)
        pitch: instance.getPitch(),
        bearing: instance.getBearing()
      });
    });

    // Korekta inercji
    instance.on('moveend', () => {
      if (isSyncingRef.current || isEasingCorrection) {
        isEasingCorrection = false;
        return;
      }
      if (isPanDragging) return;

      const isGlobe = instance.getProjection()?.type === 'globe';
      const currentRaw = instance.getZoom();
      const currentCenter = instance.getCenter();

      if (!isGlobe) {
        onViewportChange({
          center: [currentCenter.lng, currentCenter.lat],
          zoom: currentRaw,
          pitch: instance.getPitch(),
          bearing: instance.getBearing()
        });
        return;
      }

      const corr = getGlobeCorrection(currentCenter.lat);
      const { zoomRangeMin, zoomRangeMax } = useColorStore.getState();
      const minZ = Math.min(zoomRangeMin, zoomRangeMax);
      const maxZ = Math.max(zoomRangeMin, zoomRangeMax);
      const perceived = currentRaw - corr;
      const clamped = Math.max(minZ, Math.min(maxZ, perceived));
      lastStablePerceivedZoomRef.current = clamped;
      lastStableCenterRef.current = currentCenter;

      const targetRaw = clamped + corr;
      if (Math.abs(currentRaw - targetRaw) > 0.01) {
        isEasingCorrection = true;
        instance.easeTo({ zoom: targetRaw, duration: 200 });
      }

      onViewportChange({
        center: [currentCenter.lng, currentCenter.lat],
        zoom: lastStablePerceivedZoomRef.current, // Stabilna wysokość
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