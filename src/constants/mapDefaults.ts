import { MAP_STYLES } from './mapStyles';

/**
 * Domyślne ustawienia wizualne mapy (kolory, promienie punktów, szerokości linii).
 * Wyciągnięte do stałych, aby oddzielić konfigurację od logiki stanu Zustand.
 */

export interface StartPointColors {
  airport: string;
  airportHover: string;
  route: string;
  routeHover: string;
  label: string;
  labelHover: string;
}

export const DEFAULT_START_POINTS: StartPointColors[] = [
  { airport: '#000000', airportHover: '#000000', route: '#ed6498', routeHover: '#b13b6b', label: '#000000', labelHover: '#000000' },
  { airport: '#000000', airportHover: '#000000', route: '#3B8FE8', routeHover: '#1a5fa8', label: '#000000', labelHover: '#000000' },
  { airport: '#000000', airportHover: '#000000', route: '#2ECC71', routeHover: '#1a8a4a', label: '#000000', labelHover: '#000000' },
  { airport: '#000000', airportHover: '#000000', route: '#E67E22', routeHover: '#a05010', label: '#000000', labelHover: '#000000' },
  { airport: '#000000', airportHover: '#000000', route: '#9B59B6', routeHover: '#6a2e8a', label: '#000000', labelHover: '#000000' },
  { airport: '#000000', airportHover: '#000000', route: '#E74C3C', routeHover: '#a02020', label: '#000000', labelHover: '#000000' },
];

export const DEFAULT_MAP_SETTINGS = {
  startPoints: DEFAULT_START_POINTS,
  generalAirport: '#FF6B6B',
  destinationAirport: '#4CAF50',
  tripAirport: '#000000',
  tripRoute: '#1565C0',
  tripRouteHover: '#0d47a1',
  transferRoute: '#9C27B0',
  transferRouteHover: '#6a1b9a',
  generalAirportHover: '#C62828',
  destinationAirportHover: '#2E7D32',
  tripAirportHover: '#000000',
  generalLabelColor: '#000000',
  generalLabelHoverColor: '#000000',
  destinationLabelColor: '#000000',
  destinationLabelHoverColor: '#000000',
  tripLabelColor: '#000000',
  tripLabelHoverColor: '#000000',
  fcHighlightAirportBg: 'rgba(43, 168, 180, 0.10)',
  fcHighlightAirportBorder: 'rgba(43, 168, 180, 0.28)',
  fcHighlightCityBg: 'rgba(106, 153, 85, 0.10)',
  fcHighlightCityBorder: 'rgba(106, 153, 85, 0.28)',
  fcHighlightCountryBg: 'rgba(200, 158, 50, 0.10)',
  fcHighlightCountryBorder: 'rgba(200, 158, 50, 0.28)',
  fcHighlightSoonBg: 'rgba(220, 38, 38, 0.10)',
  fcHighlightSoonBorder: 'rgba(220, 38, 38, 0.30)',
  highlightedCity: '#4CAF50',
  generalCity: '#4ECDC4',
  zoomRangeMin: 1.3,
  zoomRangeMax: 12.0,
  routeLineWidthMin: 2.0,
  routeLineWidthMax: 3.0,
  routeLineHoverWidthMin: 6.6,
  routeLineHoverWidthMax: 15.0,
  tripRouteWidthMin: 2.0,
  tripRouteWidthMax: 3.0,
  tripRouteHoverWidthMin: 6.6,
  tripRouteHoverWidthMax: 15.0,
  generalAirportRadiusMin: 4.0,
  generalAirportRadiusMax: 14.0,
  generalAirportHoverRadiusMin: 12.0,
  generalAirportHoverRadiusMax: 30.0,
  highlightedAirportRadiusMin: 4.0,
  highlightedAirportRadiusMax: 22.0,
  highlightedAirportHoverRadiusMin: 12.0,
  highlightedAirportHoverRadiusMax: 45.0,
  highlightedCityRadius: 12,
  generalCityRadius: 8,
  generalAirportLabelSizeMin: 12,
  generalAirportLabelSizeMax: 20,
  generalLabelHoverSizeMin: 16,
  generalLabelHoverSizeMax: 26,
  highlightedLabelSizeMin: 12,
  highlightedLabelSizeMax: 23,
  highlightedLabelHoverSizeMin: 18,
  highlightedLabelHoverSizeMax: 34,
};

/**
 * Ustawienia kamery i widoczności przy starcie aplikacji.
 */
export const MAP_INITIAL_STATE = {
  showAirports: true,
  globeMode: false,
  mapStyle: MAP_STYLES.LIGHT,
  viewport: {
    center: [19.0, 52.0] as [number, number], // Centrum Europy
    zoom: 4,
    pitch: 0,
    bearing: 0
  }
};
