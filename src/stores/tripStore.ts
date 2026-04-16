import { create } from 'zustand';
import { useSelectionStore } from './selectionStore';
import type { ExplorationItem } from './selectionStore';
import type { TripState, TripRoute, SelectedItem, Flight } from '../types';
import { logger } from '../utils/logger';

/**
 * STRUKTURA DANYCH OBRAZU PODRÓŻY (SNAPSHOT)
 * Przechowuje pełny kontekst stanu we wszystkich powiązanych magazynach.
 * Używane do mechanizmu Time-Travel (Undo/Redo).
 */
export interface TripSnapshot {
  tripState: TripState | null;
  tripRoutes: TripRoute[];
  // Kontekst selekcji synchronizowany z podróżą (MapComponent.tsx)
  selectedItem: SelectedItem | null;
  selectedAirportCode: string | null;
  selectedAirportCodes: string[];
  highlightedAirports: string[];
  explorationItems: ExplorationItem[];
}

/**
 * INTERFEJS MAGAZYNU TRIPSTORE
 * Centralne ogniwo orkiestrujące proces planowania i persystencji podróży.
 */
interface TripStoreState {
  // --- Stan Główny (Core Logic) ---
  /** Model lotów i lotniska startowego. Główne źródło prawdy dla TripItinerary.tsx. */
  tripState: TripState | null;
  /** Kolekcja ścieżek geograficznych do renderowania linii na mapie (MapComponent.tsx). */
  tripRoutes: TripRoute[];
  /** Aktualnie podglądane lotnisko na mapie (animacje preview). */
  previewAirportCode: string | null;
  /** Bufor przesiadek manualnych (Draft State) przed ich zatwierdzeniem do tripState. */
  manualTransferAirportCodes: string[];

  // --- Metadane Persystencji (SQL Sync) ---
  /** Klucz główny podróży z bazy danych (Supabase/PostgreSQL). */
  savedTripId: number | null;
  /** Zserializowany obraz ostatniej zapisanej wersji - używany do "Dirty Checking" w SaveTripButton.tsx. */
  savedTripStateJSON: string | null;
  /** Flaga wskazująca, czy podróż pochodzi z bazy danych (tryb tylko do odczytu/edycji). */
  isLoadedTrip: boolean;
  /** Tryb modyfikacji istniejącej podróży (wpływa na restrykcje Undo w przyszłości). */
  editMode: boolean;

  // --- Mechanizm Time-Travel (History Management) ---
  /** Stos LIFO przechowujący stany historyczne (Undo). */
  pastTrips: TripSnapshot[];
  /** Stos LIFO przechowujący stany wycofane (Redo). */
  futureTrips: TripSnapshot[];

  // --- Akcje (Atomic Actions) ---
  /** 
   * Jedyny punkt wejścia do modyfikacji stanu (Atomic Update Pattern). 
   * Umożliwia batchowanie zmian wielu pól w jednym cyklu renderowania React.
   */
  updateTrip: (values: Partial<Omit<TripStoreState, 'updateTrip'>>) => void;
  /** Zrzut bieżącego stanu na stos historii - musi być wywołany bezpośrednio przed mutacją. */
  pushToHistory: () => void;
  /** Przywrócenie stanu ze stosu pastTrips. */
  undo: () => void;
  /** Przywrócenie stanu ze stosu futureTrips. */
  redo: () => void;
  /** Całkowity reset magazynu do wartości początkowych. */
  clearTrip: () => void;
}

/**
 * POMOCNIK TWORZENIA MIGAWKI (SNAPSHOT HELPER)
 * Agreguje stan z dwóch niezależnych atomów (tripStore + selectionStore).
 * Zapewnia spójność kontekstu wizualnego (mapa) i logicznego (trasa) podczas podróży w czasie.
 */
