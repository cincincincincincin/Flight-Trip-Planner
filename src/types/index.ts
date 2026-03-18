// --- Geo entities ---
export interface Airport {
  code: string;
  name: string;
  city_name?: string;
  city_code?: string;
  country_name?: string;
  country_code?: string;
  flightable?: boolean;
  coordinates?: { lat: number; lon?: number; lng?: number };
  type: 'airport';
}

export interface City {
  code: string;
  name: string;
  country_name?: string;
  country_code?: string;
  has_flightable_airport?: boolean;
  airports?: Airport[];
  type: 'city';
}

export interface Country {
  code: string;
  name: string;
  type: 'country';
  cities?: City[];
}

// --- Flights ---
export interface Flight {
  origin_airport_code: string;
  destination_airport_code: string;
  origin_city_name?: string;
  destination_city_name?: string;
  origin_city_code?: string;
  destination_city_code?: string;
  origin_country_code?: string;
  destination_country_code?: string;
  airline_code?: string;
  airline_iata?: string;
  airline_name?: string;
  flight_number?: string;
  scheduled_departure_utc?: string;
  scheduled_arrival_utc?: string;
  scheduled_departure_local?: string;
  scheduled_arrival_local?: string;
  departure_terminal?: string;
  departure_gate?: string;
  id?: string | number;
}

export interface FlightOffer {
  price: number;
  currency: string;
  link?: string;
  departure_at: string;
  duration_to?: number;
}

export interface AirportInfo {
  time_zone: string;
  current_local_date: string;
  current_local_datetime: string;
}

export interface CountryAirport {
  code: string;
  name: string;
  time_zone?: string | null;
}

// --- GeoJSON feature properties ---
export interface AirportFeatureProps {
  code: string;
  name: string;
  city_name?: string;
  city_code?: string;
  country_code?: string;
  country_name?: string;
  flightable?: boolean;
}

export interface CityFeatureProps {
  code: string;
  name: string;
  country_code?: string;
}

export interface RouteFeatureProps {
  id: string | number;
  airline_iata?: string;
  departure_airport_iata?: string;
  arrival_airport_iata?: string;
  codeshare?: boolean;
  transfers?: number;
}

// --- Selection ---
export type SelectedItem =
  | { type: 'airport'; data: Airport; isHighlighted?: boolean; overrideFromDatetime?: string; fromMap?: boolean }
  | { type: 'city'; data: City; fromMap?: boolean }
  | { type: 'country'; data: Country; fromMap?: boolean }
  | { type: 'route'; data: RouteFeatureProps };

// --- Trip ---
export interface TripLeg {
  fromAirportCode: string;
  toAirportCode: string;
  flight: Flight;
  type?: string;  // 'manual' for manual transfers
}

export interface TripSnapshot {
  selectedItem: SelectedItem | null;
  selectedAirportCode: string | null;
  tripState: TripState | null;
  tripRoutes: TripRoute[];
  highlightedAirports: string[];
  flightsData: Flight[];
}

export interface TripState {
  startAirport: { code: string; city_code?: string; country_code?: string };
  legs: TripLeg[];
}

export interface TripRoute {
  from: [number, number];
  to: [number, number];
}

// --- Map ---
export interface Viewport {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

// --- Search API ---
export interface SearchPhaseInfo {
  has_phase2: boolean;
  has_phase3: boolean;
  next_phase_available: boolean;
  total_in_current_phase: number;
}

export interface SearchResponse {
  phase: 1 | 2 | 3;
  search_mode: 'prefix' | 'contains';
  data: Country[];
  has_more: boolean;
  next_offset: number;
  phase_info: SearchPhaseInfo;
}

export interface CityWithPagination {
  data: City[];
  pagination: {
    has_more: boolean;
    total?: number;
    next_offset?: number;
  };
}

export interface FlightsResponse {
  flights: Flight[];
  has_more?: boolean;
  next_offset?: string;
}

export interface FlightOffersResponse {
  success: boolean;
  data: FlightOffer[];
}
