import React, { useState, useRef } from 'react';
import { useMapStore } from '../stores/mapStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { useColorStore } from '../stores/colorStore';
import { useAirportsQuery } from '../hooks/queries';
import ColorSettings from './ColorSettings';
import './ControlsPanel.css';
import { useTexts } from '../hooks/useTexts';
import { UI_SYMBOLS } from '../constants/ui';
import { MAP_STYLES } from '../constants/mapStyles';
import { CURRENCIES } from '../constants/config';
import type { Language } from '../constants/text';

interface ControlsPanelProps {
  onClose: () => void;
}

const ControlsPanel = ({ onClose }: ControlsPanelProps) => {
  const t = useTexts();
  const mapStyle = useMapStore(s => s.mapStyle);
  const setMapStyleStore = useMapStore(s => s.setMapStyle);
  const globeMode = useMapStore(s => s.globeMode);
  const setGlobeModeStore = useMapStore(s => s.setGlobeMode);

  // ZABEZPIECZENIE PRZED WYŚCIGIEM: Lokalny debouncing zapobiegający zbyt częstym zmianom stanu
  const lastActionTimeRef = useRef(0);
  const ACTION_DEBOUNCE_MS = 400;
  const [isUpdating, setIsUpdating] = useState(false);

  const handleSetMapStyle = (style: string) => {
    const now = Date.now();
    if (now - lastActionTimeRef.current < ACTION_DEBOUNCE_MS) return;
    lastActionTimeRef.current = now;
    
    setIsUpdating(true);
    setTimeout(() => setIsUpdating(false), ACTION_DEBOUNCE_MS);
    
    setMapStyleStore(style);
  };

  const handleSetGlobeMode = (mode: boolean) => {
    const now = Date.now();
    if (now - lastActionTimeRef.current < ACTION_DEBOUNCE_MS) return;
    lastActionTimeRef.current = now;

    setIsUpdating(true);
    setTimeout(() => setIsUpdating(false), ACTION_DEBOUNCE_MS);

    setGlobeModeStore(mode);
  };

  const {
    currency, minTransferHours, minManualTransferHours,
    showRefreshButton, showConsoleLogs, language,
    updateSettings,
  } = useSettingsStore();
  const { session } = useAuthStore();
  const isLoggedIn = !!session;

  const { data: airportsData, isFetching: loadingAirports } = useAirportsQuery();
  // const { data: routesData, isFetching: loadingRoutes, isError } = useRoutesQuery(showRoutes);
  const loadingRoutes = false;

  const [showColorSettings, setShowColorSettings] = useState(false);
  const [showDeveloper, setShowDeveloper] = useState(false);
  const [showSizes, setShowSizes] = useState(false);

  return (
    <div className="controls-panel">
      <div className="controls-panel-header">
        <h2>{t.appTitle}</h2>
        <button className="controls-panel-close" onClick={onClose}>{UI_SYMBOLS.CLOSE}</button>
      </div>

<div className="controls">
        {/* Wybór języka interfejsu */}
        <div className="language-selector">
          <label>{t.controls.language}</label>
          <div className="language-toggle">
            {(['pl', 'en'] as Language[]).map(lang => (
              <button
                key={lang}
                className={`language-option ${language === lang ? 'active' : ''}`}
                onClick={() => updateSettings({ language: lang })}
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="currency-selector">
          <label> {t.controls.currency}</label>
          <div className="currency-toggle">
            {CURRENCIES.map(({ code, label }) => (
              <button
                key={code}
                className={`currency-option ${currency === code ? 'active' : ''}`}
                onClick={() => updateSettings({ currency: code })}
                title={label}
              >
                {code}
              </button>
            ))}
          </div>
        </div>

        <div className="currency-selector">
          <label>{t.controls.minTransferTime}</label>
          <div className="currency-toggle">
            <button
              className="currency-option"
              onClick={() => updateSettings({ minTransferHours: Math.max(0.5, parseFloat((minTransferHours - 0.5).toFixed(1))) })}
            >−</button>
            <span className="currency-option active" style={{ cursor: 'default', minWidth: '42px', textAlign: 'center' }}>
              {minTransferHours}h
            </span>
            <button
              className="currency-option"
              onClick={() => updateSettings({ minTransferHours: Math.min(24, parseFloat((minTransferHours + 0.5).toFixed(1))) })}
            >+</button>
          </div>
        </div>

        <div className="currency-selector">
          <label>{t.controls.minManualTransfer}</label>
          <div className="currency-toggle">
            <button
              className="currency-option"
              onClick={() => updateSettings({ minManualTransferHours: Math.max(0.5, parseFloat((minManualTransferHours - 0.5).toFixed(1))) })}
            >−</button>
            <span className="currency-option active" style={{ cursor: 'default', minWidth: '42px', textAlign: 'center' }}>
              {minManualTransferHours}h
            </span>
            <button
              className="currency-option"
              onClick={() => updateSettings({ minManualTransferHours: Math.min(24, parseFloat((minManualTransferHours + 0.5).toFixed(1))) })}
            >+</button>
          </div>
        </div>

        <div className="settings-section" style={{ opacity: isUpdating ? 0.6 : 1, pointerEvents: isUpdating ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
        <h3>{t.controls.layersTitle}</h3>
        <div className="map-style-selector">
          <label>{t.controls.mapStyle}</label>
          <select onChange={e => handleSetMapStyle(e.target.value)} className="style-select" value={mapStyle}>
            <option value={MAP_STYLES.LIGHT}>{t.controls.lightDefault}</option>
            {/* <option value={MAP_STYLES.DARK_MATTER}>{t.controls.darkMatter}</option> */}
            {/* <option value={MAP_STYLES.POSITRON}>{t.controls.positron}</option> */}
            {/* <option value={MAP_STYLES.VOYAGER}>{t.controls.voyager}</option> */}
            <option value={MAP_STYLES.ARCGIS_IMAGERY}>{t.controls.imagery}</option>
            <option value={MAP_STYLES.ARCGIS_CHARTED}>{t.controls.charted}</option>
            <option value={MAP_STYLES.ARCGIS_COMMUNITY}>{t.controls.community}</option>
            <option value={MAP_STYLES.ARCGIS_HUMAN_GEOGRAPHY}>{t.controls.humanGeo}</option>
          </select>
          <div className="globe-toggle-row">
            <span className="globe-toggle-label">{t.controls.globe}</span>
            <button
              className={`globe-toggle-btn ${globeMode ? 'active' : ''}`}
              onClick={() => handleSetGlobeMode(!globeMode)}
              title={globeMode ? t.controls.switchToFlat : t.controls.switchToGlobe}
            >
              <span className="globe-toggle-thumb" />
            </button>
          </div>
        </div>

        {/* Przycisk dostosowywania stylów */}
        <button
          className={`color-settings-toggle ${showColorSettings ? 'active' : ''}`}
          onClick={() => setShowColorSettings(v => !v)}
        >
          {showColorSettings ? t.controls.hideStyles : t.controls.customizeStyles}
        </button>

        {/* Sekcja dostosowywania stylów – bez suwaków rozmiarów (showSizes={false}) */}
        {showColorSettings && <ColorSettings showSizes={false} />}

        {/* Przycisk panelu deweloperskiego */}
        <button
          className={`color-settings-toggle ${showDeveloper ? 'active' : ''}`}
          onClick={() => setShowDeveloper(v => !v)}
        >
          {showDeveloper ? t.controls.hideDeveloper : t.controls.developer}
        </button>

        {/* Zawartość panelu deweloperskiego */}
        {showDeveloper && (
          <div className="developer-section">
            <div className="control-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showRefreshButton}
                  onChange={e => updateSettings({ showRefreshButton: e.target.checked })}
                />
                <span>{t.controls.showRefresh}</span>
              </label>
            </div>

            <div className="control-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showConsoleLogs}
                  onChange={e => updateSettings({ showConsoleLogs: e.target.checked })}
                />
                <span>{t.controls.showConsole}</span>
              </label>
            </div>
            
            {/*
            <div className="control-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showRoutes}
                  onChange={e => setShowRoutes(e.target.checked)}
                  disabled={loadingRoutes}
                />
                <span>{t.controls.loadRoutes}</span>
                {loadingRoutes && <span className="loading"> {t.controls.loading}</span>}
              </label>
            </div>
            */}

            <div className="developer-stats">
              <div className="stat-item">{t.controls.airportsCount}{airportsData?.features?.length || 0}{loadingAirports ? <span className="loading"> {t.controls.loading}</span> : ''}</div>
              {/* <div className="stat-item">{t.controls.routesCount}{routesData?.features?.length || 0}</div> */}
            </div>
            <button
              className={`color-settings-toggle ${showSizes ? 'active' : ''}`}
              onClick={() => setShowSizes(v => !v)}
              style={{ marginTop: '12px' }}
            >
              {showSizes ? t.controls.hideSizeSettings : t.controls.mapSizeSettings}
            </button>

            {showSizes && <ColorSettings showOnlySizes={true} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ControlsPanel;