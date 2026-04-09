import { create } from 'zustand';
import { DestinationFilter, EMPTY_DESTINATION_FILTER } from '../constants/filters';

/**
 * Magazyn filtrów dla listy lotów
 * Zarządza wyborem miejsc docelowych oraz linii lotniczych w FlightsFilter.tsx.
 */
interface FilterState {
  destinationFilter: DestinationFilter;
  airlineFilter: string[];
  setDestinationFilter: (f: DestinationFilter) => void;
  setAirlineFilter: (codes: string[]) => void;
  clearFilters: () => void;
}

export const useFilterStore = create<FilterState>(set => ({
  destinationFilter: EMPTY_DESTINATION_FILTER,
  airlineFilter: [],

  setDestinationFilter: (f) => set({ destinationFilter: f }),
  setAirlineFilter: (codes) => set({ airlineFilter: codes }),

  // Resetuje wszystkie filtry do stanu początkowego
  clearFilters: () => set({
    destinationFilter: EMPTY_DESTINATION_FILTER,
    airlineFilter: []
  }),
}));
