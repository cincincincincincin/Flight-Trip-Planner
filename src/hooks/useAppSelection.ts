import { useCallback, useState, useRef, useEffect } from 'react';
import { useSelectionStore } from '../stores/selectionStore';
import { useMapStore } from '../stores/mapStore';
import { useTripStore } from '../stores/tripStore';
import { useSettingsStore } from '../stores/settingsStore';
import { CONFIG } from '../constants/config';
import { extractCoords } from '../utils/geoUtils';
import { useAirportIndexes, useAirportsMap, useCityAirportsMap, useAirportsQuery, useCountryInfoMap, useCityInfoMap } from './queries';
import type { SelectedItem, Flight, Airport } from '../types';
import type { MapComponentRef } from '../components/MapComponent';

/**
 * Główny hook orkiestrujący logikę wyboru na mapie i w wyszukiwarce.
 * Łączy zdarzenia UI z magazynem stanu i nawigacją kamery.
 */
export function useAppSelection({ mapNav, mapRef, handleAddToTripRef }: UseAppSelectionProps) {
  const { airportFeaturesMap, namesMap, cityMap, countryMap } = useAirportIndexes();
  const cityAirportsMap = useCityAirportsMap();
  const cityInfoMap = useCityInfoMap();
  const countryInfoMap = useCountryInfoMap();

  const {
    selectedItem, setSelectedItem,
    setSelectedAirportCode,
    setHighlightedAirports,
    flightsData,
    addExplorationItem,
    clearExploration,
    explorationItems,
  } = useSelectionStore();

  const { setShowAirports, viewport } = useMapStore();
  const { tripState } = useTripStore();
  const { travelDate, language } = useSettingsStore();

  const [pendingCountryPicker, setPendingCountryPicker] = useState<{ code: string; name: string } | null>(null);
  const pendingCountryPickerRef = useRef<{ code: string; name: string } | null>(null);
  /**
   * [MUTEX SELECTION LOCK]: Ochrona przed Race Conditions w interfejsie.
   * Używamy useRef zamiast useState dla blokady, ponieważ potrzebujemy natychmiastowej, 
   * synchronicznej flagi, która nie wyzwala re-renderu, ale blokuje nakładające się akcje asynchroniczne.
   */
  const selectionLockRef = useRef(false);
  const fitCameraOnFlightsRef = useRef(false);

  const setDisplayMode = useCallback(() => {
    setShowAirports(true);
    if (viewport.zoom < CONFIG.AIRPORT_ZOOM_THRESHOLD) {
      mapRef.current?.flyTo({ zoom: CONFIG.AIRPORT_ZOOM_THRESHOLD, duration: CONFIG.FLY_DURATION, essential: true });
    }
  }, [viewport.zoom, setShowAirports, mapRef]);

  // Pobiera wszystkie lotniska przypisane do miasta/lotniska
  const getExplorationAirportCodes = useCallback((type: 'airport' | 'city', code: string): string[] => {
    if (type === 'airport') return [code];
    return cityAirportsMap[code] || [];
  }, [cityAirportsMap]);

  /**
   * KLUCZOWA FUNKCJA OBSŁUGI WYBORU (Selection Controller)
   * Implementuje mechanizm Mutex (selectionLockRef) dla eliminacji Race Conditions.
   */
  const handleSelectItem = useCallback(async (item: SelectedItem) => {
    const sequenceId = Math.random().toString(36).substring(7);
    const showLogs = useSettingsStore.getState().showConsoleLogs;
    
    if (selectionLockRef.current) {
      if (showLogs) console.log(`%c[ACTION-SELECTION] %c[${sequenceId}] Blocked: Selection in progress`, 'color: #f59e0b; font-weight: bold', 'color: inherit');
      return;
    }

    const itemCode = ((item.data as any).code || '').toUpperCase();
    if (showLogs) {
      console.log(`%c[ACTION-SELECTION] %c[${sequenceId}] START | Type: ${item.type}, Code: ${itemCode}`, 'color: #10b981; font-weight: bold', 'color: inherit');
    }

    selectionLockRef.current = true;

    try {
      const currentTripState = useTripStore.getState().tripState;
      const currentSelectedItem = useSelectionStore.getState().selectedItem;

      // 1. Szybka akcja dodawania do podróży bezpośrednio z mapy
      if (item.type === 'airport' && item.isHighlighted && currentTripState) {
        const currentOrigin = currentTripState.legs.length > 0 
          ? currentTripState.legs[currentTripState.legs.length - 1].toAirportCode 
          : currentTripState.startAirport.code;
          
        const groupKey = `${currentOrigin}-${itemCode}`;
        const group = useSelectionStore.getState().flightsByRouteGroupMap.get(groupKey) || [];
        
        const flight = (
          group.find((f: Flight) => f.scheduled_departure_local?.startsWith(travelDate)) ?? 
          group[0]
        );

        if (flight) {
          if (showLogs) console.log(`%c[ACTION-SELECTION] %c[${sequenceId}] Fast Add Triggered`, 'color: #10b981; font-weight: bold', 'color: inherit');
          handleAddToTripRef.current?.(flight);
          return;
        }
      }

      if ('fromMap' in item) {
        fitCameraOnFlightsRef.current = !item.fromMap;
      }

      // 2. TRYB EKSPLORACJI (Additive)
      const currentExplorationItems = useSelectionStore.getState().explorationItems;
      if (currentSelectedItem && !currentTripState && (item.type === 'airport' || item.type === 'city')) {
        const newCodes = getExplorationAirportCodes(item.type, item.data.code);
        const allCodes = [...new Set([...currentExplorationItems.flatMap((i: any) => i.airportCodes), ...newCodes])];
        
        addExplorationItem({
          type: item.type,
          code: item.data.code,
          name: item.data.name || item.data.code,
          airportCodes: newCodes,
        });

        if (!item.fromMap) mapNav.fitBoundsToAirportCodes(allCodes);
        
        if (currentSelectedItem.type === 'country') {
          setSelectedItem(item);
          if (item.type === 'airport') setSelectedAirportCode(item.data.code);
        }
        return;
      }

      // 3. TRYB KRAJU
      if (item.type === 'country') {
        if (currentSelectedItem !== null && currentSelectedItem.type !== 'country') {
          setPendingCountryPicker({ code: item.data.code, name: item.data.name });
          if (!item.fromMap) mapNav.fitToCountry(item.data.code);
          return;
        }
        setSelectedItem(item);
        setSelectedAirportCode(null);
        if (!item.fromMap) mapNav.fitToCountry(item.data.code);
        return;
      }

      // 4. TRYB STANDARDOWY
      setSelectedItem(item);

      if (item.type === 'airport') {
        setSelectedAirportCode(item.data.code);
        setHighlightedAirports([]);
        setDisplayMode();
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
          mapNav.fitBoundsToAirportCodes(cityAirportCodes);
        }
        return;
      }

      if (item.fromMap || item.type === 'route') return;

      let coords = extractCoords(item);

      if (!coords && item.type === 'airport') {
        const feat = airportFeaturesMap[item.data.code];
        if (feat && feat.geometry.coordinates) {
          coords = { lon: feat.geometry.coordinates[0], lat: feat.geometry.coordinates[1] };
        }
      }

      if (coords) {
        mapNav.flyToLocation(coords.lon, coords.lat, CONFIG.FALLBACK_ZOOM.AIRPORT);
      }
    } finally {
      // Krótki timeout zapobiega "szaleństwu" przy ultra-szybkich kliknięciach (debouncing sprzętowy)
      setTimeout(() => {
        selectionLockRef.current = false;
        if (showLogs) console.log(`%c[ACTION-SELECTION] %c[${sequenceId}] FINISH | Lock released`, 'color: #10b981; font-weight: bold', 'color: inherit');
      }, 50);
    }
  }, [setDisplayMode, mapNav, travelDate, addExplorationItem, getExplorationAirportCodes, setSelectedItem, setSelectedAirportCode, setHighlightedAirports, handleAddToTripRef, airportFeaturesMap]);


  const handleSwitchToCountryView = useCallback((code: string, name: string) => {
    clearExploration();
    setSelectedItem({ type: 'country', data: { code, name, type: 'country' } });
    setPendingCountryPicker(null);
  }, [clearExploration, setSelectedItem]);

  const handleCountryAirportsConfirmed = useCallback((codes: string[], countryCode: string, countryName: string) => {
    if (codes.length === 0 || selectionLockRef.current) return;
    
    const sequenceId = Math.random().toString(36).substring(7);
    const showLogs = useSettingsStore.getState().showConsoleLogs;
    
    if (showLogs) console.log(`%c[ACTION-SELECTION] %c[${sequenceId}] START | Confirm Country: ${countryCode}`, 'color: #10b981; font-weight: bold', 'color: inherit');
    
    selectionLockRef.current = true;
    try {
      const resolvedName = (countryName && countryName !== countryCode)
        ? countryName
        : (countryInfoMap[countryCode]?.name || countryCode);

      clearExploration();
      addExplorationItem({ type: 'country', code: countryCode, name: resolvedName, airportCodes: codes });
      
      const firstCode = codes[0];
      const firstFeat = airportFeaturesMap[firstCode];
      
      if (firstFeat) {
        const cityCodeMap = cityMap[firstCode];
        const countryCodeData = countryMap[firstCode];

        setSelectedItem({ 
          type: 'airport', 
          data: { 
            type: 'airport',
            code: firstCode,
            name: namesMap[firstCode] || firstCode,
            city_code: cityCodeMap,
            city_name: cityCodeMap ? cityInfoMap[cityCodeMap]?.name : '',
            country_code: countryCodeData,
            country_name: countryCodeData ? countryInfoMap[countryCodeData]?.name : '',
          } as Airport 
        });
      }
      
      mapNav.fitBoundsToAirportCodes(codes);
    } finally {
      setTimeout(() => {
        selectionLockRef.current = false;
        if (showLogs) console.log(`%c[ACTION-SELECTION] %c[${sequenceId}] FINISH | Confirm Lock released`, 'color: #10b981; font-weight: bold', 'color: inherit');
      }, 100);
    }
  }, [airportFeaturesMap, namesMap, cityMap, countryMap, cityInfoMap, countryInfoMap, clearExploration, addExplorationItem, setSelectedItem, mapNav]);

  return {
    handleSelectItem,
    handleSwitchToCountryView,
    handleCountryAirportsConfirmed,
    pendingCountryPicker,
    setPendingCountryPicker,
    fitCameraOnFlightsRef,
    extractCoordinates: extractCoords,
  };
}

interface UseAppSelectionProps {
  mapNav: {
    flyToLocation: (lon: number, lat: number, zoom: number) => void;
    fitBoundsToAirportCodes: (codes: string[]) => void;
    fitToCountry: (countryCode: string) => void;
  };
  mapRef: React.RefObject<MapComponentRef | null>;
  handleAddToTripRef: React.MutableRefObject<((flight: Flight) => Promise<void>) | null>;
}
