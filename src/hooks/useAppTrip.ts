import { useCallback, useMemo } from 'react';
import { useTripStore } from '../stores/tripStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useFilterStore } from '../stores/filterStore';
import { useSettingsStore } from '../stores/settingsStore';
import { CONFIG } from '../constants/config';
import { useAirportIndexes, useCityInfoMap, useCountryInfoMap } from './queries';
import type { Airport } from '../types';

interface UseAppTripProps {
  mapNav: {
    flyToLocation: (lon: number, lat: number, zoom: number) => void;
  };
  selection: {
    setFullSelection: (v: any) => void;
    setSelectedAirportCode: (code: string | null) => void;
    setSelectedItem: (item: any) => void;
    clearExploration: () => void;
    extractCoordinates: (item: any) => { lon: number; lat: number } | null;
  };
  rightPanelRef: React.RefObject<any>;
}

export function useAppTrip({ mapNav, selection, rightPanelRef }: UseAppTripProps) {
  const { airportFeaturesMap, namesMap, cityMap, countryMap } = useAirportIndexes();
  const cityInfoMap = useCityInfoMap();
  const countryInfoMap = useCountryInfoMap();

  const {
    tripState,
    tripRoutes,
    manualTransferAirportCodes,
    pushToHistory,
    clearTrip,
    updateTrip,
  } = useTripStore();

  const { language } = useSettingsStore();
  const { clearFilters } = useFilterStore();

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

  const handleAddToTrip = useCallback(async (flight: any) => {
    const destCode = flight.destination_airport_code;
    const originCode = flight.origin_airport_code;
    const isFirstLeg = !tripState;
    
    console.log(`[RACE-DEBUG] {useAppTrip} -> handleAddToTrip START`);
    
    const newFlightLeg = { fromAirportCode: originCode, toAirportCode: destCode, flight };
    const isFromTransferAirport = !isFirstLeg && manualTransferAirportCodes.includes(originCode);
    
    pushToHistory();

    const newTripRoutes = [...tripRoutes];

    let finalTripState = tripState;
    if (isFirstLeg) {
      finalTripState = {
        startAirport: {
          code: originCode,
          city_code: cityMap[originCode] || '',
          country_code: countryMap[originCode] || '',
        },
        legs: [newFlightLeg],
      };
    } else if (isFromTransferAirport) {
      const arrivalCode = (selection as any).selectedItem?.data?.code ?? '';
      const manualLeg = {
        type: 'manual' as const,
        fromAirportCode: arrivalCode,
        toAirportCode: originCode,
        flight: null as any,
      };
      finalTripState = { ...tripState, legs: [...tripState.legs, manualLeg, newFlightLeg] };
      const fromFeat = airportFeaturesMap[arrivalCode];
      const transferFeat = airportFeaturesMap[originCode];
      if (fromFeat?.geometry && transferFeat?.geometry) {
        newTripRoutes.push({ from: fromFeat.geometry.coordinates as [number, number], to: transferFeat.geometry.coordinates as [number, number] });
      }
    } else if (tripState) {
      finalTripState = { ...tripState, legs: [...tripState.legs, newFlightLeg] };
    }

    const fromFeat = airportFeaturesMap[originCode];
    const toFeat = airportFeaturesMap[destCode];
    if (fromFeat?.geometry && toFeat?.geometry) {
      newTripRoutes.push({ from: fromFeat.geometry.coordinates as [number, number], to: toFeat.geometry.coordinates as [number, number] });
    }

    updateTrip({
      tripState: finalTripState,
      tripRoutes: newTripRoutes,
      manualTransferAirportCodes: []
    });

    try {
      const destFeat = airportFeaturesMap[destCode];
      if (!destFeat) throw new Error('Destination airport not found in cached data');

      const overrideFromDatetime = flight.scheduled_arrival_local
        ? flight.scheduled_arrival_local.toString().substring(0, 19)
        : undefined;

      const cityCode = cityMap[destCode];
      const countryCode = countryMap[destCode];

      const destData: Airport = {
        type: 'airport',
        code: destCode,
        name: namesMap[destCode] || destCode,
        city_code: cityCode,
        city_name: cityCode ? cityInfoMap[cityCode]?.name : '',
        country_code: countryCode, 
        country_name: countryCode ? countryInfoMap[countryCode]?.name : '',
        coordinates: { lon: destFeat.geometry.coordinates[0], lat: destFeat.geometry.coordinates[1] },
      };

      // ATOMOWA AKTUALIZACJA SELEKCJI (Zero-Waste)
      selection.setFullSelection({
        selectedItem: { type: 'airport', data: destData as any, overrideFromDatetime },
        selectedAirportCode: destCode,
        selectedAirportCodes: [destCode], // Resetujemy multiselect przy dodaniu do trasy
        highlightedAirports: [],
        explorationItems: [],
      });

      rightPanelRef.current?.clearTransferAirports();
      if (destData.coordinates) mapNav.flyToLocation(destData.coordinates.lon, destData.coordinates.lat, CONFIG.FALLBACK_ZOOM.AIRPORT);
    } catch (e) {
      console.error('Failed to fetch destination airport:', e);
      selection.setFullSelection({
        selectedItem: { type: 'airport', data: { code: destCode, name: destCode } as any },
        selectedAirportCode: destCode,
        selectedAirportCodes: [destCode],
        highlightedAirports: [],
        explorationItems: [],
      });
    }
  }, [tripState, selection, airportFeaturesMap, namesMap, cityMap, countryMap, cityInfoMap, countryInfoMap, tripRoutes, manualTransferAirportCodes, mapNav, updateTrip, pushToHistory, rightPanelRef]);

  const handleUndoRedo = useCallback(() => {
    // ZERO WASTE: Zamiast setTimeout korzystamy z faktu, że stan został już 
    // zaaplikowany w tripStore.undo()/redo() przed wywołaniem tego callbacka.
    const item = useSelectionStore.getState().selectedItem;
    if (!item) return;
    const coords = selection.extractCoordinates(item);
    if (coords) {
      mapNav.flyToLocation(coords.lon, coords.lat, CONFIG.FALLBACK_ZOOM.AIRPORT);
    }
  }, [mapNav, selection]);

  const handleCloseTrip = useCallback(() => {
    clearFilters();
    selection.clearExploration();
    useSelectionStore.getState().clearSelection();
    clearTrip();
  }, [clearFilters, selection, clearTrip]);

  const handleEditLoadedTrip = useCallback(async () => {
    if (!tripState?.legs?.length) return;
    
    const now = Date.now();
    const legs = tripState.legs;
    const snapshots: any[] = [];

    for (let i = legs.length - 1; i >= 0; i--) {
      const leg = legs[i];
      const isManual = (leg as { type?: string }).type === 'manual';
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
      
      const snapData = snapCode ? {
        type: 'airport' as const,
        code: snapCode,
        name: namesMap[snapCode] || snapCode,
        city_code: cityMap[snapCode],
        country_code: countryMap[snapCode],
      } : null;

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

    updateTrip({
      editMode: true,
      pastTrips: snapshots,
    });

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
    selection.setSelectedAirportCode(lastCode);
    try {
      const destFeat = airportFeaturesMap[lastCode];
      if (!destFeat) throw new Error('Airport not found in cached data');

      const overrideFromDatetime = lastArrivalLocal
        ? lastArrivalLocal.toString().substring(0, 19)
        : lastArrivalUTC ? lastArrivalUTC.substring(0, 19) : undefined;

      const cityCode = cityMap[lastCode];
      const countryCode = countryMap[lastCode];

      const destData: Airport = {
        code: lastCode,
        name: namesMap[lastCode] || lastCode,
        type: 'airport',
        city_code: cityCode,
        city_name: cityCode ? cityInfoMap[cityCode]?.name : '',
        country_code: countryCode,
        country_name: countryCode ? countryInfoMap[countryCode]?.name : '',
        coordinates: { lon: destFeat.geometry.coordinates[0], lat: destFeat.geometry.coordinates[1] },
      };

      selection.setSelectedItem({ type: 'airport', data: destData as any, overrideFromDatetime });
      if (destData.coordinates) mapNav.flyToLocation(destData.coordinates.lon, destData.coordinates.lat, CONFIG.FALLBACK_ZOOM.AIRPORT);
    } catch {
      selection.setSelectedItem({ type: 'airport', data: { code: lastCode, name: lastCode } as any });
    }
  }, [tripState, tripRoutes, airportFeaturesMap, namesMap, cityMap, countryMap, cityInfoMap, countryInfoMap, updateTrip, selection, mapNav, language]);

  return {
    handleAddToTrip,
    handleUndoRedo,
    handleCloseTrip,
    handleEditLoadedTrip,
    tripVisibleAirportCodes,
    tripCurrentArrivalTimeUTC,
  };
}
