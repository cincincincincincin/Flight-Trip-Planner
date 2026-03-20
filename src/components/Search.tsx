import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Country, City, Airport, SelectedItem } from '../types';
import Phase1 from './search/Phase1';
import Phase2 from './search/Phase2';
import Phase3 from './search/Phase3';
import { useSearchData } from './search/useSearchData';
import './Search.css';

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
          <h3>Search Component Error</h3>
          <p>{this.state.error?.toString()}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const Search = ({ onSelectItem }: SearchProps) => {
  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [visibleExpanded, setVisibleExpanded] = useState<{ country: string | null; city: string | null }>({ country: null, city: null });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mainObserverRef = useRef<IntersectionObserver | null>(null);
  const nestedObserversRef = useRef<Record<string, IntersectionObserver>>({});
  const visibilityObserversRef = useRef<Record<string, IntersectionObserver>>({});
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
      }, 50);
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
      rootMargin: '100px',
      threshold: 0.1
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
      rootMargin: '100px',
      threshold: 0.1
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

  // Visibility observer for tracking expanded countries/cities
  useEffect(() => {
    if (!isSearchOpen || !containerRef.current) return;

    const handleVisibilityIntersection = (entries: IntersectionObserverEntry[]) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const countryCode = entry.target.getAttribute('data-country-code');
          const cityCode = entry.target.getAttribute('data-city-code');
          if (countryCode) {
            setVisibleExpanded(prev => ({ ...prev, country: countryCode }));
          }
          if (cityCode) {
            setVisibleExpanded(prev => ({ ...prev, city: cityCode }));
          }
        } else {
          const countryCode = entry.target.getAttribute('data-country-code');
          const cityCode = entry.target.getAttribute('data-city-code');
          if (countryCode && visibleExpanded.country === countryCode) {
            setVisibleExpanded(prev => ({ ...prev, country: null }));
          }
          if (cityCode && visibleExpanded.city === cityCode) {
            setVisibleExpanded(prev => ({ ...prev, city: null }));
          }
        }
      });
    };

    const observer = new IntersectionObserver(handleVisibilityIntersection, {
      root: containerRef.current,
      rootMargin: '-10% 0px -80% 0px',
      threshold: 0
    });

    const visibilityMarkers = containerRef.current.querySelectorAll('.visibility-marker');
    visibilityMarkers.forEach(marker => { observer.observe(marker); });

    visibilityObserversRef.current.visibilityObserver = observer;

    return () => {
      if (visibilityObserversRef.current.visibilityObserver) {
        visibilityObserversRef.current.visibilityObserver.disconnect();
        delete visibilityObserversRef.current.visibilityObserver;
      }
    };
  }, [isSearchOpen, visibleExpanded]);

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
      <div className="search-section">
        <div className="section-header">
          <h4>
            {icon} {title} ({items.length})
            {searchMode === 'contains' && ' (Contains)'}
            {!isCurrentPhase && items.length > 0 && ' (Loaded)'}
          </h4>
          {loading.search && isCurrentPhase && hasMore[phaseNumber] &&
            <span className="loading-indicator">Loading...</span>}
        </div>
        <div className="section-content">
          {items.length > 0 ? (
            <>
              {phaseNumber === 1 && query.trim() !== '' && (
                <div className="debug-info" style={{ fontSize: '10px', color: '#999', padding: '5px 16px' }}>
                  Phase 1: Showing {items.length} matching countries (collapsed by default)
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
  }, [phaseData, currentPhase, hasMore, loading.search, searchMode, query, isMainScrollPaused]);

  const hasResults = useMemo(() => {
    return phaseData[1].length > 0 || phaseData[2].length > 0 || phaseData[3].length > 0;
  }, [phaseData]);

  const showContent = useMemo(() => {
    return isSearchOpen && (hasResults || loading.search || query.trim() !== '');
  }, [isSearchOpen, hasResults, loading.search, query]);

  const getVisibleExpandedName = useCallback(() => {
    if (visibleExpanded.country) {
      const allCountries = [...phaseData[1], ...phaseData[2], ...phaseData[3]];
      const country = allCountries.find(c => c.code === visibleExpanded.country);
      if (country) {
        if (visibleExpanded.city) {
          const countryCache = countriesCache[visibleExpanded.country] ||
                              phase2Cache[visibleExpanded.country] ||
                              phase3Cache[visibleExpanded.country];
          if (countryCache?.cities) {
            const city = countryCache.cities.find(c => c.code === visibleExpanded.city);
            if (city) return `${country.name} › ${city.name}`;
          }
        }
        return country.name;
      }
    }
    return null;
  }, [visibleExpanded, phaseData, countriesCache, phase2Cache, phase3Cache]);

  const visibleExpandedName = getVisibleExpandedName();

  return (
    <SearchErrorBoundary>
      <div className="search-container" onBlur={handleSearchBlur} tabIndex={-1}>
        <div className="search-input-wrapper">
          <input
            type="text"
            className="search-input"
            placeholder="Search countries, cities, airports..."
            value={query}
            onChange={handleQueryChange}
            onFocus={handleSearchFocus}
            autoComplete="off"
          />
          {(loading.search || loading.expand) && (
            <span className="search-loading">⌛</span>
          )}
        </div>

        {showContent && (
          <div className="search-results" ref={containerRef}>
            <div className="results-header">
              <div className="header-main">
                <h3>
                  Search Results
                  {searchMode === 'contains' && ' (Contains Search)'}
                  {isMainScrollPaused && activeNestedScrolls.size > 0 && ` (Scrolling ${activeNestedScrolls.size} countries...)`}
                </h3>
                <button
                  className="close-results"
                  onClick={() => setIsSearchOpen(false)}
                >
                  ×
                </button>
              </div>

              {visibleExpandedName && (
                <div className="visible-expanded-indicator">
                  <span className="indicator-icon">📍</span>
                  <span className="indicator-text">{visibleExpandedName}</span>
                </div>
              )}
            </div>

            <div className="results-content">
              {!hasResults && !exactAirport && !loading.search && query.trim() !== '' ? (
                <div className="no-results">
                  No results found for "{query}"
                </div>
              ) : (
                <>
                  {query.trim().length === 3 && exactAirport && (
                    <div className="search-section">
                      <div className="section-header">
                        <h4>Airport code</h4>
                      </div>
                      <div className="section-content">
                        <div
                          className="search-item airport-item"
                          onClick={() => handleItemClick(exactAirport)}
                        >
                          <div className="item-main">
                            <span className="item-icon"></span>
                            <span className="item-name"><b>{exactAirport.name}</b></span>
                            <span className="item-code">({exactAirport.code})</span>
                            {exactAirport.flightable && <span className="item-badge"></span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {renderPhaseSection(1, "Countries", "", renderPhase1Country)}
                  {renderPhaseSection(2, "Cities", "", renderPhase2Country)}
                  {renderPhaseSection(3, "Airports", "", renderPhase3Country)}

                  {searchMode === 'contains' && hasResults && (
                    <div className="debug-info" style={{
                      padding: '10px 16px',
                      backgroundColor: '#fff3cd',
                      color: '#856404',
                      borderTop: '1px solid #ffeaa7',
                      fontSize: '12px',
                      marginTop: '10px'
                    }}>
                      Showing results containing "{query}" (prefix search returned no results)
                    </div>
                  )}
                </>
              )}

              {loading.expand && (
                <div className="global-loading">Loading details...</div>
              )}
            </div>

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
                  Visible: {visibleExpanded.country ? `Country:${visibleExpanded.country}` : '-'}
                  {visibleExpanded.city ? `, City:${visibleExpanded.city}` : ''}
                </small>
              </div>
            </div>
          </div>
        )}
      </div>
    </SearchErrorBoundary>
  );
};

export default Search;
