import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useSelectionStore } from '../stores/selectionStore';
import { useMapStore } from '../stores/mapStore';
import { useTripStore } from '../stores/tripStore';
import { useSettingsStore } from '../stores/settingsStore';
import { CONFIG } from '../constants/config';
import { extractCoords } from '../utils/geoUtils';
import { useAirportIndexes, useCityAirportsMap, useCountryInfoMap, useCityInfoMap } from './queries';
import type { SelectedItem, Flight, Airport, City } from '../types';
import type { MapComponentRef } from '../components/MapComponent';

interface UseAppSelectionProps {
  mapNav: {
    flyToLocation: (lon: number, lat: number, zoom?: number) => void;
    fitBoundsToAirportCodes: (codes: string[]) => void;
    fitToCountry: (countryCode: string) => void;
  };
  mapRef: React.RefObject<MapComponentRef | null>;
  handleAddToTripRef: React.MutableRefObject<((flight: Flight) => Promise<void>) | null>;
}

/**
 * Główny hook orkiestrujący logikę wyboru na mapie i w wyszukiwarce.
 */
export function useAppSelection({ mapNav, mapRef, handleAddToTripRef }: UseAppSelectionProps) {
  const { airportFeaturesMap, namesMap, cityMap, countryMap } = useAirportIndexes();
  const cityAirportsMap = useCityAirportsMap();
  const cityInfoMap = useCityInfoMap();
  const countryInfoMap = useCountryInfoMap();

  const {
    setSelectedItem,
    setSelectedAirportCode,
    setHighlightedAirports,
    addExplorationItem,
    clearExploration,
    explorationItems,
  } = useSelectionStore();

  const { setShowAirports, viewport } = useMapStore();
  const { travelDate } = useSettingsStore();

  const [pendingCountryPicker, setPendingCountryPicker] = useState<{ code: string; name: string } | null>(null);
  const selectionLockRef = useRef(false);
  const fitCameraOnFlightsRef = useRef(false);

  const setDisplayMode = useCallback(() => {
    setShowAirports(true);
  }, [setShowAirports]);

  const getExplorationAirportCodes = useCallback((type: 'airport' | 'city', code: string): string[] => {
    if (type === 'airport') return [code.toUpperCase()];
    return cityAirportsMap[code.toUpperCase()] || [];
  }, [cityAirportsMap]);

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

      // 1. Fast Add to Trip
      if (item.type === 'airport' && item.isHighlighted && currentTripState) {
        const currentOrigin = (currentTripState.legs.length > 0 
          ? currentTripState.legs[currentTripState.legs.length - 1].toAirportCode 
          : currentTripState.startAirport.code).toUpperCase();
          
        const groupKey = `${currentOrigin}-${itemCode}`;
        const group = useSelectionStore.getState().flightsByRouteGroupMap.get(groupKey) || [];
        
        const flight = (
          group.find((f: Flight) => f.scheduled_departure_local?.startsWith(travelDate)) ?? 
          group[0]
        );

        if (flight) {
          handleAddToTripRef.current?.(flight);
          return;
        }
      }

      if ('fromMap' in item) {
        fitCameraOnFlightsRef.current = !item.fromMap;
      }

      // Pre-calculate target coordinates for "Pure Pan" navigation (no zoom change)
      let targetCenter: { lon: number, lat: number } | null = null;
      if (!item.fromMap) {
        if (item.type === 'airport') {
          const feature = airportFeaturesMap[itemCode];
          if (feature) {
            targetCenter = {
              lon: feature.geometry.coordinates[0],
              lat: feature.geometry.coordinates[1]
            };
          }
        } else if (item.type === 'city') {
          const codes = getExplorationAirportCodes('city', itemCode);
          const points = codes.map(c => airportFeaturesMap[c]?.geometry?.coordinates as [number, number]).filter(Boolean);
          if (points.length > 0) {
            targetCenter = {
              lon: points.reduce((acc, p) => acc + p[0], 0) / points.length,
              lat: points.reduce((acc, p) => acc + p[1], 0) / points.length
            };
          }
        } else if (item.type === 'country') {
          const center = countryInfoMap[itemCode];
          if (center) targetCenter = { lon: center.lon, lat: center.lat };
        }
      }

      // 3. Exploration Item Management
      const currentState = useSelectionStore.getState();
      const currentExplorationItems = currentState.explorationItems;
      const updates: any = {
        selectedItem: item,
        selectedAirportCode: (item.type === 'airport' || item.type === 'route') ? itemCode : null
      };

      if (currentSelectedItem && !currentTripState && (item.type === 'airport' || item.type === 'city')) {
        if (item.type === 'airport') {
          const isAlreadyCovered = currentExplorationItems.some(existing => 
            (existing.type === 'city' || existing.type === 'country') && existing.airportCodes.includes(itemCode)
          );
          
          if (!isAlreadyCovered) {
            const newCodes = getExplorationAirportCodes(item.type, itemCode);
            const id = `airport-${itemCode}`;
            if (!currentExplorationItems.some(i => i.id === id)) {
              updates.explorationItems = [
                ...currentExplorationItems,
                { type: item.type, code: itemCode, name: (item.data as any).name || (item.data as any).code, airportCodes: newCodes, id }
              ];
            }
          }
        } else if (item.type === 'city') {
          const newCodes = getExplorationAirportCodes(item.type, itemCode);
          const id = `city-${itemCode}`;
          if (!currentExplorationItems.some(i => i.id === id)) {
            updates.explorationItems = [
              ...currentExplorationItems,
              { type: item.type, code: itemCode, name: (item.data as any).name || (item.data as any).code, airportCodes: newCodes, id }
            ];
          }
        }
      } else if (item.type === 'country') {
        if (currentSelectedItem !== null && currentSelectedItem.type !== 'country') {
          setPendingCountryPicker({ code: (item.data as any).code, name: (item.data as any).name });
        } else {
          updates.selectedAirportCode = null;
        }
      } else {
        // Standard non-exploration mode
        if (item.type === 'airport') {
          updates.highlightedAirports = [];
          const id = `airport-${itemCode}`;
          if (!currentState.explorationItems.some(i => i.id === id)) {
            updates.explorationItems = [
              ...currentState.explorationItems,
              { type: 'airport', code: itemCode, name: (item.data as any).name || itemCode, airportCodes: [itemCode], id }
            ];
          }
        } else if (item.type === 'city') {
          const cityAirportCodes = getExplorationAirportCodes('city', itemCode);
          const id = `city-${itemCode}`;
          if (!currentState.explorationItems.some(i => i.id === id)) {
            updates.explorationItems = [
              ...currentState.explorationItems,
              { type: 'city', code: itemCode, name: (item.data as any).name || itemCode, airportCodes: cityAirportCodes, id }
            ];
          }
        }
      }

      // Execute atomic store updates
      useSelectionStore.setState(updates);

      // Map aesthetics trigger
      if (item.type === 'airport') setDisplayMode();

      // EXECUTE NAVIGATION (v11.60.2 - "Pure Pan" / No Bounds fitting)
      if (targetCenter && !item.fromMap && item.type !== 'route') {
        mapNav.flyToLocation(targetCenter.lon, targetCenter.lat);
      }

    } finally {
      setTimeout(() => {
        selectionLockRef.current = false;
        if (showLogs) console.log(`%c[ACTION-SELECTION] %c[${sequenceId}] FINISH | Lock released`, 'color: #10b981; font-weight: bold', 'color: inherit');
      }, 50);
    }
  }, [setDisplayMode, mapNav, airportFeaturesMap, countryInfoMap, extractCoords, cityAirportsMap, getExplorationAirportCodes, handleAddToTripRef, travelDate]);

  const handleSwitchToCountryView = useCallback((code: string, name: string) => {
    clearExploration();
    setSelectedItem({ type: 'country', data: { code, name, type: 'country' } });
    setPendingCountryPicker(null);
  }, [clearExploration, setSelectedItem]);

  const handleCountryAirportsConfirmed = useCallback((codes: string[], countryCode: string, countryName: string) => {
    if (codes.length === 0 || selectionLockRef.current) return;
    
    const sequenceId = Math.random().toString(36).substring(7);
    const showLogs = useSettingsStore.getState().showConsoleLogs;
    
    selectionLockRef.current = true;
    try {
      const resolvedName = (countryName && countryName !== countryCode)
        ? countryName
        : (countryInfoMap[countryCode]?.name || countryCode);

      clearExploration();
      addExplorationItem({ type: 'country', code: countryCode, name: resolvedName, airportCodes: codes });
      
      const firstCode = codes[0]?.toUpperCase();
      if (firstCode) {
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
  }, [namesMap, cityMap, countryMap, cityInfoMap, countryInfoMap, clearExploration, addExplorationItem, setSelectedItem, mapNav]);

  return useMemo(() => ({
    handleSelectItem,
    handleSwitchToCountryView,
    handleCountryAirportsConfirmed,
    pendingCountryPicker,
    setPendingCountryPicker,
    fitCameraOnFlightsRef,
    extractCoordinates: extractCoords,
  }), [
    handleSelectItem, 
    handleSwitchToCountryView, 
    handleCountryAirportsConfirmed, 
    pendingCountryPicker,
  ]);
}
