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
   * Kluczowa funkcja obsługi kliknięcia/wyboru elementu.
   * Realizuje zasadę Single Source of Truth dla danych geograficznych.
   */
  const handleSelectItem = useCallback(async (item: SelectedItem) => {
    const itemCode = (item.data as any).code || '';
    console.log(`[RACE-DEBUG] {useAppSelection} -> handleSelectItem | Type: ${item.type}, Code: ${itemCode}, fromMap: ${!!(item as any).fromMap}`);

    // Szybka akcja dodawania do podróży bezpośrednio z mapy (jeśli podświetlone)
    if (item.type === 'airport' && item.isHighlighted && tripState) {
      const flight = (
        flightsData.find((f: Flight) =>
          f.destination_airport_code === itemCode &&
          f.scheduled_departure_local?.startsWith(travelDate)
        ) ?? flightsData.find((f: Flight) => f.destination_airport_code === itemCode)
      );
      if (flight) {
        console.log(`[RACE-DEBUG] {useAppSelection} -> fast add to trip | Airport: ${itemCode}`);
        handleAddToTripRef.current?.(flight);
        return;
      }
    }

    if ('fromMap' in item) {
      fitCameraOnFlightsRef.current = !item.fromMap;
    }

    // TRYB EKSPLORACJI (Additive) - dodawanie kafli do panelu bocznego
    if (selectedItem && !tripState && (item.type === 'airport' || item.type === 'city')) {
      const newCodes = getExplorationAirportCodes(item.type, item.data.code);
      const allCodes = [...new Set([...explorationItems.flatMap((i: any) => i.airportCodes), ...newCodes])];
      
      addExplorationItem({
        type: item.type,
        code: item.data.code,
        name: item.data.name || item.data.code,
        airportCodes: newCodes,
      });

      if (!item.fromMap) mapNav.fitBoundsToAirportCodes(allCodes);
      
      // Jeśli poprzednio był wybrany kraj, zmieniamy fokus na konkretny element
      if (selectedItem.type === 'country') {
        setSelectedItem(item);
        if (item.type === 'airport') setSelectedAirportCode(item.data.code);
      }
      return;
    }

    // TRYB KRAJU - otwiera picker lotnisk lub przechodzi do widoku państwa
    if (item.type === 'country') {
      if (selectedItem !== null && selectedItem.type !== 'country') {
        setPendingCountryPicker({ code: item.data.code, name: item.data.name });
        if (!item.fromMap) mapNav.fitToCountry(item.data.code);
        return;
      }
      setSelectedItem(item);
      setSelectedAirportCode(null);
      if (!item.fromMap) mapNav.fitToCountry(item.data.code);
      return;
    }

    // TRYB STANDARDOWY (Single selection)
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

    // Nawigacja kamery do wybranego punktu (jeśli nie wybrano trasy)
    if (item.fromMap || item.type === 'route') return;

    let coords = extractCoords(item);

    // Fallback: szukanie współrzędnych w bazie głównej lotnisk
    if (!coords && item.type === 'airport') {
      const feat = airportFeaturesMap[item.data.code];
      if (feat && feat.geometry.coordinates) {
        coords = { lon: feat.geometry.coordinates[0], lat: feat.geometry.coordinates[1] };
      }
    }

    if (coords) {
      mapNav.flyToLocation(coords.lon, coords.lat, CONFIG.FALLBACK_ZOOM.AIRPORT);
    }
  }, [setDisplayMode, mapNav, tripState, flightsData, travelDate, selectedItem, addExplorationItem, explorationItems, getExplorationAirportCodes, setSelectedItem, setSelectedAirportCode, setHighlightedAirports, handleAddToTripRef, airportFeaturesMap]);


  const handleSwitchToCountryView = useCallback((code: string, name: string) => {
    clearExploration();
    setSelectedItem({ type: 'country', data: { code, name, type: 'country' } });
    setPendingCountryPicker(null);
  }, [clearExploration, setSelectedItem]);

  const handleCountryAirportsConfirmed = useCallback((codes: string[], countryCode: string, countryName: string) => {
    if (codes.length === 0) return;
    
    // Rozwiązywanie nazwy kraju (O(1) z mapy danych)
    const resolvedName = (countryName && countryName !== countryCode)
      ? countryName
      : (countryInfoMap[countryCode]?.name || countryCode);

    clearExploration();
    addExplorationItem({ type: 'country', code: countryCode, name: resolvedName, airportCodes: codes });
    
    // Ustawienie fokus na pierwsze lotnisko z wybranego zestawu w kraju (O(1))
    const firstCode = codes[0];
    const firstFeat = airportFeaturesMap[firstCode];
    
    if (firstFeat) {
      const cityCode = cityMap[firstCode];
      const countryCodeMap = countryMap[firstCode];

      setSelectedItem({ 
        type: 'airport', 
        data: { 
          type: 'airport',
          code: firstCode,
          name: namesMap[firstCode] || firstCode,
          city_code: cityCode,
          city_name: cityCode ? cityInfoMap[cityCode]?.name : '',
          country_code: countryCodeMap,
          country_name: countryCodeMap ? countryInfoMap[countryCodeMap]?.name : '',
        } as Airport 
      });
    }
    
    mapNav.fitBoundsToAirportCodes(codes);
  }, [airportFeaturesMap, namesMap, cityMap, countryMap, cityInfoMap, countryInfoMap, clearExploration, addExplorationItem, setSelectedItem, mapNav, language]);

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
