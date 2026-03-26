import { CONFIG } from '../constants/config';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Country, City, Airport, SelectedItem } from '../types';
import Phase1 from './search/Phase1';
import Phase2 from './search/Phase2';
import Phase3 from './search/Phase3';
import { useSearchData } from './search/useSearchData';
import { useSettingsStore } from '../stores/settingsStore';
import './Search.css';
import { useTexts } from '../hooks/useTexts';
import { UI_SYMBOLS } from '../constants/ui';
import { getLocalizedName } from '../utils/i18n';

interface SearchProps {
  onSelectItem: (item: SelectedItem) => void;
}

interface SearchErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class SearchErrorBoundary extends React.Component<React.PropsWithChildren, SearchErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(_error: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Search component error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h3>Search error</h3>
          <p>{this.state.error?.toString()}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const Search = ({ onSelectItem }: SearchProps) => {
  const t = useTexts();
  const { showConsoleLogs } = useSettingsStore();
  const language = useSettingsStore(s => s.language);
  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [visibleSection, setVisibleSection] = useState<number | null>(null);
  const [visibleCountry, setVisibleCountry] = useState<string | null>(null);
  const [visibleCity, setVisibleCity] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibleCountryRef = useRef<string | null>(null);
  const visibleCityRef = useRef<string | null>(null);
  const mainObserverRef = useRef<IntersectionObserver | null>(null);
  const nestedObserversRef = useRef<Record<string, IntersectionObserver>>({});
  const savedScrollForQueryRef = useRef<{ query: string; position: number }>({ query: '', position: 0 });

  const {
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
  } = useSearchData({ query, containerRef });

  const handleItemClick = useCallback((item: Country | City | Airport) => {
    console.log('[SEARCH] handleItemClick:', { type: item.type, name: item.name, code: item.code });

    if (onSelectItem) {
      onSelectItem({ type: item.type, data: item } as SelectedItem);
    }

    if (containerRef.current) {
      savedScrollForQueryRef.current = {
        query: query,
        position: containerRef.current.scrollTop
      };
    }

    setIsSearchOpen(false);
  }, [onSelectItem, query]);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    triggerSearch(newQuery, 0, false);
  };

  const handleSearchFocus = () => {
    setIsSearchOpen(true);

    if (query.trim() === '' && phaseData[1].length === 0 && !loading.search) {
      triggerSearchImmediate('', 0, false);
    } else if (query.trim() !== '' &&
               phaseData[1].length === 0 &&
               phaseData[2].length === 0 &&
               phaseData[3].length === 0) {
      triggerSearchImmediate(query, 0, false);
    }
  };

  const handleSearchBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (containerRef.current) {
      savedScrollForQueryRef.current = {
        query: query,
        position: containerRef.current.scrollTop
      };
    }

    if (!e.currentTarget.contains(e.relatedTarget)) {
      setTimeout(() => {
        setIsSearchOpen(false);
        setIsMainScrollPaused(false);
        setActiveNestedScrolls(new Set());
      }, 200);
    }
  };

  // Restore scroll position when search opens with same query
  useEffect(() => {
    if (isSearchOpen && containerRef.current && savedScrollForQueryRef.current.query === query) {
      const savedPosition = savedScrollForQueryRef.current.position;
      const timer = setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = savedPosition;
        }
      }, CONFIG.SCROLL_RESTORE_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [isSearchOpen, query]);

  // Restore scroll position after expand actions (runs every render)
  useEffect(() => {
    if (shouldRestoreScrollRef.current && containerRef.current && scrollBeforeActionRef.current > 0) {
      requestAnimationFrame(() => {
        if (containerRef.current) {
          console.log('[SEARCH] Restoring scroll position after action:', scrollBeforeActionRef.current);
          containerRef.current.scrollTop = scrollBeforeActionRef.current;
          shouldRestoreScrollRef.current = false;
          scrollBeforeActionRef.current = 0;
          changingItemRef.current = null;
        }
      });
    }
  });

  // Main infinite scroll observer
  useEffect(() => {
    if (!isSearchOpen || isMainScrollPaused || loading.search) {
      if (mainObserverRef.current) {
        mainObserverRef.current.disconnect();
        mainObserverRef.current = null;
      }
      return;
    }

    if (!containerRef.current) return;

    if (mainObserverRef.current) {
      mainObserverRef.current.disconnect();
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMoreMain(currentPhase, offset, hasMore, phaseInfo, phaseData, isMainScrollPaused, query);
      }
    }, {
      root: containerRef.current,
      rootMargin: CONFIG.INFINITE_SCROLL_MARGIN,
      threshold: CONFIG.INTERSECTION_THRESHOLD
    });

    mainObserverRef.current = observer;

    const trigger = containerRef.current.querySelector('.load-more-trigger');
    if (trigger) {
      observer.observe(trigger);
    }

    return () => {
      if (mainObserverRef.current) {
        mainObserverRef.current.disconnect();
      }
    };
  }, [isSearchOpen, loading.search, loadMoreMain, isMainScrollPaused, currentPhase, offset, hasMore, phaseInfo, phaseData, query]);

  // Nested observer for cities infinite scroll (phase 1)
  useEffect(() => {
    if (!isSearchOpen || !containerRef.current) return;

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const countryCode = entry.target.getAttribute('data-country-code');
          if (!countryCode) return;
          const countryName = phaseData[1].find(c => c.code === countryCode)?.name;
          const countryCache = countriesCache[countryCode];
          if (countryCache?.pagination?.hasMore) {
            console.log('[SEARCH] Nested scroll trigger detected for country:', { countryCode, countryName });
            handleLoadMoreCities(countryCode, countryName ?? '');
          }
        }
      });
    };

    const observer = new IntersectionObserver(handleIntersection, {
      root: containerRef.current,
      rootMargin: CONFIG.INFINITE_SCROLL_MARGIN,
      threshold: CONFIG.INTERSECTION_THRESHOLD
    });

    const triggers = containerRef.current.querySelectorAll('.cities-load-more-trigger');
    triggers.forEach(trigger => { observer.observe(trigger); });

    nestedObserversRef.current.citiesObserver = observer;

    return () => {
      if (nestedObserversRef.current.citiesObserver) {
        nestedObserversRef.current.citiesObserver.disconnect();
        delete nestedObserversRef.current.citiesObserver;
      }
    };
  }, [isSearchOpen, phaseData[1], countriesCache, handleLoadMoreCities]);

  // Keep refs in sync to avoid stale closures in observer callbacks
  visibleCountryRef.current = visibleCountry;
  visibleCityRef.current = visibleCity;

  // Unified scroll spy: tracks visible section, country, and city by position
  useEffect(() => {
    const container = containerRef.current;
    if (!isSearchOpen || !container) return;
    const update = () => {
      const cTop = container.getBoundingClientRect().top;
      const header = container.querySelector<HTMLElement>('.results-header');
      const refY = cTop + (header?.offsetHeight ?? 0);

      // Section tracking (which phase is at the top)
      let section: number | null = null;
      container.querySelectorAll<HTMLElement>('.search-section[data-phase]').forEach(s => {
        if (s.getBoundingClientRect().top <= refY + 10) {
          section = parseInt(s.getAttribute('data-phase') || '1');
        }
      });
      setVisibleSection(section);

      // Country: active when top ≤ refY AND the last visible text (nested-list bottom) > refY
      let country: string | null = null;
      container.querySelectorAll<HTMLElement>('[data-country-code]').forEach(el => {
        const r = el.getBoundingClientRect();
        const nestedList = el.querySelector<HTMLElement>(':scope > .nested-list');
        const textBottom = nestedList ? nestedList.getBoundingClientRect().bottom : r.bottom;
        if (r.top <= refY && textBottom > refY) country = el.getAttribute('data-country-code');
      });
      setVisibleCountry(prev => prev === country ? prev : country);

      // City: active when top ≤ refY AND the last visible text (nested-list bottom) > refY
      let city: string | null = null;
      container.querySelectorAll<HTMLElement>('[data-city-code]').forEach(el => {
        const r = el.getBoundingClientRect();
        const nestedList = el.querySelector<HTMLElement>(':scope > .nested-list');
        const textBottom = nestedList ? nestedList.getBoundingClientRect().bottom : r.bottom;
        if (r.top <= refY && textBottom > refY) city = el.getAttribute('data-city-code');
      });
      setVisibleCity(prev => prev === city ? prev : city);
    };
    update();
    container.addEventListener('scroll', update, { passive: true });
    return () => container.removeEventListener('scroll', update);
  }, [isSearchOpen, phaseData[1].length, phaseData[2].length, phaseData[3].length]);

  const renderPhase1Country = useCallback((country: Country) => (
    <Phase1
      key={`phase1-country-${country.code}`}
      country={country}
      countriesCache={countriesCache}
      citiesCache={citiesCache}
      loadingExpand={loading.expand}
      onItemClick={handleItemClick}
      onExpandCountry={handleExpandCountry}
      onExpandCity={handleExpandCity}
      query={query}
      searchMode={searchMode}
    />
  ), [countriesCache, citiesCache, loading.expand, handleItemClick, handleExpandCountry, handleExpandCity, query, searchMode]);

  const renderPhase2Country = useCallback((country: Country) => (
    <Phase2
      key={`phase2-country-${country.code}`}
      country={country}
      phase2Cache={phase2Cache}
      citiesCache={citiesCache}
      loadingExpand={loading.expand}
      onItemClick={handleItemClick}
      onExpandCity={handleExpandCity}
      query={query}
      searchMode={searchMode}
    />
  ), [phase2Cache, citiesCache, loading.expand, handleItemClick, handleExpandCity, query, searchMode]);

  const renderPhase3Country = useCallback((country: Country) => (
    <Phase3
      key={`phase3-country-${country.code}`}
      country={country}
      phase3Cache={phase3Cache}
      onItemClick={handleItemClick}
      query={query}
      searchMode={searchMode}
    />
  ), [phase3Cache, handleItemClick, query, searchMode]);

  const renderPhaseSection = useCallback((phaseNumber: 1 | 2 | 3, title: string, icon: string, renderFunction: (item: Country) => React.ReactNode) => {
    const items = phaseData[phaseNumber];
    const showSection = items.length > 0 || (phaseNumber === currentPhase && hasMore[phaseNumber]);
    if (!showSection) return null;

    const isCurrentPhase = currentPhase === phaseNumber;

    return (
      <div className="search-section" data-phase={phaseNumber}>
        <div className="section-header">
          <h4>
            {icon} {title}{showConsoleLogs && ` (${items.length})`}
            {showConsoleLogs && searchMode === 'contains' && t.search.containsSearch}
            {showConsoleLogs && !isCurrentPhase && items.length > 0 && t.search.loaded}
          </h4>
          {loading.search && isCurrentPhase && hasMore[phaseNumber] &&
            <span className="loading-indicator">{t.search.loading}</span>}
        </div>
        <div className="section-content">
          {items.length > 0 ? (
            <>
              {showConsoleLogs && phaseNumber === 1 && query.trim() !== '' && (
                <div className="debug-info" style={{ fontSize: '10px', color: 'var(--text-muted)', padding: '5px 16px' }}>
                  {t.search.debugPhase1(items.length)}
                </div>
              )}
              {items.map(renderFunction)}
              {isCurrentPhase && hasMore[phaseNumber] && !isMainScrollPaused && (
                <div className="load-more-trigger" style={{ height: '20px', marginTop: '10px' }} />
              )}
            </>
          ) : (
            isCurrentPhase && hasMore[phaseNumber] && !isMainScrollPaused && (
              <div className="load-more-trigger" style={{ height: '20px' }} />
            )
          )}
        </div>
      </div>
    );
  }, [phaseData, currentPhase, hasMore, loading.search, searchMode, query, isMainScrollPaused, showConsoleLogs]);

  const hasResults = useMemo(() => {
    return phaseData[1].length > 0 || phaseData[2].length > 0 || phaseData[3].length > 0;
  }, [phaseData]);

  const showContent = useMemo(() => {
    return isSearchOpen && (hasResults || loading.search || query.trim() !== '');
  }, [isSearchOpen, hasResults, loading.search, query]);

  const dynamicLabel = useMemo(() => {
    // 3-char exact airport code
    if (query.trim().length === 3 && exactAirport) return t.search.airportCode;

    // Inside large city (>1 airport) — show city name
    if (visibleCity) {
      const airports = citiesCache[visibleCity]?.airports;
      if (airports && airports.length > 1) {
        const allCities = [...phaseData[1], ...phaseData[2], ...phaseData[3]]
          .flatMap(c => {
            const cache = countriesCache[c.code] || phase2Cache[c.code] || phase3Cache[c.code];
            return cache?.cities ?? (c as any).cities ?? [];
          });
        const city = allCities.find((ci: any) => ci.code === visibleCity);
        if (city) return getLocalizedName(city, language);
      }
    }

    // Inside large country (>1 city) — show country name
    if (visibleCountry) {
      const countryCache = countriesCache[visibleCountry] || phase2Cache[visibleCountry] || phase3Cache[visibleCountry];
      const cityCount = countryCache?.cities?.length ?? 0;
      if (cityCount > 1) {
        const allCountries = [...phaseData[1], ...phaseData[2], ...phaseData[3]];
        const country = allCountries.find(c => c.code === visibleCountry);
        if (country) return getLocalizedName(country, language);
      }
    }

    // Section-based fallback
    if (visibleSection === 3) return t.search.airports;
    if (visibleSection === 2) return t.search.cities;
    if (visibleSection === 1) return t.search.countries;
    return t.search.searchResults;
  }, [query, exactAirport, visibleCity, visibleCountry, visibleSection,
      citiesCache, countriesCache, phase2Cache, phase3Cache, phaseData, language, t]);

  return (
    <SearchErrorBoundary>
      <div className="search-container" onBlur={handleSearchBlur} tabIndex={-1}>
        <div className="search-input-wrapper">
          <input
            type="text"
            className="search-input"
            placeholder={t.search.placeholder}
            value={query}
            onChange={handleQueryChange}
            onFocus={handleSearchFocus}
            autoComplete="off"
          />
          {(loading.search || loading.expand) && (
            <span className="search-loading">{UI_SYMBOLS.LOADING}</span>
          )}
        </div>

        {showContent && (
          <div className="search-results" ref={containerRef}>
            <div className="results-header">
              <div className="header-main">
                <h3>
                  {dynamicLabel}
                  {showConsoleLogs && searchMode === 'contains' && t.search.containsSearch}
                  {showConsoleLogs && isMainScrollPaused && activeNestedScrolls.size > 0 && t.search.scrolling(activeNestedScrolls.size)}
                </h3>
                <button
                  className="close-results"
                  onClick={() => setIsSearchOpen(false)}
                >{UI_SYMBOLS.CLOSE}</button>
              </div>
            </div>

            <div className="results-content">
              {!hasResults && !exactAirport && !loading.search && query.trim() !== '' ? (
                <div className="no-results">
                  {t.search.noResultsFound(query)}
                </div>
              ) : (
                <>
                  {query.trim().length === 3 && exactAirport && (
                    <div className="search-section">
                      <div className="section-header">
                        <h4>{t.search.airportCode}</h4>
                      </div>
                      <div className="section-content">
                        <div
                          className="search-item airport-item"
                          onClick={() => handleItemClick(exactAirport)}
                        >
                          <div className="item-main">
                            <span className="item-name"><b>{getLocalizedName(exactAirport, language)}</b></span>
                            <span className="item-badge"></span>
                          </div>
                          <span className="item-code">({exactAirport.code})</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {renderPhaseSection(1, t.search.countries, "", renderPhase1Country)}
                  {renderPhaseSection(2, t.search.cities, "", renderPhase2Country)}
                  {renderPhaseSection(3, t.search.airports, "", renderPhase3Country)}

                  {showConsoleLogs && searchMode === 'contains' && hasResults && (
                    <div className="debug-info" style={{
                      padding: '10px 16px',
                      backgroundColor: 'var(--warning-bg)',
                      color: 'var(--warning-text)',
                      borderTop: '1px solid var(--warning-border)',
                      fontSize: '12px',
                      marginTop: '10px'
                    }}>
                      Showing results containing "{query}" (prefix search returned no results)
                    </div>
                  )}
                </>
              )}

              {loading.expand && (
                <div className="global-loading">{t.search.loadingDetails}</div>
              )}
            </div>

            {showConsoleLogs && (
              <div className="results-footer">
                <div className="debug-info">
                  <small>
                    Query: "{query}" |
                    Phase: {currentPhase} |
                    Mode: {searchMode} |
                    P1: {phaseData[1].length} |
                    P2: {phaseData[2].length} |
                    P3: {phaseData[3].length} |
                    Offset: {offset} |
                    HasMore: {hasMore[currentPhase] ? 'Yes' : 'No'} |
                    MainScroll: {isMainScrollPaused ? 'PAUSED' : 'ACTIVE'} |
                    ActiveNested: {activeNestedScrolls.size} |
                    Visible: {visibleCountry ? `Country:${visibleCountry}` : '-'}
                    {visibleCity ? `, City:${visibleCity}` : ''}
                  </small>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </SearchErrorBoundary>
  );
};

export default Search;
