import React, { useState, useMemo, useCallback } from 'react';
import type { Flight } from '../types';
import { useFilterStore } from '../stores/filterStore';
import { useAirportsQuery } from '../hooks/queries';
import './FlightsFilter.css';

interface DestAirport { code: string; name: string; cityCode?: string; countryCode?: string; }
interface DestCity { code: string; name: string; countryCode?: string; airports: DestAirport[]; }
interface DestCountry { code: string; name: string; cities: DestCity[]; }

interface FlightsFilterProps {
  allFlights: Flight[];
  isOpen: boolean;
  onToggle: () => void;
}

// Change 2: Full country names using Intl.DisplayNames (module level)
const regionNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }); }
  catch { return null; }
})();
const getCountryName = (code: string): string => regionNames?.of(code) || code;

const FlightsFilter: React.FC<FlightsFilterProps> = ({ allFlights, isOpen, onToggle }) => {
  const { destinationFilter, airlineFilter, setDestinationFilter, setAirlineFilter, clearFilters } = useFilterStore();
  const { data: airportsData } = useAirportsQuery();
  const [destQuery, setDestQuery] = useState('');
  // Change 1: Track input focus state
  const [inputFocused, setInputFocused] = useState(false);
  const [expandedCountriesP1, setExpandedCountriesP1] = useState<Set<string>>(new Set());
  const [expandedCitiesP1, setExpandedCitiesP1] = useState<Set<string>>(new Set());
  const [expandedCountriesP2, setExpandedCountriesP2] = useState<Set<string>>(new Set());

  // Maps from airportsData
  const airportCountryMap = useMemo(() => {
    if (!airportsData) return {};
    const m: Record<string, string> = {};
    airportsData.features.forEach(f => { if (f.properties.code && f.properties.country_code) m[f.properties.code] = f.properties.country_code; });
    return m;
  }, [airportsData]);

  const airportCityMap = useMemo(() => {
    if (!airportsData) return {};
    const m: Record<string, string> = {};
    airportsData.features.forEach(f => { if (f.properties.code && f.properties.city_code) m[f.properties.code] = f.properties.city_code; });
    return m;
  }, [airportsData]);

  // Change 3: Full airport names from airportsData GeoJSON
  const airportNameMap = useMemo(() => {
    if (!airportsData) return {} as Record<string, string>;
    const m: Record<string, string> = {};
    airportsData.features.forEach(f => {
      if (f.properties.code) m[f.properties.code] = f.properties.name || f.properties.code;
    });
    return m;
  }, [airportsData]);

  // Flights scoped to active airline filter (for destination tree)
  const destScopeFlights = useMemo(() => {
    if (airlineFilter.length === 0) return allFlights;
    return allFlights.filter(f => f.airline_code && airlineFilter.includes(f.airline_code));
  }, [allFlights, airlineFilter]);

  // Flights scoped to active destination filter (for airline list)
  const airlineScopeFlights = useMemo(() => {
    const { airports, cities, countries } = destinationFilter;
    if (airports.length === 0 && cities.length === 0 && countries.length === 0) return allFlights;
    return allFlights.filter(f => {
      const aC = f.destination_airport_code;
      if (!aC) return false;
      if (airports.includes(aC)) return true;
      const cityCode = f.destination_city_code || airportCityMap[aC];
      if (cityCode && cities.includes(cityCode)) return true;
      const countryCode = airportCountryMap[aC];
      if (countryCode && countries.includes(countryCode)) return true;
      return false;
    });
  }, [allFlights, destinationFilter, airportCityMap, airportCountryMap]);

  // Build destination hierarchy from flights
  const destData = useMemo<DestCountry[]>(() => {
    const countriesMap = new Map<string, DestCountry>();
    destScopeFlights.forEach(f => {
      const aC = f.destination_airport_code;
      if (!aC) return;
      const cityCode = f.destination_city_code || airportCityMap[aC];
      const countryCode = airportCountryMap[aC];
      if (!countryCode) return;

      if (!countriesMap.has(countryCode)) {
        // Change 2: Use getCountryName for full country name
        countriesMap.set(countryCode, { code: countryCode, name: getCountryName(countryCode), cities: [] });
      }
      const country = countriesMap.get(countryCode)!;
      let city = country.cities.find(c => c.code === cityCode);
      if (!city && cityCode) {
        city = { code: cityCode, name: f.destination_city_name || cityCode, countryCode, airports: [] };
        country.cities.push(city);
      }
      // Change 3: Use airportNameMap for full airport name
      const ap: DestAirport = { code: aC, name: airportNameMap[aC] || aC, cityCode, countryCode };
      if (city && !city.airports.some(a => a.code === aC)) city.airports.push(ap);
      else if (!city) {
        // airport without city
        let noCityEntry = country.cities.find(c => c.code === '__nocity__');
        if (!noCityEntry) {
          noCityEntry = { code: '__nocity__', name: '', countryCode, airports: [] };
          country.cities.push(noCityEntry);
        }
        if (!noCityEntry.airports.some(a => a.code === aC)) noCityEntry.airports.push(ap);
      }
    });

    return Array.from(countriesMap.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [destScopeFlights, airportCityMap, airportCountryMap, airportNameMap]);

  // Airlines from flights scoped to active destination filter
  const airlines = useMemo(() => {
    const m = new Map<string, { code: string; name: string }>();
    airlineScopeFlights.forEach(f => {
      if (f.airline_code && !m.has(f.airline_code)) {
        m.set(f.airline_code, { code: f.airline_code, name: f.airline_name || f.airline_code });
      }
    });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  }, [airlineScopeFlights]);

  const q = destQuery.toLowerCase().trim();

  // Phase 1: countries matching query
  const phase1 = useMemo<DestCountry[]>(() => {
    if (!q) return destData; // all countries when empty
    return destData.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [destData, q]);

  // Phase 2: countries containing matching cities
  const phase2 = useMemo<DestCountry[]>(() => {
    if (!q) return [];
    return destData
      .map(c => ({ ...c, cities: c.cities.filter(ci => ci.name.toLowerCase().includes(q) || ci.code.toLowerCase().includes(q)) }))
      .filter(c => c.cities.length > 0 && !phase1.some(p1 => p1.code === c.code));
  }, [destData, q, phase1]);

  // Phase 3: countries containing cities with matching airports
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

  // Exact airport code match for 3-letter queries
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

  // Count active filters
  const activeFilterCount = destinationFilter.airports.length + destinationFilter.cities.length +
    destinationFilter.countries.length + airlineFilter.length;

  // Change 4: Smart selection with isEffectivelySelected and selectItem

  const isEffectivelySelected = useCallback((type: 'airport' | 'city' | 'country', code: string, cityCode?: string, countryCode?: string): boolean => {
    if (type === 'country') return destinationFilter.countries.includes(code);
    if (type === 'city') return destinationFilter.cities.includes(code) || (!!countryCode && destinationFilter.countries.includes(countryCode));
    // airport
    return destinationFilter.airports.includes(code) ||
      (!!cityCode && destinationFilter.cities.includes(cityCode)) ||
      (!!countryCode && destinationFilter.countries.includes(countryCode));
  }, [destinationFilter]);

  const selectItem = useCallback((type: 'airport' | 'city' | 'country', code: string, cityCode?: string, countryCode?: string) => {
    const selected = isEffectivelySelected(type, code, cityCode, countryCode);
    const { airports, cities, countries } = destinationFilter;

    if (selected) {
      // DESELECT
      if (type === 'country') {
        setDestinationFilter({ airports, cities, countries: countries.filter(c => c !== code) });
      } else if (type === 'city') {
        if (cities.includes(code)) {
          setDestinationFilter({ airports, cities: cities.filter(c => c !== code), countries });
        } else if (countryCode && countries.includes(countryCode)) {
          // Country was selected: split into all other cities
          const country = destData.find(c => c.code === countryCode);
          const otherCities = (country?.cities || []).filter(ci => ci.code !== code && ci.code !== '__nocity__').map(ci => ci.code);
          setDestinationFilter({ airports, cities: [...cities, ...otherCities.filter(c => !cities.includes(c))], countries: countries.filter(c => c !== countryCode) });
        }
      } else {
        // airport
        if (airports.includes(code)) {
          setDestinationFilter({ airports: airports.filter(a => a !== code), cities, countries });
        } else if (cityCode && cities.includes(cityCode)) {
          // City was selected: split into other airports
          const city = destData.flatMap(c => c.cities).find(ci => ci.code === cityCode);
          const otherAirports = (city?.airports || []).filter(a => a.code !== code).map(a => a.code);
          setDestinationFilter({ airports: [...airports, ...otherAirports.filter(a => !airports.includes(a))], cities: cities.filter(c => c !== cityCode), countries });
        } else if (countryCode && countries.includes(countryCode)) {
          // Country selected: split into cities except the parent, handle airport
          const country = destData.find(c => c.code === countryCode);
          const otherCities = (country?.cities || []).filter(ci => ci.code !== cityCode && ci.code !== '__nocity__').map(ci => ci.code);
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
      // SELECT
      if (type === 'country') {
        // Remove all cities/airports of this country
        const country = destData.find(c => c.code === code);
        const cityCodes = new Set((country?.cities || []).map(ci => ci.code));
        const airportCodes = new Set((country?.cities || []).flatMap(ci => ci.airports.map(a => a.code)));
        setDestinationFilter({
          countries: [...countries, code],
          cities: cities.filter(c => !cityCodes.has(c)),
          airports: airports.filter(a => !airportCodes.has(a)),
        });
      } else if (type === 'city') {
        // Remove airports of this city from explicit selection
        const city = destData.flatMap(c => c.cities).find(ci => ci.code === code);
        const airportCodes = new Set((city?.airports || []).map(a => a.code));
        const newCities = [...cities, code];
        const newAirports = airports.filter(a => !airportCodes.has(a));
        // Check auto-upgrade to country
        if (countryCode) {
          const country = destData.find(c => c.code === countryCode);
          const validCities = (country?.cities || []).filter(ci => ci.code !== '__nocity__');
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
        // airport
        const newAirports = [...airports, code];
        // Check auto-upgrade to city
        if (cityCode) {
          const city = destData.flatMap(c => c.cities).find(ci => ci.code === cityCode);
          if (city && city.airports.length > 0 && city.airports.every(a => newAirports.includes(a.code))) {
            const cityAirportCodes = new Set(city.airports.map(a => a.code));
            const newCities = [...cities, cityCode];
            const aps = newAirports.filter(a => !cityAirportCodes.has(a));
            // Check auto-upgrade to country
            if (countryCode) {
              const country = destData.find(c => c.code === countryCode);
              const validCities = (country?.cities || []).filter(ci => ci.code !== '__nocity__');
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

  const toggleAirline = useCallback((code: string) => {
    setAirlineFilter(airlineFilter.includes(code) ? airlineFilter.filter(c => c !== code) : [...airlineFilter, code]);
  }, [airlineFilter, setAirlineFilter]);

  // Change 5: renderAirport, renderCity, renderCountry use selectItem and isEffectivelySelected
  const renderAirport = (ap: DestAirport) => {
    const selected = isEffectivelySelected('airport', ap.code, ap.cityCode, ap.countryCode);
    return (
      <div key={ap.code} className={`ff-item ff-airport ${selected ? 'ff-selected' : ''}`}
        onClick={() => selectItem('airport', ap.code, ap.cityCode, ap.countryCode)}>
        <span>{ap.name} <span className="ff-code">({ap.code})</span></span>
        {selected && <span className="ff-check">✓</span>}
      </div>
    );
  };

  const renderCity = (ci: DestCity, expanded: boolean, onCityToggle: () => void, showAirports: boolean) => {
    const selected = isEffectivelySelected('city', ci.code, undefined, ci.countryCode);
    return (
      <div key={ci.code} className="ff-city-wrapper">
        <div className={`ff-item ff-city ${selected ? 'ff-selected' : ''}`}>
          {ci.airports.length > 0 && (
            <button className="ff-expand-btn" onClick={onCityToggle}>{expanded ? '▼' : '▶'}</button>
          )}
          <div className="ff-item-left" onClick={() => selectItem('city', ci.code, undefined, ci.countryCode)}>
            <span>{ci.name || ci.code} {ci.code !== '__nocity__' && <span className="ff-code">({ci.code})</span>}</span>
            {selected && <span className="ff-check">✓</span>}
          </div>
        </div>
        {expanded && showAirports && (
          <div className="ff-nested">{ci.airports.map(renderAirport)}</div>
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
        <div className={`ff-item ff-country ${isCountrySelected ? 'ff-selected' : ''}`}>
          {phase === 1 && setCountryExpanded && (
            <button className="ff-expand-btn" onClick={() => setCountryExpanded(prev => { const n = new Set(prev); if (n.has(country.code)) n.delete(country.code); else n.add(country.code); return n; })}>
              {isCountryExpanded ? '▼' : '▶'}
            </button>
          )}
          <div className="ff-item-left" onClick={() => selectItem('country', country.code)}>
            <span>{country.name} <span className="ff-code">({country.code})</span></span>
            {isCountrySelected && <span className="ff-check">✓</span>}
          </div>
        </div>
        {isCountryExpanded && country.cities.filter(c => c.code !== '__nocity__').map(ci => {
          const isCityExpanded = expandedCities.has(ci.code);
          return renderCity(
            ci,
            isCityExpanded || phase === 3,
            () => setExpandedCities(prev => { const n = new Set(prev); if (n.has(ci.code)) n.delete(ci.code); else n.add(ci.code); return n; }),
            showAirports || isCityExpanded,
          );
        })}
      </div>
    );
  };

  const renderSection = (title: string, countries: DestCountry[], phase: 1 | 2 | 3) => {
    if (countries.length === 0 && phase !== 1) return null;
    if (countries.length === 0 && phase === 1 && q) return null;
    return (
      <div className="ff-section">
        <div className="ff-section-label">{title}</div>
        {phase === 1 && countries.map(c => renderCountry(c, 1, expandedCitiesP1, setExpandedCitiesP1, expandedCountriesP1.has(c.code), setExpandedCountriesP1))}
        {phase === 2 && countries.map(c => renderCountry(c, 2, expandedCountriesP2, setExpandedCountriesP2))}
        {phase === 3 && countries.map(c => renderCountry(c, 3, new Set(countries.flatMap(co => co.cities.map(ci => ci.code))), () => {}))}
      </div>
    );
  };

  if (allFlights.length === 0) {
    return (
      <div className="flights-filter">
        <button className="ff-toggle-btn" onClick={onToggle}>
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
      </div>
    );
  }

  return (
    <div className="flights-filter">
      <div className="ff-header">
        <button className="ff-toggle-btn" onClick={onToggle}>
          {isOpen ? '▲' : '▼'} Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        {activeFilterCount > 0 && (
          <button className="ff-clear-btn" onClick={clearFilters}>Clear</button>
        )}
      </div>

      {isOpen && (
        <div className="ff-body">
          {/* Selected chips */}
          {activeFilterCount > 0 && (
            <div className="ff-chips">
              {/* Change 6: Show full names in chips */}
              {destinationFilter.countries.map(code => {
                const country = destData.find(c => c.code === code);
                return <span key={`c-${code}`} className="ff-chip">{country?.name || code} <button onClick={() => selectItem('country', code)}>×</button></span>;
              })}
              {destinationFilter.cities.map(code => {
                const city = destData.flatMap(c => c.cities).find(ci => ci.code === code);
                return <span key={`ci-${code}`} className="ff-chip">{city?.name || code} <button onClick={() => selectItem('city', code, undefined, city?.countryCode)}>×</button></span>;
              })}
              {destinationFilter.airports.map(code => {
                const apName = airportNameMap[code] || code;
                const ap = destData.flatMap(c => c.cities).flatMap(ci => ci.airports).find(a => a.code === code);
                return <span key={`a-${code}`} className="ff-chip">{apName} ({code}) <button onClick={() => selectItem('airport', code, ap?.cityCode, ap?.countryCode)}>×</button></span>;
              })}
              {airlineFilter.map(code => {
                const a = airlines.find(al => al.code === code);
                return <span key={`al-${code}`} className="ff-chip">{a?.name || code} <button onClick={() => toggleAirline(code)}>×</button></span>;
              })}
            </div>
          )}

          {/* Destination search */}
          <div className="ff-dest-section">
            <div className="ff-section-title">Destinations</div>
            {/* Change 1 & 7: onFocus/onBlur on input, results only shown when focused or query non-empty */}
            <input
              className="ff-search-input"
              type="text"
              placeholder="Search destinations..."
              value={destQuery}
              onChange={e => setDestQuery(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setTimeout(() => setInputFocused(false), 200)}
            />
            {(inputFocused || destQuery.length > 0) && (
              <div className="ff-results" onMouseDown={e => e.preventDefault()}>
                {/* Exact airport code */}
                {exactAirport && (
                  <div className="ff-section">
                    <div className="ff-section-label">Airport code</div>
                    {renderAirport(exactAirport)}
                  </div>
                )}
                {renderSection('Countries', phase1, 1)}
                {q && renderSection('Cities', phase2, 2)}
                {q && renderSection('Airports', phase3, 3)}
              </div>
            )}
          </div>

          {/* Airline filter */}
          {airlines.length > 0 && (
            <div className="ff-airline-section">
              <div className="ff-section-title">Airlines</div>
              <div className="ff-airlines">
                {airlines.map(a => (
                  <label key={a.code} className="ff-airline-item">
                    <input type="checkbox" checked={airlineFilter.includes(a.code)} onChange={() => toggleAirline(a.code)} />
                    <span>{a.name} <span className="ff-code">({a.code})</span></span>
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
