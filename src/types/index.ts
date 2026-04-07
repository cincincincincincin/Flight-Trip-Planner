// --- Geo entities ---
export interface Airport {
  code: string;
  name: string;
  city_name?: string;
  city_code?: string;
  country_name?: string;
  country_code?: string;
  coordinates?: { lat: number; lon?: number; lng?: number };
  type: 'airport';
}

export interface City {
  code: string;
  name: string;
  country_name?: string;
  country_code?: string;
  airports?: Airport[];
  type: 'city';
}

export interface Country {
  code: string;
  name: string;
  type: 'country';
  cities?: City[];
}

export interface Flight {
  flight_number: string;
  airline_code?: string;
  airline_name?: string;
  origin_airport_code: string;
  destination_airport_code: string;
  scheduled_departure_utc: string;
  scheduled_arrival_utc?: string;
  scheduled_departure_local?: string;
  scheduled_arrival_local?: string;
  departure_gate?: string;
}

export interface Schedule {
  success: boolean;
  data: Flight[];
  count: number;
  last_fetched_at?: string;
  range_end_datetime?: string;
}

export interface FlightOffer {
  origin_city_code: string;
  destination_city_code: string;
  origin_airport_code: string;
  destination_airport_code: string;
  price: number;
  currency: string;
  airline_code?: string;
  flight_number?: string;
  departure_at: string;
  link?: string;
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

export interface AirportFeatureProps {
  code: string;
  name_en: string;
  name_pl?: string;
  city_code?: string;
  city_name_en?: string;
  city_name_pl?: string;
  country_code?: string;
  country_name_en?: string;
  country_name_pl?: string;
  time_zone?: string | null;
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
}

export type SelectedItem =
  | { type: 'airport'; data: Airport; isHighlighted?: boolean; overrideFromDatetime?: string; fromMap?: boolean }
  | { type: 'city'; data: City; fromMap?: boolean }
  | { type: 'country'; data: Country; fromMap?: boolean }
  | { type: 'route'; data: RouteFeatureProps };


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

export interface Viewport {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

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
  exact_match?: Airport | null;
}

export interface CityWithPagination {
  data: City[];
  pagination: {
    has_more: boolean;
    total?: number;
    next_offset?: number;
  };
}

export type FlightOfferResponse = FlightOffer;
