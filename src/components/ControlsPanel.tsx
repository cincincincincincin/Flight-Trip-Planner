import React, { useState } from 'react';
import { useMapStore } from '../stores/mapStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAirportsQuery, useCitiesQuery, useRoutesQuery } from '../hooks/queries';
import ColorSettings from './ColorSettings';
import './ControlsPanel.css';
import { TEXTS } from '../constants/text';
import { UI_SYMBOLS } from '../constants/ui';
import { MAP_STYLES, isArcGISUrl } from '../constants/mapStyles';

const CURRENCIES = [
  { code: 'PLN', label: 'PLN – Polish Złoty' },
  { code: 'USD', label: 'USD – US Dollar' },
  { code: 'EUR', label: 'EUR – Euro' },
  { code: 'GBP', label: 'GBP – British Pound' },
];

interface ControlsPanelProps {
  onClose: () => void;
}

const ControlsPanel = ({ onClose }: ControlsPanelProps) => {
  const {
    showRoutes, setShowRoutes,
    mapStyle, setMapStyle,
    globeMode, setGlobeMode,
  } = useMapStore();

  const {
    currency, setCurrency,
    minTransferHours, setMinTransferHours,
    minManualTransferHours, setMinManualTransferHours,
    showRefreshButton, setShowRefreshButton,
    showConsoleLogs, setShowConsoleLogs,
  } = useSettingsStore();

  const { data: airportsData, isFetching: loadingAirports } = useAirportsQuery();
  const { data: citiesData, isFetching: loadingCities } = useCitiesQuery(false);
  const { data: routesData, isFetching: loadingRoutes, isError } = useRoutesQuery(showRoutes);

  const [showColorSettings, setShowColorSettings] = useState(false);
  const [showDeveloper, setShowDeveloper] = useState(false);
  const [showSizes, setShowSizes] = useState(false);

  return (
    <div className="controls-panel">
      <div className="controls-panel-header">
        <h2>{TEXTS.appTitle}</h2>
        <button className="controls-panel-close" onClick={onClose}>{UI_SYMBOLS.CLOSE}</button>
      </div>

      {isError && (
        <div className="error-message">{TEXTS.controls.failedRoutes}</div>
      )}

      <div className="controls">
        <div className="currency-selector">
          <label> {TEXTS.controls.currency}</label>
          <div className="currency-toggle">
            {CURRENCIES.map(({ code, label }) => (
              <button
                key={code}
                className={`currency-option ${currency === code ? 'active' : ''}`}
                onClick={() => setCurrency(code)}
                title={label}
              >
                {code}
              </button>
            ))}
          </div>
        </div>

        <div className="currency-selector">
          <label>{TEXTS.controls.minTransferTime}</label>
          <div className="currency-toggle">
            <button
              className="currency-option"
              onClick={() => setMinTransferHours(Math.max(0.5, parseFloat((minTransferHours - 0.5).toFixed(1))))}
            >−</button>
            <span className="currency-option active" style={{ cursor: 'default', minWidth: '42px', textAlign: 'center' }}>
              {minTransferHours}h
            </span>
            <button
              className="currency-option"
              onClick={() => setMinTransferHours(Math.min(24, parseFloat((minTransferHours + 0.5).toFixed(1))))}
            >+</button>
          </div>
        </div>

        <div className="currency-selector">
          <label>{TEXTS.controls.minManualTransfer}</label>
          <div className="currency-toggle">
            <button
              className="currency-option"
              onClick={() => setMinManualTransferHours(Math.max(0.5, parseFloat((minManualTransferHours - 0.5).toFixed(1))))}
            >−</button>
            <span className="currency-option active" style={{ cursor: 'default', minWidth: '42px', textAlign: 'center' }}>
              {minManualTransferHours}h
            </span>
            <button
              className="currency-option"
              onClick={() => setMinManualTransferHours(Math.min(24, parseFloat((minManualTransferHours + 0.5).toFixed(1))))}
            >+</button>
          </div>
        </div>

        <div className="map-style-selector">
          <label>{TEXTS.controls.mapStyle}</label>
          <select onChange={e => setMapStyle(e.target.value)} className="style-select" value={mapStyle}>
            <option value={MAP_STYLES.LIGHT}>{TEXTS.controls.lightDefault}</option>
            <option value={MAP_STYLES.DARK_MATTER}>{TEXTS.controls.darkMatter}</option>
            <option value={MAP_STYLES.POSITRON}>{TEXTS.controls.positron}</option>
            <option value={MAP_STYLES.VOYAGER}>{TEXTS.controls.voyager}</option>
            <option value={MAP_STYLES.ARCGIS_SATELLITE}>{TEXTS.controls.satellite}</option>
            <option value={MAP_STYLES.ARCGIS_IMAGERY}>{TEXTS.controls.imagery}</option>
            <option value={MAP_STYLES.ARCGIS_CHARTED}>{TEXTS.controls.charted}</option>
            <option value={MAP_STYLES.ARCGIS_COMMUNITY}>{TEXTS.controls.community}</option>
          </select>
          <div className="globe-toggle-row">
            <span className="globe-toggle-label">{TEXTS.controls.globe}</span>
            <button
              className={`globe-toggle-btn ${globeMode ? 'active' : ''}`}
              onClick={() => setGlobeMode(!globeMode)}
              title={globeMode ? TEXTS.controls.switchToFlat : TEXTS.controls.switchToGlobe}
            >
              <span className="globe-toggle-thumb" />
            </button>
          </div>
        </div>

        {/* Przycisk Customize Styles */}
        <button
          className={`color-settings-toggle ${showColorSettings ? 'active' : ''}`}
          onClick={() => setShowColorSettings(v => !v)}
        >
          {showColorSettings ? TEXTS.controls.hideStyles : TEXTS.controls.customizeStyles}
        </button>

        {/* Sekcja Customize Styles – bez suwaków (showSizes={false}) */}
        {showColorSettings && <ColorSettings showSizes={false} />}

        {/* Przycisk Developer – teraz na końcu */}
        <button
          className={`color-settings-toggle ${showDeveloper ? 'active' : ''}`}
          onClick={() => setShowDeveloper(v => !v)}
        >
          {showDeveloper ? TEXTS.controls.hideDeveloper : TEXTS.controls.developer}
        </button>

        {/* Zawartość developera */}
        {showDeveloper && (
          <div className="developer-section">
            <div className="control-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showRefreshButton}
                  onChange={e => setShowRefreshButton(e.target.checked)}
                />
                <span>{TEXTS.controls.showRefresh}</span>
              </label>
            </div>

            <div className="control-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showConsoleLogs}
                  onChange={e => setShowConsoleLogs(e.target.checked)}
                />
                <span>{TEXTS.controls.showConsole}</span>
              </label>
            </div>
            
            <div className="control-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showRoutes}
                  onChange={e => setShowRoutes(e.target.checked)}
                  disabled={loadingRoutes}
                />
                <span>{TEXTS.controls.loadRoutes}</span>
                {loadingRoutes && <span className="loading"> {TEXTS.controls.loading}</span>}
              </label>
            </div>

            <div className="developer-stats">
              <div className="stat-item">{TEXTS.controls.airportsCount}{airportsData?.features?.length || 0}{loadingAirports ? <span className="loading"> {TEXTS.controls.loading}</span> : ''}</div>
              <div className="stat-item">{TEXTS.controls.routesCount}{routesData?.features?.length || 0}</div>
            </div>

            <button
              className={`color-settings-toggle ${showSizes ? 'active' : ''}`}
              onClick={() => setShowSizes(v => !v)}
              style={{ marginTop: '12px' }}
            >
              {showSizes ? TEXTS.controls.hideSizeSettings : TEXTS.controls.mapSizeSettings}
            </button>

            {showSizes && <ColorSettings showOnlySizes={true} />}
          </div>
        )}
      </div>
    </div>
  );
};

export default ControlsPanel;