import { create } from 'zustand';
import type { TripState, TripRoute } from '../types';

interface TripSnapshot {
  tripState: TripState | null;
  tripRoutes: TripRoute[];
}

interface TripStoreState {
  tripState: TripState | null;
  tripRoutes: TripRoute[];
  manualTransferHistory: TripSnapshot[];
  previewAirportCode: string | null;
  manualTransferAirportCodes: string[];
  setTripState: (v: TripState | null) => void;
  setTripRoutes: (v: TripRoute[]) => void;
  pushHistory: (snapshot: TripSnapshot) => void;
  popHistory: () => TripSnapshot | null;
  setPreviewAirportCode: (v: string | null) => void;
  setManualTransferAirportCodes: (v: string[]) => void;
  clearTrip: () => void;
}

export const useTripStore = create<TripStoreState>((set, get) => ({
  tripState: null,
  tripRoutes: [],
  manualTransferHistory: [],
  previewAirportCode: null,
  manualTransferAirportCodes: [],

  setTripState: v => set({ tripState: v }),
  setTripRoutes: v => set({ tripRoutes: v }),
  pushHistory: snapshot => set(state => ({
    manualTransferHistory: [...state.manualTransferHistory, snapshot],
  })),
  popHistory: () => {
    const history = [...get().manualTransferHistory];
    const snapshot = history.pop() ?? null;
    set({ manualTransferHistory: history });
    return snapshot;
  },
  setPreviewAirportCode: v => set({ previewAirportCode: v }),
  setManualTransferAirportCodes: v => set({ manualTransferAirportCodes: v }),
  clearTrip: () => set({
    tripState: null,
    tripRoutes: [],
    manualTransferHistory: [],
    previewAirportCode: null,
    manualTransferAirportCodes: [],
  }),
}));
