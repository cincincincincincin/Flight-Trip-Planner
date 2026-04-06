import React from 'react';
import type { FeatureCollection, Point } from 'geojson';
import type { AirportFeatureProps, CountryAirport } from '../../types';
import { useTexts } from '../../hooks/useTexts';
import { CONFIG } from '../../constants/config';
import type { buildTzGroups } from '../../utils/timezoneUtils';
import { useSettingsStore } from '../../stores/settingsStore';
import { getLocalizedProp } from '../../utils/geoUtils';

type TzGroups = ReturnType<typeof buildTzGroups>;

interface CountryModeSectionProps {
  countryTzGroups: TzGroups;
  countryActiveTZ: string | null;
  setCountryActiveTZ: React.Dispatch<React.SetStateAction<string | null>>;
  selectedFlatAirports: CountryAirport[];
  onAirportToggle: (airport: CountryAirport) => void;
  onConfirm: () => void;
  airportsData: FeatureCollection<Point, AirportFeatureProps> | undefined;
  getCountryTzRelativeOffset: (tz: string) => string | null;
}

const CountryModeSection: React.FC<CountryModeSectionProps> = ({
  countryTzGroups,
  countryActiveTZ,
  setCountryActiveTZ,
  selectedFlatAirports,
  onAirportToggle,
  onConfirm,
  airportsData,
  getCountryTzRelativeOffset,
}) => {
  const t = useTexts();
  const language = useSettingsStore(s => s.language);

  const hasMixedTZ = countryTzGroups.filter(g => g.tz !== CONFIG.UNKNOWN_TIMEZONE).length > 1;
  const allCountryAirports = countryTzGroups.flatMap(g => g.airports);

  const renderAirportCheckbox = (airport: { code: string; name: string }) => {
    const isSelected = selectedFlatAirports.some(a => a.code === airport.code);
    const canSelect = isSelected || selectedFlatAirports.length < CONFIG.MAX_AIRPORTS;
    const feat = airportsData?.features.find(f => f.properties.code === airport.code);
    const localName = feat ? getLocalizedProp(feat.properties, 'name', language) : airport.name;
    return (
      <label key={airport.code}
        className={`country-airport-item ${isSelected ? 'selected' : ''} ${!canSelect ? 'disabled' : ''}`}>
        <input type="checkbox" checked={isSelected} disabled={!canSelect}
          onChange={() => onAirportToggle(airport as CountryAirport)} />
        <span>{localName} ({airport.code})</span>
      </label>
    );
  };

  return (
    <div className="country-flat-airports">
          <div className="country-mode-info">
            {t.panel.selectAirportsMax(CONFIG.MAX_AIRPORTS)} {t.panel.selectedCount(selectedFlatAirports.length, CONFIG.MAX_AIRPORTS)}
          </div>
          {hasMixedTZ ? (
            countryTzGroups.map(group => {
              const relOffset = getCountryTzRelativeOffset(group.tz);
              const isActive = group.tz === countryActiveTZ;
              const hasSelected = selectedFlatAirports.some(a => group.airports.some(ga => ga.code === a.code));
              return (
                <div key={group.tz} className={`country-tz-group${isActive ? ' country-tz-group--active' : ''}`}>
                  {group.tz !== CONFIG.UNKNOWN_TIMEZONE && (
                    <div className="country-tz-header">
                      <span className="tz-offset">{group.utcLabel}</span>
                      <span className="tz-current-dt">{group.currentDateStr} · {group.currentTimeStr}</span>
                      {!isActive && hasSelected && relOffset && (
                        <button className="tz-switch-btn" onClick={() => setCountryActiveTZ(group.tz)}>{relOffset}</button>
                      )}
                    </div>
                  )}
                  <div className="country-airports-flat-list">
                    {group.airports.map(renderAirportCheckbox)}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="country-airports-flat-list">
              {allCountryAirports.map(renderAirportCheckbox)}
            </div>
          )}
          {selectedFlatAirports.length > 0 && (
            <button className="confirm-flights-btn" onClick={onConfirm}>
              {t.panel.loadFlightsFromCount(selectedFlatAirports.length)}
            </button>
          )}
    </div>
  );
};

export default CountryModeSection;
