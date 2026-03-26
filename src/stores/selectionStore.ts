import { create } from 'zustand';
import type { SelectedItem, Flight } from '../types';

export interface ExplorationItem {
  id: string;           // unique ID (use Date.now().toString() + Math.random())
  type: 'airport' | 'city' | 'country';
  code: string;         // airport or city code
  name: string;
  airportCodes: string[]; // actual IATA airport codes (1 for airport, N for city)
}

interface SelectionState {
  selectedItem: SelectedItem | null;
  selectedAirportCode: string | null;
  selectedAirportCodes: string[];
  highlightedAirports: string[];
  highlightedCities: string[];
  flightsData: Flight[];
  /** Flights currently visible in the RightPanel list (today's window, filtered by TZ). */
  displayedFlights: Flight[];
  explorationItems: ExplorationItem[];
  setSelectedItem: (v: SelectedItem | null) => void;
  setSelectedAirportCode: (v: string | null) => void;
  setSelectedAirportCodes: (v: string[]) => void;
  setHighlightedAirports: (v: string[]) => void;
  setHighlightedCities: (v: string[]) => void;
  setFlightsData: (v: Flight[]) => void;
  setDisplayedFlights: (v: Flight[]) => void;
  appendFlights: (newFlights: Flight[]) => void;
  clearSelection: () => void;
  addExplorationItem: (item: Omit<ExplorationItem, 'id'>/*, viewMode: 'airports' | 'cities' */) => void;
  removeExplorationItem: (id: string) => void;
  clearExploration: () => void;
}

export const useSelectionStore = create<SelectionState>(set => ({
  selectedItem: null,
  selectedAirportCode: null,
  selectedAirportCodes: [],
  highlightedAirports: [],
  highlightedCities: [],
  flightsData: [],
  displayedFlights: [],
  explorationItems: [],

  setSelectedItem: v => set({ selectedItem: v }),
  setSelectedAirportCode: v => set({ selectedAirportCode: v }),
  setSelectedAirportCodes: v => set({ selectedAirportCodes: v }),
  setHighlightedAirports: v => set({ highlightedAirports: v }),
  setHighlightedCities: v => set({ highlightedCities: v }),
  setFlightsData: v => set({ flightsData: v }),
  setDisplayedFlights: v => set({ displayedFlights: v }),
  appendFlights: newFlights => set(state => {
    const existingIds = new Set(state.flightsData.map(f => f.id));
    const unique = newFlights.filter(f => !existingIds.has(f.id));
    return { flightsData: [...state.flightsData, ...unique] };
  }),
  clearSelection: () => set({
    selectedItem: null,
    selectedAirportCode: null,
    selectedAirportCodes: [],
    highlightedAirports: [],
    highlightedCities: [],
    flightsData: [],
    displayedFlights: [],
    explorationItems: [],
  }),

  addExplorationItem: (item/*, viewMode */) => set(state => {
    // Check if it's already in the list
    if (state.explorationItems.some((i: ExplorationItem) => i.code === item.code && i.type === item.type)) {
      return state;
    }

    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const newItem: ExplorationItem = { ...item, id };
    
    let items = state.explorationItems.filter(i => i.code !== item.code);
    const getTotal = (itms: ExplorationItem[]) => new Set(itms.flatMap(i => i.airportCodes)).size;

    // Always use airport mode eviction logic
    const newCodes = new Set(newItem.airportCodes);
    items = items.map(i => ({ ...i, airportCodes: i.airportCodes.filter(c => !newCodes.has(c)) }))
                 .filter(i => i.airportCodes.length > 0);

    while (items.length > 0 && getTotal(items) + newItem.airportCodes.length > 6) {
      const oldest = items[0];
      if (oldest.airportCodes.length <= 1) {
        items.shift();
      } else {
        items[0] = { ...oldest, airportCodes: oldest.airportCodes.slice(1) };
      }
    }

    return { explorationItems: [...items, newItem] };
  }),

  removeExplorationItem: (id) => set(state => ({
    explorationItems: state.explorationItems.filter(i => i.id !== id),
  })),

  clearExploration: () => set({ explorationItems: [] }),
}));
