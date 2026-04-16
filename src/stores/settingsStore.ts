import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CONFIG } from '../constants/config';
import { getTodayInTz } from '../utils/dateFormatting';
import type { Language } from '../constants/text';
import { logger } from '../utils/logger';

/**
 * Magazyn ustawień użytkownika i sesji. 
 * Metoda updateSettings pozwala na wygodną zmianę dowolnego pola.
 */
export interface SettingsState {
  // --- Atrybuty persystentne (Synchronizowane z PostgreSQL / LocalStorage) ---
  language: Language;
  currency: string;
  minTransferHours: number;
  minManualTransferHours: number;
  showRefreshButton: boolean;
  showConsoleLogs: boolean;

  // --- Atrybuty sesyjne (Ulotne) ---
  travelDate: string;   // Data wylotu, synchronizowana ze strefą czasową wybranego airportu
  timezone: string | null; // Strefa czasowa punktu nawigacyjnego

  // Snapshot z bazy danych, żeby wiedzieć czy mamy jakieś niezapisane zmiany (Dirty Checking).
  savedSnapshot: string | null;

  /**
   * Generyczna metoda aktualizacji stanu (Single Entry Point).
   */
  updateSettings: (values: Partial<Omit<SettingsState, 'updateSettings'>>) => void;
}

// Inicjalizacja języka interfejsu na podstawie preferencji przeglądarki
const detectLanguage = (): Language =>
  navigator.language.toLowerCase().startsWith('pl') ? 'pl' : 'en';

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      // Wartości inicjalne pobierane z modułu CONFIG (Single Source of Truth)
      language: detectLanguage(),
      currency: CONFIG.DEFAULT_CURRENCY,
      minTransferHours: CONFIG.DEFAULT_MIN_TRANSFER_HOURS,
      minManualTransferHours: CONFIG.DEFAULT_MIN_MANUAL_TRANSFER_HOURS,
      showRefreshButton: false,
      showConsoleLogs: false,
      travelDate: getTodayInTz(),
      timezone: null,
      savedSnapshot: null,

      updateSettings: (values) => set((state) => {
        if (values.travelDate) logger.log(`[RACE-DEBUG] {settingsStore} -> updateSettings | Nowa data podróży: ${values.travelDate}`);
        if (values.timezone) logger.log(`[RACE-DEBUG] {settingsStore} -> updateSettings | Nowa strefa czasowa: ${values.timezone}`);
        return { ...state, ...values };
      }),
    }),
    {
      name: 'ftp-settings', // Klucz identyfikacyjny w LocalStorage

      /* 
       * Wybieramy co ma zostać w pamięci przeglądarki (LocalStorage).
       * Datę i strefę czasową pomijamy, żeby nie było błędów przy nowej sesji.
       */
      partialize: (state) => ({
        language: state.language,
        currency: state.currency,
        minTransferHours: state.minTransferHours,
        minManualTransferHours: state.minManualTransferHours,
        showRefreshButton: state.showRefreshButton,
        showConsoleLogs: state.showConsoleLogs,
        savedSnapshot: state.savedSnapshot,
      }),
    }
  )
);
