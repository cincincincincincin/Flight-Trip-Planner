import React from 'react';
import { UI_SYMBOLS } from '../../constants/ui';
import { useTexts } from '../../hooks/useTexts';
import { getSingleAirportLabel } from '../search/searchUtils';

export interface ExplorationDisplayItem {
  kind: 'airport' | 'city-group' | 'country-group';
  itemId?: string;
  code: string;
  name: string;
  airportCodes: string[];
  cityCode?: string;
  countryCode?: string;
  isExpanded?: boolean;
  childCities?: Array<{
    cityCode: string;
    cityName: string;
    airports: Array<{ id: string; code: string; name: string }>;
  }>;
  missingAirports?: Array<{ code: string; name: string }>;
}

interface ExplorationListProps {
  items: ExplorationDisplayItem[];
  expandedCityGroups: Set<string>;
  setExpandedCityGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  expandedInnerCities: Set<string>;
  setExpandedInnerCities: React.Dispatch<React.SetStateAction<Set<string>>>;
  getAltTimeDisplay: (code: string) => string | null;
  onSwitchTimezone: (code: string) => void;
  onRemoveItem: (id: string) => void;
  onRemoveCodes: (codes: string[]) => void;
  onAddMissingAirport: (ap: { code: string; name: string }) => void;
}

