// Dane z API (backend)

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
  departure_terminal?: string;
  departure_gate?: string;
}

// Rozkład lotów (NDJSON)
export interface Schedule {
  success: boolean;
  data: Flight[];
  count: number;
  last_fetched_at?: string;
  range_end_datetime?: string;
}

// Oferta cenowa (Aviasales)
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

// Dane geograficzne (pliki .geojson / .json)

export interface GeoBaseProps {
  code: string;
  name: string;
  n?: string; // normalized name for Zero-Transformation search
  type: 'airport' | 'city' | 'country';
}

// Właściwości z airports.geojson
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
  // [STABLE OFFSETS v12.8.9]
  la_off_n?: [number, number];
  la_off_f?: [number, number];
  // [MASTER LABEL PIPELINE v13.71]
  is_high?: boolean;
  is_selected?: boolean;
  is_trip?: boolean;
  is_dest?: boolean;
  is_city_high?: boolean;
  is_city_selected?: boolean;
  is_city_dest?: boolean;
  is_city_trip?: boolean;
  is_city_primary?: boolean;
  city_airport_count?: number;
  la_is_high_num?: number;
  // PRE-CALCULATED LABELS
  cl_hl_low?: string;
  cl_hl_high?: string;
  cl_grouped?: string;
  cl_search?: string;
  cl_high?: string;
  la_sel_idx?: number;
  la_city_sel_idx?: number;
}

// Właściwości z cities.json
export interface CityFeatureProps {
  code: string;
  name: string;
  country_code?: string;
}

// Właściwości trasy na mapie
export interface RouteFeatureProps {
  id: string | number;
  airline_iata?: string;
  departure_airport_iata?: string;
  arrival_airport_iata?: string;
  codeshare?: boolean;
}

// Główne modele aplikacji

export interface Airport extends Omit<GeoBaseProps, 'type'> {
  type: 'airport';
  city_code?: string;
  city_name?: string;
  country_code?: string;
  country_name?: string;
  coordinates?: { lat: number; lon: number };
  time_zone?: string | null;
}

export interface City extends Omit<GeoBaseProps, 'type'> {
  type: 'city';
  country_code?: string;
  country_name?: string;
  airports?: Airport[];
}

export interface Country extends Omit<GeoBaseProps, 'type'> {
  type: 'country';
  cities?: City[];
}

// Rozszerzenie lotniska dla trybu wyboru kraju
export interface CountryAirport extends Airport {
  isSelected?: boolean;
}

// Stan UI i modele pomocnicze

export interface AirportInfo {
  time_zone: string;
  current_local_date: string;
  current_local_datetime: string;
}

// Wybrany element na mapie
export type SelectedItem =
  | { type: 'airport'; data: Airport; isHighlighted?: boolean; overrideFromDatetime?: string; fromMap?: boolean }
  | { type: 'city'; data: City; fromMap?: boolean }
  | { type: 'country'; data: Country; fromMap?: boolean }
  | { type: 'route'; data: RouteFeatureProps; fromMap?: boolean };

export interface TripLeg {
  fromAirportCode: string;
  toAirportCode: string;
  flight: Flight;
  type?: 'manual' | 'direct';
}

export interface TripRoute {
  from: [number, number];
  to: [number, number];
}

export interface TripState {
  startAirport: {
    code: string;
    city_code?: string;
    country_code?: string
  };
  legs: TripLeg[];
}

export interface TripSnapshot {
  selectedItem: SelectedItem | null;
  selectedAirportCode: string | null;
  tripState: TripState | null;
  tripRoutes: TripRoute[];
  highlightedAirports: string[];
  flightsData: Flight[];
}

export interface Viewport {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

// Wyniki wyszukiwania i paginacja

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
