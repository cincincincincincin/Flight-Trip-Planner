import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface StartPointColors {
  airport: string;       // dot color for this starting airport
  airportHover: string;  // hover color for this starting airport dot
  route: string;         // animated route line color for flights from this airport
  routeHover: string;    // hover color for this starting point's route line
  label: string;         // label color for this starting airport
  labelHover: string;    // hover label color for this starting airport
}

export interface ColorState {
  // Per starting point (up to 6 slots)
  startPoints: StartPointColors[];

  // Airport dot layers
  generalAirport: string;      // general unselected airports (#FF6B6B red)
  destinationAirport: string;  // destination airports (found flights)
  tripAirport: string;         // airports visited in trip mode (#000000 black)

  // Route/line layers
  tripRoute: string;            // permanent trip route line (#1565C0 blue)
  tripRouteHover: string;       // hover color for trip route line
  transferRoute: string;        // manual transfer dashed lines (#9C27B0 purple)
  transferRouteHover: string;   // hover color for manual transfer line

  // Hover colors for map elements
  generalAirportHover: string;      // hover on general airports (#C62828)
  destinationAirportHover: string;  // hover on destination airports
  tripAirportHover: string;         // hover on trip airports
  generalLabelColor: string;        // text color for general airport labels
  generalLabelHoverColor: string;   // hover text color for general airport labels
  destinationLabelColor: string;    // text color for destination airport labels
  destinationLabelHoverColor: string; // hover text color for destination airport labels
  tripLabelColor: string;           // text color for trip airport labels
  tripLabelHoverColor: string;      // hover text color for trip airport labels

  // City colors (kept for backward compat, not shown in settings)
  highlightedCity: string;
  generalCity: string;

  // Element sizes
  zoomRangeMin: number;
  zoomRangeMax: number;
  routeLineWidthMin: number;        // animated route line width at min zoom
  routeLineWidthMax: number;        // animated route line width at max zoom
  routeLineHoverWidthMin: number;   // animated route line hover width at min zoom
  routeLineHoverWidthMax: number;   // animated route line hover width at max zoom
  tripRouteWidthMin: number;        // trip permanent route line width at min zoom
  tripRouteWidthMax: number;        // trip permanent route line width at max zoom
  tripRouteHoverWidthMin: number;   // trip route hover width at min zoom
  tripRouteHoverWidthMax: number;   // trip route hover width at max zoom
  generalAirportRadiusMin: number;  // general airport circle radius at min zoom
  generalAirportRadiusMax: number;  // general airport circle radius at max zoom
  generalAirportHoverRadiusMin: number; // general airport hover radius at min zoom
  generalAirportHoverRadiusMax: number; // general airport hover radius at max zoom
  highlightedAirportRadiusMin: number;  // highlighted airport circle radius at min zoom
  highlightedAirportRadiusMax: number;  // highlighted airport circle radius at max zoom
  highlightedAirportHoverRadiusMin: number; // highlighted airport hover radius at min zoom
  highlightedAirportHoverRadiusMax: number; // highlighted airport hover radius at max zoom
  highlightedCityRadius: number;
  generalCityRadius: number;
  generalAirportLabelSizeMin: number;   // general label size at min zoom
  generalAirportLabelSizeMax: number;   // general label size at max zoom
  generalLabelHoverSizeMin: number;     // hover general label size at min zoom
  generalLabelHoverSizeMax: number;     // hover general label size at max zoom
  highlightedLabelSizeMin: number;      // highlighted label size at min zoom
  highlightedLabelSizeMax: number;      // highlighted label size at max zoom
  highlightedLabelHoverSizeMin: number; // highlighted label hover size at min zoom
  highlightedLabelHoverSizeMax: number; // highlighted label hover size at max zoom

  // Actions
  setStartPointColor: (index: number, key: keyof StartPointColors, color: string) => void;
  setColor: (key: ColorKey, color: string) => void;
  setSize: (key: SizeKey, value: number) => void;
  setZoomRange: (min: number, max: number) => void;
  resetColors: () => void;
  resetSizes: () => void; // nowa akcja
}