const ExplorationList = ({
  items,
  expandedCityGroups,
  setExpandedCityGroups,
  expandedInnerCities,
  setExpandedInnerCities,
  getAltTimeDisplay,
  onSwitchTimezone,
  onRemoveItem,
  onRemoveCodes,
  onAddMissingAirport,
}: ExplorationListProps) => {
  const t = useTexts();

  return (
    <div className="exploration-list">
      {items.map((item, idx) => {
        if (item.kind === 'airport') {
          const altTime = getAltTimeDisplay(item.code);
          return (
            <div key={item.itemId || idx} className="exploration-item">
              <span className="exploration-icon"></span>
              <span className="exploration-name">{item.name}</span>
              <span className="exploration-code">({item.code})</span>
              {altTime && (
                <button className="exploration-tz-btn" title={t.panel.switchTimezone}
                  onClick={() => onSwitchTimezone(item.code)}>{altTime}</button>
              )}
              <button className="exploration-remove-btn"
                onClick={() => item.itemId && onRemoveItem(item.itemId)}>{UI_SYMBOLS.CLOSE}</button>
            </div>
          );
        }

        if (item.kind === 'city-group') {
          const isPartial = (item.missingAirports?.length ?? 0) > 0;
          const altTime = item.airportCodes[0] ? getAltTimeDisplay(item.airportCodes[0]) : null;

          if (isPartial) {
            const total = item.airportCodes.length + (item.missingAirports?.length ?? 0);
            return (
              <div key={item.code} className="exploration-group">
                <div className="exploration-item exploration-item--group">
                  <span className="exploration-icon"></span>
                  <span className="exploration-name">{item.name}</span>
                  <span className="exploration-count">{item.airportCodes.length}/{total}ap</span>
                </div>
                {item.childCities?.[0].airports.map(ap => (
                  <div key={ap.code} className="exploration-item exploration-item--child">
                    <span className="exploration-icon"></span>
                    <span className="exploration-name">{ap.name}</span>
                    <span className="exploration-code">({ap.code})</span>
                  </div>
                ))}
                {item.missingAirports?.map(ap => (
                  <div key={ap.code} className="exploration-item exploration-item--child exploration-item--missing">
                    <span className="exploration-icon"></span>
                    <span className="exploration-name">{ap.name}</span>
                    <span className="exploration-code">({ap.code})</span>
                    <button className="exploration-add-btn" onClick={() => onAddMissingAirport(ap)}>+</button>
                  </div>
                ))}
              </div>
            );
          }

          const hasSingleAirport = item.airportCodes.length === 1 && item.childCities?.[0]?.airports?.length === 1;
          const isExpanded = hasSingleAirport ? false : expandedCityGroups.has(item.code);
          const label = hasSingleAirport 
            ? getSingleAirportLabel(item.name, item.childCities![0].airports[0].name)
            : item.name;

          return (
            <div key={item.code} className="exploration-group">
              <div className={`exploration-item exploration-item--group ${hasSingleAirport ? 'exploration-item--single-airport' : ''}`}>
                {!hasSingleAirport && (
                  <button className="exploration-expand-btn" onClick={() => setExpandedCityGroups(prev => {
                    const s = new Set(prev);
                    if (s.has(item.code)) s.delete(item.code); else s.add(item.code);
                    return s;
                  })}>{expandedCityGroups.has(item.code) ? '▾' : '▸'}</button>
                )}
                <span className="exploration-icon"></span>
                <span className="exploration-name">{label}</span>
                {!hasSingleAirport && <span className="exploration-count">{item.airportCodes.length}{t.panel.airportAbbreviation}</span>}
                {hasSingleAirport && <span className="exploration-code">({item.airportCodes[0]})</span>}
                {altTime && (
                  <button className="exploration-tz-btn"
                    onClick={() => onSwitchTimezone(item.airportCodes[0])}>{altTime}</button>
                )}
                <button className="exploration-remove-btn"
                  onClick={() => onRemoveCodes(item.airportCodes)}>{UI_SYMBOLS.CLOSE}</button>
              </div>
              {isExpanded && !hasSingleAirport && item.childCities?.map(city =>
                city.airports.map(ap => (
                  <div key={ap.code} className="exploration-item exploration-item--child">
                    <span className="exploration-icon"></span>
                    <span className="exploration-name">{ap.name}</span>
                    <span className="exploration-code">({ap.code})</span>
                    <button className="exploration-remove-btn"
                      onClick={() => onRemoveItem(ap.id)}>{UI_SYMBOLS.CLOSE}</button>
                  </div>
                ))
              )}
            </div>
          );
        }

        if (item.kind === 'country-group') {
          const isExpanded = expandedCityGroups.has(item.code);
          const tzSet = new Set(item.airportCodes.map(c => getAltTimeDisplay(c)).filter(Boolean));
          const hasSingleTZ = tzSet.size <= 1;
          const countryTzBtn = hasSingleTZ ? getAltTimeDisplay(item.airportCodes[0]) : null;
          return (
            <div key={item.code} className="exploration-group">
              <div className="exploration-item exploration-item--group">
                <button className="exploration-expand-btn" onClick={() => setExpandedCityGroups(prev => {
                  const s = new Set(prev);
                  if (s.has(item.code)) s.delete(item.code); else s.add(item.code);
                  return s;
                })}>{isExpanded ? '▾' : '▸'}</button>
                <span className="exploration-icon"></span>
                <span className="exploration-name">{item.name}</span>
                <span className="exploration-count">{item.airportCodes.length}{t.panel.airportAbbreviation}</span>
                {countryTzBtn && (
                  <button className="exploration-tz-btn" title={t.panel.switchTimezone}
                    onClick={() => onSwitchTimezone(item.airportCodes[0])}>{countryTzBtn}</button>
                )}
                <button className="exploration-remove-btn"
                  onClick={() => onRemoveCodes(item.airportCodes)}>{UI_SYMBOLS.CLOSE}</button>
              </div>
              {isExpanded && item.childCities?.map(city => {
                const cityKey = `${item.code}:${city.cityCode}`;
                const hasSingleAirport = city.airports.length === 1;
                const isCityExpanded = hasSingleAirport ? false : expandedInnerCities.has(cityKey);
                const cityRepCode = city.airports[0]?.code;
                const cityTzBtn = !hasSingleTZ && cityRepCode ? getAltTimeDisplay(cityRepCode) : null;
                const label = hasSingleAirport 
                  ? getSingleAirportLabel(city.cityName, city.airports[0].name)
                  : city.cityName;

                return (
                  <div key={city.cityCode} className={`exploration-group exploration-group--nested ${hasSingleAirport ? 'exploration-group--single-airport' : ''}`}>
                    <div className={`exploration-item exploration-item--city-child ${hasSingleAirport ? 'exploration-item--single-airport' : ''}`}>
                      {!hasSingleAirport && (
                        <button className="exploration-expand-btn" onClick={() => setExpandedInnerCities(prev => {
                          const s = new Set(prev);
                          if (s.has(cityKey)) s.delete(cityKey); else s.add(cityKey);
                          return s;
                        })}>{expandedInnerCities.has(cityKey) ? '▾' : '▸'}</button>
                      )}
                      <span className="exploration-icon"></span>
                      <span className="exploration-name">{label}</span>
                      {!hasSingleAirport && <span className="exploration-count">{city.airports.length}ap</span>}
                      {hasSingleAirport && <span className="exploration-code">({city.airports[0].code})</span>}
                      {cityTzBtn && cityRepCode && (
                        <button className="exploration-tz-btn" title={t.panel.switchTimezone}
                          onClick={() => onSwitchTimezone(cityRepCode)}>{cityTzBtn}</button>
                      )}
                      <button className="exploration-remove-btn"
                        onClick={() => onRemoveCodes(city.airports.map(a => a.code))}>{UI_SYMBOLS.CLOSE}</button>
                    </div>
                    {isCityExpanded && !hasSingleAirport && city.airports.map(ap => (
                      <div key={ap.code} className="exploration-item exploration-item--child">
                        <span className="exploration-icon"></span>
                        <span className="exploration-name">{ap.name}</span>
                        <span className="exploration-code">({ap.code})</span>
                        <button className="exploration-remove-btn"
                          onClick={() => onRemoveItem(ap.id)}>{UI_SYMBOLS.CLOSE}</button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
};

export default ExplorationList;
