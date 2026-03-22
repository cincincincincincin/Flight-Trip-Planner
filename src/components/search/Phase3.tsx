import { UI_SYMBOLS } from '../../constants/ui';
import { TEXTS } from '../../constants/text';
import React, { useState, useCallback, useEffect } from 'react';
import type { Country, City, Airport } from '../../types';
import { highlightText } from './searchUtils';

interface PhaseCacheEntry {
  cities: City[];
  fetchedAt: number;
}

interface Phase3Props {
  country: Country;
  phase3Cache: Record<string, PhaseCacheEntry>;
  onItemClick: (item: Country | City | Airport) => void;
  query: string;
  searchMode: 'prefix' | 'contains';
}

const Phase3 = React.memo(({
  country,
  phase3Cache,
  onItemClick,
  query,
  searchMode
}: Phase3Props) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedCities, setExpandedCities] = useState(new Set<string>());

  const cachedCountryData = phase3Cache[country.code];
  const cities = cachedCountryData?.cities || country.cities || [];

  useEffect(() => {
    if (cities.length > 0) {
      setExpandedCities(prev => {
        const newSet = new Set(prev);
        cities.forEach((city: City) => {
          newSet.add(city.code);
        });
        return newSet;
      });
    }
  }, [cities]);

  const handleToggleCountry = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsExpanded(prev => !prev);
  }, []);

  const handleToggleCity = useCallback((cityCode: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpandedCities(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cityCode)) {
        newSet.delete(cityCode);
      } else {
        newSet.add(cityCode);
      }
      return newSet;
    });
  }, []);

  const handleItemClick = useCallback((item: Country | City | Airport) => {
    onItemClick(item);
  }, [onItemClick]);

  return (
    <div className="search-item country-item">
      {cities.length > 0 && (
        <button
          className="expand-button"
          onClick={handleToggleCountry}
          title={isExpanded ? TEXTS.search.collapse : TEXTS.search.expand}
        >
          {isExpanded ? UI_SYMBOLS.EXPAND_DOWN : UI_SYMBOLS.EXPAND_RIGHT}
        </button>
      )}

      <div
        className="item-main"
        onClick={() => handleItemClick(country)}
      >
        <span className="item-name">{country.name}</span>
      </div>
      <span className="item-code">({country.code})</span>

      {isExpanded && cities.length > 0 && (
        <div className="nested-list">
          <div
            className="visibility-marker"
            data-country-code={country.code}
            style={{ height: '1px', width: '1px', position: 'absolute', top: '0', left: '0', opacity: '0' }}
          />

          {cities.map((city: City) => {
            const isCityExpanded = expandedCities.has(city.code);
            const airports = city.airports || [];

            return (
              <div key={`phase3-city-${city.code}`} className="city-item-wrapper">
                <div className="search-item city-item">
                  {airports.length > 0 && (
                    <button
                      className="expand-button"
                      onClick={(e) => handleToggleCity(city.code, e)}
                      title={isCityExpanded ? TEXTS.search.collapse : TEXTS.search.expand}
                    >
                      {isCityExpanded ? UI_SYMBOLS.EXPAND_DOWN : UI_SYMBOLS.EXPAND_RIGHT}
                    </button>
                  )}
                  <div
                    className="item-main"
                    onClick={() => handleItemClick(city)}
                  >
                    <span className="item-name">{city.name}</span>
                    {city.has_flightable_airport && <span className="item-badge"></span>}
                  </div>
                  <span className="item-code">({city.code})</span>
                </div>

                {isCityExpanded && airports.length > 0 && (
                  <div className="nested-list">
                    <div
                      className="visibility-marker"
                      data-city-code={city.code}
                      style={{ height: '1px', width: '1px', position: 'absolute', top: '0', left: '0', opacity: '0' }}
                    />
                    {airports.map((airport: Airport) => (
                      <div
                        key={`phase3-airport-${airport.code}`}
                        className="search-item airport-item"
                        onClick={() => handleItemClick(airport)}
                      >
                        <div className="item-main">
                          <span className="item-name">
                            {highlightText(airport.name, query, searchMode)}
                          </span>
                          {airport.flightable && <span className="item-badge"></span>}
                        </div>
                        <span className="item-code">({airport.code})</span>
                      </div>
                    ))}
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
    prevProps.phase3Cache?.[nextProps.country.code] === nextProps.phase3Cache?.[nextProps.country.code] &&
    prevProps.query === nextProps.query &&
    prevProps.searchMode === nextProps.searchMode
  );
});

export default Phase3;
