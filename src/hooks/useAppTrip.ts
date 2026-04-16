import { useCallback, useMemo, useRef } from 'react';
import { useTripStore } from '../stores/tripStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useFilterStore } from '../stores/filterStore';
import { useSettingsStore } from '../stores/settingsStore';
import { CONFIG } from '../constants/config';
import { useAirportIndexes, useCityInfoMap, useCountryInfoMap } from './queries';
import type { Airport } from '../types';
import { logger } from '../utils/logger';

interface UseAppTripProps {
  mapNav: any;
  selection: any;
  rightPanelRef: React.RefObject<any>;
}

/**
 * GŁÓWNY HOOK ZARZĄDZANIA PODRÓŻĄ (Trip Orchestrator)
 * Odpowiada za logikę budowania trasy, obsługę przesiadek (w tym manualnych) 
 * oraz synchronizację stanu podróży z historią (Undo/Redo).
 */
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

  /**
   * [MUTEX EXECUTION LOCK]: Krytyczne zabezpieczenie przed wyścigami (Race Conditions).
   * Blokuje nakładające się operacje asynchroniczne na planie podróży (np. szybkie dwukrotne kliknięcie "Dodaj").
   */
  const tripExecutionLockRef = useRef(false);

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

  /**
   * DODAWANIE LOTU DO TRASY (handleAddToTrip)
   * Najważniejsza funkcja logiczna aplikacji. Odpowiada za sekwencyjne budowanie trasy.
   * Obsługuje automatyczne wykrywanie i wstrzykiwanie przesiadek manualnych 
   * (np. transport między lotniskami w tym samym mieście).
   */
  const handleAddToTrip = useCallback(async (flight: any) => {
    const sequenceId = Math.random().toString(36).substring(7);
    const showLogs = useSettingsStore.getState().showConsoleLogs;

    if (tripExecutionLockRef.current) {
      logger.log(`%c[ACTION-TRIP] %c[${sequenceId}] Zablokowane: Inna akcja podróży w toku`, 'color: #f59e0b; font-weight: bold', 'color: inherit');
      return;
    }

    tripExecutionLockRef.current = true;

    logger.log(`%c[ACTION-TRIP] %c[${sequenceId}] START | Lot: ${flight.airline_code}${flight.flight_number} -> ${flight.destination_airport_code}`, 'color: #3b82f6; font-weight: bold', 'color: inherit');

    try {
      // INŻYNIERSKI LIVE ACCESS: Pobieramy stan bezpośrednio ze store'a, 
      // aby uniknąć problemu "stale closures" przy szybkich kliknięciach.
      /**
       * [LIVE STORE ACCESS]: Pobieramy najnowszy stan bezpośrednio ze store'a.
       * Zapobiega to błędowi "stale closures" (zamykanie starych stanów w callbackach),
       * co gwarantuje spójność danych nawet przy bardzo intensywnej interakcji użytkownika.
       */
      const currentTripState = useTripStore.getState().tripState;
      const currentTripRoutes = useTripStore.getState().tripRoutes;
      const currentManualTransfers = useTripStore.getState().manualTransferAirportCodes;

      const destCode = flight.destination_airport_code.toUpperCase();
      const originCode = flight.origin_airport_code.toUpperCase();
      const isFirstLeg = !currentTripState;

      const newFlightLeg = { fromAirportCode: originCode, toAirportCode: destCode, flight };
      const isFromTransferAirport = !isFirstLeg && currentManualTransfers.includes(originCode);

      pushToHistory();

      const newTripRoutes = [...currentTripRoutes];
      let finalTripState = currentTripState;

      if (isFirstLeg) {
        // Pierwszy segment podróży - definiujemy lotnisko startowe.
        finalTripState = {
          startAirport: {
            code: originCode,
            city_code: cityMap[originCode] || '',
            country_code: countryMap[originCode] || '',
          },
          legs: [newFlightLeg],
        };
      } else if (isFromTransferAirport) {
        // [LOGIKA PRZESIADKI MANUALNEJ]: 
        // Jeśli aktualny lot zaczyna się na lotnisku, na które musieliśmy dojechać manualnie,
        // wstrzykujemy segment typu 'manual' między poprzedni cel a obecny start.
        const arrivalCode = useSelectionStore.getState().selectedAirportCode ?? '';
        const manualLeg = {
          type: 'manual' as const,
          fromAirportCode: arrivalCode,
          toAirportCode: originCode,
          flight: null as any,
        };
        finalTripState = { ...currentTripState!, legs: [...currentTripState!.legs, manualLeg, newFlightLeg] };

        const fromFeat = airportFeaturesMap[arrivalCode];
        const transferFeat = airportFeaturesMap[originCode];
        if (fromFeat?.geometry && transferFeat?.geometry) {
          newTripRoutes.push({ from: fromFeat.geometry.coordinates as [number, number], to: transferFeat.geometry.coordinates as [number, number] });
        }
      } else if (currentTripState) {
        finalTripState = { ...currentTripState, legs: [...currentTripState.legs, newFlightLeg] };
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

      // Synchronizacja UI: Wycentrowanie mapy na nowym lotnisku docelowym.
      const destFeat = airportFeaturesMap[destCode];
      if (destFeat) {
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

        selection.setFullSelection({
          selectedItem: { type: 'airport', data: destData as any, overrideFromDatetime },
          selectedAirportCode: destCode,
          selectedAirportCodes: [destCode],
          highlightedAirports: [],
          explorationItems: [],
        });

        rightPanelRef.current?.clearTransferAirports();
        if (destData.coordinates) {
          mapNav.flyToLocation(destData.coordinates.lon, destData.coordinates.lat, CONFIG.FALLBACK_ZOOM.AIRPORT);
        }
      }

      logger.log(`%c[ACTION-TRIP] %c[${sequenceId}] KONIEC | Podróż zaktualizowana pomyślnie`, 'color: #3b82f6; font-weight: bold', 'color: inherit');
    } catch (e) {
      logger.error(`[ACTION-TRIP] [${sequenceId}] Błąd krytyczny:`, e);
    } finally {
      tripExecutionLockRef.current = false;
    }
  }, [selection, airportFeaturesMap, namesMap, cityMap, countryMap, cityInfoMap, countryInfoMap, mapNav, updateTrip, pushToHistory, rightPanelRef]);

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

  /**
   * INICJALIZACJA TRYBU EDYCJI (handleEditLoadedTrip)
   * Funkcja "rozpakowująca" zapisaną podróż z bazy danych do formatu edytowalnego.
   * Implementuje zaawansowany wzorzec odbudowy historii (History Rebuilding), 
   * pozwalając użytkownikowi cofać kroki trasy, która została wczytana jako gotowa całość.
   */
  const handleEditLoadedTrip = useCallback(async () => {
    const sequenceId = Math.random().toString(36).substring(7);
    const showLogs = useSettingsStore.getState().showConsoleLogs;
    const currentTripState = useTripStore.getState().tripState;
    const currentTripRoutes = useTripStore.getState().tripRoutes;

    if (!currentTripState?.legs?.length) return;

    if (showLogs) {
      logger.log(`[ACTION-TRIP] [${sequenceId}] START | Budowanie migawek edycji`);
    }

    tripExecutionLockRef.current = true;

    try {
      const now = Date.now();
      const legs = currentTripState.legs;
      const snapshots: any[] = [];

      for (let i = legs.length - 1; i >= 0; i--) {
        const leg = legs[i];
        const isManual = (leg as { type?: string }).type === 'manual';
        if (!isManual && leg.flight?.scheduled_departure_utc) {
          const dep = new Date(leg.flight.scheduled_departure_utc).getTime();
          if (dep < now) break;
        }
        const slicedLegs = legs.slice(0, i);

        // Pomijanie migawek kończących się przesiadką manualną, aby undo zawsze lądowało na locie.
        const lastSlicedLeg = slicedLegs[slicedLegs.length - 1];
        if (lastSlicedLeg && (lastSlicedLeg as any).type === 'manual') continue;

        const slicedState = slicedLegs.length === 0 ? null : { ...currentTripState, legs: slicedLegs };
        let snapCode: string | null = null;
        for (let j = slicedLegs.length - 1; j >= 0; j--) {
          const l = slicedLegs[j];
          if ((l as { type?: string }).type !== 'manual') { snapCode = l.toAirportCode.toUpperCase(); break; }
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
          tripRoutes: currentTripRoutes.slice(0, i),
          selectedItem: snapData ? { type: 'airport', data: snapData as any } : null,
          selectedAirportCode: snapCode,
          selectedAirportCodes: snapCode ? [snapCode] : [],
          highlightedAirports: [],
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
          lastCode = leg.toAirportCode.toUpperCase();
          lastArrivalUTC = leg.flight.scheduled_arrival_utc;
          lastArrivalLocal = leg.flight.scheduled_arrival_local ?? null;
          break;
        }
      }

      if (lastCode) {
        selection.setSelectedAirportCode(lastCode);
        const destFeat = airportFeaturesMap[lastCode];

        if (destFeat) {
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
        } else {
          selection.setSelectedItem({ type: 'airport', data: { code: lastCode, name: lastCode } as any });
        }
      }

      if (showLogs) {
        logger.log(`[ACTION-TRIP] [${sequenceId}] FINISH | Tryb edycji gotowy`);
      }
    } finally {
      tripExecutionLockRef.current = false;
    }
  }, [airportFeaturesMap, namesMap, cityMap, countryMap, cityInfoMap, countryInfoMap, updateTrip, selection, mapNav]);

  return {
    handleAddToTrip,
    handleUndoRedo,
    handleCloseTrip,
    handleEditLoadedTrip,
    tripVisibleAirportCodes,
    tripCurrentArrivalTimeUTC,
  };
}
