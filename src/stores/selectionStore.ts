import { create } from 'zustand';
import type { SelectedItem, Flight, Country, RouteFeatureProps, Airport, City } from '../types';
import { CONFIG } from '../constants/config';

// Element "eksploracji" kafel lotniska/miasta/kraju w panelu bocznym.
export interface ExplorationItem {
  id: string; // Deterministyczny klucz: `${type}-${code}`
  type: 'airport' | 'city' | 'country';
  code: string; // Kod IATA lub ID miasta
  name: string;
  airportCodes: string[]; // Lotniska przypisane do elementu (N dla miasta/kraju)
}

interface SelectionState {
  selectedItem: SelectedItem | null; // Aktualnie kliknięty element na mapie
  selectedAirportCode: string | null;
  selectedAirportCodes: string[];
  highlightedAirports: string[]; // Lotniska podświetlone (hover/search)
  highlightedCities: string[];
  flightsData: Flight[]; // Globalny rejestr lotów (Single Source of Truth)
  /** 
   * INDEKS PODRĘCZNY: Map<"DEPARTURE_CODE-ARRIVAL_CODE-TIME", Flight> 
   * Umożliwia wyszukiwanie lotów w czasie O(1) podczas interakcji z mapą.
   */
  flightsByRouteMap: Map<string, Flight>;
  /**
   * INDEKS GRUPOWY: Map<"ORIGIN-DEST", Flight[]>
   * Umożliwia natychmiastowe pobranie wszystkich lotów dla danej trasy (np. klastrowanie w popupach).
   */
  flightsByRouteGroupMap: Map<string, Flight[]>;
  _dedupKeys: Set<string>; // Indeks atomowych kluczy lotów dla O(1) dedup
  displayedFlights: Flight[]; // Loty aktualnie renderowane w RightPanel
  explorationItems: ExplorationItem[];

  isFlightsLoading: boolean; // Stan ładowania danych o lotach
  setSelectedItem: (v: SelectedItem | null) => void;
  setSelectedAirportCode: (v: string | null) => void;
  setSelectedAirportCodes: (v: string[]) => void;
  addSelectedAirportCode: (code: string) => void;
  setHighlightedAirports: (v: string[]) => void;
  setHighlightedCities: (v: string[]) => void;
  setFlightsData: (v: Flight[]) => void;
  setDisplayedFlights: (v: Flight[]) => void;
  setIsFlightsLoading: (v: boolean) => void;
  appendFlights: (newFlights: Flight[]) => void;
  clearSelection: () => void;
  addExplorationItem: (item: Omit<ExplorationItem, 'id'>) => void;
  removeExplorationItem: (id: string) => void;
  clearExploration: () => void;
  /**
   * ATOMOWY SNAPSHOT SELEKCJI (Full State Sync).
   * Używany przez TripStore do przywracania pełnego kontekstu widoku (Time-Travel).
   */
  setFullSelection: (v: {
    selectedItem: SelectedItem | null;
    selectedAirportCode: string | null;
    selectedAirportCodes: string[];
    highlightedAirports: string[];
    explorationItems: ExplorationItem[];
  }) => void;
  removeAirportsData: (codes: string[]) => void;
  calculateNextExplorationItems: (items: ExplorationItem[], newItem: ExplorationItem) => ExplorationItem[];
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedItem: null,
  selectedAirportCode: null,
  selectedAirportCodes: [],
  highlightedAirports: [],
  highlightedCities: [],
  flightsData: [],
  flightsByRouteMap: new Map(),
  flightsByRouteGroupMap: new Map(),
  _dedupKeys: new Set(),
  displayedFlights: [],
  explorationItems: [],

  setSelectedItem: v => set({ selectedItem: v }),
  setSelectedAirportCode: v => set({ selectedAirportCode: v }),
  setSelectedAirportCodes: v => set({ selectedAirportCodes: v }),
  setHighlightedAirports: v => set({ highlightedAirports: v }),
  setHighlightedCities: v => set({ highlightedCities: v }),
  setFlightsData: v => {
    const keys = new Set(v.map(f => `${f.flight_number}-${f.scheduled_departure_utc}`));
    const routeMap = new Map<string, Flight>();
    const groupMap = new Map<string, Flight[]>();
    v.forEach(f => {
      const key = `${f.origin_airport_code}-${f.destination_airport_code}-${f.scheduled_departure_utc}`;
      routeMap.set(key, f);

      const groupKey = `${f.origin_airport_code}-${f.destination_airport_code}`;
      if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
      groupMap.get(groupKey)!.push(f);
    });
    set({ flightsData: v, _dedupKeys: keys, flightsByRouteMap: routeMap, flightsByRouteGroupMap: groupMap });
  },
  setDisplayedFlights: v => set({ displayedFlights: v }),
  setIsFlightsLoading: v => set({ isFlightsLoading: v }),
  isFlightsLoading: false,

