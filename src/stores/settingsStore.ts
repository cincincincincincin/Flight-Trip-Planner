import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { FORMAT_LOCALES } from '../constants/format';
import type { Language } from '../constants/text';

export interface SettingsState {
  // Trwałe ustawienia (zapisywane w localStorage)
  language: Language;
  currency: string;
  minTransferHours: number;
  minManualTransferHours: number;
  showRefreshButton: boolean;
  showConsoleLogs: boolean;
  // Stan sesji (nie zapisywany)
  travelDate: string;
  timezone: string | null;
  // Synchronizacja z DB (nie zapisywana)
  savedSnapshot: string | null;

  setLanguage: (v: Language) => void;
  setCurrency: (v: string) => void;
  setMinTransferHours: (v: number) => void;
  setMinManualTransferHours: (v: number) => void;
  setShowRefreshButton: (v: boolean) => void;
  setShowConsoleLogs: (v: boolean) => void;
  setTravelDate: (v: string) => void;
  setTimezone: (v: string | null) => void;
  setSavedSnapshot: (v: string | null) => void;
}

// Wykrywa język przeglądarki — używany tylko jako wartość domyślna przy pierwszym uruchomieniu
const detectLanguage = (): Language =>
  navigator.language.toLowerCase().startsWith('pl') ? 'pl' : 'en';

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: detectLanguage(),
      currency: 'PLN',
      minTransferHours: 2,
      minManualTransferHours: 1,
      showRefreshButton: false,
      showConsoleLogs: false,
      travelDate: new Date().toLocaleDateString(FORMAT_LOCALES.CA),
      timezone: null,
      savedSnapshot: null,

      setLanguage: v => set({ language: v }),
      setCurrency: v => set({ currency: v }),
      setMinTransferHours: v => set({ minTransferHours: v }),
      setMinManualTransferHours: v => set({ minManualTransferHours: v }),
      setShowRefreshButton: v => set({ showRefreshButton: v }),
      setShowConsoleLogs: v => set({ showConsoleLogs: v }),
      setTravelDate: v => set({ travelDate: v }),
      setTimezone: v => set({ timezone: v }),
      setSavedSnapshot: v => set({ savedSnapshot: v }),
    }),
    {
      name: 'ftp-settings',
      // Zapisujemy tylko trwałe ustawienia — pomijamy stan sesji i stan synchronizacji
      partialize: (state) => ({
        language: state.language,
        currency: state.currency,
        minTransferHours: state.minTransferHours,
        minManualTransferHours: state.minManualTransferHours,
        showRefreshButton: state.showRefreshButton,
        showConsoleLogs: state.showConsoleLogs,
      }),
    }
  )
);
