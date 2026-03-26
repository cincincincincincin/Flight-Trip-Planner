/**
 * Ładuje preferencje z serwera po zalogowaniu i aplikuje je do stores.
 * Wywoływane z module-level auth listener.
 */
import { fetchPreferences } from '../api/preferences';
import { useSettingsStore } from '../stores/settingsStore';
import { useMapStore } from '../stores/mapStore';
import { useColorStore } from '../stores/colorStore';
import { buildPrefsSnapshot } from './i18n';

export const loadPreferencesOnLogin = async (): Promise<void> => {
  try {
    const prefs = await fetchPreferences();

    // Aplikuj ustawienia ogólne
    const s = useSettingsStore.getState();
    s.setLanguage(prefs.settings.language as 'en' | 'pl');
    s.setCurrency(prefs.settings.currency);
    s.setMinTransferHours(prefs.settings.min_transfer_hours);
    s.setMinManualTransferHours(prefs.settings.min_manual_transfer_hours);
    s.setShowRefreshButton(prefs.settings.show_refresh_button);
    s.setShowConsoleLogs(prefs.settings.show_console_logs);

    // Aplikuj ustawienia mapy
    const m = useMapStore.getState();
    m.setMapStyle(prefs.map.map_style);
    m.setGlobeMode(prefs.map.globe_mode);

    // Aplikuj kolory (wszystkie klucze danych z colorStore)
    const colorSet = useColorStore.getState();
    const colorData = prefs.colors as Record<string, unknown>;
    Object.entries(colorData).forEach(([key, value]) => {
      if (key in colorSet && typeof (colorSet as Record<string, unknown>)[key] !== 'function') {
        useColorStore.setState({ [key]: value });
      }
    });

    // Zapisz snapshot — przycisk "Zapisz" będzie ukryty dopóki nic nie zostanie zmienione
    const snap = buildPrefsSnapshot(
      useSettingsStore.getState(),
      useMapStore.getState(),
      useColorStore.getState() as unknown as Record<string, unknown>
    );
    useSettingsStore.getState().setSavedSnapshot(JSON.stringify(snap));

  } catch (err: unknown) {
    // 404 = brak zapisanych preferencji — ustawiamy snapshot z bieżącego stanu
    const isNotFound = (err as { response?: { status?: number } })?.response?.status === 404;
    if (isNotFound) {
      const snap = buildPrefsSnapshot(
        useSettingsStore.getState(),
        useMapStore.getState(),
        useColorStore.getState() as unknown as Record<string, unknown>
      );
      useSettingsStore.getState().setSavedSnapshot(JSON.stringify(snap));
    } else {
      console.warn('[preferences] Failed to load preferences:', err);
    }
  }
};

export const clearPreferencesOnLogout = (): void => {
  // Zerujemy snapshot — przycisk zapisu znika
  useSettingsStore.getState().setSavedSnapshot(null);
};
