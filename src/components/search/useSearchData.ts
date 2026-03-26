import { useState, useRef, useCallback, useEffect } from 'react';
import axios from 'axios';
import { search, getCountryCities, getCityAirports, getAirport } from '../../api/search';
import { CONFIG } from '../../constants/config';
import type { Country, City, Airport, SearchPhaseInfo, Airport as AirportType } from '../../types';
import { useSettingsStore } from '../../stores/settingsStore';

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

type CountriesCache = Record<string, CountryCacheEntry>;
type CitiesCache = Record<string, CityCacheEntry>;
type PhaseCache = Record<string, PhaseCacheEntry>;
type PhaseData = { 1: Country[]; 2: Country[]; 3: Country[] };
type HasMore = { 1: boolean; 2: boolean; 3: boolean };

interface UseSearchDataParams {
  query: string;
  containerRef: React.RefObject<HTMLElement | null>;
}

export function useSearchData({ query, containerRef }: UseSearchDataParams) {
  const language = useSettingsStore(s => s.language);
  const showConsoleLogs = useSettingsStore(s => s.showConsoleLogs);
  const showConsoleLogsRef = useRef(showConsoleLogs);
  useEffect(() => { showConsoleLogsRef.current = showConsoleLogs; }, [showConsoleLogs]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const log = useCallback((...args: any[]) => { if (showConsoleLogsRef.current) console.log(...args); }, []);

  const [loading, setLoading] = useState({ search: false, expand: false });
  const [currentPhase, setCurrentPhase] = useState<1 | 2 | 3>(1);
  const [offset, setOffset] = useState(0);
  const [phaseData, setPhaseData] = useState<PhaseData>({ 1: [], 2: [], 3: [] });
  const [hasMore, setHasMore] = useState<HasMore>({ 1: false, 2: false, 3: false });
  const [phaseInfo, setPhaseInfo] = useState<SearchPhaseInfo>({
    has_phase2: false,
    has_phase3: false,
    next_phase_available: false,
    total_in_current_phase: 0
  });
  const [countriesCache, setCountriesCache] = useState<CountriesCache>({});
  const [citiesCache, setCitiesCache] = useState<CitiesCache>({});
  const [phase2Cache, setPhase2Cache] = useState<PhaseCache>({});
  const [phase3Cache, setPhase3Cache] = useState<PhaseCache>({});
  const [isMainScrollPaused, setIsMainScrollPaused] = useState(false);
  const [activeNestedScrolls, setActiveNestedScrolls] = useState(new Set<string>());
  const [searchMode, setSearchMode] = useState<'prefix' | 'contains'>('prefix');
  const [exactAirport, setExactAirport] = useState<AirportType | null>(null);

  const languageRef = useRef(language);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const exactAirportAbortRef = useRef<AbortController | null>(null);
  const countriesCacheRef = useRef<CountriesCache>(countriesCache);
  const citiesCacheRef = useRef<CitiesCache>(citiesCache);
  const phase2CacheRef = useRef<PhaseCache>(phase2Cache);
  const phase3CacheRef = useRef<PhaseCache>(phase3Cache);
  const loadingRef = useRef<{
    phase1Countries: Record<string, boolean>;
    phase1Cities: Record<string, boolean>;
    phase2Cities: Record<string, boolean>;
  }>({ phase1Countries: {}, phase1Cities: {}, phase2Cities: {} });
  const citiesOffsetRef = useRef<Record<string, number>>({});
  const scrollBeforeActionRef = useRef(0);
  const shouldRestoreScrollRef = useRef(false);
  const changingItemRef = useRef<string | null>(null);

  // Keep cache refs in sync
  useEffect(() => {
    countriesCacheRef.current = countriesCache;
    citiesCacheRef.current = citiesCache;
    phase2CacheRef.current = phase2Cache;
    phase3CacheRef.current = phase3Cache;
  }, [countriesCache, citiesCache, phase2Cache, phase3Cache]);

  // Keep language ref in sync
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  // Exact airport lookup for 3-letter queries
  useEffect(() => {
    const q = query.trim();
    if (q.length !== 3) {
      setExactAirport(null);
      if (exactAirportAbortRef.current) {
        exactAirportAbortRef.current.abort();
        exactAirportAbortRef.current = null;
      }
      return;
    }
    if (exactAirportAbortRef.current) {
      exactAirportAbortRef.current.abort();
    }
    exactAirportAbortRef.current = new AbortController();
    getAirport(q.toUpperCase(), { signal: exactAirportAbortRef.current.signal, params: { lang: languageRef.current } })
      .then(data => setExactAirport(data))
      .catch(err => {
        if (!axios.isCancel(err)) setExactAirport(null);
      });
  }, [query, language]);

  const resetSearch = useCallback(() => {
    log('[SEARCH] Resetting search');

    setPhaseData({ 1: [], 2: [], 3: [] });
    setHasMore({ 1: false, 2: false, 3: false });
    setPhaseInfo({
      has_phase2: false,
      has_phase3: false,
      next_phase_available: false,
      total_in_current_phase: 0
    });
    setCurrentPhase(1);
    setOffset(0);
    setCountriesCache({});
    setCitiesCache({});
    setPhase2Cache({});
    setPhase3Cache({});
    setIsMainScrollPaused(false);
    setActiveNestedScrolls(new Set());
    setSearchMode('prefix');

    citiesOffsetRef.current = {};
    scrollBeforeActionRef.current = 0;
    shouldRestoreScrollRef.current = false;
    changingItemRef.current = null;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const performSearch = useCallback(async (searchQuery: string, searchOffset = 0, append = false) => {
    const trimmedQuery = searchQuery.trim();

    log('[SEARCH] performSearch:', { query: trimmedQuery, offset: searchOffset, append, currentPhase });

    if (!append) {
      resetSearch();
    }

    setLoading(prev => ({ ...prev, search: true }));

    try {
      abortControllerRef.current = new AbortController();

      const data = await search(
        { q: trimmedQuery, offset: searchOffset, limit: CONFIG.SEARCH_LIMITS.main, lang: languageRef.current },
        { signal: abortControllerRef.current.signal }
      );
      log('[SEARCH] Search response:', {
        phase: data.phase,
        mode: data.search_mode,
        itemsCount: data.data.length,
        hasMore: data.has_more,
        nextOffset: data.next_offset
      });

      setSearchMode(data.search_mode);
      setPhaseInfo(data.phase_info);

      setPhaseData(prev => {
        const newPhaseData = { ...prev };
        if (append && data.phase === currentPhase) {
          const existing = newPhaseData[data.phase] || [];
          const existingIds = new Set(existing.map((item: Country) => item.code));
          const newItems = data.data.filter((item: Country) => !existingIds.has(item.code));
          newPhaseData[data.phase] = [...existing, ...newItems];
        } else {
          newPhaseData[data.phase] = data.data;
        }
        return newPhaseData;
      });

      if (data.phase === 2 && data.data.length > 0) {
        setPhase2Cache(prev => {
          const newCache = { ...prev };
          let hasChanges = false;
          data.data.forEach((country: Country) => {
            if (country.code && country.cities) {
              const existing = prev[country.code];
              if (!existing || existing.fetchedAt < Date.now() - CONFIG.CACHE_FRESHNESS_MS) {
                newCache[country.code] = { cities: country.cities, fetchedAt: Date.now() };
                hasChanges = true;
              }
            }
          });
          return hasChanges ? newCache : prev;
        });
      } else if (data.phase === 3 && data.data.length > 0) {
        setPhase3Cache(prev => {
          const newCache = { ...prev };
          let hasChanges = false;
          data.data.forEach((country: Country) => {
            if (country.code) {
              const existing = prev[country.code];
              if (!existing || existing.fetchedAt < Date.now() - CONFIG.CACHE_FRESHNESS_MS) {
                newCache[country.code] = { cities: country.cities || [], fetchedAt: Date.now() };
                hasChanges = true;
              }
            }
          });
          return hasChanges ? newCache : prev;
        });
      }

      setHasMore(prev => ({ ...prev, [data.phase]: data.has_more }));
      setOffset(data.next_offset);
      setCurrentPhase(data.phase);

    } catch (error) {
      if (!axios.isCancel(error)) {
        console.error('[SEARCH ERROR] performSearch:', error);
      }
    } finally {
      setLoading(prev => ({ ...prev, search: false }));
      abortControllerRef.current = null;
    }
  }, [resetSearch, currentPhase]);

  // Re-search when language changes (only if query is non-empty)
  useEffect(() => {
    if (!query.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    performSearch(query, 0, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const loadMoreMain = useCallback((
    currentPhaseVal: 1 | 2 | 3,
    offsetVal: number,
    hasMoreVal: HasMore,
    phaseInfoVal: SearchPhaseInfo,
    phaseDataVal: PhaseData,
    isMainScrollPausedVal: boolean,
    queryVal: string,
  ) => {
    if (loading.search || isMainScrollPausedVal) {
      log('[SEARCH] loadMoreMain: Skipping - loading or paused');
      return;
    }

    let shouldLoadMore = false;

    if (currentPhaseVal === 1) {
      shouldLoadMore = hasMoreVal[1] ||
                      (!hasMoreVal[1] && phaseInfoVal.has_phase2 && phaseDataVal[2].length === 0);
    } else if (currentPhaseVal === 2) {
      shouldLoadMore = hasMoreVal[2] ||
                      (!hasMoreVal[2] && phaseInfoVal.has_phase3 && phaseDataVal[3].length === 0);
    } else if (currentPhaseVal === 3) {
      shouldLoadMore = hasMoreVal[3];
    }

    if (!shouldLoadMore) {
      log('[SEARCH] No more data to load');
      return;
    }

    log('[SEARCH] Loading more, offset:', offsetVal);
    performSearch(queryVal, offsetVal, true);
  }, [loading.search, performSearch]);

  const expandCountryPhase1 = useCallback(async (
    countryCode: string,
    countryName: string,
    citiesOffset = 0,
    isScrollTrigger = false,
  ) => {
    if (loadingRef.current.phase1Countries[countryCode]) {
      log('[SEARCH] expandCountryPhase1: Already loading', countryCode);
      return;
    }

    log('[SEARCH] Expanding country for PHASE 1:', { countryCode, countryName, citiesOffset, isScrollTrigger });

    if (containerRef.current && !isScrollTrigger) {
      scrollBeforeActionRef.current = containerRef.current.scrollTop;
      shouldRestoreScrollRef.current = true;
      changingItemRef.current = `country-${countryCode}`;
    }

    loadingRef.current.phase1Countries[countryCode] = true;
    setLoading(prev => ({ ...prev, expand: true }));

    if (!isScrollTrigger) {
      setActiveNestedScrolls(prev => new Set(prev).add(countryCode));
    }

    try {
      const { data: cities, pagination } = await getCountryCities(countryCode, {
        limit: CONFIG.SEARCH_LIMITS.cities,
        offset: citiesOffset,
        lang: languageRef.current,
      });

      citiesOffsetRef.current = {
        ...citiesOffsetRef.current,
        [countryCode]: citiesOffset + cities.length
      };

      setCountriesCache(prev => {
        const currentCountryCache = prev[countryCode];
        const existingCities = currentCountryCache?.cities || [];
        const existingCityCodes = new Set(existingCities.map((c: City) => c.code));
        const newCities = cities.filter((city: City) => !existingCityCodes.has(city.code));

        if (citiesOffset > 0 && newCities.length === 0) return prev;

        const updatedCities = citiesOffset === 0 ? cities : [...existingCities, ...newCities];

        return {
          ...prev,
          [countryCode]: {
            cities: updatedCities,
            pagination: {
              offset: citiesOffset + cities.length,
              hasMore: pagination.has_more,
              total: pagination.total
            },
            fetchedAt: Date.now()
          }
        };
      });

      if (!pagination.has_more) {
        setActiveNestedScrolls(prev => {
          const newSet = new Set(prev);
          newSet.delete(countryCode);
          if (newSet.size === 0) {
            log('[SEARCH] All nested scrolls completed, resuming main scroll');
            setIsMainScrollPaused(false);
          }
          return newSet;
        });
      }

    } catch (error) {
      console.error('[SEARCH ERROR] expandCountryPhase1:', error);
      setActiveNestedScrolls(prev => {
        const newSet = new Set(prev);
        newSet.delete(countryCode);
        return newSet;
      });
    } finally {
      loadingRef.current.phase1Countries[countryCode] = false;
      setLoading(prev => ({ ...prev, expand: false }));
    }
  }, [containerRef]);

  const expandCity = useCallback(async (cityCode: string, cityName: string, countryCode: string) => {
    if (loadingRef.current.phase1Cities[cityCode]) {
      log('[SEARCH] expandCity: Already loading', cityCode);
      return;
    }
    if (citiesCacheRef.current[cityCode]) return;

    log('[SEARCH] Expanding city:', { cityCode, cityName, countryCode });

    if (containerRef.current) {
      scrollBeforeActionRef.current = containerRef.current.scrollTop;
      shouldRestoreScrollRef.current = true;
      changingItemRef.current = `city-${cityCode}`;
    }

    loadingRef.current.phase1Cities[cityCode] = true;
    setLoading(prev => ({ ...prev, expand: true }));

    try {
      const { data } = await getCityAirports(cityCode, { limit: CONFIG.SEARCH_LIMITS.airports, offset: 0, lang: languageRef.current });
      setCitiesCache(prev => {
        if (prev[cityCode]) return prev;
        return { ...prev, [cityCode]: { airports: data, fetchedAt: Date.now() } };
      });
    } catch (error) {
      console.error('[SEARCH ERROR] expandCity:', error);
    } finally {
      loadingRef.current.phase1Cities[cityCode] = false;
      setLoading(prev => ({ ...prev, expand: false }));
    }
  }, [containerRef]);

  const handleExpandCountry = useCallback((countryCode: string, countryName: string) => {
    setIsMainScrollPaused(true);
    if (!countriesCacheRef.current[countryCode]) {
      expandCountryPhase1(countryCode, countryName, 0, false);
    }
  }, [expandCountryPhase1]);

  const handleExpandCity = useCallback((cityCode: string, cityName: string, countryCode: string) => {
    if (!citiesCacheRef.current[cityCode]) {
      expandCity(cityCode, cityName, countryCode);
    }
  }, [expandCity]);

  const handleLoadMoreCities = useCallback((countryCode: string, countryName: string) => {
    const countryCache = countriesCacheRef.current[countryCode];
    if (!countryCache?.pagination?.hasMore) {
      log('[SEARCH] handleLoadMoreCities: No more cities to load');
      return;
    }
    const currentOffset = countryCache.pagination.offset || 0;
    log('[SEARCH] Loading more cities for country:', { countryCode, countryName, currentOffset });
    expandCountryPhase1(countryCode, countryName, currentOffset, true);
  }, [expandCountryPhase1]);

  const triggerSearch = useCallback((searchQuery: string, searchOffset = 0, append = false) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    debounceRef.current = setTimeout(() => {
      performSearch(searchQuery, searchOffset, append);
    }, CONFIG.DEBOUNCE_TIME_MS);
  }, [performSearch]);

  const triggerSearchImmediate = useCallback((searchQuery: string, searchOffset = 0, append = false) => {
    performSearch(searchQuery, searchOffset, append);
  }, [performSearch]);

  return {
    // state
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
    // setters needed by Search.jsx
    setIsMainScrollPaused,
    setActiveNestedScrolls,
    // scroll refs for Search.jsx scroll restoration
    scrollBeforeActionRef,
    shouldRestoreScrollRef,
    changingItemRef,
    // actions
    triggerSearch,
    triggerSearchImmediate,
    handleExpandCountry,
    handleExpandCity,
    handleLoadMoreCities,
    loadMoreMain,
    resetSearch,
    // refs
    loadingRef,
    citiesOffsetRef,
  };
}
