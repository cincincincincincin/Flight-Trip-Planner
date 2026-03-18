import { create } from 'zustand';

export interface DestinationFilter {
  airports: string[];    // selected airport codes
  cities: string[];      // selected city codes
  countries: string[];   // selected country codes
}

const emptyDestFilter: DestinationFilter = { airports: [], cities: [], countries: [] };

interface FilterState {
  destinationFilter: DestinationFilter;
  airlineFilter: string[];   // selected airline codes (empty = no filter)
  setDestinationFilter: (f: DestinationFilter) => void;
  setAirlineFilter: (codes: string[]) => void;
  clearFilters: () => void;
}

export const useFilterStore = create<FilterState>(set => ({
  destinationFilter: emptyDestFilter,
  airlineFilter: [],
  setDestinationFilter: f => set({ destinationFilter: f }),
  setAirlineFilter: codes => set({ airlineFilter: codes }),
  clearFilters: () => set({ destinationFilter: emptyDestFilter, airlineFilter: [] }),
}));
