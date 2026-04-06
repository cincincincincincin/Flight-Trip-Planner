import React, { useCallback, useRef, memo, useMemo, useState, useEffect } from 'react';
import MapComponent from './components/MapComponent';
import ControlsPanel from './components/ControlsPanel';
import RightPanel from './components/RightPanel';
import Search from './components/Search';
import TripItinerary from './components/TripItinerary';
import AuthModal from './components/auth/AuthModal';
import UserMenu from './components/auth/UserMenu';
import SavedTripsPanel from './components/auth/SavedTripsPanel';
import { useAirportsQuery, useCountryCentersQuery } from './hooks/queries';
import { useMapStore } from './stores/mapStore';
import { useSelectionStore } from './stores/selectionStore';
import { useTripStore } from './stores/tripStore';
import { useSettingsStore } from './stores/settingsStore';
import { useAuthStore } from './stores/authStore';
import { useFilterStore } from './stores/filterStore';
import { useColorStore } from './stores/colorStore';
import { useTexts } from './hooks/useTexts';
import './App.css';
import { CONFIG } from './constants/config';
import { MAP_ASSETS } from './constants/mapStyles';
import { calculateZoomByAirportCount } from './components/map/zoomUtils';
import { getLocalizedProp } from './utils/geoUtils';

// Zachowujemy oryginalne metody konsoli, żeby móc je przywrócić w razie potrzeby
const _origLog = console.log;
const _origWarn = console.warn;
const _origDebug = console.debug;