  // Przyrostowa agregacja danych ze strumieni NDJSON.
  // Gwarantuje spójność globalnego rejestru przy asynchronicznym dopompowywaniu 
  // brakujących okien czasowych (gap-filling logic z useFlightLoader).
  appendFlights: newFlights => set(state => {
    const getKey = (f: Flight) => `${f.flight_number}-${f.scheduled_departure_utc}`;
    const getRouteKey = (f: Flight) => `${f.origin_airport_code}-${f.destination_airport_code}-${f.scheduled_departure_utc}`;

    const unique = newFlights.filter(f => !state._dedupKeys.has(getKey(f)));
    if (unique.length === 0) return state;

    const nextKeys = new Set(state._dedupKeys);
    const nextRouteMap = new Map(state.flightsByRouteMap);
    const nextGroupMap = new Map(state.flightsByRouteGroupMap);

    unique.forEach(f => {
      nextKeys.add(getKey(f));
      nextRouteMap.set(getRouteKey(f), f);

      const groupKey = `${f.origin_airport_code}-${f.destination_airport_code}`;
      if (!nextGroupMap.has(groupKey)) nextGroupMap.set(groupKey, []);
      nextGroupMap.get(groupKey)!.push(f);
    });

    const newDestinations = Array.from(new Set(unique.map(f => f.destination_airport_code.toUpperCase())));
    const currentHighlights = new Set(state.highlightedAirports.map(c => c.toUpperCase()));
    const addedDestinations = newDestinations.filter(d => !currentHighlights.has(d));

    // [PODŚWIETLANIE KONTROLOWANE KONTEKSTEM]: Nie podświetlamy nowych lotnisk, jeśli panel jest zamknięty.
    const shouldUpdateHighlights = state.selectedItem !== null && addedDestinations.length > 0;

    return {
      flightsData: [...state.flightsData, ...unique],
      _dedupKeys: nextKeys,
      flightsByRouteMap: nextRouteMap,
      flightsByRouteGroupMap: nextGroupMap,
      highlightedAirports: shouldUpdateHighlights
        ? [...state.highlightedAirports, ...addedDestinations]
        : state.highlightedAirports
    };
  }),

  addSelectedAirportCode: (code: string) => set((state) => {
    const nextCodes = state.selectedAirportCodes.includes(code)
      ? state.selectedAirportCodes
      : [...state.selectedAirportCodes, code];
    return { selectedAirportCodes: nextCodes };
  }),

  clearSelection: () => set({
    selectedItem: null,
    selectedAirportCode: null,
    selectedAirportCodes: [],
    highlightedAirports: [],
    highlightedCities: [],
    flightsData: [],
    flightsByRouteMap: new Map(),
    flightsByRouteGroupMap: new Map(),
    _dedupKeys: new Set(),
    isFlightsLoading: false,
    displayedFlights: []
  }),

