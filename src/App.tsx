import React, { useCallback, useRef, memo, useMemo, useState, useEffect } from 'react';
import MapComponent from './components/MapComponent';
import ControlsPanel from './components/ControlsPanel';
import RightPanel from './components/RightPanel';
import Search from './components/Search';
import TripItinerary from './components/TripItinerary';
import AuthModal from './components/auth/AuthModal';
import UserMenu from './components/auth/UserMenu';
import SavedTripsPanel from './components/auth/SavedTripsPanel';
import { getAirport, getCity, getCountryCenter } from './api/search';
import { useAirportsQuery } from './hooks/queries';
import { useMapStore } from './stores/mapStore';
import { useSelectionStore } from './stores/selectionStore';
import { useTripStore } from './stores/tripStore';
import { useSettingsStore } from './stores/settingsStore';
import { useAuthStore } from './stores/authStore';
import { useFilterStore } from './stores/filterStore';
import { useColorStore } from './stores/colorStore'; // for flight card highlight CSS vars
import './App.css';

const _origLog = console.log;
const _origWarn = console.warn;
const _origDebug = console.debug;

const AIRPORT_ZOOM_THRESHOLD = 1.2;

function medianVal(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function filterOutliersCoords(coords: [number, number][], maxDeg = 5): [number, number][] {
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

const FALLBACK_ZOOM = {
  AIRPORT: 6,
  CITY: 5,
  COUNTRY: 4
};

const MemoizedMapComponent = memo(MapComponent);

function App() {
  const mapRef = useRef<any>(null);
  const rightPanelRef = useRef<any>(null);
  const handleAddToTripRef = useRef<((flight: any) => Promise<void>) | null>(null);

  const {
    showAirports, setShowAirports,
    showCities, setShowCities,
    viewport, setViewport,
    controlsPanelOpen, setControlsPanelOpen,
    viewMode, setViewMode,
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

  const { travelDate, showConsoleLogs } = useSettingsStore();

  const fcHighlightAirportBg     = useColorStore(s => s.fcHighlightAirportBg);
  const fcHighlightAirportBorder = useColorStore(s => s.fcHighlightAirportBorder);
  const fcHighlightCityBg        = useColorStore(s => s.fcHighlightCityBg);
  const fcHighlightCityBorder    = useColorStore(s => s.fcHighlightCityBorder);
  const fcHighlightCountryBg     = useColorStore(s => s.fcHighlightCountryBg);
  const fcHighlightCountryBorder = useColorStore(s => s.fcHighlightCountryBorder);
  const fcHighlightSoonBg        = useColorStore(s => s.fcHighlightSoonBg);
  const fcHighlightSoonBorder    = useColorStore(s => s.fcHighlightSoonBorder);

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

  const { clearFilters } = useFilterStore();

  const { user } = useAuthStore();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSavedTrips, setShowSavedTrips] = useState(false);
  const [pendingCountryPicker, setPendingCountryPicker] = useState<{ code: string; name: string } | null>(null);
  const prevSelectedAirportCodesLenRef = useRef<number>(0);
  // When true, camera follows highlighted airports (only for search selections, not map clicks)
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

  const flyToLocation = useCallback((lng: number, lat: number, zoom: number) => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom, essential: true, duration: 800 });
  }, []);

  // Use a ref so fitBoundsToAirportCodes doesn't change reference when flights load
  const highlightedAirportsRef = useRef(highlightedAirports);
  useEffect(() => { highlightedAirportsRef.current = highlightedAirports; }, [highlightedAirports]);

  const fitBoundsToAirportCodes = useCallback((codes: string[]) => {
    if (!airportsData || codes.length === 0) return;
    const allCodes = [...new Set([...codes, ...highlightedAirportsRef.current])];
    const points = allCodes
      .map(code => airportsData.features.find(f => f.properties.code === code)?.geometry?.coordinates as [number, number] | undefined)
      .filter((p): p is [number, number] => !!p);
    if (points.length === 0) return;
    if (points.length === 1) { flyToLocation(points[0][0], points[0][1], FALLBACK_ZOOM.AIRPORT); return; }
    const lngs = points.map(p => p[0]);
    const lats = points.map(p => p[1]);
    mapRef.current?.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80, duration: 800, maxZoom: 8 });
  }, [airportsData, flyToLocation]);

  const setDisplayMode = useCallback((mode: string) => {
    if (mode === 'airports') {
      setShowAirports(true);
      setShowCities(false);
      setViewMode('airports');
      if (viewport.zoom < AIRPORT_ZOOM_THRESHOLD) {
        mapRef.current?.flyTo({ zoom: AIRPORT_ZOOM_THRESHOLD, duration: 800, essential: true });
      }
    } else {
      setShowAirports(false);
      setShowCities(true);
      setViewMode('cities');
    }
  }, [viewport.zoom, setShowAirports, setShowCities, setViewMode]);

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
      .filter(f => f.properties.city_code === code && f.properties.flightable)
      .map(f => f.properties.code);
  }, [airportsData]);

  const fitToCountry = useCallback((countryCode: string) => {
    if (airportsData) {
      const coords = airportsData.features
        .filter(f => f.properties.country_code === countryCode && f.properties.flightable)
        .map(f => f.geometry.coordinates as [number, number]);
      if (coords.length > 0) {
        const continental = filterOutliersCoords(coords);
        if (continental.length === 1) {
          flyToLocation(continental[0][0], continental[0][1], FALLBACK_ZOOM.COUNTRY);
        } else {
          const lngs = continental.map(c => c[0]);
          const lats = continental.map(c => c[1]);
          mapRef.current?.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 80, duration: 800, maxZoom: 7 }
          );
        }
        return;
      }
    }
    // Fallback to backend center if GeoJSON has no airports for this country
    getCountryCenter(countryCode).then((center: any) => {
      flyToLocation(center.lon ?? 0, center.lat ?? 0, center.recommended_zoom ?? FALLBACK_ZOOM.COUNTRY);
    }).catch(() => {});
  }, [airportsData, flyToLocation]);

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

    // Track whether camera should follow flight results (only for search, not map clicks)
    fitCameraOnFlightsRef.current = !item.fromMap;

    // Pre-trip exploration: if panel already open + airport/city → ADD to selection, don't navigate
    if (selectedItem && !tripState && (item.type === 'airport' || item.type === 'city')) {
      const newCodes = getExplorationAirportCodes(item.type, item.data.code);
      const allCodes = [...new Set([...explorationItems.flatMap((i: any) => i.airportCodes), ...newCodes])];
      addExplorationItem({
        type: item.type,
        code: item.data.code,
        name: item.data.name || item.data.code,
        airportCodes: newCodes,
      }, viewMode);
      if (!item.fromMap) fitBoundsToAirportCodes(allCodes);
      // If we were in country selection mode, switch the panel to the newly selected item
      if (selectedItem.type === 'country') {
        setSelectedItem(item);
        if (item.type === 'airport') setSelectedAirportCode(item.data.code);
      }
      return;
    }

    // If panel is already open with non-country content and user clicks a country → inline picker
    if (item.type === 'country') {
      if (selectedItem !== null && selectedItem.type !== 'country') {
        setPendingCountryPicker({ code: item.data.code, name: item.data.name });
        if (!item.fromMap) fitToCountry(item.data.code);
        return;
      }
      // Otherwise: open full country panel
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
      // Seed exploration items for the first selection
      addExplorationItem({
        type: 'airport',
        code: item.data.code,
        name: item.data.name || item.data.code,
        airportCodes: [item.data.code],
      }, viewMode);
      // Camera only for search selections — map clicks don't move camera
      if (item.fromMap) return;
    } else if (item.type === 'city') {
      setSelectedAirportCode(null);
      const cityAirportCodes = getExplorationAirportCodes('city', item.data.code);
      addExplorationItem({
        type: 'city',
        code: item.data.code,
        name: item.data.name || item.data.code,
        airportCodes: cityAirportCodes,
      }, viewMode);

      if (!item.fromMap) {
        let coords = extractCoordinates(item);
        if (!coords && item.data?.code) {
          try {
            const data = await getCity(item.data.code);
            coords = extractCoordinates({ data });
          } catch (e) {
            console.error('Failed to fetch city details:', e);
          }
        }
        if (cityAirportCodes.length > 1) {
          fitBoundsToAirportCodes(cityAirportCodes);
        } else if (coords) {
          flyToLocation(coords.lng, coords.lat, FALLBACK_ZOOM.CITY);
        }
      }
      return;
    } else {
      setSelectedAirportCode(null);
    }

    if (item.fromMap) return;

    let coords = extractCoordinates(item);

    if (!coords && (item.type === 'airport') && item.data?.code) {
      try {
        const data = await getAirport(item.data.code);
        coords = extractCoordinates({ data });
      } catch (e) {
        console.error(`Failed to fetch ${item.type} details:`, e);
      }
    }

    if (coords) {
      flyToLocation(coords.lng, coords.lat, FALLBACK_ZOOM.AIRPORT);
    }
  }, [setDisplayMode, flyToLocation, fitBoundsToAirportCodes, tripState, flightsData, travelDate, selectedItem, viewMode, addExplorationItem, explorationItems, getExplorationAirportCodes, setSelectedItem, setSelectedAirportCode, setHighlightedAirports, setFlightsData]);

  const handleAddToTrip = useCallback(async (flight: any) => {
    const destCode = flight.destination_airport_code;
    const originCode = flight.origin_airport_code;
    const isFirstLeg = !tripState;
    const newFlightLeg = { fromAirportCode: originCode, toAirportCode: destCode, flight };

    // In trip mode: check if flight departs from a manual transfer airport
    const isFromTransferAirport = !isFirstLeg && manualTransferAirportCodes.includes(originCode);
    
    // Save current state to undo stack before modifying
    pushToHistory();

    const newTripRoutes = [...tripRoutes];

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
      // Add manual transfer leg (current arrival → transfer airport) then the flight leg
      const arrivalCode = (selectedItem?.data as any)?.code ?? '';
      const manualLeg = {
        type: 'manual' as const,
        fromAirportCode: arrivalCode,
        toAirportCode: originCode,
        flight: null as any,
      };
      setTripState({ ...tripState, legs: [...tripState.legs, manualLeg, newFlightLeg] });
      // Add manual transfer route line
      const fromFeat = airportsData?.features.find(f => f.properties.code === arrivalCode);
      const transferFeat = airportsData?.features.find(f => f.properties.code === originCode);
      if (fromFeat?.geometry && transferFeat?.geometry) {
        newTripRoutes.push({ from: fromFeat.geometry.coordinates as [number, number], to: transferFeat.geometry.coordinates as [number, number] });
      }
    } else {
      setTripState({ ...tripState, legs: [...tripState.legs, newFlightLeg] });
    }

    // Clear manual transfer airports
    setManualTransferAirportCodes([]);

    // Add flight route line
    const fromFeat = airportsData?.features.find(f => f.properties.code === originCode);
    const toFeat = airportsData?.features.find(f => f.properties.code === destCode);
    if (fromFeat?.geometry && toFeat?.geometry) {
      newTripRoutes.push({ from: fromFeat.geometry.coordinates as [number, number], to: toFeat.geometry.coordinates as [number, number] });
    }
    setTripRoutes(newTripRoutes);

    setHighlightedAirports([]);
    setFlightsData([]);
    clearExploration();
    rightPanelRef.current?.clearTransferAirports();

    // Switch selectedItem immediately (minimal data) so flightAirportCodes in RightPanel
    // points to destCode right away — before the async getAirport resolves.
    // Without this, selectedItem.data.code stays on the old airport during the async gap,
    // causing FlightsList to fetch and append flights from the wrong airport.
    setSelectedAirportCode(destCode);
    setSelectedItem({ type: 'airport', data: { code: destCode, name: destCode } as any });

    try {
      const destData = await getAirport(destCode);
      const overrideFromDatetime = flight.scheduled_arrival_local
        ? flight.scheduled_arrival_local.toString().substring(0, 19)
        : undefined;

      setSelectedItem({ type: 'airport', data: destData, overrideFromDatetime });

      const coords = destData.coordinates;
      if (coords) flyToLocation((coords.lon ?? coords.lng) ?? 0, coords.lat ?? 0, FALLBACK_ZOOM.AIRPORT);
    } catch (e) {
      console.error('Failed to fetch destination airport:', e);
      // Fallback: set a minimal selectedItem so the panel stays consistent
      setSelectedItem({ type: 'airport', data: { code: destCode, name: destCode } as any });
    }
  }, [tripState, selectedItem, airportsData, tripRoutes, manualTransferAirportCodes, flyToLocation, setTripState, setTripRoutes, setManualTransferAirportCodes, setHighlightedAirports, setFlightsData, setSelectedAirportCode, setSelectedItem]);
  handleAddToTripRef.current = handleAddToTrip;

  const handleUndoRedo = useCallback(() => {
    // Defer slightly so Zustand stores (trip and selection) fully update
    setTimeout(() => {
      const item = useSelectionStore.getState().selectedItem;
      if (!item) return;
      const coords = extractCoordinates(item);
      if (coords) {
        flyToLocation(coords.lng, coords.lat, FALLBACK_ZOOM.AIRPORT);
      }
    }, 0);
  }, [flyToLocation]);

  const handleClosePanel = () => {
    setPendingCountryPicker(null);
    clearFilters();
    clearExploration();
    clearSelection();
    clearTrip();
  };

  const handleCloseLoadedTrip = useCallback(() => {
    setPendingCountryPicker(null);
    clearFilters();
    clearExploration();
    clearSelection();
    clearTrip();
  }, [clearFilters, clearExploration, clearSelection, clearTrip]);

  const handleEditLoadedTrip = useCallback(async () => {
    if (!tripState?.legs?.length) return;
    setEditMode(true);

    // Build undo history: allow undoing future legs (departure >= now), stop at departed legs
    const now = Date.now();
    const legs = tripState.legs;
    const snapshots: import('./stores/tripStore').TripSnapshot[] = [];

    for (let i = legs.length - 1; i >= 0; i--) {
      const leg = legs[i];
      const isManual = (leg as { type?: string }).type === 'manual';
      if (!isManual && leg.flight?.scheduled_departure_utc) {
        const dep = new Date(leg.flight.scheduled_departure_utc).getTime();
        if (dep < now) break; // this flight already departed — stop here
      }
      const slicedLegs = legs.slice(0, i);
      const slicedState = slicedLegs.length === 0 ? null : { ...tripState, legs: slicedLegs };
      // Determine the "current airport" for this intermediate state
      let snapCode: string | null = null;
      for (let j = slicedLegs.length - 1; j >= 0; j--) {
        const l = slicedLegs[j];
        if ((l as { type?: string }).type !== 'manual') { snapCode = l.toAirportCode; break; }
      }
      const snapFeat = snapCode ? airportsData?.features.find(f => f.properties.code === snapCode) : null;
      const snapData = snapFeat?.properties ?? (snapCode ? { code: snapCode } : null);
      snapshots.unshift({
        tripState: slicedState,
        tripRoutes: tripRoutes.slice(0, i), // each leg adds exactly one route
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

    // Find last real leg's arrival airport to open the right panel there
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
      const destData = await getAirport(lastCode);
      const overrideFromDatetime = lastArrivalLocal
        ? lastArrivalLocal.toString().substring(0, 19)
        : lastArrivalUTC ? lastArrivalUTC.substring(0, 19) : undefined;
      setSelectedItem({ type: 'airport', data: destData, overrideFromDatetime });
      const coords = destData.coordinates;
      if (coords) flyToLocation((coords.lon ?? coords.lng) ?? 0, coords.lat ?? 0, FALLBACK_ZOOM.AIRPORT);
    } catch {
      setSelectedItem({ type: 'airport', data: { code: lastCode, name: lastCode } as any });
    }
  }, [tripState, tripRoutes, airportsData, setEditMode, setPastTrips, setSelectedAirportCode, setSelectedItem, flyToLocation]);

  const handleSwitchToCountryView = useCallback((code: string, name: string) => {
    clearExploration();
    setSelectedItem({ type: 'country', data: { code, name } as any });
    setPendingCountryPicker(null);
  }, [clearExploration, setSelectedItem]);

  const handleCountryAirportsConfirmed = useCallback((codes: string[], countryCode: string, countryName: string) => {
    if (!airportsData || codes.length === 0) return;
    // Resolve name: prefer passed countryName, fall back to country_name from GeoJSON, then code
    const resolvedName = (countryName && countryName !== countryCode)
      ? countryName
      : (airportsData.features.find(f => f.properties.country_code === countryCode)?.properties.country_name ?? countryCode);
    clearExploration();
    addExplorationItem({ type: 'country', code: countryCode, name: resolvedName, airportCodes: codes }, viewMode);
    const firstFeat = airportsData.features.find(f => f.properties.code === codes[0]);
    if (firstFeat) setSelectedItem({ type: 'airport', data: firstFeat.properties as any });
    fitBoundsToAirportCodes(codes);
  }, [airportsData, clearExploration, addExplorationItem, viewMode, setSelectedItem, fitBoundsToAirportCodes]);

  // Camera: when selectedAirportCodes grows (search only, not map clicks), fitBounds
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

  // Camera: fit to selected + destination airports each time new flights load (search only, not map clicks)
  useEffect(() => {
    if (!fitCameraOnFlightsRef.current || tripState || highlightedAirports.length === 0) return;
    const originCodes = selectedAirportCodes.length > 0
      ? selectedAirportCodes
      : selectedAirportCode ? [selectedAirportCode] : [];
    fitBoundsToAirportCodes([...originCodes, ...highlightedAirports]);
  }, [highlightedAirports, selectedAirportCode, selectedAirportCodes, tripState, fitBoundsToAirportCodes]);

  // Mode-switch effect: when switching to city mode, expand airport exploration items to full cities
  useEffect(() => {
    if (viewMode !== 'cities' || !airportsData) return;
    if (explorationItems.length === 0) return;
    const needsExpansion = explorationItems.some(i => i.type === 'airport');
    if (!needsExpansion) return;
    clearExploration();
    explorationItems.forEach(item => {
      if (item.type === 'city') {
        addExplorationItem(item, 'cities');
      } else {
        // airport → expand to city
        const feat = airportsData.features.find(f => f.properties.code === item.code);
        const cityCode = feat?.properties.city_code;
        if (!cityCode) {
          addExplorationItem(item, 'cities');
        } else {
          const cityAirportCodes = airportsData.features
            .filter(f => f.properties.city_code === cityCode && f.properties.flightable)
            .map(f => f.properties.code);
          const cityName = feat?.properties.city_name || cityCode;
          addExplorationItem({ type: 'city', code: cityCode, name: cityName, airportCodes: cityAirportCodes }, 'cities');
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);


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
              {controlsPanelOpen ? '✕ Close settings' : 'Settings'}
            </button>
            {!user && (
              <button className="sign-in-btn" onClick={() => setShowAuthModal(true)}>
                Sign In
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
      )}
    </div>
  );
}

export default App;
