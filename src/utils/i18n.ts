import type { Language } from '../constants/text';
import type { ColorState } from '../stores/colorStore';
import type { MapState } from '../stores/mapStore';
import type { SettingsState } from '../stores/settingsStore';

// --- Lokalizacja nazw encji z bazy danych ---

/**
 * Zwraca przetłumaczoną nazwę encji (lotnisko, miasto, kraj).
 * Jeśli brak tłumaczenia dla danego języka, zwraca domyślną nazwę (angielską).
 */
export const getLocalizedName = (
  entity: { name: string; name_translations?: Record<string, string> },
  lang: Language
): string => entity.name_translations?.[lang] ?? entity.name;

// --- Snapshot ustawień użytkownika do zapisu w DB ---

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
  // Płaski stan colorStore — funkcje akcji są pomijane przez JSON.stringify
  colors: Record<string, unknown>;
};

/**
 * Buduje snapshot ustawień z trzech stores.
 * Klucze w stałej kolejności alfabetycznej — zapewnia stabilne JSON.stringify do porównań.
 */
export const buildPrefsSnapshot = (
  settings: Pick<SettingsState, 'language' | 'currency' | 'minTransferHours' |
    'minManualTransferHours' | 'showRefreshButton' | 'showConsoleLogs'>,
  map: Pick<MapState, 'mapStyle' | 'globeMode'>,
  colorStoreState: Record<string, unknown>
): PrefsSnapshot => ({
  colors: colorStoreState,
  map: {
    globe_mode: map.globeMode,
    map_style: map.mapStyle,
  },
  settings: {
    currency: settings.currency,
    language: settings.language,
    min_manual_transfer_hours: settings.minManualTransferHours,
    min_transfer_hours: settings.minTransferHours,
    show_console_logs: settings.showConsoleLogs,
    show_refresh_button: settings.showRefreshButton,
  },
});
