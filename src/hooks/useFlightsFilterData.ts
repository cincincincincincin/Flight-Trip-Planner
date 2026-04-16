import { useState, useMemo, useCallback } from 'react';
import { CONFIG } from '../constants/config';
import type { Flight } from '../types';
import { useFilterStore } from '../stores/filterStore';
import { useAirportIndexes, useAirportNamesMap, useCityInfoMap, useCountryInfoMap } from './queries';
import { useSettingsStore } from '../stores/settingsStore';
import { getLocalizedProp } from '../utils/i18n';
import type { Language } from '../constants/text';

/**
 * INTERFEJSY DANYCH DOCELOWYCH
 * Definiują strukturę hierarchiczną używaną w panelu filtrów.
 */
export interface DestAirport { code: string; name: string; cityCode?: string; countryCode?: string; }
export interface DestCity { code: string; name: string; countryCode?: string; airports: DestAirport[]; }
export interface DestCountry { code: string; name: string; cities: DestCity[]; }

/**
 * HOOK PRZETWARZANIA DANYCH FILTROWANIA (Flight Filter Logic)
 * Agreguje surowe dane o lotach w ustrukturyzowaną hierarchię geograficzną (Kraje -> Miasta -> Lotniska).
 * Obsługuje logikę wyszukiwarki filtrów oraz zaawansowane zarządzanie stanem zaznaczeń.
 */
export interface UseFlightsFilterDataResult {
  language: Language;
  destQuery: string;
  setDestQuery: (q: string) => void;
  destinationFilter: ReturnType<typeof useFilterStore.getState>['destinationFilter'];
  airlineFilter: string[];
  clearFilters: () => void;
  getCountryName: (code: string) => string;
  airportNameMap: Record<string, string>;
  destData: DestCountry[];
  airlines: { codes: string[]; name: string }[];
  phase1: DestCountry[];
  phase2: DestCountry[];
  phase3: DestCountry[];
  exactAirport: DestAirport | null;
  activeFilterCount: number;
  isEffectivelySelected: (type: 'airport' | 'city' | 'country', code: string, cityCode?: string, countryCode?: string) => boolean;
  selectItem: (type: 'airport' | 'city' | 'country', code: string, cityCode?: string, countryCode?: string) => void;
  toggleAirline: (codes: string[]) => void;
}

