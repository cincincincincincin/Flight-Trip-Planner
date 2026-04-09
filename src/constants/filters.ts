/**
 * Definicje i wartości domyślne dla systemu filtrowania lotów.
 */

export interface DestinationFilter {
  airports: string[];  // Kody IATA wybranych lotnisk
  cities: string[];    // ID wybranych miast
  countries: string[]; // Kody ISO wybranych krajów
}

export const EMPTY_DESTINATION_FILTER: DestinationFilter = { 
  airports: [], 
  cities: [], 
  countries: [] 
};
