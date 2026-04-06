import React from 'react';
import type { FeatureCollection, Point } from 'geojson';
import type { AirportFeatureProps } from '../../types';
import type { ExplorationItem } from '../../stores/selectionStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useTexts } from '../../hooks/useTexts';
import { UI_SYMBOLS } from '../../constants/ui';
import { CONFIG } from '../../constants/config';
import type { buildTzGroups } from '../../utils/timezoneUtils';
import { useSettingsStore } from '../../stores/settingsStore';
import { getLocalizedProp } from '../../utils/geoUtils';

type TzGroups = ReturnType<typeof buildTzGroups>;

interface PendingCountryPickerProps {
  pendingCountryPicker: { code: string; name: string };
  pendingCountryTzGroups: TzGroups;
  pendingSelectedAirports: string[];
  setPendingSelectedAirports: React.Dispatch<React.SetStateAction<string[]>>;
  airportsData: FeatureCollection<Point, AirportFeatureProps> | undefined;
  explorationItems: ExplorationItem[];
  onFitBounds?: (codes: string[]) => void;
  onClearCountryPicker?: () => void;
}

const PendingCountryPicker: React.FC<PendingCountryPickerProps> = ({
  pendingCountryPicker,
  pendingCountryTzGroups,
  pendingSelectedAirports,
  setPendingSelectedAirports,
  airportsData,
  explorationItems,
  onFitBounds,
  onClearCountryPicker,
}) => {
  const t = useTexts();
  const language = useSettingsStore(s => s.language);
  const { clearExploration, addExplorationItem } = useSelectionStore();

  const hasMixedTZ = pendingCountryTzGroups.filter(g => g.tz !== CONFIG.UNKNOWN_TIMEZONE).length > 1;
  const alreadySelectedCodes = new Set(explorationItems.flatMap(i => i.airportCodes));

  const renderPendingCheckbox = (airport: { code: string; name: string }) => {
    const alreadySelected = alreadySelectedCodes.has(airport.code);
    const isPendingSelected = pendingSelectedAirports.includes(airport.code);
    const isSelected = alreadySelected || isPendingSelected;
    const canSelect = !alreadySelected && (isPendingSelected || pendingSelectedAirports.length < CONFIG.MAX_AIRPORTS);
    return (
      <label key={airport.code}
        className={`country-airport-item ${isSelected ? 'selected' : ''} ${alreadySelected ? 'disabled locked' : !canSelect ? 'disabled' : ''}`}>
        <input type="checkbox" checked={isSelected} disabled={alreadySelected || !canSelect}
          onChange={() => {
            if (alreadySelected) return;
            setPendingSelectedAirports(prev =>
              prev.includes(airport.code)
                ? prev.filter(c => c !== airport.code)
                : (prev.length < CONFIG.MAX_AIRPORTS ? [...prev, airport.code] : prev)
            );
          }} />
        <span>{(() => { const f = airportsData?.features.find(f => f.properties.code === airport.code); return f ? getLocalizedProp(f.properties, 'name', language) : airport.name; })()} ({airport.code})</span>
      </label>
    );
  };

  return (
    <div className="pending-country-picker">
      <div className="pending-country-header">
        <span>{t.panel.addAirportsFrom}{pendingCountryPicker.name}</span>
        <button className="pending-country-close" onClick={onClearCountryPicker}>{UI_SYMBOLS.CLOSE}</button>
      </div>
      <div className="pending-country-content">
        {hasMixedTZ ? (
          pendingCountryTzGroups.map(group => (
            <div key={group.tz} className="country-tz-group">
              {group.tz !== CONFIG.UNKNOWN_TIMEZONE && (
                <div className="country-tz-header">
                  <span className="tz-offset">{group.utcLabel}</span>
                  <span className="tz-current-dt">{group.currentDateStr} · {group.currentTimeStr}</span>
                </div>
              )}
              <div className="country-airports-flat-list">
                {group.airports.map(renderPendingCheckbox)}
              </div>
            </div>
          ))
        ) : (
          <div className="country-airports-flat-list">
            {pendingCountryTzGroups.flatMap(g => g.airports).map(renderPendingCheckbox)}
          </div>
        )}
      </div>
      {pendingSelectedAirports.length > 0 && (
        <button className="confirm-flights-btn" onClick={() => {
          const currentCodes = explorationItems.flatMap(i => i.airportCodes);
          const willFill = pendingSelectedAirports.length >= CONFIG.MAX_AIRPORTS;
          if (willFill) clearExploration();
          const slotsLeft = CONFIG.MAX_AIRPORTS - (willFill ? 0 : currentCodes.length);
          const codesToAdd = pendingSelectedAirports.slice(0, slotsLeft);
          codesToAdd.forEach(code => {
            const feat = airportsData?.features.find(f => f.properties.code === code);
            addExplorationItem({ type: 'airport', code, name: feat ? getLocalizedProp(feat.properties, 'name', language) : code, airportCodes: [code] });
          });
          onFitBounds?.([...(willFill ? [] : currentCodes), ...codesToAdd]);
          onClearCountryPicker?.();
          setPendingSelectedAirports([]);
        }}>
          {t.panel.addCountAirports(Math.min(pendingSelectedAirports.length, CONFIG.MAX_AIRPORTS))}
        </button>
      )}
    </div>
  );
};

export default PendingCountryPicker;
