import { UI_SYMBOLS } from '../../constants/ui';
import React, { useState, useCallback } from 'react';
import type { Country, City, Airport } from '../../types';
import { highlightText } from './searchUtils';
import { useTexts } from '../../hooks/useTexts';
import { getLocalizedName } from '../../utils/i18n';
import { useSettingsStore } from '../../stores/settingsStore';

interface CityCacheEntry {
  airports: Airport[];
  fetchedAt: number;
}

interface PhaseCacheEntry {
  cities: City[];
  fetchedAt: number;
}

interface Phase2Props {
  country: Country;
  phase2Cache: Record<string, PhaseCacheEntry>;
  citiesCache: Record<string, CityCacheEntry>;
  loadingExpand: boolean;
  onItemClick: (item: Country | City | Airport) => void;
  onExpandCity: (cityCode: string, cityName: string, countryCode: string) => void;
  query: string;
  searchMode: 'prefix' | 'contains';
}

const Phase2 = React.memo(({
  country,
  phase2Cache,
  citiesCache,
  loadingExpand,
  onItemClick,
  onExpandCity,
  query,
  searchMode
}: Phase2Props) => {
  const t = useTexts();
  const language = useSettingsStore(s => s.language);
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedCities, setExpandedCities] = useState(new Set<string>());

  const cachedCountryData = phase2Cache[country.code];
  const cities = cachedCountryData?.cities || country.cities || [];

  const handleToggleCountry = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsExpanded(prev => !prev);
  }, []);

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

  return (
    <div className="country-wrapper" data-country-code={country.code}>
      <div className={`search-item country-item${isExpanded ? ' country-item--expanded' : ''}`}>
        {cities.length > 0 && (
          <button
            className="expand-button"
            onClick={handleToggleCountry}
            title={isExpanded ? t.search.collapse : t.search.expand}
          >
            {isExpanded ? UI_SYMBOLS.EXPAND_DOWN : UI_SYMBOLS.EXPAND_RIGHT}
          </button>
        )}

        <div
          className="item-main"
          onClick={() => handleItemClick(country)}
        >
          <span className="item-name">{getLocalizedName(country, language)}</span>
        </div>
        <span className="item-code">({country.code})</span>
      </div>

      {isExpanded && cities.length > 0 && (
        <div className="nested-list">

          {cities.map((city: City) => {
            const isCityExpanded = expandedCities.has(city.code);
            const cachedAirports = citiesCache[city.code]?.airports;

            return (
              <div key={`phase2-city-${city.code}`} className="city-item-wrapper" data-city-code={city.code}>
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
                    <span className="item-name">
                      {highlightText(getLocalizedName(city, language), query, searchMode)}
                    </span>
                    <span className="item-badge"></span>
                  </div>
                  <span className="item-code">({city.code})</span>
                </div>

                {isCityExpanded && cachedAirports && cachedAirports.length > 0 && (
                  <div className="nested-list">
                    {cachedAirports.map((airport: Airport) => (
                      <div
                        key={`phase2-airport-${airport.code}`}
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
                  </div>
                )}

                {isCityExpanded && !cachedAirports && loadingExpand && (
                  <div className="nested-list">
                    <div className="no-items">{t.search.loadingAirportsForCity(city.name)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.phase2Cache?.[nextProps.country.code] === nextProps.phase2Cache?.[nextProps.country.code] &&
    prevProps.loadingExpand === nextProps.loadingExpand &&
    prevProps.citiesCache === nextProps.citiesCache &&
    prevProps.query === nextProps.query &&
    prevProps.searchMode === nextProps.searchMode
  );
});

export default Phase2;