// Pomocnicza funkcja do liczenia mediany - przydaje się przy filtrowaniu outlierów
function medianVal(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Logika odrzucania terytoriów pozamorskich i wysp (outliers).
// Chodzi o to, żeby mapa centrowała się na głównym terytorium kraju, a nie na środku oceanu.
function filterOutliersCoords(coords: [number, number][], maxDeg = CONFIG.OUTLIER_MAX_DEG): [number, number][] {
  if (coords.length <= 1) return coords;
  let current = [...coords];
  let prevLen = 0;
  while (current.length !== prevLen) {
    prevLen = current.length;
    const medLon = medianVal(current.map(c => c[0]));
    const medLat = medianVal(current.map(c => c[1]));
    const filtered = current.filter(([lon, lat]) =>
      Math.sqrt((lon - medLon) ** 2 + (lat - medLat) ** 2) <= maxDeg
    );
    if (filtered.length === 0) break;
    current = filtered;
  }
  return current;
}


const MemoizedMapComponent = memo(MapComponent);

function App() {
  const t = useTexts(); // Hook do tłumaczeń
  const mapRef = useRef<any>(null); // Referencja do instancji mapy (MapLibre/Mapbox)
  const rightPanelRef = useRef<any>(null); // Ref do bocznego panelu z informacjami
  const handleAddToTripRef = useRef<((flight: any) => Promise<void>) | null>(null);
  
  // Stan dla mobilnego panelu (dolna szuflada)
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(false);
  const mobileSheetRef = useRef<HTMLDivElement>(null);
  const sheetExpandedRef = useRef(false);
  useEffect(() => { sheetExpandedRef.current = mobileSheetExpanded; }, [mobileSheetExpanded]);

  const {
    showAirports, setShowAirports,
    viewport, setViewport,
    controlsPanelOpen, setControlsPanelOpen,
  } = useMapStore();

  const {
    selectedItem, setSelectedItem,
    selectedAirportCode, setSelectedAirportCode,
    selectedAirportCodes,
    highlightedAirports, setHighlightedAirports,
    flightsData,
    setFlightsData,
    clearSelection,
    explorationItems,
    addExplorationItem,
    clearExploration,
  } = useSelectionStore();

  useEffect(() => { setMobileSheetExpanded(false); }, [selectedItem]);

  // Obsługa gestów swipe dla panelu mobilnego (bottom sheet)
  useEffect(() => {
    const sheet = mobileSheetRef.current;
    if (!sheet) return;

    let dragging = false;
    let startY = 0;
    let startTranslate = 0;
    let currentTranslate = 0;

    const onStart = (e: TouchEvent) => {
      const rect = sheet.getBoundingClientRect();
      const fromTop = e.touches[0].clientY - rect.top;
      // Sprawdzamy czy użytkownik złapał za górny pasek (header) panelu
      if (fromTop > CONFIG.PEEK_H + CONFIG.DRAG_HEADER_EXTRA) return;
      dragging = true;
      startY = e.touches[0].clientY;
      startTranslate = sheetExpandedRef.current ? 0 : window.innerHeight - CONFIG.PEEK_H;
      currentTranslate = startTranslate;
      sheet.style.transition = 'none'; // Wyłączamy animację na czas dragowania
    };

    const onMove = (e: TouchEvent) => {
      if (!dragging) return;
      e.preventDefault();
      const dy = e.touches[0].clientY - startY;
      const maxT = window.innerHeight - CONFIG.PEEK_H;
      currentTranslate = Math.max(0, Math.min(maxT, startTranslate + dy));
      sheet.style.transform = `translateY(${currentTranslate}px)`;
    };

    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      const totalDrag = currentTranslate - startTranslate;
      const wasExpanded = sheetExpandedRef.current;
      // Decydujemy czy rozwinąć czy schować panel na podstawie progu przesunięcia
      const nextExpanded = wasExpanded ? totalDrag < CONFIG.DRAG_THRESHOLD : totalDrag < -CONFIG.DRAG_THRESHOLD;
      sheet.style.transition = ''; // Przywracamy animację CSS
      sheet.style.transform = '';
      setMobileSheetExpanded(nextExpanded);
    };

    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);

    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
    };
  }, [!!selectedItem]);

  const {
    tripState, setTripState,
    tripRoutes, setTripRoutes,
    manualTransferAirportCodes, setManualTransferAirportCodes,
    setPreviewAirportCode,
    pushToHistory,
    clearTrip,
    setEditMode,
    setPastTrips,
  } = useTripStore();

  const { travelDate, showConsoleLogs, language } = useSettingsStore();

  const fcHighlightAirportBg     = useColorStore(s => s.fcHighlightAirportBg);
  const fcHighlightAirportBorder = useColorStore(s => s.fcHighlightAirportBorder);
  const fcHighlightCityBg        = useColorStore(s => s.fcHighlightCityBg);
  const fcHighlightCityBorder    = useColorStore(s => s.fcHighlightCityBorder);
  const fcHighlightCountryBg     = useColorStore(s => s.fcHighlightCountryBg);
  const fcHighlightCountryBorder = useColorStore(s => s.fcHighlightCountryBorder);
  const fcHighlightSoonBg        = useColorStore(s => s.fcHighlightSoonBg);
  const fcHighlightSoonBorder    = useColorStore(s => s.fcHighlightSoonBorder);

  // Dynamiczna aktualizacja zmiennych CSS dla kolorów podświetlenia (Exploration Mode)
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--fc-highlight-airport-bg',     fcHighlightAirportBg);
    root.style.setProperty('--fc-highlight-airport-border', fcHighlightAirportBorder);
    root.style.setProperty('--fc-highlight-city-bg',        fcHighlightCityBg);
    root.style.setProperty('--fc-highlight-city-border',    fcHighlightCityBorder);
    root.style.setProperty('--fc-highlight-country-bg',     fcHighlightCountryBg);
    root.style.setProperty('--fc-highlight-country-border', fcHighlightCountryBorder);
    root.style.setProperty('--fc-highlight-soon-bg',        fcHighlightSoonBg);
    root.style.setProperty('--fc-highlight-soon-border',    fcHighlightSoonBorder);
  }, [fcHighlightAirportBg, fcHighlightAirportBorder, fcHighlightCityBg, fcHighlightCityBorder,
      fcHighlightCountryBg, fcHighlightCountryBorder, fcHighlightSoonBg, fcHighlightSoonBorder]);

  useEffect(() => {
    if (showConsoleLogs) {
      console.log = _origLog;
      console.warn = _origWarn;
      console.debug = _origDebug;
    } else {
      console.log = () => {};
      console.warn = () => {};
      console.debug = () => {};
    }
  }, [showConsoleLogs]);

  const { data: airportsData } = useAirportsQuery();
  const { data: countryCenters } = useCountryCentersQuery();

  const { clearFilters } = useFilterStore();

  const { user } = useAuthStore();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSavedTrips, setShowSavedTrips] = useState(false);
  const [pendingCountryPicker, setPendingCountryPicker] = useState<{ code: string; name: string } | null>(null);
  const prevSelectedAirportCodesLenRef = useRef<number>(0);
  const fitCameraOnFlightsRef = useRef(false);
  const tripVisibleAirportCodes = useMemo(() => {
    if (!tripState) return null;
    return [tripState.startAirport.code, ...tripState.legs.map(l => l.toAirportCode)];
  }, [tripState]);

  const tripCurrentArrivalTimeUTC = useMemo(() => {
    if (!tripState?.legs?.length) return null;
    for (let i = tripState.legs.length - 1; i >= 0; i--) {
      const leg = tripState.legs[i];
      if (leg.type !== 'manual' && leg.flight?.scheduled_arrival_utc) {
        return leg.flight.scheduled_arrival_utc;
      }
    }
    return null;
  }, [tripState]);

  // Funkcja flyTo do płynnego przemieszczania kamery na mapie
  const flyToLocation = useCallback((lng: number, lat: number, zoom: number) => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom, essential: true, duration: CONFIG.FLY_DURATION });
  }, []);

  const highlightedAirportsRef = useRef(highlightedAirports);
  useEffect(() => { highlightedAirportsRef.current = highlightedAirports; }, [highlightedAirports]);

  const fitBoundsToAirportCodes = useCallback((codes: string[]) => {
    if (!airportsData || codes.length === 0) return;
    const allCodes = [...new Set([...codes, ...highlightedAirportsRef.current])];
    const points = allCodes
      .map(code => airportsData.features.find(f => f.properties.code === code)?.geometry?.coordinates as [number, number] | undefined)
      .filter((p): p is [number, number] => !!p);
    if (points.length === 0) return;
    if (points.length === 1) { flyToLocation(points[0][0], points[0][1], CONFIG.FALLBACK_ZOOM.AIRPORT); return; }
    const lngs = points.map(p => p[0]);
    const lats = points.map(p => p[1]);
    mapRef.current?.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: CONFIG.FIT_BOUNDS_PADDING, duration: CONFIG.FLY_DURATION, maxZoom: CONFIG.FIT_BOUNDS_MAX_ZOOM });
  }, [airportsData, flyToLocation]);

  const setDisplayMode = useCallback((mode: string) => {
    setShowAirports(true);
    if (viewport.zoom < CONFIG.AIRPORT_ZOOM_THRESHOLD) {
      mapRef.current?.flyTo({ zoom: CONFIG.AIRPORT_ZOOM_THRESHOLD, duration: CONFIG.FLY_DURATION, essential: true });
    }
  }, [viewport.zoom, setShowAirports]);

  const extractCoordinates = (item: any) => {
    if (!item?.data) return null;
    const data = item.data;
    let coords = data.coordinates || data.geometry?.coordinates;
    if (!coords) return null;
    let lng, lat;
    if (Array.isArray(coords)) {
      [lng, lat] = coords;
    } else if (coords.lon !== undefined && coords.lat !== undefined) {
      lng = coords.lon;
      lat = coords.lat;
    }

  return (lng !== undefined && lat !== undefined) ? { lng, lat } : null;
  };

  const getExplorationAirportCodes = useCallback((type: 'airport' | 'city', code: string): string[] => {
    if (type === 'airport') return [code];
    if (!airportsData) return [];
    return airportsData.features
      .filter(f => f.properties.city_code === code)
      .map(f => f.properties.code);
  }, [airportsData]);

  const fitToCountry = useCallback((countryCode: string) => {
    if (airportsData) {
      const countryAirports = airportsData.features
        .filter(f => f.properties.country_code === countryCode);
      
      const coords = countryAirports.map(f => f.geometry.coordinates as [number, number]);
      
      if (coords.length > 0) {
        const customZoom = calculateZoomByAirportCount(coords.length);
        const continental = filterOutliersCoords(coords);
        
        if (continental.length === 1) {
          flyToLocation(continental[0][0], continental[0][1], customZoom);
        } else {
          const lngs = continental.map(c => c[0]);
          const lats = continental.map(c => c[1]);
          mapRef.current?.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { 
              padding: CONFIG.FIT_BOUNDS_PADDING, 
              duration: CONFIG.FLY_DURATION, 
              maxZoom: Math.max(CONFIG.MAX_ZOOM_FOR_COUNTRY, customZoom) 
            }
          );
        }
        return;
      }
    }
    const center = countryCenters?.[countryCode];
    if (center) {
      // Dla krajów bez lotnisk (fallback) również aplikujemy nową logikę lub zostawiamy domyślny środek
      flyToLocation(center.lon, center.lat, calculateZoomByAirportCount(center.airport_count));
    }
  }, [airportsData, countryCenters, flyToLocation]);

  const handleSelectItem = useCallback(async (item: any) => {
    if (item.type === 'airport' && item.isHighlighted && tripState) {
      const flight = (
        flightsData.find(f =>
          f.destination_airport_code === item.data.code &&
          f.scheduled_departure_local?.startsWith(travelDate)
        ) ?? flightsData.find(f => f.destination_airport_code === item.data.code)
      );
      if (flight) {
        handleAddToTripRef.current?.(flight);
        return;
      }
    }

    fitCameraOnFlightsRef.current = !item.fromMap;

    if (selectedItem && !tripState && (item.type === 'airport' || item.type === 'city')) {
      const newCodes = getExplorationAirportCodes(item.type, item.data.code);
      const allCodes = [...new Set([...explorationItems.flatMap((i: any) => i.airportCodes), ...newCodes])];
      addExplorationItem({
        type: item.type,
        code: item.data.code,
        name: item.data.name || item.data.code,
        airportCodes: newCodes,
      });
      if (!item.fromMap) fitBoundsToAirportCodes(allCodes);
      if (selectedItem.type === 'country') {
        setSelectedItem(item);
        if (item.type === 'airport') setSelectedAirportCode(item.data.code);
      }
      return;
    }

    if (item.type === 'country') {
      if (selectedItem !== null && selectedItem.type !== 'country') {
        setPendingCountryPicker({ code: item.data.code, name: item.data.name });
        if (!item.fromMap) fitToCountry(item.data.code);
        return;
      }
      setSelectedItem(item);
      setSelectedAirportCode(null);
      if (!item.fromMap) fitToCountry(item.data.code);
      return;
    }

    setSelectedItem(item);

    if (item.type === 'airport') {
      setSelectedAirportCode(item.data.code);
      setHighlightedAirports([]);
      setFlightsData([]);
      setDisplayMode('airports');
      addExplorationItem({
        type: 'airport',
        code: item.data.code,
        name: item.data.name || item.data.code,
        airportCodes: [item.data.code],
      });
      if (item.fromMap) return;
    } else if (item.type === 'city') {
      setSelectedAirportCode(null);
      const cityAirportCodes = getExplorationAirportCodes('city', item.data.code);
      addExplorationItem({
        type: 'city',
        code: item.data.code,
        name: item.data.name || item.data.code,
        airportCodes: cityAirportCodes,
      });

        if (cityAirportCodes.length > 0) {
          fitBoundsToAirportCodes(cityAirportCodes);
        }
      return;
    } else {
      setSelectedAirportCode(null);
    }

    if (item.fromMap) return;

    let coords = extractCoordinates(item);

    if (!coords && (item.type === 'airport') && item.data?.code) {
      const feat = airportsData?.features.find(f => f.properties.code === item.data.code);
      if (feat && feat.geometry.coordinates) {
        coords = { lng: feat.geometry.coordinates[0], lat: feat.geometry.coordinates[1] };
      }
    }

    if (coords) {
      flyToLocation(coords.lng, coords.lat, CONFIG.FALLBACK_ZOOM.AIRPORT);
    }
  }, [setDisplayMode, flyToLocation, fitBoundsToAirportCodes, tripState, flightsData, travelDate, selectedItem, /*viewMode,*/ addExplorationItem, explorationItems, getExplorationAirportCodes, setSelectedItem, setSelectedAirportCode, setHighlightedAirports, setFlightsData]);

  // Handler dodawania lotu do planu podróży
  const handleAddToTrip = useCallback(async (flight: any) => {
    const destCode = flight.destination_airport_code;
    const originCode = flight.origin_airport_code;
    const isFirstLeg = !tripState;
    const newFlightLeg = { fromAirportCode: originCode, toAirportCode: destCode, flight };
    const isFromTransferAirport = !isFirstLeg && manualTransferAirportCodes.includes(originCode);
    
    // Zapisujemy stan na potrzeby undo/redo
    pushToHistory();

    const newTripRoutes = [...tripRoutes];

    // Inicjalizacja pierwszej nogi podróży
    if (isFirstLeg) {
      const originFeat = airportsData?.features.find(f => f.properties.code === originCode);
      const startData = originFeat ? originFeat.properties : { code: originCode, city_code: '', country_code: '' };
      setTripState({
        startAirport: {
          code: startData.code,
          city_code: startData.city_code,
          country_code: startData.country_code,
        },
        legs: [newFlightLeg],
      });
    } else if (isFromTransferAirport) {
      // Obsługa przesiadek ręcznych (gdy użytkownik sam wybrał lotnisko wylotu w trakcie)
      const arrivalCode = (selectedItem?.data as any)?.code ?? '';
      const manualLeg = {
        type: 'manual' as const,
        fromAirportCode: arrivalCode,
        toAirportCode: originCode,
        flight: null as any,
      };
      setTripState({ ...tripState, legs: [...tripState.legs, manualLeg, newFlightLeg] });
      const fromFeat = airportsData?.features.find(f => f.properties.code === arrivalCode);
      const transferFeat = airportsData?.features.find(f => f.properties.code === originCode);
      if (fromFeat?.geometry && transferFeat?.geometry) {
        newTripRoutes.push({ from: fromFeat.geometry.coordinates as [number, number], to: transferFeat.geometry.coordinates as [number, number] });
      }
    } else {
      setTripState({ ...tripState, legs: [...tripState.legs, newFlightLeg] });
    }

    setManualTransferAirportCodes([]);

    // Dodanie nowej linii (trasy) na mapie
    const fromFeat = airportsData?.features.find(f => f.properties.code === originCode);
    const toFeat = airportsData?.features.find(f => f.properties.code === destCode);
    if (fromFeat?.geometry && toFeat?.geometry) {
      newTripRoutes.push({ from: fromFeat.geometry.coordinates as [number, number], to: toFeat.geometry.coordinates as [number, number] });
    }
    setTripRoutes(newTripRoutes);

    // Czyszczenie UI po dodaniu lotu
    setHighlightedAirports([]);
    setFlightsData([]);
    clearExploration();
    rightPanelRef.current?.clearTransferAirports();
    setSelectedAirportCode(destCode);
    setSelectedItem({ type: 'airport', data: { code: destCode, name: destCode } as any });

    try {
      const destFeat = airportsData?.features.find(f => f.properties.code === destCode);
      if (!destFeat) throw new Error('Destination airport not found in cached data');

      const overrideFromDatetime = flight.scheduled_arrival_local
        ? flight.scheduled_arrival_local.toString().substring(0, 19)
        : undefined;

      const destData = {
        code: destFeat.properties.code,
        name: getLocalizedProp(destFeat.properties, 'name', language),
        city_code: destFeat.properties.city_code,
        city_name: getLocalizedProp(destFeat.properties, 'city_name', language),
        country_code: destFeat.properties.country_code,
        country_name: getLocalizedProp(destFeat.properties, 'country_name', language),
        coordinates: { lon: destFeat.geometry.coordinates[0], lat: destFeat.geometry.coordinates[1] },
      };

      setSelectedItem({ type: 'airport', data: destData as any, overrideFromDatetime });

      if (destData.coordinates) flyToLocation(destData.coordinates.lon, destData.coordinates.lat, CONFIG.FALLBACK_ZOOM.AIRPORT);
    } catch (e) {
      console.error('Failed to fetch destination airport:', e);
      setSelectedItem({ type: 'airport', data: { code: destCode, name: destCode } as any });
    }
  }, [tripState, selectedItem, airportsData, tripRoutes, manualTransferAirportCodes, flyToLocation, setTripState, setTripRoutes, setManualTransferAirportCodes, setHighlightedAirports, setFlightsData, setSelectedAirportCode, setSelectedItem, pushToHistory, clearExploration]);
  handleAddToTripRef.current = handleAddToTrip;

  const handleUndoRedo = useCallback(() => {
    setTimeout(() => {
      const item = useSelectionStore.getState().selectedItem;
      if (!item) return;
      const coords = extractCoordinates(item);
      if (coords) {
        flyToLocation(coords.lng, coords.lat, CONFIG.FALLBACK_ZOOM.AIRPORT);
      }
    }, 0);
  }, [flyToLocation]);

  // Resetowanie wszystkich stanów (powrót do widoku domyślnego)
  const handleClosePanel = () => {
    setPendingCountryPicker(null);
    clearFilters();
    clearExploration();
    clearSelection();
    clearTrip();
  };

  // Zamknięcie załadowanej podróży i powrót do czystego stanu UI
  const handleCloseLoadedTrip = useCallback(() => {
    setPendingCountryPicker(null);
    clearFilters();
    clearExploration();
    clearSelection();
    clearTrip();
  }, [clearFilters, clearExploration, clearSelection, clearTrip]);

  // Funkcja do edycji załadowanej podróży - odtwarzamy stan i migawki historyczne (snapshots)
  const handleEditLoadedTrip = useCallback(async () => {
    if (!tripState?.legs?.length) return;
    setEditMode(true);
    const now = Date.now();
    const legs = tripState.legs;
    const snapshots: import('./stores/tripStore').TripSnapshot[] = [];

    // Przechodzimy po odcinkach podróży wstecz, aby zbudować historię dla undo/redo
    for (let i = legs.length - 1; i >= 0; i--) {
      const leg = legs[i];
      const isManual = (leg as { type?: string }).type === 'manual';
      // Jeśli segment już się odbył (czas przeszły), nie pozwalamy na jego cofnięcie w historii edycji
      if (!isManual && leg.flight?.scheduled_departure_utc) {
        const dep = new Date(leg.flight.scheduled_departure_utc).getTime();
        if (dep < now) break;
      }
      const slicedLegs = legs.slice(0, i);
      const slicedState = slicedLegs.length === 0 ? null : { ...tripState, legs: slicedLegs };
      let snapCode: string | null = null;
      for (let j = slicedLegs.length - 1; j >= 0; j--) {
        const l = slicedLegs[j];
        if ((l as { type?: string }).type !== 'manual') { snapCode = l.toAirportCode; break; }
      }
      const snapFeat = snapCode ? airportsData?.features.find(f => f.properties.code === snapCode) : null;
      const snapData = snapFeat?.properties ?? (snapCode ? { code: snapCode } : null);
      snapshots.unshift({
        tripState: slicedState,
        tripRoutes: tripRoutes.slice(0, i),
        selectedItem: snapData ? { type: 'airport', data: snapData as any } : null,
        selectedAirportCode: snapCode,
        selectedAirportCodes: snapCode ? [snapCode] : [],
        highlightedAirports: [],
        flightsData: [],
        explorationItems: [],
      });
    }

    if (snapshots.length > 0) {
      setPastTrips(snapshots);
    }

    let lastCode: string | null = null;
    let lastArrivalUTC: string | null = null;
    let lastArrivalLocal: string | null = null;
    for (let i = legs.length - 1; i >= 0; i--) {
      const leg = legs[i];
      if ((leg as { type?: string }).type !== 'manual' && leg.flight?.scheduled_arrival_utc) {
        lastCode = leg.toAirportCode;
        lastArrivalUTC = leg.flight.scheduled_arrival_utc;
        lastArrivalLocal = leg.flight.scheduled_arrival_local ?? null;
        break;
      }
    }
    if (!lastCode) return;
    setSelectedAirportCode(lastCode);
    try {
      const destFeat = airportsData?.features.find(f => f.properties.code === lastCode);
      if (!destFeat) throw new Error('Airport not found in cached data');

      const overrideFromDatetime = lastArrivalLocal
        ? lastArrivalLocal.toString().substring(0, 19)
        : lastArrivalUTC ? lastArrivalUTC.substring(0, 19) : undefined;

      const destData = {
        code: destFeat.properties.code,
        name: getLocalizedProp(destFeat.properties, 'name', language),
        city_code: destFeat.properties.city_code,
        city_name: getLocalizedProp(destFeat.properties, 'city_name', language),
        country_code: destFeat.properties.country_code,
        country_name: getLocalizedProp(destFeat.properties, 'country_name', language),
        coordinates: { lon: destFeat.geometry.coordinates[0], lat: destFeat.geometry.coordinates[1] },
      };

      setSelectedItem({ type: 'airport', data: destData as any, overrideFromDatetime });
      if (destData.coordinates) flyToLocation(destData.coordinates.lon, destData.coordinates.lat, CONFIG.FALLBACK_ZOOM.AIRPORT);
    } catch {
      setSelectedItem({ type: 'airport', data: { code: lastCode, name: lastCode } as any });
    }
  }, [tripState, tripRoutes, airportsData, setEditMode, setPastTrips, setSelectedAirportCode, setSelectedItem, flyToLocation]);

  // Przełączenie na widok konkretnego państwa (reset filtrów eksploracji)
  const handleSwitchToCountryView = useCallback((code: string, name: string) => {
    clearExploration();
    setSelectedItem({ type: 'country', data: { code, name } as any });
    setPendingCountryPicker(null);
  }, [clearExploration, setSelectedItem]);

  // Potwierdzenie wyboru lotnisk z widoku państwa i dopasowanie widoku mapy
  const handleCountryAirportsConfirmed = useCallback((codes: string[], countryCode: string, countryName: string) => {
    if (!airportsData || codes.length === 0) return;
    const resolvedName = (countryName && countryName !== countryCode)
      ? countryName
      : (() => {
          const feat = airportsData.features.find(f => f.properties.country_code === countryCode);
          const fromGeo = feat ? getLocalizedProp(feat.properties, 'country_name', language) : undefined;
          if (fromGeo && fromGeo !== countryCode) return fromGeo;
          try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) || countryCode; } catch { return countryCode; }
        })();
    clearExploration();
    addExplorationItem({ type: 'country', code: countryCode, name: resolvedName, airportCodes: codes });
    const firstFeat = airportsData?.features.find(f => f.properties.code === codes[0]);
    if (firstFeat) setSelectedItem({ type: 'airport', data: firstFeat.properties as any });
    fitBoundsToAirportCodes(codes);
  }, [airportsData, clearExploration, addExplorationItem, setSelectedItem, fitBoundsToAirportCodes]);

  // Efekt do automatycznego dopasowania kamery po wybraniu wielu lotnisk (np. grupy eksploracji)
  useEffect(() => {
    if (
      fitCameraOnFlightsRef.current &&
      selectedAirportCodes.length > 1 &&
      selectedAirportCodes.length > prevSelectedAirportCodesLenRef.current
    ) {
      fitBoundsToAirportCodes(selectedAirportCodes);
    }
    prevSelectedAirportCodesLenRef.current = selectedAirportCodes.length;
  }, [selectedAirportCodes, fitBoundsToAirportCodes]);

  // Efekt do automatycznego dopasowania widoku, gdy zmieniają się podświetlone lotniska (np. po wyszukiwaniu)
  useEffect(() => {
    if (!fitCameraOnFlightsRef.current || tripState || highlightedAirports.length === 0) return;
    const originCodes = selectedAirportCodes.length > 0
      ? selectedAirportCodes
      : selectedAirportCode ? [selectedAirportCode] : [];
    fitBoundsToAirportCodes([...originCodes, ...highlightedAirports]);
  }, [highlightedAirports, selectedAirportCode, selectedAirportCodes, tripState, fitBoundsToAirportCodes]);


  // Inicjalizacja tła z parametrów wizualnych
  useEffect(() => {
    document.documentElement.style.setProperty('--map-bg-image', MAP_ASSETS.BACKGROUND_IMAGE);
  }, []);

  return (
    <div className="app">
      {controlsPanelOpen && (
        <ControlsPanel
          onClose={() => setControlsPanelOpen(false)}
        />
      )}

      <div className="map-container">
        <div className="map-search-overlay">
          {!tripState && <Search onSelectItem={handleSelectItem} />}
          <div className="overlay-controls-row">
            <button
              className="open-controls-btn"
              onClick={() => setControlsPanelOpen(!controlsPanelOpen)}
            >
              {controlsPanelOpen ? t.buttons.closeControls : t.buttons.openControls}
            </button>
            {!user && (
              <button className="sign-in-btn" onClick={() => setShowAuthModal(true)}>
                {t.buttons.signIn}
              </button>
            )}
            {user && <UserMenu onOpenSavedTrips={() => setShowSavedTrips(true)} />}
          </div>
          <TripItinerary
            onUndo={handleUndoRedo}
            onRedo={handleUndoRedo}
            onEditTrip={handleEditLoadedTrip}
            onClose={handleCloseLoadedTrip}
            showSaveButton={!!user}
          />
        </div>

        <MemoizedMapComponent
          ref={mapRef}
          onViewportChange={setViewport}
          onSelectItem={handleSelectItem}
          rightPanelRef={rightPanelRef}
        />
      </div>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {showSavedTrips && <SavedTripsPanel onClose={() => setShowSavedTrips(false)} onTripLoaded={() => { clearSelection(); clearExploration(); }} />}

      {selectedItem && (
        <div
          ref={mobileSheetRef}
          className={`mobile-sheet${mobileSheetExpanded ? ' mobile-sheet--expanded' : ''}`}
        >
          <RightPanel
            ref={rightPanelRef}
            onClose={handleClosePanel}
            onAddToTrip={handleAddToTrip}
            onPreviewAirport={setPreviewAirportCode}
            onClearPreview={() => setPreviewAirportCode(null)}
            pendingCountryPicker={pendingCountryPicker}
            onClearCountryPicker={() => setPendingCountryPicker(null)}
            onFitBounds={fitBoundsToAirportCodes}
            onCountryAirportsConfirmed={handleCountryAirportsConfirmed}
            onSwitchToCountryView={handleSwitchToCountryView}
          />
        </div>
      )}
    </div>
  );
}

export default App;
