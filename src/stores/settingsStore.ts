import { create } from 'zustand';

interface SettingsState {
  currency: string;
  minTransferHours: number;
  minManualTransferHours: number;
  travelDate: string;
  timezone: string | null;
  setCurrency: (v: string) => void;
  setMinTransferHours: (v: number) => void;
  setMinManualTransferHours: (v: number) => void;
  setTravelDate: (v: string) => void;
  setTimezone: (v: string | null) => void;
}

const today = new Date().toLocaleDateString('en-CA');

export const useSettingsStore = create<SettingsState>(set => ({
  currency: 'PLN',
  minTransferHours: 2,
  minManualTransferHours: 1,
  travelDate: today,
  timezone: null,

  setCurrency: v => set({ currency: v }),
  setMinTransferHours: v => set({ minTransferHours: v }),
  setMinManualTransferHours: v => set({ minManualTransferHours: v }),
  setTravelDate: v => set({ travelDate: v }),
  setTimezone: v => set({ timezone: v }),
}));
