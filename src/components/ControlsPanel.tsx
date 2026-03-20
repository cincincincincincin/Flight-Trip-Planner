import React, { useState } from 'react';
import { useMapStore } from '../stores/mapStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAirportsQuery, useCitiesQuery, useRoutesQuery } from '../hooks/queries';
import ColorSettings from './ColorSettings';
import './ControlsPanel.css';

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
        <h2>Flight Trip Planner</h2>
        <button className="controls-panel-close" onClick={onClose}>✕</button>
      </div>

      {isError && (
        <div className="error-message">Failed to load routes</div>
      )}

      <div className="controls">
        <div className="currency-selector">
          <label> Currency:</label>
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
          <label>Min. transfer time:</label>
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
          <label>Min. manual transfer:</label>
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
          <label>Map Style:</label>
          <select onChange={e => setMapStyle(e.target.value)} className="style-select" value={mapStyle}>
            <option value="https://demotiles.maplibre.org/style.json">Light (default)</option>
            <option value="https://demotiles.maplibre.org/globe.json">Globe</option>
            <option value="https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json">Dark Matter</option>
            <option value="https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/style.json">Positron</option>
            <option value="https://tiles.basemaps.cartocdn.com/gl/voyager-gl-style/style.json">Voyager</option>
            <option value="arcgis:satellite">Satellite</option>
            <option value="arcgis:satellite-globe">Satellite Globe</option>
            <option value="arcgis:imagery">ArcGIS Imagery</option>
            <option value="arcgis:charted-territory">ArcGIS Charted Territory</option>
            <option value="arcgis:community">ArcGIS Community</option>
          </select>
        </div>

        {/* Przycisk Customize Styles */}
        <button
          className={`color-settings-toggle ${showColorSettings ? 'active' : ''}`}
          onClick={() => setShowColorSettings(v => !v)}
        >
          {showColorSettings ? 'Hide Styles' : 'Customize Styles'}
        </button>

        {/* Sekcja Customize Styles – bez suwaków (showSizes={false}) */}
        {showColorSettings && <ColorSettings showSizes={false} />}

        {/* Przycisk Developer – teraz na końcu */}
        <button
          className={`color-settings-toggle ${showDeveloper ? 'active' : ''}`}
          onClick={() => setShowDeveloper(v => !v)}
        >
          {showDeveloper ? 'Hide Developer' : 'Developer'}
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
                <span>Show Refresh Button</span>
              </label>
            </div>

            <div className="control-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showConsoleLogs}
                  onChange={e => setShowConsoleLogs(e.target.checked)}
                />
                <span>Show Console Logs</span>
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
                <span>Load Routes</span>
                {loadingRoutes && <span className="loading"> (loading...)</span>}
              </label>
            </div>

            <div className="developer-stats">
              <div className="stat-item">Airports: {airportsData?.features?.length || 0}{loadingAirports ? ' (loading...)' : ''}</div>
              <div className="stat-item">Routes: {routesData?.features?.length || 0}</div>
            </div>

            <button
              className={`color-settings-toggle ${showSizes ? 'active' : ''}`}
              onClick={() => setShowSizes(v => !v)}
              style={{ marginTop: '12px' }}
            >
              {showSizes ? 'Hide Size Settings' : 'Map Size Settings'}
            </button>

            {showSizes && <ColorSettings showOnlySizes={true} />}
          </div>
        )}
      </div>
    </div>
  );
};

export default ControlsPanel;