export function useFlightsFilterData(allFlights: Flight[]): UseFlightsFilterDataResult {
  const language = useSettingsStore(s => s.language as Language);
  const { destinationFilter, airlineFilter, setDestinationFilter, setAirlineFilter, clearFilters } = useFilterStore();
  
  const { countryMap: airportCountryMap, cityMap: airportCityMap } = useAirportIndexes();
  const airportNameMap = useAirportNamesMap();
  const cityInfoMap = useCityInfoMap();
  const countryInfoMap = useCountryInfoMap();
  
  const [destQuery, setDestQuery] = useState('');

  const getCountryName = useMemo(() => {
    return (code: string) => countryInfoMap[code]?.name || code;
  }, [countryInfoMap]);

  const destScopeFlights = useMemo(() => {
    if (airlineFilter.length === 0) return allFlights;
    return allFlights.filter(f => f.airline_code && airlineFilter.includes(f.airline_code));
  }, [allFlights, airlineFilter]);

  const airlineScopeFlights = useMemo(() => {
    const { airports, cities, countries } = destinationFilter;
    if (airports.length === 0 && cities.length === 0 && countries.length === 0) return allFlights;
    return allFlights.filter(f => {
      const aC = f.destination_airport_code;
      if (!aC) return false;
      if (airports.includes(aC)) return true;
      const cityCode = airportCityMap[aC];
      if (cityCode && cities.includes(cityCode)) return true;
      const countryCode = airportCountryMap[aC];
      if (countryCode && countries.includes(countryCode)) return true;
      return false;
    });
  }, [allFlights, destinationFilter, airportCityMap, airportCountryMap]);

  /** 
   * AGREGACJA DANYCH DOCELOWYCH (Hierarchical Aggregation O(N))
   * Buduje strukturę Kraje -> Miasta -> Lotniska na podstawie aktualnie dostępnych lotów.
   * Wykorzystuje Map (HashMaps) do budowy indeksów w czasie liniowym, eliminując kosztowne przeszukiwanie tablic.
   */
  const destData = useMemo<DestCountry[]>(() => {
    const countriesMap = new Map<string, { 
      data: DestCountry; 
      citiesMap: Map<string, { data: DestCity; airportsSet: Set<string> }> 
    }>();

    destScopeFlights.forEach(f => {
      const aC = f.destination_airport_code?.toUpperCase();
      if (!aC) return;
      
      const cityCode = airportCityMap[aC];
      const countryCode = airportCountryMap[aC];
      if (!countryCode) return;

      // 1. Zapewnienie istnienia kraju w mapie
      if (!countriesMap.has(countryCode)) {
        countriesMap.set(countryCode, { 
          data: { code: countryCode, name: getCountryName(countryCode), cities: [] },
          citiesMap: new Map()
        });
      }
      const countryEntry = countriesMap.get(countryCode)!;

      // 2. Zapewnienie istnienia miasta (obsługuje lotniska bez przypisanego miasta przez placeholder)
      const effectiveCityCode = cityCode || CONFIG.NO_CITY_PLACEHOLDER;
      if (!countryEntry.citiesMap.has(effectiveCityCode)) {
        countryEntry.citiesMap.set(effectiveCityCode, {
          data: { 
            code: effectiveCityCode, 
            name: effectiveCityCode === CONFIG.NO_CITY_PLACEHOLDER ? '' : (cityInfoMap[effectiveCityCode]?.name || effectiveCityCode), 
            countryCode, 
            airports: [] 
          },
          airportsSet: new Set()
        });
      }
      const cityEntry = countryEntry.citiesMap.get(effectiveCityCode)!;

      // 3. Dodanie unikalnego lotniska do miasta (O(1) dzięki Set)
      if (!cityEntry.airportsSet.has(aC)) {
        cityEntry.airportsSet.add(aC);
        cityEntry.data.airports.push({ 
          code: aC, 
          name: airportNameMap[aC] || aC, 
          cityCode: effectiveCityCode !== CONFIG.NO_CITY_PLACEHOLDER ? effectiveCityCode : undefined, 
          countryCode 
        });
      }
    });

    // Konwersja map pomocniczych na wynikową strukturę tablicową (posortowaną)
    return Array.from(countriesMap.values())
      .map(entry => ({
        ...entry.data,
        cities: Array.from(entry.citiesMap.values())
          .map(ce => ce.data)
          .sort((a, b) => a.name.localeCompare(b.name))
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [destScopeFlights, airportCityMap, airportCountryMap, airportNameMap, getCountryName, cityInfoMap]);

  const airlines = useMemo(() => {
    const m = new Map<string, { codes: string[]; name: string }>();
    airlineScopeFlights.forEach(f => {
      if (!f.airline_code) return;
      const name = f.airline_name || f.airline_code;
      if (!m.has(name)) m.set(name, { codes: [], name });
      const entry = m.get(name)!;
      if (!entry.codes.includes(f.airline_code)) entry.codes.push(f.airline_code);
    });
    return Array.from(m.values())
      .map(a => ({ ...a, codes: a.codes.sort() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [airlineScopeFlights]);

  const q = destQuery.toLowerCase().trim();

  const phase1 = useMemo<DestCountry[]>(() => {
    if (!q) return destData;
    return destData.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [destData, q]);

  const phase2 = useMemo<DestCountry[]>(() => {
    if (!q) return [];
    return destData
      .map(c => ({ ...c, cities: c.cities.filter(ci => ci.name.toLowerCase().includes(q) || ci.code.toLowerCase().includes(q)) }))
      .filter(c => c.cities.length > 0 && !phase1.some(p1 => p1.code === c.code));
  }, [destData, q, phase1]);

  const phase3 = useMemo<DestCountry[]>(() => {
    if (!q) return [];
    return destData
      .map(c => ({
        ...c,
        cities: c.cities
          .map(ci => ({ ...ci, airports: ci.airports.filter(a => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)) }))
          .filter(ci => ci.airports.length > 0)
      }))
      .filter(c => c.cities.length > 0
        && !phase1.some(p1 => p1.code === c.code)
        && !phase2.some(p2 => p2.code === c.code));
  }, [destData, q, phase1, phase2]);

  const exactAirport = useMemo<DestAirport | null>(() => {
    const raw = destQuery.trim();
    if (raw.length !== 3) return null;
    const up = raw.toUpperCase();
    for (const c of destData) {
      for (const ci of c.cities) {
        const ap = ci.airports.find(a => a.code === up);
        if (ap) return ap;
      }
    }
    return null;
  }, [destQuery, destData]);

  const activeFilterCount = destinationFilter.airports.length + destinationFilter.cities.length +
    destinationFilter.countries.length + airlineFilter.length;

  const isEffectivelySelected = useCallback((type: 'airport' | 'city' | 'country', code: string, cityCode?: string, countryCode?: string): boolean => {
    if (type === 'country') return destinationFilter.countries.includes(code);
    if (type === 'city') return destinationFilter.cities.includes(code) || (!!countryCode && destinationFilter.countries.includes(countryCode));
    return destinationFilter.airports.includes(code) ||
      (!!cityCode && destinationFilter.cities.includes(cityCode)) ||
      (!!countryCode && destinationFilter.countries.includes(countryCode));
  }, [destinationFilter]);

  /**
   * ZARZĄDZANIE WYBOREM ELEMENTÓW (Selection Logic)
   * Najbardziej złożona część hooka. Implementuje inteligentną politykę zaznaczania:
   * 1. Obsługuje zaznaczanie hierarchiczne (np. zaznaczenie kraju odznacza miasta wewnątrz).
   * 2. Wykrywa "pełne zestawy" (np. jeśli zaznaczysz wszystkie miasta w kraju, system zamienia je na jeden filtr kraju).
   * 3. Zapobiega redundancji danych w filterStore.
   */
  const selectItem = useCallback((type: 'airport' | 'city' | 'country', code: string, cityCode?: string, countryCode?: string) => {
    const selected = isEffectivelySelected(type, code, cityCode, countryCode);
    const { airports, cities, countries } = destinationFilter;

    if (selected) {
      // LOGIKA ODZNACZANIA (Deselect)
      if (type === 'country') {
        setDestinationFilter({ airports, cities, countries: countries.filter(c => c !== code) });
      } else if (type === 'city') {
        if (cities.includes(code)) {
          setDestinationFilter({ airports, cities: cities.filter(c => c !== code), countries });
        } else if (countryCode && countries.includes(countryCode)) {
          // Jeśli odznaczamy miasto, które było częścią zaznaczonego kraju -> zamieniamy kraj na listę pozostałych miast.
          const country = destData.find(c => c.code === countryCode);
          const otherCities = (country?.cities || []).filter(ci => ci.code !== code && ci.code !== CONFIG.NO_CITY_PLACEHOLDER).map(ci => ci.code);
          setDestinationFilter({ airports, cities: [...cities, ...otherCities.filter(c => !cities.includes(c))], countries: countries.filter(c => c !== countryCode) });
        }
      } else {
        if (airports.includes(code)) {
          setDestinationFilter({ airports: airports.filter(a => a !== code), cities, countries });
        } else if (cityCode && cities.includes(cityCode)) {
          // Jeśli odznaczamy lotnisko będące częścią zaznaczonego miasta -> zamieniamy miasto na listę pozostałych lotnisk.
          const city = destData.flatMap(c => c.cities).find(ci => ci.code === cityCode);
          const otherAirports = (city?.airports || []).filter(a => a.code !== code).map(a => a.code);
          setDestinationFilter({ airports: [...airports, ...otherAirports.filter(a => !airports.includes(a))], cities: cities.filter(c => c !== cityCode), countries });
        } else if (countryCode && countries.includes(countryCode)) {
          // Analogiczna logika dla dekompozycji kraju na miasta i lotniska przy odznaczaniu pojedynczego punktu.
          const country = destData.find(c => c.code === countryCode);
          const otherCities = (country?.cities || []).filter(ci => ci.code !== cityCode && ci.code !== CONFIG.NO_CITY_PLACEHOLDER).map(ci => ci.code);
          const parentCity = country?.cities.find(ci => ci.code === cityCode);
          const otherAirports = (parentCity?.airports || []).filter(a => a.code !== code).map(a => a.code);
          setDestinationFilter({
            airports: [...airports, ...otherAirports.filter(a => !airports.includes(a))],
            cities: [...cities, ...otherCities.filter(c => !cities.includes(c))],
            countries: countries.filter(c => c !== countryCode),
          });
        }
      }
    } else {
      // LOGIKA ZAZNACZANIA (Select)
      if (type === 'country') {
        const country = destData.find(c => c.code === code);
        const cityCodes = new Set((country?.cities || []).map(ci => ci.code));
        const airportCodes = new Set((country?.cities || []).flatMap(ci => ci.airports.map(a => a.code)));
        setDestinationFilter({
          countries: [...countries, code],
          cities: cities.filter(c => !cityCodes.has(c)), // Czyścimy redundantne miasta
          airports: airports.filter(a => !airportCodes.has(a)), // Czyścimy redundantne lotniska
        });
      } else if (type === 'city') {
        const city = destData.flatMap(c => c.cities).find(ci => ci.code === code);
        const airportCodes = new Set((city?.airports || []).map(a => a.code));
        const newCities = [...cities, code];
        const newAirports = airports.filter(a => !airportCodes.has(a));
        
        // [AUTO-CONSOLIDATION]: Jeśli zaznaczyliśmy wszystkie dostępne miasta w kraju -> zamień na filtr kraju.
        if (countryCode) {
          const country = destData.find(c => c.code === countryCode);
          const validCities = (country?.cities || []).filter(ci => ci.code !== CONFIG.NO_CITY_PLACEHOLDER);
          if (validCities.length > 0 && validCities.every(ci => newCities.includes(ci.code))) {
            const countryCityCodes = new Set(validCities.map(ci => ci.code));
            setDestinationFilter({
              countries: [...countries, countryCode],
              cities: newCities.filter(c => !countryCityCodes.has(c)),
              airports: newAirports,
            });
            return;
          }
        }
        setDestinationFilter({ airports: newAirports, cities: newCities, countries });
      } else {
        const newAirports = [...airports, code];
        // Podobna auto-konsolidacja dla lotnisk awansujących do poziomu miasta.
        if (cityCode) {
          const city = destData.flatMap(c => c.cities).find(ci => ci.code === cityCode);
          if (city && city.airports.length > 0 && city.airports.every(a => newAirports.includes(a.code))) {
            const cityAirportCodes = new Set(city.airports.map(a => a.code));
            const newCities = [...cities, cityCode];
            const aps = newAirports.filter(a => !cityAirportCodes.has(a));
            if (countryCode) {
              const country = destData.find(c => c.code === countryCode);
              const validCities = (country?.cities || []).filter(ci => ci.code !== CONFIG.NO_CITY_PLACEHOLDER);
              if (validCities.length > 0 && validCities.every(ci => newCities.includes(ci.code))) {
                const countryCityCodes = new Set(validCities.map(ci => ci.code));
                setDestinationFilter({ countries: [...countries, countryCode], cities: newCities.filter(c => !countryCityCodes.has(c)), airports: aps });
                return;
              }
            }
            setDestinationFilter({ airports: aps, cities: newCities, countries });
            return;
          }
        }
        setDestinationFilter({ airports: newAirports, cities, countries });
      }
    }
  }, [destinationFilter, destData, isEffectivelySelected, setDestinationFilter]);

  const toggleAirline = useCallback((codes: string[]) => {
    const allSelected = codes.every(c => airlineFilter.includes(c));
    if (allSelected) {
      setAirlineFilter(airlineFilter.filter(c => !codes.includes(c)));
    } else {
      setAirlineFilter([...airlineFilter, ...codes.filter(c => !airlineFilter.includes(c))]);
    }
  }, [airlineFilter, setAirlineFilter]);

  return {
    language,
    destQuery,
    setDestQuery,
    destinationFilter,
    airlineFilter,
    clearFilters,
    getCountryName,
    airportNameMap,
    destData,
    airlines,
    phase1,
    phase2,
    phase3,
    exactAirport,
    activeFilterCount,
    isEffectivelySelected,
    selectItem,
    toggleAirline,
  };
}
