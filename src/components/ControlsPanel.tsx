import React, { useState } from 'react';
import { useMapStore } from '../stores/mapStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { useColorStore } from '../stores/colorStore';
import { useAirportsQuery } from '../hooks/queries';
import ColorSettings from './ColorSettings';
import './ControlsPanel.css';
import { useTexts } from '../hooks/useTexts';
import { UI_SYMBOLS } from '../constants/ui';
import { MAP_STYLES, isArcGISUrl } from '../constants/mapStyles';
import { CURRENCIES } from '../constants/config';
import { buildPrefsSnapshot } from '../utils/i18n';
import { savePreferences } from '../api/preferences';
import type { Language } from '../constants/text';

interface ControlsPanelProps {
  onClose: () => void;
}

const ControlsPanel = ({ onClose }: ControlsPanelProps) => {
  const t = useTexts();
  // showRoutes, setShowRoutes,
  const mapStyle = useMapStore(s => s.mapStyle);
  const setMapStyle = useMapStore(s => s.setMapStyle);
  const globeMode = useMapStore(s => s.globeMode);
  const setGlobeMode = useMapStore(s => s.setGlobeMode);

  const {
    currency, setCurrency,
    minTransferHours, setMinTransferHours,
    minManualTransferHours, setMinManualTransferHours,
    showRefreshButton, setShowRefreshButton,
    showConsoleLogs, setShowConsoleLogs,
    language, setLanguage,
    savedSnapshot, setSavedSnapshot,
  } = useSettingsStore();
  const { session } = useAuthStore();
  const isLoggedIn = !!session;
  const mapState = { mapStyle, globeMode };
  const colorState = useColorStore();

  const settingsState = { language, currency, minTransferHours, minManualTransferHours, showRefreshButton, showConsoleLogs };

  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentSnapshot = JSON.stringify(
    buildPrefsSnapshot(settingsState, mapState, colorState as unknown as Record<string, unknown>)
  );
  const isDirty = isLoggedIn && savedSnapshot !== null && currentSnapshot !== savedSnapshot;

  const handleSavePreferences = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const snap = buildPrefsSnapshot(settingsState, mapState, colorState as unknown as Record<string, unknown>);
      await savePreferences(snap);
      setSavedSnapshot(JSON.stringify(snap));
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch {
      setSaveError(t.errors.generic);
    } finally {
      setIsSaving(false);
    }
  };

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
                onClick={() => setLanguage(lang)}
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
                onClick={() => setCurrency(code)}
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
          <label>{t.controls.minManualTransfer}</label>
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
          <label>{t.controls.mapStyle}</label>
          <select onChange={e => setMapStyle(e.target.value)} className="style-select" value={mapStyle}>
            <option value={MAP_STYLES.LIGHT}>{t.controls.lightDefault}</option>
            {/* <option value={MAP_STYLES.DARK_MATTER}>{t.controls.darkMatter}</option> */}
            {/* <option value={MAP_STYLES.POSITRON}>{t.controls.positron}</option> */}
            {/* <option value={MAP_STYLES.VOYAGER}>{t.controls.voyager}</option> */}
            <option value={MAP_STYLES.ARCGIS_SATELLITE}>{t.controls.satellite}</option>
            <option value={MAP_STYLES.ARCGIS_IMAGERY}>{t.controls.imagery}</option>
            <option value={MAP_STYLES.ARCGIS_CHARTED}>{t.controls.charted}</option>
            <option value={MAP_STYLES.ARCGIS_COMMUNITY}>{t.controls.community}</option>
          </select>
          <div className="globe-toggle-row">
            <span className="globe-toggle-label">{t.controls.globe}</span>
            <button
              className={`globe-toggle-btn ${globeMode ? 'active' : ''}`}
              onClick={() => setGlobeMode(!globeMode)}
              title={globeMode ? t.controls.switchToFlat : t.controls.switchToGlobe}
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
          {showColorSettings ? t.controls.hideStyles : t.controls.customizeStyles}
        </button>

        {/* Sekcja Customize Styles – bez suwaków (showSizes={false}) */}
        {showColorSettings && <ColorSettings showSizes={false} />}

        {/* Przycisk Developer – teraz na końcu */}
        <button
          className={`color-settings-toggle ${showDeveloper ? 'active' : ''}`}
          onClick={() => setShowDeveloper(v => !v)}
        >
          {showDeveloper ? t.controls.hideDeveloper : t.controls.developer}
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
                <span>{t.controls.showRefresh}</span>
              </label>
            </div>

            <div className="control-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showConsoleLogs}
                  onChange={e => setShowConsoleLogs(e.target.checked)}
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

        {isLoggedIn && isDirty && (
          <button
            className="save-preferences-btn"
            onClick={handleSavePreferences}
            disabled={isSaving}
          >
            {isSaving ? t.controls.saving : t.controls.saveSettings}
          </button>
        )}
        {justSaved && (
          <span className="save-preferences-confirm">{t.controls.settingsSaved}</span>
        )}
        {saveError && (
          <span className="save-preferences-error">{saveError}</span>
        )}
      </div>
    </div>
  );
};

export default ControlsPanel;