  /**
   * GRANULOWANE USUWANIE DANYCH
   * Czyści dane lotów i podświetlenia dla konkretnych lotnisk źródłowych.
   * Zapobiega pełnemu przeładowaniu widoku przy usuwaniu pojedynczego elementu.
   */
  removeAirportsData: (codes: string[]) => set(state => {
    const codesToRemove = new Set(codes.map(c => c.toUpperCase()));
    if (codesToRemove.size === 0) return state;

    // 1. Filtrowanie bazy lotów
    const nextFlightsData = state.flightsData.filter(f =>
      !codesToRemove.has(f.origin_airport_code.toUpperCase())
    );

    // 2. Atomowa rekonstrukcja indeksów O(N)
    const nextDedupKeys = new Set<string>();
    const nextRouteMap = new Map<string, Flight>();
    const nextGroupMap = new Map<string, Flight[]>();

    nextFlightsData.forEach(f => {
      const key = `${f.flight_number}-${f.scheduled_departure_utc}`;
      const routeKey = `${f.origin_airport_code}-${f.destination_airport_code}-${f.scheduled_departure_utc}`;
      const groupKey = `${f.origin_airport_code}-${f.destination_airport_code}`;

      nextDedupKeys.add(key);
      nextRouteMap.set(routeKey, f);
      if (!nextGroupMap.has(groupKey)) nextGroupMap.set(groupKey, []);
      nextGroupMap.get(groupKey)!.push(f);
    });

    // 3. Garbage Collection dla podświetleń (Destinations)
    // Czyścimy tylko te lotniska docelowe, które NIE są już osiągalne z żadnego z pozostałych źródeł.
    const remainingDestinations = new Set(nextFlightsData.map(f => f.destination_airport_code.toUpperCase()));
    const nextHighlights = state.highlightedAirports.filter(h =>
      remainingDestinations.has(h.toUpperCase())
    );

    return {
      flightsData: nextFlightsData,
      _dedupKeys: nextDedupKeys,
      flightsByRouteMap: nextRouteMap,
      flightsByRouteGroupMap: nextGroupMap,
      highlightedAirports: nextHighlights,
      displayedFlights: state.displayedFlights.filter(f =>
        !codesToRemove.has(f.origin_airport_code.toUpperCase())
      )
    };
  }),

  /**
   * POMOCNIK: Oblicza nowy stan eksploracji z zachowaniem limitów FIFO.
   */
  calculateNextExplorationItems: (items: ExplorationItem[], newItem: ExplorationItem): ExplorationItem[] => {
    // 1. Sprawdzanie duplikatów (Idempotentność)
    if (items.some(i => i.id === newItem.id)) return items;

    // 2. [ZASADA HIERARCHII]: Jeśli dodajemy lotniska, sprawdzamy czy nie są już objęte kafelkiem Miasta/Kraju.
    if (newItem.type === 'airport') {
      const code = newItem.code.toUpperCase();
      const isAlreadyCovered = items.some(existing =>
        (existing.type === 'city' || existing.type === 'country') && existing.airportCodes.includes(code)
      );
      if (isAlreadyCovered) return items;
    }

    // Funkcja pomocnicza do zliczania unikalnych lotnisk w kolekcjach
    const getUniqueAirportCount = (itms: ExplorationItem[]) =>
      new Set(itms.flatMap(i => i.airportCodes)).size;

    // 3. Konsolidacja lotnisk: usuwamy mniejsze kafelki, jeśli nowy je zawiera (Up-promotion).
    let nextItems = items.filter(i => i.id !== newItem.id);
    const newCodesSet = new Set(newItem.airportCodes.map(c => c.toUpperCase()));

    nextItems = nextItems.map(i => ({
      ...i,
      airportCodes: i.airportCodes.filter(c => !newCodesSet.has(c.toUpperCase()))
    })).filter(i => i.airportCodes.length > 0);

    // 4. Dynamiczne zwalnianie miejsca (FIFO).
    while (nextItems.length > 0 && getUniqueAirportCount(nextItems) + Math.min(newItem.airportCodes.length, CONFIG.MAX_AIRPORTS) > CONFIG.MAX_AIRPORTS) {
      const oldest = nextItems[0];
      if (oldest.airportCodes.length <= 1) {
        nextItems.shift();
      } else {
        nextItems[0] = { ...oldest, airportCodes: oldest.airportCodes.slice(1) };
      }
    }

    // 5. Dodatkowe zabezpieczenie: przycinamy samo newItem
    if (newItem.airportCodes.length > CONFIG.MAX_AIRPORTS) {
      newItem.airportCodes = newItem.airportCodes.slice(0, CONFIG.MAX_AIRPORTS);
    }

    return [...nextItems, newItem];
  },

  /**
   * Zaawansowana polityka zarządzania kafelkami eksploracji (Slot Management).
   */
  addExplorationItem: (item) => set(state => {
    const id = `${item.type}-${item.code}`;
    const nextItems = state.calculateNextExplorationItems(state.explorationItems, { ...item, id } as ExplorationItem);
    return { explorationItems: nextItems };
  }),

  removeExplorationItem: (id) => set(state => ({
    explorationItems: state.explorationItems.filter(i => i.id !== id),
  })),

  clearExploration: () => set({ explorationItems: [] }),

  setFullSelection: (v) => set((state) => ({ ...state, ...v })),
}));
