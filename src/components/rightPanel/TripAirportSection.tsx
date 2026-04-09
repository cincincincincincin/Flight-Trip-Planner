import React from 'react';
import type { Airport, AirportFeatureProps } from '../../types';
import AirportTransferPicker from '../AirportTransferPicker';
import { UI_SYMBOLS } from '../../constants/ui';
import { useTexts } from '../../hooks/useTexts';
import { CONFIG } from '../../constants/config';
import { useSettingsStore } from '../../stores/settingsStore';
import { getLocalizedProp } from '../../utils/i18n';
import { useAirportsMap } from '../../hooks/queries';

interface TripAirportSectionProps {
  selectedAirport: Airport;
  transferAirports: string[];
  setTransferAirports: React.Dispatch<React.SetStateAction<string[]>>;
  getAltTimeDisplay: (code: string) => string | null;
  onSwitchTimezone: (code: string) => void;
  selectedTimezoneAirportCode: string | null;
  setSelectedTimezoneOverride: (tz: string | null) => void;
  setSelectedTimezoneAirportCode: (code: string | null) => void;
  onPreviewAirport: (code: string) => void;
  onClearPreview: () => void;
}

const TripAirportSection = ({
  selectedAirport,
  transferAirports,
  setTransferAirports,
  getAltTimeDisplay,
  onSwitchTimezone,
  selectedTimezoneAirportCode,
  setSelectedTimezoneOverride,
  setSelectedTimezoneAirportCode,
  onPreviewAirport,
  onClearPreview,
}: TripAirportSectionProps) => {
  const airportsMap = useAirportsMap();
  const t = useTexts();
  const language = useSettingsStore(s => s.language);

  return (
    <div className="trip-airports-section">
      <div className="trip-airports-list">
        {(() => {
          const tzDisplay = getAltTimeDisplay(selectedAirport.code);
          return (
            <div className="trip-airport-item trip-airport-item--original">
              <span className="exploration-icon"></span>
              <span className="exploration-name">{selectedAirport.name}</span>
              <span className="exploration-code">({selectedAirport.code})</span>
              {tzDisplay && (
                <button className="exploration-tz-btn" title={t.panel.switchTimezone}
                  onClick={() => onSwitchTimezone(selectedAirport.code)}>{tzDisplay}</button>
              )}
            </div>
          );
        })()}
        {t.panel.transferAirports}
        {transferAirports.map(code => {
          const tzDisplay = getAltTimeDisplay(code);
          const feat = airportsMap[code];
          const label = feat ? getLocalizedProp(feat.properties, 'name', language) : code;
          return (
            <div key={code} className="trip-airport-item">
              <span className="exploration-icon"></span>
              <span className="exploration-name">{label}</span>
              <span className="exploration-code">({code})</span>
              {tzDisplay && (
                <button className="exploration-tz-btn" title={t.panel.switchTimezone}
                  onClick={() => onSwitchTimezone(code)}>{tzDisplay}</button>
              )}
              <button className="exploration-remove-btn" onClick={() => {
                setTransferAirports(prev => prev.filter(c => c !== code));
                if (selectedTimezoneAirportCode === code) {
                  setSelectedTimezoneOverride(null);
                  setSelectedTimezoneAirportCode(null);
                }
              }}>{UI_SYMBOLS.CLOSE}</button>
            </div>
          );
        })}
      </div>
      {transferAirports.length < CONFIG.MAX_TRANSFER_AIRPORTS && (
        <AirportTransferPicker
          currentAirport={selectedAirport}
          inline
          preCheckedCodes={transferAirports}
          onSelectAirports={(newCodes) => {
            setTransferAirports(prev => {
              const combined = [...new Set([...prev, ...newCodes])];
              return combined.slice(0, CONFIG.MAX_TRANSFER_AIRPORTS);
            });
          }}
          onSelectAirport={(code) => {
            setTransferAirports(prev => {
              if (prev.includes(code) || prev.length >= CONFIG.MAX_TRANSFER_AIRPORTS) return prev;
              return [...prev, code];
            });
          }}
          onPreviewAirport={onPreviewAirport}
          onClearPreview={onClearPreview}
          maxSelect={CONFIG.MAX_TRANSFER_AIRPORTS - transferAirports.length}
        />
      )}
    </div>
  );
};

export default TripAirportSection;
