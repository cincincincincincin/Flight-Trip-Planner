import { UI_SYMBOLS } from '../../constants/ui';
import React, { useState, useCallback } from 'react';
import type { Country, City, Airport } from '../../types';
import { highlightText } from './searchUtils';
import { useTexts } from '../../hooks/useTexts';
import { getLocalizedName } from '../../utils/i18n';
import { useSettingsStore } from '../../stores/settingsStore';

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
  const t = useTexts();
  const language = useSettingsStore(s => s.language);
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
      <div key={`phase1-city-${city.code}`} className="city-item-wrapper" data-city-code={city.code}>
        <div className={`search-item city-item${isCityExpanded ? ' city-item--expanded' : ''}`}>
          {(
            <button
              className="expand-button"
              onClick={(e) => handleToggleCity(city.code, city.name, e)}
              title={isCityExpanded ? t.search.collapse : t.search.expandToShowAirports}
            >
              {isCityExpanded ? UI_SYMBOLS.EXPAND_DOWN : UI_SYMBOLS.EXPAND_RIGHT}
            </button>
          )}
          <div
            className="item-main"
            onClick={() => handleItemClick(city)}
          >
            <span className="item-name">{getLocalizedName(city, language)}</span>
            <span className="item-badge"></span>
          </div>
          <span className="item-code">({city.code})</span>
        </div>

        {isCityExpanded && cachedAirports && (
          <div className="nested-list">
            {cachedAirports.length > 0 ? (
              <>
                {cachedAirports.map(airport => (
                  <div
                    key={`phase1-airport-${airport.code}`}
                    className="search-item airport-item"
                    onClick={() => handleItemClick(airport)}
                  >
                    <div className="item-main">
                      <span className="item-name">{getLocalizedName(airport, language)}</span>
                      <span className="item-badge"></span>
                    </div>
                    <span className="item-code">({airport.code})</span>
                  </div>
                ))}
              </>
            ) : (
              <div className="no-items">{t.search.noAirportsForCity(city.name)}</div>
            )}
          </div>
        )}

        {isCityExpanded && !cachedAirports && loadingExpand && (
          <div className="nested-list">
            <div className="no-items">{t.search.loadingAirportsForCity(city.name)}</div>
          </div>
        )}
      </div>
    );
  }, [expandedCities, citiesCache, loadingExpand, handleItemClick, handleToggleCity, language]);

  return (
    <div className="country-wrapper" data-country-code={country.code}>
      <div className={`search-item country-item${isExpanded ? ' country-item--expanded' : ''}`}>
        <button
          className="expand-button"
          onClick={handleToggleCountry}
          title={isExpanded ? t.search.collapse : t.search.expandToShowCities}
        >
          {isExpanded ? UI_SYMBOLS.EXPAND_DOWN : UI_SYMBOLS.EXPAND_RIGHT}
        </button>

        <div
          className="item-main"
          onClick={() => handleItemClick(country)}
        >
          <span className="item-name">
            {highlightText(getLocalizedName(country, language), query, searchMode)}
          </span>
        </div>
        <span className="item-code">({country.code})</span>
      </div>

      {isExpanded && (
        <div className="nested-list">

          {!countryCache ? (
            loadingExpand ? (
              <div className="no-items">{t.search.loadingCitiesForCountry(country.name)}</div>
            ) : (
              <div className="no-items">{t.search.clickExpandCities(country.name)}</div>
            )
          ) : cachedCities.length === 0 ? (
            <div className="no-items">{t.search.noCities}</div>
          ) : (
            <>
              {cachedCities.map(renderCity)}

              {citiesPagination?.hasMore && (
                <div
                  id={`cities-trigger-${country.code}`}
                  className="cities-load-more-trigger"
                  data-country-code={country.code}
                  style={{ height: '1px', marginTop: '10px', position: 'relative', top: '-50px' }}
                >
                  <div style={{
                    height: '50px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '12px'
                  }}>{t.search.scrollMore}</div>
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
