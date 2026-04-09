import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  StartPointColors, 
  DEFAULT_START_POINTS, 
  DEFAULT_MAP_SETTINGS 
} from '../constants/mapDefaults';

export interface ColorState {
  startPoints: StartPointColors[];

  // Kolory warstw kropek
  generalAirport: string;
  destinationAirport: string;
  tripAirport: string;

  // Kolory warstw tras
  tripRoute: string;
  tripRouteHover: string;
  transferRoute: string;
  transferRouteHover: string;

  // Interakcja i Etykiety
  generalAirportHover: string;
  destinationAirportHover: string;
  tripAirportHover: string;
  generalLabelColor: string;
  generalLabelHoverColor: string;
  destinationLabelColor: string;
  destinationLabelHoverColor: string;
  tripLabelColor: string;
  tripLabelHoverColor: string;

  // Podświetlenia elementów UI (FlightCard.tsx)
  fcHighlightAirportBg: string;
  fcHighlightAirportBorder: string;
  fcHighlightCityBg: string;
  fcHighlightCityBorder: string;
  fcHighlightCountryBg: string;
  fcHighlightCountryBorder: string;
  fcHighlightSoonBg: string;
  fcHighlightSoonBorder: string;

  highlightedCity: string;
  generalCity: string;

  // Rozmiary obiektów WebGL zależne od poziomu zoomu
  zoomRangeMin: number;
  zoomRangeMax: number;
  routeLineWidthMin: number;
  routeLineWidthMax: number;
  routeLineHoverWidthMin: number;
  routeLineHoverWidthMax: number;
  tripRouteWidthMin: number;
  tripRouteWidthMax: number;
  tripRouteHoverWidthMin: number;
  tripRouteHoverWidthMax: number;
  generalAirportRadiusMin: number;
  generalAirportRadiusMax: number;
  generalAirportHoverRadiusMin: number;
  generalAirportHoverRadiusMax: number;
  highlightedAirportRadiusMin: number;
  highlightedAirportRadiusMax: number;
  highlightedAirportHoverRadiusMin: number;
  highlightedAirportHoverRadiusMax: number;
  highlightedCityRadius: number;
  generalCityRadius: number;
  generalAirportLabelSizeMin: number;
  generalAirportLabelSizeMax: number;
  generalLabelHoverSizeMin: number;
  generalLabelHoverSizeMax: number;
  highlightedLabelSizeMin: number;
  highlightedLabelSizeMax: number;
  highlightedLabelHoverSizeMin: number;
  highlightedLabelHoverSizeMax: number;

  setStartPointColor: (index: number, key: keyof StartPointColors, color: string) => void;
  setColor: (key: ColorKey, color: string) => void;
  setSize: (key: SizeKey, value: number) => void;
  setZoomRange: (min: number, max: number) => void;
  resetColors: () => void;
  resetSizes: () => void;
}

export type ColorKey =
  | 'generalAirport' | 'destinationAirport' | 'tripAirport'
  | 'tripRoute' | 'tripRouteHover' | 'transferRoute' | 'transferRouteHover'
  | 'generalAirportHover' | 'destinationAirportHover' | 'tripAirportHover'
  | 'generalLabelColor' | 'generalLabelHoverColor' | 'destinationLabelColor'
  | 'destinationLabelHoverColor' | 'tripLabelColor' | 'tripLabelHoverColor'
  | 'highlightedCity' | 'generalCity'
  | 'fcHighlightAirportBg' | 'fcHighlightAirportBorder'
  | 'fcHighlightCityBg' | 'fcHighlightCityBorder'
  | 'fcHighlightCountryBg' | 'fcHighlightCountryBorder'
  | 'fcHighlightSoonBg' | 'fcHighlightSoonBorder';

// Typ SizeKey definiowany dynamicznie na podstawie struktury stanu (wykluczając kolory i metody)
export type SizeKey = keyof Omit<ColorState, ColorKey | 'startPoints' | 'setStartPointColor' | 'setColor' | 'setSize' | 'setZoomRange' | 'resetColors' | 'resetSizes' | 'zoomRangeMin' | 'zoomRangeMax'>;

/** Obraz stanu utrwalonego w localStorage */
interface PersistedColorState extends Omit<Partial<ColorState>, 'startPoints'> {
  startPoints?: Partial<StartPointColors>[];
}

/**
 * Logika inwersji koloru etykiety na podstawie luminancji (UX: czytelność na mapie).
 */
const getContrastColor = (colorHex: string): string => {
  const hex = colorHex.replace('#', '');
  if (hex.length !== 6) return '#FFFFFF';
  
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? '#000000' : '#FFFFFF';
};

const LABEL_PAIRS: Record<string, { main: ColorKey; hover: ColorKey }> = {
  generalAirport: { main: 'generalLabelColor', hover: 'generalLabelHoverColor' },
  destinationAirport: { main: 'destinationLabelColor', hover: 'destinationLabelHoverColor' },
  tripAirport: { main: 'tripLabelColor', hover: 'tripLabelHoverColor' },
};

export const useColorStore = create<ColorState>()(
  persist(
    (set) => ({
      ...DEFAULT_MAP_SETTINGS,

      setStartPointColor: (index, key, color) =>
        set(state => {
          const startPoints = [...state.startPoints];
          if (startPoints[index]) {
            startPoints[index] = { ...startPoints[index], [key]: color };
            if (key === 'airport') {
              const contrast = getContrastColor(color);
              startPoints[index].label = contrast;
              startPoints[index].labelHover = contrast;
            }
          }
          return { startPoints };
        }),

      setColor: (key, color) =>
        set(state => {
          const updates: Partial<ColorState> = { [key]: color };
          if (LABEL_PAIRS[key]) {
            const contrast = getContrastColor(color);
            updates[LABEL_PAIRS[key].main] = contrast;
            updates[LABEL_PAIRS[key].hover] = contrast;
          }
          return updates;
        }),

      setSize: (key, value) => set({ [key]: value } as Pick<ColorState, SizeKey>),
      setZoomRange: (min, max) => set({ zoomRangeMin: min, zoomRangeMax: max }),
      resetColors: () => set(DEFAULT_MAP_SETTINGS),

      resetSizes: () => set(state => {
        const sizeUpdates: Partial<ColorState> = {};
        Object.keys(DEFAULT_MAP_SETTINGS).forEach(k => {
          const key = k as keyof typeof DEFAULT_MAP_SETTINGS;
          if (typeof DEFAULT_MAP_SETTINGS[key] === 'number') {
            (sizeUpdates as any)[key] = DEFAULT_MAP_SETTINGS[key];
          }
        });
        return sizeUpdates;
      }),
    }),
    {
      name: 'flight-map-colors',
      merge: (persisted, current) => {
        const p = persisted as PersistedColorState;
        const merged = { ...current, ...p };
        merged.startPoints = (p.startPoints ?? DEFAULT_START_POINTS).map((sp, i) => ({
          ...DEFAULT_START_POINTS[i],
          ...sp,
        })) as StartPointColors[];
        return merged as ColorState;
      },
    }
  )
);