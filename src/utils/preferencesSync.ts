import { fetchPreferences } from '../api/preferences';
import type { User } from '@supabase/supabase-js';
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

export const loadPreferencesOnLogin = async (user: User | null): Promise<void> => {
  const s = useSettingsStore.getState();
  
  // Jeśli już trwa synchronizacja lub mamy już załadowany stan z DB, pomijamy
  if (isSyncing || s.savedSnapshot) return;

  try {
    isSyncing = true;
    
    // Heurystyka pierwszego logowania: Jeśli użytkownik jest nowy (data utworzenia konta
    // jest prawie identyczna z datą logowania), pomijamy żądanie do bazy,
    // oszczędzając czas i zasoby sieciowe.
    if (user && user.last_sign_in_at) {
      const created = new Date(user.created_at).getTime();
      const lastSign = new Date(user.last_sign_in_at).getTime();
      if (Math.abs(lastSign - created) < 5000) { // Próg 5 sekund dla rejestracji
        updateLocalSnapshot();
        return;
      }
    }

    const prefs = await fetchPreferences();

    if (!prefs) {
      // Brak zapisanych preferencji (pierwsze logowanie po rejestracji).
      // Nie zapisujemy ich jeszcze, tylko oznaczamy stan lokalny jako gotowy do przyszłego zapisu.
      useSettingsStore.getState().updateSettings({ savedSnapshot: "" });
      return;
    }

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

  } finally {
    isSyncing = false;
  }
};

export const clearPreferencesOnLogout = (): void => {
  // Czyszczenie snapshota przy wylogowaniu
  useSettingsStore.getState().updateSettings({ savedSnapshot: null });
  isSyncing = false;
};
