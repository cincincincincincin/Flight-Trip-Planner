import { useState, useRef, useCallback, useMemo } from 'react';
import type { Country, City, Airport, SearchPhaseInfo } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { useAirportsMap, useSearchIndex } from './queries';

type PhaseData = { 1: Country[]; 2: Country[]; 3: Country[] };
type HasMore = { 1: boolean; 2: boolean; 3: boolean };

interface CountryCacheEntry {
  cities: City[];
  pagination: { offset: number; hasMore: boolean; total?: number };
  fetchedAt: number;
}

interface CityCacheEntry {
  airports: Airport[];
  fetchedAt: number;
}

interface PhaseCacheEntry {
  cities: City[];
  fetchedAt: number;
}

interface UseSearchDataParams {
  query: string;
  containerRef: React.RefObject<HTMLElement | null>;
}

function normalize(str: string): string {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * LOGIKA WYSZUKIWANIA (Phases 1-3)
 * 
 * Implementacja wzorca "Progressive Disclosure". Wyszukiwarka filtruje dane 
 * w trzech fazach (Dokładne dopasowanie kraju -> Miasta -> Lotniska), 
 * zapewniając czytelność wyników przy dużych zbiorach danych.
 */
function computePhaseData(
  countryMap: Record<string, { name: string; n: string; cities: Record<string, { name: string; n: string; airports: Airport[] }> }>,
  query: string,
  iataMap: Record<string, Airport>,
): { phaseData: PhaseData; searchMode: 'prefix' | 'contains'; exactAirport: Airport | null; phase2Cache: Record<string, PhaseCacheEntry>; phase3Cache: Record<string, PhaseCacheEntry> } {
  const q = normalize(query.trim());

  // Empty query: all countries in phase 1
  if (q === '') {
    const allCountries: Country[] = Object.entries(countryMap)
      .map(([code, { name }]) => ({ type: 'country' as const, code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { phaseData: { 1: allCountries, 2: [], 3: [] }, searchMode: 'prefix', exactAirport: null, phase2Cache: {}, phase3Cache: {} };
  }

  // Exact IATA match (3 chars) - O(1)
  const exactAirport = q.length === 3 ? (iataMap[q] || null) : null;

  for (const mode of ['prefix', 'contains'] as const) {
    const matches = (n?: string) => {
      if (!n) return false;
      return mode === 'prefix' ? n.startsWith(q) : n.includes(q);
    };

    const p1: Country[] = [], p2: Country[] = [], p3: Country[] = [];
    const p2Cache: Record<string, PhaseCacheEntry> = {};
    const p3Cache: Record<string, PhaseCacheEntry> = {};
    const now = Date.now();

    for (const [cc, { name: countryName, n: countryN, cities }] of Object.entries(countryMap)) {
      if (matches(countryN)) {
        const cityList = Object.entries(cities)
          .map(([cityCode, { name, airports }]) => ({ type: 'city' as const, code: cityCode, name, country_code: cc, airports }))
          .sort((a, b) => a.name.localeCompare(b.name));
        p1.push({ type: 'country', code: cc, name: countryName, cities: cityList });
        continue;
      }

      const matchingCities: City[] = [];
      const airportMatchCities: City[] = [];

      for (const [cityCode, { name: cityName, n: cityN, airports }] of Object.entries(cities)) {
        if (matches(cityN)) {
          matchingCities.push({ type: 'city', code: cityCode, name: cityName, country_code: cc, airports });
        } else {
          const matched = airports.filter(a => matches(a.n));
          if (matched.length > 0) {
            airportMatchCities.push({ type: 'city', code: cityCode, name: cityName, country_code: cc, airports: matched });
          }
        }
      }

      if (matchingCities.length > 0) {
        const sorted = matchingCities.sort((a, b) => a.name.localeCompare(b.name));
        p2.push({ type: 'country', code: cc, name: countryName, cities: sorted });
        p2Cache[cc] = { cities: sorted, fetchedAt: now };
      } else if (airportMatchCities.length > 0) {
        const sorted = airportMatchCities.sort((a, b) => a.name.localeCompare(b.name));
        p3.push({ type: 'country', code: cc, name: countryName, cities: sorted });
        p3Cache[cc] = { cities: sorted, fetchedAt: now };
      }
    }

    p1.sort((a, b) => a.name.localeCompare(b.name));
    p2.sort((a, b) => a.name.localeCompare(b.name));
    p3.sort((a, b) => a.name.localeCompare(b.name));

    if (p1.length > 0 || p2.length > 0 || p3.length > 0) {
      return { phaseData: { 1: p1, 2: p2, 3: p3 }, searchMode: mode, exactAirport, phase2Cache: p2Cache, phase3Cache: p3Cache };
    }
  }

  return { phaseData: { 1: [], 2: [], 3: [] }, searchMode: 'prefix', exactAirport, phase2Cache: {}, phase3Cache: {} };
}

export function useSearchData({ query }: UseSearchDataParams) {
  const airportsMap = useAirportsMap();
  const { countryMap, iataMap } = useSearchIndex();

  const { countriesCache, citiesCache } = useMemo(() => {
    const ccCache: Record<string, CountryCacheEntry> = {};
    const ciCache: Record<string, CityCacheEntry> = {};
    const now = Date.now();

    for (const [cc, { cities }] of Object.entries(countryMap)) {
      const cityList: City[] = Object.entries(cities)
        .map(([cityCode, { name, airports }]) => {
          ciCache[cityCode] = { airports, fetchedAt: now };
          return { type: 'city' as const, code: cityCode, name, country_code: cc, airports };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      
      ccCache[cc] = { 
        cities: cityList, 
        pagination: { offset: cityList.length, hasMore: false, total: cityList.length }, 
        fetchedAt: now 
      };
    }
    return { countriesCache: ccCache, citiesCache: ciCache };
  }, [countryMap]);

  const { phaseData, searchMode, exactAirport, phase2Cache, phase3Cache } = useMemo(
    () => computePhaseData(countryMap, query, iataMap),
    [countryMap, query, iataMap],
  );

  const currentPhase = useMemo<1 | 2 | 3>(() => {
    if (phaseData[1].length > 0) return 1;
    if (phaseData[2].length > 0) return 2;
    return 3;
  }, [phaseData]);

  const hasMore: HasMore = { 1: false, 2: false, 3: false };
  const offset = 0;

  const phaseInfo: SearchPhaseInfo = useMemo(() => ({
    has_phase2: phaseData[2].length > 0,
    has_phase3: phaseData[3].length > 0,
    next_phase_available: false,
    total_in_current_phase: phaseData[currentPhase].length,
  }), [phaseData, currentPhase]);

  const loading = { search: Object.keys(airportsMap).length === 0, expand: false };

  const [isMainScrollPaused, setIsMainScrollPaused] = useState(false);
  const [activeNestedScrolls, setActiveNestedScrolls] = useState(new Set<string>());

  const scrollBeforeActionRef = useRef(0);
  const shouldRestoreScrollRef = useRef(false);
  const changingItemRef = useRef<string | null>(null);
  const loadingRef = useRef<{
    phase1Countries: Record<string, boolean>;
    phase1Cities: Record<string, boolean>;
    phase2Cities: Record<string, boolean>;
  }>({ phase1Countries: {}, phase1Cities: {}, phase2Cities: {} });
  const citiesOffsetRef = useRef<Record<string, number>>({});

  // All expand/search actions are no-ops: data is pre-indexed from GeoJSON
  const handleExpandCountry = useCallback((_code: string, _name: string) => {}, []);
  const handleExpandCity = useCallback((_code: string, _name: string, _cc: string) => {}, []);
  const handleLoadMoreCities = useCallback((_code: string, _name: string) => {}, []);
  const loadMoreMain = useCallback((..._args: any[]) => {}, []);
  const resetSearch = useCallback(() => {}, []);
  const triggerSearch = useCallback((_q: string, _offset?: number, _reset?: boolean) => {}, []);
  const triggerSearchImmediate = useCallback((_q: string, _offset?: number, _reset?: boolean) => {}, []);

  return {
    loading,
    currentPhase,
    offset,
    phaseData,
    hasMore,
    phaseInfo,
    countriesCache,
    citiesCache,
    phase2Cache,
    phase3Cache,
    isMainScrollPaused,
    activeNestedScrolls,
    searchMode,
    exactAirport,
    setIsMainScrollPaused,
    setActiveNestedScrolls,
    scrollBeforeActionRef,
    shouldRestoreScrollRef,
    changingItemRef,
    triggerSearch,
    triggerSearchImmediate,
    handleExpandCountry,
    handleExpandCity,
    handleLoadMoreCities,
    loadMoreMain,
    resetSearch,
    loadingRef,
    citiesOffsetRef,
  };
}
