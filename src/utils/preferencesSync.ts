import { fetchPreferences } from '../api/preferences';
import { useSettingsStore } from '../stores/settingsStore';
import { useMapStore } from '../stores/mapStore';
import { useColorStore } from '../stores/colorStore';
import { buildPrefsSnapshot } from './prefsUtils';

// Funkcja pomocnicza do zapamiętania aktualnego stanu ustawień (pozwala wykryć zmiany do zapisu)
const updateLocalSnapshot = () => {
  const snap = buildPrefsSnapshot(
    useSettingsStore.getState(),
    useMapStore.getState(),
    useColorStore.getState() as unknown as Record<string, unknown>
  );
  useSettingsStore.getState().updateSettings({ savedSnapshot: JSON.stringify(snap) });
};

let isSyncing = false;

export const loadPreferencesOnLogin = async (): Promise<void> => {
  const s = useSettingsStore.getState();
  
  // Jeśli już trwa synchronizacja lub mamy już załadowany stan z DB, pomijamy
  if (isSyncing || s.savedSnapshot) return;

  try {
    isSyncing = true;
    const prefs = await fetchPreferences();

    // Wgrywamy ustawienia ogólne jednym strzałem (Zero-Waste)
    s.updateSettings({
      language: prefs.settings.language as 'en' | 'pl',
      currency: prefs.settings.currency,
      minTransferHours: prefs.settings.min_transfer_hours,
      minManualTransferHours: prefs.settings.min_manual_transfer_hours,
      showRefreshButton: prefs.settings.show_refresh_button,
      showConsoleLogs: prefs.settings.show_console_logs,
    });

    // Wgrywamy styl mapy
    const m = useMapStore.getState();
    m.setMapStyle(prefs.map.map_style);
    m.setGlobeMode(prefs.map.globe_mode);

    // Aktualizujemy dane kolorów, blokując nadpisywanie metod store'a.
    const colorSet = useColorStore.getState();
    const colorData = prefs.colors as Record<string, unknown>;

    // Budujemy obiekt z kolorami, filtrując tylko te klucze, które istnieją w store i nie są funkcjami
    const validColors = Object.fromEntries(
      Object.entries(colorData).filter(([key]) => 
        key in colorSet && typeof (colorSet as any)[key] !== 'function'
      )
    );
    
    // Wgrywamy wszystko jednym strzałem (wydajniej w Zustand)
    useColorStore.setState(validColors);

    // Po wgraniu wszystkiego robimy snapshot, żeby wiedzieć kiedy użytkownik coś zmieni
    updateLocalSnapshot();

  } catch (err: unknown) {
    const isNotFound = (err as { response?: { status?: number } })?.response?.status === 404;

    if (isNotFound) {
      // 404 oznacza, że użytkownik nie ma jeszcze żadnych zapisanych preferencji (pierwsze logowanie)
      // Robimy snapshot stanu domyślnego
      updateLocalSnapshot();
    } else {
      console.warn('[preferences] Failed to load preferences:', err);
    }
  } finally {
    isSyncing = false;
  }
};

export const clearPreferencesOnLogout = (): void => {
  // Czyszczenie snapshota przy wylogowaniu
  useSettingsStore.getState().updateSettings({ savedSnapshot: null });
  isSyncing = false;
};
