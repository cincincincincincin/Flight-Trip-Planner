import { create } from 'zustand';
import type { TripState, TripRoute, SelectedItem, Flight } from '../types';
import { useSelectionStore } from './selectionStore';
import type { ExplorationItem } from './selectionStore';

interface TripSnapshot {
  tripState: TripState | null;
  tripRoutes: TripRoute[];
  selectedItem: SelectedItem | null;
  selectedAirportCode: string | null;
  selectedAirportCodes: string[];
  highlightedAirports: string[];
  flightsData: Flight[];
  explorationItems: ExplorationItem[];
}

interface TripStoreState {
  tripState: TripState | null;
  tripRoutes: TripRoute[];
  pastTrips: TripSnapshot[];
  futureTrips: TripSnapshot[];
  previewAirportCode: string | null;
  manualTransferAirportCodes: string[];
  setTripState: (v: TripState | null) => void;
  setTripRoutes: (v: TripRoute[]) => void;
  pushToHistory: () => void;
  undo: () => void;
  redo: () => void;
  setPreviewAirportCode: (v: string | null) => void;
  setManualTransferAirportCodes: (v: string[]) => void;
  clearHistory: () => void;
  clearTrip: () => void;
}

export const useTripStore = create<TripStoreState>((set, get) => ({
  tripState: null,
  tripRoutes: [],
  pastTrips: [],
  futureTrips: [],
  previewAirportCode: null,
  manualTransferAirportCodes: [],

  setTripState: v => set({ tripState: v }),
  setTripRoutes: v => set({ tripRoutes: v }),
  pushToHistory: () => {
    const { tripState, tripRoutes, pastTrips } = get();
    const { 
      selectedItem, selectedAirportCode, selectedAirportCodes, 
      highlightedAirports, flightsData, explorationItems 
    } = useSelectionStore.getState();

    set({
      pastTrips: [...pastTrips, { 
        tripState, tripRoutes: [...tripRoutes],
        selectedItem, selectedAirportCode, selectedAirportCodes: [...selectedAirportCodes],
        highlightedAirports: [...highlightedAirports],
        flightsData: [...flightsData],
        explorationItems: [...explorationItems]
      }],
      futureTrips: []
    });
  },
  undo: () => {
    const { pastTrips, futureTrips, tripState, tripRoutes } = get();
    if (pastTrips.length === 0) return;
    
    const previous = pastTrips[pastTrips.length - 1];
    const newPast = pastTrips.slice(0, -1);
    
    const { 
      selectedItem, selectedAirportCode, selectedAirportCodes, 
      highlightedAirports, flightsData, explorationItems 
    } = useSelectionStore.getState();

    const currentSnapshot: TripSnapshot = {
        tripState, tripRoutes: [...tripRoutes],
        selectedItem, selectedAirportCode, selectedAirportCodes: [...selectedAirportCodes],
        highlightedAirports: [...highlightedAirports],
        flightsData: [...flightsData],
        explorationItems: [...explorationItems]
    };
    
    set({
      pastTrips: newPast,
      futureTrips: [currentSnapshot, ...futureTrips],
      tripState: previous.tripState,
      tripRoutes: previous.tripRoutes,
    });

    useSelectionStore.setState({
      selectedItem: previous.selectedItem,
      selectedAirportCode: previous.selectedAirportCode,
      selectedAirportCodes: previous.selectedAirportCodes,
      highlightedAirports: previous.highlightedAirports,
      flightsData: previous.flightsData,
      explorationItems: previous.explorationItems,
    });
  },
  redo: () => {
    const { pastTrips, futureTrips, tripState, tripRoutes } = get();
    if (futureTrips.length === 0) return;
    
    const next = futureTrips[0];
    const newFuture = futureTrips.slice(1);
    
    const { 
      selectedItem, selectedAirportCode, selectedAirportCodes, 
      highlightedAirports, flightsData, explorationItems 
    } = useSelectionStore.getState();

    const currentSnapshot: TripSnapshot = {
        tripState, tripRoutes: [...tripRoutes],
        selectedItem, selectedAirportCode, selectedAirportCodes: [...selectedAirportCodes],
        highlightedAirports: [...highlightedAirports],
        flightsData: [...flightsData],
        explorationItems: [...explorationItems]
    };
    
    set({
      pastTrips: [...pastTrips, currentSnapshot],
      futureTrips: newFuture,
      tripState: next.tripState,
      tripRoutes: next.tripRoutes,
    });

    useSelectionStore.setState({
      selectedItem: next.selectedItem,
      selectedAirportCode: next.selectedAirportCode,
      selectedAirportCodes: next.selectedAirportCodes,
      highlightedAirports: next.highlightedAirports,
      flightsData: next.flightsData,
      explorationItems: next.explorationItems,
    });
  },
  setPreviewAirportCode: v => set({ previewAirportCode: v }),
  setManualTransferAirportCodes: v => set({ manualTransferAirportCodes: v }),
  clearHistory: () => set({ pastTrips: [], futureTrips: [] }),
  clearTrip: () => set({
    tripState: null,
    tripRoutes: [],
    pastTrips: [],
    futureTrips: [],
    previewAirportCode: null,
    manualTransferAirportCodes: [],
  }),
}));