const createCurrentSnapshot = (state: TripStoreState): TripSnapshot => {
  const selection = useSelectionStore.getState();
  return {
    // INŻYNIERSKA OPTYMALIZACJA (Faza 2: Deep Isolation):
    // Używamy structuredClone dla tripState, aby izolować historie Undo/Redo.
    // Odzwierciedla to atomowość zapisu JSONB w PostgreSQL (każdy stan to osobny rekord).
    tripState: state.tripState ? structuredClone(state.tripState) : null,
    tripRoutes: [...state.tripRoutes],
    selectedItem: selection.selectedItem,
    selectedAirportCode: selection.selectedAirportCode,
    selectedAirportCodes: [...selection.selectedAirportCodes],
    highlightedAirports: [...selection.highlightedAirports],
    // flightsData (globalny cache lotów) nie jest częścią migawki (Zero-Waste).
    explorationItems: selection.explorationItems,
  };
};

/**
 * MAGAZYN ZUSTAND: TRIPSTORE
 * Implementacja wzorca State Container z wbudowaną obsługą historii migawkowej.
 */
export const useTripStore = create<TripStoreState>((set, get) => ({
  tripState: null,
  tripRoutes: [],
  previewAirportCode: null,
  manualTransferAirportCodes: [],
  savedTripId: null,
  savedTripStateJSON: null,
  isLoadedTrip: false,
  editMode: false,
  pastTrips: [],
  futureTrips: [],

  updateTrip: (values) => set((state) => ({ ...state, ...values })),

  pushToHistory: () => {
    const current = get();
    const snapshot = createCurrentSnapshot(current);
    set((state) => ({
      pastTrips: [...state.pastTrips, snapshot],
      futureTrips: [], // Nowa akcja przerywa linię redo (zgodnie ze standardami UX)
    }));
  },

  undo: () => {
    const { pastTrips, futureTrips } = get();
    if (pastTrips.length === 0) return;

    const currentSnapshot = createCurrentSnapshot(get());
    const previousSnapshot = pastTrips[pastTrips.length - 1];
    const remainingPast = pastTrips.slice(0, pastTrips.length - 1);

    // Atomowa aplikacja stanu z migawki do obu magazynów
    useSelectionStore.getState().setFullSelection({
      selectedItem: previousSnapshot.selectedItem,
      selectedAirportCode: previousSnapshot.selectedAirportCode,
      selectedAirportCodes: previousSnapshot.selectedAirportCodes,
      highlightedAirports: previousSnapshot.highlightedAirports,
      explorationItems: previousSnapshot.explorationItems,
    });

    set({
      tripState: previousSnapshot.tripState,
      tripRoutes: previousSnapshot.tripRoutes,
      pastTrips: remainingPast,
      futureTrips: [currentSnapshot, ...futureTrips],
    });
  },

  redo: () => {
    const { pastTrips, futureTrips } = get();
    if (futureTrips.length === 0) return;

    const currentSnapshot = createCurrentSnapshot(get());
    const nextSnapshot = futureTrips[0];
    const remainingFuture = futureTrips.slice(1);

    logger.log(`[RACE-DEBUG] {tripStore} -> REDO | Snapshot:`, nextSnapshot);

    useSelectionStore.getState().setFullSelection({
      selectedItem: nextSnapshot.selectedItem,
      selectedAirportCode: nextSnapshot.selectedAirportCode,
      selectedAirportCodes: nextSnapshot.selectedAirportCodes,
      highlightedAirports: nextSnapshot.highlightedAirports,
      explorationItems: nextSnapshot.explorationItems,
    });

    set({
      tripState: nextSnapshot.tripState,
      tripRoutes: nextSnapshot.tripRoutes,
      pastTrips: [...pastTrips, currentSnapshot],
      futureTrips: remainingFuture,
    });
  },

  clearTrip: () => set({
    tripState: null,
    tripRoutes: [],
    previewAirportCode: null,
    manualTransferAirportCodes: [],
    savedTripId: null,
    savedTripStateJSON: null,
    pastTrips: [],
    futureTrips: [],
    isLoadedTrip: false,
    editMode: false,
  }),
}));