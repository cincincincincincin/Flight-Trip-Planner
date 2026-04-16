import React, { useState, useRef, useEffect } from 'react';
import type { Flight } from '../types';
import './FlightsFilter.css';
import { useTexts } from '../hooks/useTexts';
import { UI_SYMBOLS } from '../constants/ui';
import { getLocalizedName } from '../utils/i18n';
import { getSingleAirportLabel } from './search/searchUtils';
import { CONFIG } from '../constants/config';
import { useFlightsFilterData } from '../hooks/useFlightsFilterData';
import type { DestAirport, DestCity, DestCountry } from '../hooks/useFlightsFilterData';

interface FlightsFilterProps {
  allFlights: Flight[];
  isOpen: boolean;
  onToggle: () => void;
}

const FlightsFilter: React.FC<FlightsFilterProps> = ({ allFlights, isOpen, onToggle }) => {
  const t = useTexts();
  const [inputFocused, setInputFocused] = useState(false);
  const [expandedCountriesP1, setExpandedCountriesP1] = useState<Set<string>>(new Set());
  const [expandedCitiesP1, setExpandedCitiesP1] = useState<Set<string>>(new Set());
  const [expandedCountriesP2, setExpandedCountriesP2] = useState<Set<string>>(new Set());
  const chipsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Przewijanie poziome za pomocą kółka myszy
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const {
    language,
    destQuery,
    setDestQuery,
    destinationFilter,
    airlineFilter,
    clearFilters,
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
  } = useFlightsFilterData(allFlights);

  const renderAirport = (ap: DestAirport) => {
    const selected = isEffectivelySelected('airport', ap.code, ap.cityCode, ap.countryCode);
    return (
      <div key={ap.code} className={`ff-item ff-airport ${selected ? 'ff-selected' : ''}`}
        onClick={() => selectItem('airport', ap.code, ap.cityCode, ap.countryCode)}>
        <span>{getLocalizedName(ap, language)} <span className="ff-code">({ap.code})</span></span>
        {selected && <span className="ff-check">{UI_SYMBOLS.CHECK}</span>}
      </div>
    );
  };

  const renderCity = (ci: DestCity, expanded: boolean, onCityToggle: () => void, showAirports: boolean) => {
    const selected = isEffectivelySelected('city', ci.code, undefined, ci.countryCode);
    const sortedAirports = [...ci.airports].sort((a, b) => getLocalizedName(a, language).localeCompare(getLocalizedName(b, language)));
    const hasSingleAirport = sortedAirports.length === 1;

    const label = hasSingleAirport
      ? getSingleAirportLabel(getLocalizedName(ci, language), getLocalizedName(sortedAirports[0], language))
      : (getLocalizedName(ci, language) || ci.code);

    return (
      <div key={ci.code} className="ff-city-wrapper">
        <div className={`ff-item ff-city ${selected ? 'ff-selected' : ''}${expanded && showAirports ? ' ff-city--expanded' : ''}${hasSingleAirport ? ' ff-city--single-airport ff-city--coral-line' : ''}`}>
          {!hasSingleAirport && sortedAirports.length > 0 && (
            <button className="ff-expand-btn" onClick={onCityToggle}>{expanded ? UI_SYMBOLS.EXPAND_DOWN : UI_SYMBOLS.EXPAND_RIGHT}</button>
          )}
          <div className="ff-item-left" onClick={() => selectItem('city', ci.code, undefined, ci.countryCode)}>
            <span>{label} {ci.code !== CONFIG.NO_CITY_PLACEHOLDER && <span className="ff-code">({ci.code})</span>}</span>
            {selected && <span className="ff-check">{UI_SYMBOLS.CHECK}</span>}
          </div>
        </div>
        {!hasSingleAirport && expanded && showAirports && (
          <div className="ff-nested">{sortedAirports.map(renderAirport)}</div>
        )}
      </div>
    );
  };

  const renderCountry = (
    country: DestCountry,
    phase: 1 | 2 | 3,
    expandedCities: Set<string>,
    setExpandedCities: (fn: (prev: Set<string>) => Set<string>) => void,
    countryExpanded?: boolean,
    setCountryExpanded?: (fn: (prev: Set<string>) => Set<string>) => void,
  ) => {
    const isCountrySelected = isEffectivelySelected('country', country.code);
    const isCountryExpanded = phase === 1 ? (countryExpanded ?? false) : true;
    const showAirports = phase === 3;

    return (
      <div key={`${phase}-${country.code}`} className="ff-country-wrapper">
        <div className={`ff-item ff-country ${isCountrySelected ? 'ff-selected' : ''}${isCountryExpanded ? ' ff-country--expanded' : ''}`}>
          {phase === 1 && setCountryExpanded && (
            <button className="ff-expand-btn" onClick={() => setCountryExpanded(prev => { const n = new Set(prev); if (n.has(country.code)) n.delete(country.code); else n.add(country.code); return n; })}>
              {isCountryExpanded ? UI_SYMBOLS.EXPAND_DOWN : UI_SYMBOLS.EXPAND_RIGHT}
            </button>
          )}
          <div className="ff-item-left" onClick={() => selectItem('country', country.code)}>
            <span>{getLocalizedName(country, language)} <span className="ff-code">({country.code})</span></span>
            {isCountrySelected && <span className="ff-check">{UI_SYMBOLS.CHECK}</span>}
          </div>
        </div>
        {isCountryExpanded && (
          <div className="ff-cities-list">
            {[...country.cities].filter(c => c.code !== CONFIG.NO_CITY_PLACEHOLDER)
              .sort((a, b) => getLocalizedName(a, language).localeCompare(getLocalizedName(b, language)))
              .map(ci => {
              const isCityExpanded = expandedCities.has(ci.code);
              return renderCity(
                ci,
                isCityExpanded || phase === 3,
                () => setExpandedCities(prev => { const n = new Set(prev); if (n.has(ci.code)) n.delete(ci.code); else n.add(ci.code); return n; }),
                showAirports || isCityExpanded,
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderSection = (title: string, countries: DestCountry[], phase: 1 | 2 | 3) => {
    if (countries.length === 0 && phase !== 1) return null;
    if (countries.length === 0 && phase === 1 && destQuery) return null;
    
    const sortedCountries = [...countries].sort((a, b) => getLocalizedName(a, language).localeCompare(getLocalizedName(b, language)));

    return (
      <div className="ff-section">
        {phase !== 1 && <div className="ff-section-label">{title}</div>}
        {phase === 1 && sortedCountries.map(c => renderCountry(c, 1, expandedCitiesP1, setExpandedCitiesP1, expandedCountriesP1.has(c.code), setExpandedCountriesP1))}
        {phase === 2 && sortedCountries.map(c => renderCountry(c, 2, expandedCountriesP2, setExpandedCountriesP2))}
        {phase === 3 && sortedCountries.map(c => renderCountry(c, 3, new Set(countries.flatMap(co => co.cities.map(ci => ci.code))), () => {}))}
      </div>
    );
  };

  if (allFlights.length === 0) {
    return (
      <div className="flights-filter">
        <button className="ff-toggle-btn" onClick={onToggle}>
          {t.filter.title}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
      </div>
    );
  }

  return (
    <div className="flights-filter">
      <div className={`ff-header${activeFilterCount > 0 ? ' ff-header--has-clear' : ''}`}>
        <button className="ff-toggle-btn" onClick={onToggle}>
          {isOpen ? UI_SYMBOLS.EXPAND_UP : UI_SYMBOLS.EXPAND_DOWN} {t.filter.title}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        {activeFilterCount > 0 && (
          <button className="ff-clear-btn" onClick={clearFilters}>{t.buttons.clear}</button>
        )}
      </div>

      {isOpen && (
        <div className="ff-body">
          {activeFilterCount > 0 && (
            <div className="ff-chips" ref={chipsRef}>
              {destinationFilter.countries.map(code => {
                const country = destData.find(c => c.code === code);
                return <span key={`c-${code}`} className="ff-chip">{country ? getLocalizedName(country, language) : code} <button onClick={() => selectItem('country', code)}>{UI_SYMBOLS.CLOSE}</button></span>;
              })}
              {destinationFilter.cities.map(code => {
                const city = destData.flatMap(c => c.cities).find(ci => ci.code === code);
                return <span key={`ci-${code}`} className="ff-chip">{city ? getLocalizedName(city, language) : code} <button onClick={() => selectItem('city', code, undefined, city?.countryCode)}>{UI_SYMBOLS.CLOSE}</button></span>;
              })}
              {destinationFilter.airports.map(code => {
                const apName = airportNameMap[code] || code;
                const ap = destData.flatMap(c => c.cities).flatMap(ci => ci.airports).find(a => a.code === code);
                return <span key={`a-${code}`} className="ff-chip">{apName} ({code}) <button onClick={() => selectItem('airport', code, ap?.cityCode, ap?.countryCode)}>{UI_SYMBOLS.CLOSE}</button></span>;
              })}
              {airlines.filter(a => a.codes.some(c => airlineFilter.includes(c))).map(a => (
                <span key={`al-${a.name}`} className="ff-chip">{a.name} <button onClick={() => toggleAirline(a.codes)}>{UI_SYMBOLS.CLOSE}</button></span>
              ))}
            </div>
          )}

          <div className="ff-dest-section">
            <div className="ff-section-title">{t.panel.destinations}</div>
            <input
              className="ff-search-input"
              type="text"
              placeholder={t.filter.searchDestinations}
              value={destQuery}
              onChange={e => setDestQuery(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setTimeout(() => setInputFocused(false), 50)}
            />
            {inputFocused && (
              <div className="ff-results" onMouseDown={e => e.preventDefault()}>
                {exactAirport && (
                  <div className="ff-section">
                    <div className="ff-section-label">{t.search.airportCode}</div>
                    {renderAirport(exactAirport)}
                  </div>
                )}
                {renderSection(t.filter.countries, phase1, 1)}
                {destQuery && renderSection(t.filter.cities, phase2, 2)}
                {destQuery && renderSection(t.filter.airports, phase3, 3)}
              </div>
            )}
          </div>

          {airlines.length > 0 && (
            <div className="ff-airline-section">
              <div className="ff-section-title">{t.panel.airlines}</div>
              <div className="ff-airlines">
                {airlines.map(a => (
                  <label key={a.name} className="ff-airline-item">
                    <input type="checkbox" checked={a.codes.some(c => airlineFilter.includes(c))} onChange={() => toggleAirline(a.codes)} />
                    <span>{a.name} <span className="ff-code">({a.codes.join(', ')})</span></span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FlightsFilter;
