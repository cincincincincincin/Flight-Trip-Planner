import type { Language } from '../constants/text';
import type { MapState } from '../stores/mapStore';
import type { SettingsState } from '../stores/settingsStore';

export type PrefsSnapshot = {
  settings: {
    language: Language;
    currency: string;
    min_transfer_hours: number;
    min_manual_transfer_hours: number;
    show_refresh_button: boolean;
    show_console_logs: boolean;
  };
  map: {
    map_style: string;
    globe_mode: boolean;
  };
  colors: Record<string, unknown>;
};

// Tworzy migawkę (snapshot) ustawień do zapisu w bazie danych.
// Odfiltrowujemy tu akcje Zustanda, żeby w JSON-ie zostały same wartości (kolory, parametry).
export const buildPrefsSnapshot = (
  settings: Pick<SettingsState, 'language' | 'currency' | 'minTransferHours' |
    'minManualTransferHours' | 'showRefreshButton' | 'showConsoleLogs'>,
  map: Pick<MapState, 'mapStyle' | 'globeMode'>,
  colorStoreState: Record<string, unknown>
): PrefsSnapshot => ({
  settings: {
    language: settings.language,
    currency: settings.currency,
    min_transfer_hours: settings.minTransferHours,
    min_manual_transfer_hours: settings.minManualTransferHours,
    show_refresh_button: settings.showRefreshButton,
    show_console_logs: settings.showConsoleLogs,
  },
  map: {
    map_style: map.mapStyle,
    globe_mode: map.globeMode,
  },
  // Exportujemy tylko dane (kolory/rozmiary), omijając funkcje sterujące store'a
  colors: Object.fromEntries(
    Object.entries(colorStoreState).filter(([_, v]) => typeof v !== 'function')
  ),
});
