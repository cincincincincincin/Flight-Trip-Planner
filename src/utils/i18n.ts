import type { Language } from '../constants/text';
import type { ColorState } from '../stores/colorStore';
import type { MapState } from '../stores/mapStore';
import type { SettingsState } from '../stores/settingsStore';

export const getLocalizedName = (
  entity: { name: string; name_translations?: Record<string, string> },
  lang: Language
): string => entity.name_translations?.[lang] ?? entity.name;

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