// Keys for simple (non-startPoints) colors
export type ColorKey =
  | 'generalAirport'
  | 'destinationAirport'
  | 'tripAirport'
  | 'tripRoute'
  | 'tripRouteHover'
  | 'transferRoute'
  | 'transferRouteHover'
  | 'generalAirportHover'
  | 'destinationAirportHover'
  | 'tripAirportHover'
  | 'generalLabelColor'
  | 'generalLabelHoverColor'
  | 'destinationLabelColor'
  | 'destinationLabelHoverColor'
  | 'tripLabelColor'
  | 'tripLabelHoverColor'
  | 'highlightedCity'
  | 'generalCity';

export type SizeKey =
  | 'routeLineWidthMin'
  | 'routeLineWidthMax'
  | 'routeLineHoverWidthMin'
  | 'routeLineHoverWidthMax'
  | 'tripRouteWidthMin'
  | 'tripRouteWidthMax'
  | 'tripRouteHoverWidthMin'
  | 'tripRouteHoverWidthMax'
  | 'generalAirportRadiusMin'
  | 'generalAirportRadiusMax'
  | 'generalAirportHoverRadiusMin'
  | 'generalAirportHoverRadiusMax'
  | 'highlightedAirportRadiusMin'
  | 'highlightedAirportRadiusMax'
  | 'highlightedAirportHoverRadiusMin'
  | 'highlightedAirportHoverRadiusMax'
  | 'highlightedCityRadius'
  | 'generalCityRadius'
  | 'generalAirportLabelSizeMin'
  | 'generalAirportLabelSizeMax'
  | 'generalLabelHoverSizeMin'
  | 'generalLabelHoverSizeMax'
  | 'highlightedLabelSizeMin'
  | 'highlightedLabelSizeMax'
  | 'highlightedLabelHoverSizeMin'
  | 'highlightedLabelHoverSizeMax';

const DEFAULT_START_POINTS: StartPointColors[] = [
  { airport: '#000000', airportHover: '#000000', route: '#ed6498', routeHover: '#b13b6b', label: '#000000', labelHover: '#000000' },
  { airport: '#000000', airportHover: '#000000', route: '#3B8FE8', routeHover: '#1a5fa8', label: '#000000', labelHover: '#000000' },
  { airport: '#000000', airportHover: '#000000', route: '#2ECC71', routeHover: '#1a8a4a', label: '#000000', labelHover: '#000000' },
  { airport: '#000000', airportHover: '#000000', route: '#E67E22', routeHover: '#a05010', label: '#000000', labelHover: '#000000' },
  { airport: '#000000', airportHover: '#000000', route: '#9B59B6', routeHover: '#6a2e8a', label: '#000000', labelHover: '#000000' },
  { airport: '#000000', airportHover: '#000000', route: '#E74C3C', routeHover: '#a02020', label: '#000000', labelHover: '#000000' },
];

const DEFAULT_COLORS = {
  startPoints: DEFAULT_START_POINTS,
  generalAirport:     '#FF6B6B',
  destinationAirport: '#4CAF50',
  tripAirport:        '#000000',
  tripRoute:          '#1565C0',
  tripRouteHover:     '#0d47a1',
  transferRoute: '#9C27B0',
  transferRouteHover: '#6a1b9a',
  // hover colors
  generalAirportHover:     '#C62828',
  destinationAirportHover: '#2E7D32',
  tripAirportHover:        '#000000',
  generalLabelColor:       '#000000',
  generalLabelHoverColor:  '#000000',
  destinationLabelColor:   '#000000',
  destinationLabelHoverColor: '#000000',
  tripLabelColor:          '#000000',
  tripLabelHoverColor:     '#000000',
  // city colors (kept for backward compat)
  highlightedCity: '#4CAF50',
  generalCity: '#4ECDC4',
  // sizes (min/max for zoom 1/12)
  zoomRangeMin: 1.3,
  zoomRangeMax: 5.5,
  routeLineWidthMin:           2.0,
  routeLineWidthMax:           3.0,
  routeLineHoverWidthMin:      6.6,
  routeLineHoverWidthMax:      15.0,
  tripRouteWidthMin:           2.0,
  tripRouteWidthMax:           3.0,
  tripRouteHoverWidthMin:      6.6,
  tripRouteHoverWidthMax:      15.0,
  generalAirportRadiusMin:     2.0,
  generalAirportRadiusMax:     10.0,
  generalAirportHoverRadiusMin: 10.0,
  generalAirportHoverRadiusMax: 25.0,
  highlightedAirportRadiusMin: 4.0,
  highlightedAirportRadiusMax: 18.0,
  highlightedAirportHoverRadiusMin: 10.0,
  highlightedAirportHoverRadiusMax: 40.0,
  highlightedCityRadius: 8,
  generalCityRadius: 5,
  generalAirportLabelSizeMin: 12,
  generalAirportLabelSizeMax: 20,
  generalLabelHoverSizeMin: 16,
  generalLabelHoverSizeMax: 26,
  highlightedLabelSizeMin: 12,
  highlightedLabelSizeMax: 23,
  highlightedLabelHoverSizeMin: 18,
  highlightedLabelHoverSizeMax: 34,
};

