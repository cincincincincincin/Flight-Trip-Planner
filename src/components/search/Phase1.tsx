import React, { useState, useCallback } from 'react';
import type { Country, City, Airport } from '../../types';
import { highlightText } from './searchUtils';

interface CountryCacheEntry {
  cities: City[];
  pagination?: { offset: number; hasMore: boolean; total?: number };
  fetchedAt: number;
}

interface CityCacheEntry {
  airports: Airport[];
  fetchedAt: number;
}

interface Phase1Props {
  country: Country;
  countriesCache: Record<string, CountryCacheEntry>;
  citiesCache: Record<string, CityCacheEntry>;
  loadingExpand: boolean;
  onItemClick: (item: Country | City | Airport) => void;
  onExpandCountry: (code: string, name: string) => void;
  onExpandCity: (cityCode: string, cityName: string, countryCode: string) => void;
  query: string;
  searchMode: 'prefix' | 'contains';
}

const Phase1 = React.memo(({
  country,
  countriesCache,
  citiesCache,
  loadingExpand,
  onItemClick,
  onExpandCountry,
  onExpandCity,
  query,
  searchMode
}: Phase1Props) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedCities, setExpandedCities] = useState(new Set<string>());

  const countryCache = countriesCache?.[country.code];
  const cachedCities = countryCache?.cities || [];
  const citiesPagination = countryCache?.pagination;

  const handleToggleCountry = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    if (newExpanded && !countryCache) {
      onExpandCountry(country.code, country.name);
    }
  }, [isExpanded, countryCache, country.code, country.name, onExpandCountry]);

  const handleToggleCity = useCallback((cityCode: string, cityName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpandedCities(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cityCode)) {
        newSet.delete(cityCode);
      } else {
        newSet.add(cityCode);
        if (!citiesCache[cityCode]) {
          onExpandCity(cityCode, cityName, country.code);
        }
      }
      return newSet;
    });
  }, [citiesCache, country.code, onExpandCity]);

  const handleItemClick = useCallback((item: Country | City | Airport) => {
    onItemClick(item);
  }, [onItemClick]);

  const renderCity = useCallback((city: City) => {
    const isCityExpanded = expandedCities.has(city.code);
    const cachedAirports = citiesCache[city.code]?.airports;

    return (
      <div key={`phase1-city-${city.code}`} className="city-item-wrapper">
        <div className="search-item city-item">
          <div
            className="item-main"
            onClick={() => handleItemClick(city)}
          >
            <span className="item-icon"></span>
            <span className="item-name">{city.name}</span>
            <span className="item-code">({city.code})</span>
            {city.has_flightable_airport && <span className="item-badge"></span>}
          </div>

          <button
            className="expand-button"
            onClick={(e) => handleToggleCity(city.code, city.name, e)}
            title={isCityExpanded ? "Collapse" : "Expand to show airports"}
            style={{
              visibility: city.has_flightable_airport || cachedAirports ? 'visible' : 'hidden',
              opacity: city.has_flightable_airport || cachedAirports ? 1 : 0.5
            }}
          >
            {isCityExpanded ? '▼' : '▶'}
          </button>
        </div>

        {isCityExpanded && cachedAirports && (
          <div className="nested-list">
            <div
              className="visibility-marker"
              data-city-code={city.code}
              style={{ height: '1px', width: '1px', position: 'absolute', top: '0', left: '0', opacity: '0' }}
            />
            {cachedAirports.length > 0 ? (
              <>
                {cachedAirports.map(airport => (
                  <div
                    key={`phase1-airport-${airport.code}`}
                    className="search-item airport-item"
                    onClick={() => handleItemClick(airport)}
                  >
                    <div className="item-main">
                      <span className="item-icon"></span>
                      <span className="item-name">{airport.name}</span>
                      <span className="item-code">({airport.code})</span>
                      {airport.flightable && <span className="item-badge"></span>}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="no-items">No airports available for {city.name}</div>
            )}
          </div>
        )}

        {isCityExpanded && !cachedAirports && loadingExpand && (
          <div className="nested-list">
            <div className="no-items">Loading airports for {city.name}...</div>
          </div>
        )}
      </div>
    );
  }, [expandedCities, citiesCache, loadingExpand, handleItemClick, handleToggleCity]);

  return (
    <div className="search-item country-item">
      <div
        className="item-main"
        onClick={() => handleItemClick(country)}
      >
        <span className="item-icon"></span>
        <span className="item-name">
          {highlightText(country.name, query, searchMode)}
        </span>
        <span className="item-code">({country.code})</span>
      </div>

      <button
        className="expand-button"
        onClick={handleToggleCountry}
        title={isExpanded ? "Collapse" : "Expand to show cities"}
      >
        {isExpanded ? '▼' : '▶'}
      </button>

      {isExpanded && (
        <div className="nested-list">
          <div
            className="visibility-marker"
            data-country-code={country.code}
            style={{ height: '1px', width: '1px', position: 'absolute', top: '0', left: '0', opacity: '0' }}
          />

          {!countryCache ? (
            loadingExpand ? (
              <div className="no-items">Loading cities for {country.name}...</div>
            ) : (
              <div className="no-items">Click expand to load cities for {country.name}</div>
            )
          ) : cachedCities.length === 0 ? (
            <div className="no-items">No cities available</div>
          ) : (
            <>
              <div className="debug-info" style={{ display: 'none' }}>
                Showing {cachedCities.length} cities for {country.name}
                {citiesPagination?.total ? ` (${citiesPagination.total} total)` : ''}
                {citiesPagination?.hasMore ?
                  ` - scroll for more` :
                  ' - all cities loaded'}
              </div>
              {cachedCities.map(renderCity)}

              {citiesPagination?.hasMore && (
                <div
                  id={`cities-trigger-${country.code}`}
                  className="cities-load-more-trigger"
                  data-country-code={country.code}
                  style={{
                    height: '1px',
                    marginTop: '10px',
                    position: 'relative',
                    top: '-50px'
                  }}
                >
                  <div style={{
                    height: '50px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#666',
                    fontSize: '12px'
                  }}>
                    Scroll for more cities
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.countriesCache?.[nextProps.country.code] === nextProps.countriesCache?.[nextProps.country.code] &&
    prevProps.loadingExpand === nextProps.loadingExpand &&
    prevProps.citiesCache === nextProps.citiesCache &&
    prevProps.query === nextProps.query &&
    prevProps.searchMode === nextProps.searchMode
  );
});

export default Phase1;