// Helper: detect if a color is pure black or white (allowing slight variations)
const isBlackOrWhite = (colorHex: string): boolean => {
  if (!colorHex.startsWith('#') || colorHex.length < 7) return false;
  const r = parseInt(colorHex.slice(1, 3), 16);
  const g = parseInt(colorHex.slice(3, 5), 16);
  const b = parseInt(colorHex.slice(5, 7), 16);
  // Check if color is close to black (#000000) or white (#FFFFFF)
  const isBlack = r < 20 && g < 20 && b < 20;
  const isWhite = r > 235 && g > 235 && b > 235;
  return isBlack || isWhite;
};

// Helper: invert black/white color
const invertBlackWhite = (colorHex: string): string => {
  if (!isBlackOrWhite(colorHex)) return colorHex;
  const r = parseInt(colorHex.slice(1, 3), 16);
  const isBlack = r < 128;
  return isBlack ? '#FFFFFF' : '#000000';
};

// Helper: invert ANY color based on luminance (always calculate opposite for contrast)
const invertColorByLuminance = (colorHex: string): string => {
  if (!colorHex.startsWith('#') || colorHex.length < 7) return '#FFFFFF';
  
  const r = parseInt(colorHex.slice(1, 3), 16);
  const g = parseInt(colorHex.slice(3, 5), 16);
  const b = parseInt(colorHex.slice(5, 7), 16);
  
  // Calculate perceived brightness (luminance)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // Return opposite: if bright text, use dark; if dark text, use bright
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
};

// Mapping: main airport color key → label key pairs
const LABEL_MAPPINGS: Record<string, { label: ColorKey; labelHover: ColorKey }> = {
  generalAirport: { label: 'generalLabelColor', labelHover: 'generalLabelHoverColor' },
  destinationAirport: { label: 'destinationLabelColor', labelHover: 'destinationLabelHoverColor' },
  tripAirport: { label: 'tripLabelColor', labelHover: 'tripLabelHoverColor' },
};

export const useColorStore = create<ColorState>()(
  persist(
    (set) => ({
      ...DEFAULT_COLORS,

      setStartPointColor: (index, key, color) =>
        set(state => {
          const startPoints = state.startPoints.map((sp, i) => {
            if (i === index) {
              const updated = { ...sp, [key]: color };
              // If we're changing the airport dot color, auto-invert labels (always, regardless of current color)
              if (key === 'airport') {
                updated.label = invertColorByLuminance(color);
                updated.labelHover = invertColorByLuminance(color);
              }
              return updated;
            }
            return sp;
          });
          return { startPoints };
        }),

      setColor: (key, color) =>
        set(state => {
          const updates: Partial<ColorState> = { [key]: color } as Pick<ColorState, ColorKey>;
          
          // Check if this is an airport dot color that should auto-update labels
          if (key in LABEL_MAPPINGS) {
            const mapping = LABEL_MAPPINGS[key];
            // Auto-invert labels based on luminance (always, regardless of current color)
            updates[mapping.label] = invertColorByLuminance(color) as ColorKey;
            updates[mapping.labelHover] = invertColorByLuminance(color) as ColorKey;
          }
          
          return updates as Pick<ColorState, ColorKey>;
        }),

      setSize: (key, value) => set({ [key]: value } as Pick<ColorState, SizeKey>),
      setZoomRange: (min, max) => set({ zoomRangeMin: min, zoomRangeMax: max }),

      resetColors: () => set(DEFAULT_COLORS),

      // NOWA AKCJA: resetuje tylko rozmiary do wartości domyślnych
      resetSizes: () => set({
        zoomRangeMin: DEFAULT_COLORS.zoomRangeMin,
        zoomRangeMax: DEFAULT_COLORS.zoomRangeMax,
        routeLineWidthMin: DEFAULT_COLORS.routeLineWidthMin,
        routeLineWidthMax: DEFAULT_COLORS.routeLineWidthMax,
        routeLineHoverWidthMin: DEFAULT_COLORS.routeLineHoverWidthMin,
        routeLineHoverWidthMax: DEFAULT_COLORS.routeLineHoverWidthMax,
        tripRouteWidthMin: DEFAULT_COLORS.tripRouteWidthMin,
        tripRouteWidthMax: DEFAULT_COLORS.tripRouteWidthMax,
        tripRouteHoverWidthMin: DEFAULT_COLORS.tripRouteHoverWidthMin,
        tripRouteHoverWidthMax: DEFAULT_COLORS.tripRouteHoverWidthMax,
        generalAirportRadiusMin: DEFAULT_COLORS.generalAirportRadiusMin,
        generalAirportRadiusMax: DEFAULT_COLORS.generalAirportRadiusMax,
        generalAirportHoverRadiusMin: DEFAULT_COLORS.generalAirportHoverRadiusMin,
        generalAirportHoverRadiusMax: DEFAULT_COLORS.generalAirportHoverRadiusMax,
        highlightedAirportRadiusMin: DEFAULT_COLORS.highlightedAirportRadiusMin,
        highlightedAirportRadiusMax: DEFAULT_COLORS.highlightedAirportRadiusMax,
        highlightedAirportHoverRadiusMin: DEFAULT_COLORS.highlightedAirportHoverRadiusMin,
        highlightedAirportHoverRadiusMax: DEFAULT_COLORS.highlightedAirportHoverRadiusMax,
        highlightedCityRadius: DEFAULT_COLORS.highlightedCityRadius,
        generalCityRadius: DEFAULT_COLORS.generalCityRadius,
        generalAirportLabelSizeMin: DEFAULT_COLORS.generalAirportLabelSizeMin,
        generalAirportLabelSizeMax: DEFAULT_COLORS.generalAirportLabelSizeMax,
        generalLabelHoverSizeMin: DEFAULT_COLORS.generalLabelHoverSizeMin,
        generalLabelHoverSizeMax: DEFAULT_COLORS.generalLabelHoverSizeMax,
        highlightedLabelSizeMin: DEFAULT_COLORS.highlightedLabelSizeMin,
        highlightedLabelSizeMax: DEFAULT_COLORS.highlightedLabelSizeMax,
        highlightedLabelHoverSizeMin: DEFAULT_COLORS.highlightedLabelHoverSizeMin,
        highlightedLabelHoverSizeMax: DEFAULT_COLORS.highlightedLabelHoverSizeMax,
      }),
    }),
    {
      name: 'flight-map-colors',
      // Migrate old store: add new StartPointColors fields if missing
      merge: (persisted: unknown, current) => {
        const p = persisted as Partial<ColorState>;
        const merged = { ...current, ...p } as ColorState & Record<string, unknown>;
        merged.startPoints = (p.startPoints ?? DEFAULT_START_POINTS).map((sp, i) => ({
          ...DEFAULT_START_POINTS[i],
          ...sp,
        }));
        if (!('destinationLabelColor' in (p as any)) && (p as any).focusedLabelColor) {
          merged.destinationLabelColor = (p as any).focusedLabelColor as string;
          merged.tripLabelColor = (p as any).focusedLabelColor as string;
        }
        if (!('destinationLabelHoverColor' in (p as any)) && (p as any).labelHoverColor) {
          merged.destinationLabelHoverColor = (p as any).labelHoverColor as string;
          merged.tripLabelHoverColor = (p as any).labelHoverColor as string;
        }
        if (!('transferRoute' in (p as any)) && (p as any).manualTransferRoute) {
          merged.transferRoute = (p as any).manualTransferRoute as string;
        }
        if (!('transferRouteHover' in (p as any)) && (p as any).manualTransferHover) {
          merged.transferRouteHover = (p as any).manualTransferHover as string;
        }
        const firstSp = (p.startPoints?.[0] as any) ?? null;
        if (!('destinationAirport' in (p as any)) && firstSp?.destination) {
          merged.destinationAirport = firstSp.destination as string;
        }
        if (!('destinationAirportHover' in (p as any)) && firstSp?.destinationHover) {
          merged.destinationAirportHover = firstSp.destinationHover as string;
        }
        const sizeMigrations: Array<{ oldKey: string; minKey: SizeKey; maxKey: SizeKey }> = [
          { oldKey: 'routeLineWidth', minKey: 'routeLineWidthMin', maxKey: 'routeLineWidthMax' },
          { oldKey: 'routeLineHoverWidth', minKey: 'routeLineHoverWidthMin', maxKey: 'routeLineHoverWidthMax' },
          { oldKey: 'tripRouteWidth', minKey: 'tripRouteWidthMin', maxKey: 'tripRouteWidthMax' },
          { oldKey: 'tripRouteHoverWidth', minKey: 'tripRouteHoverWidthMin', maxKey: 'tripRouteHoverWidthMax' },
          { oldKey: 'generalAirportRadius', minKey: 'generalAirportRadiusMin', maxKey: 'generalAirportRadiusMax' },
          { oldKey: 'generalAirportHoverRadius', minKey: 'generalAirportHoverRadiusMin', maxKey: 'generalAirportHoverRadiusMax' },
          { oldKey: 'highlightedAirportRadius', minKey: 'highlightedAirportRadiusMin', maxKey: 'highlightedAirportRadiusMax' },
          { oldKey: 'highlightedAirportHoverRadius', minKey: 'highlightedAirportHoverRadiusMin', maxKey: 'highlightedAirportHoverRadiusMax' },
          { oldKey: 'generalAirportLabelSize', minKey: 'generalAirportLabelSizeMin', maxKey: 'generalAirportLabelSizeMax' },
          { oldKey: 'generalLabelHoverSize', minKey: 'generalLabelHoverSizeMin', maxKey: 'generalLabelHoverSizeMax' },
          { oldKey: 'highlightedLabelSize', minKey: 'highlightedLabelSizeMin', maxKey: 'highlightedLabelSizeMax' },
          { oldKey: 'highlightedLabelHoverSize', minKey: 'highlightedLabelHoverSizeMin', maxKey: 'highlightedLabelHoverSizeMax' },
          { oldKey: 'selectedAirportRadius', minKey: 'highlightedAirportRadiusMin', maxKey: 'highlightedAirportRadiusMax' },
          { oldKey: 'focusedLabelSize', minKey: 'highlightedLabelSizeMin', maxKey: 'highlightedLabelSizeMax' },
        ];
        for (const { oldKey, minKey, maxKey } of sizeMigrations) {
          const v = (p as Record<string, unknown>)[oldKey];
          if (v != null && !(minKey in (p as any)) && !(maxKey in (p as any))) {
            (merged as Record<string, unknown>)[minKey] = v as number;
            (merged as Record<string, unknown>)[maxKey] = v as number;
          }
        }
        if (!('zoomRangeMin' in (p as any)) && typeof (p as any).minZoom === 'number') {
          merged.zoomRangeMin = (p as any).minZoom as number;
        }
        if (!('zoomRangeMax' in (p as any)) && typeof (p as any).maxZoom === 'number') {
          merged.zoomRangeMax = (p as any).maxZoom as number;
        }
        return merged;
      },
    }
  )
);