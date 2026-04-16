import { useSettingsStore } from '../stores/settingsStore';

/**
 * CENTRALNY MODUŁ LOGOWANIA (Logger)
 * 
 * Pozwala na kontrolowane wypisywanie komunikatów do konsoli.
 * Logi typu 'log', 'warn', 'info' są wyświetlane tylko wtedy, gdy 
 * w ustawieniach (settingsStore) włączona jest opcja 'showConsoleLogs'.
 * Logi typu 'error' są wyświetlane zawsze.
 */
export const logger = {
  log: (...args: any[]) => {
    if (useSettingsStore.getState().showConsoleLogs) {
      console.log(...args);
    }
  },
  warn: (...args: any[]) => {
    if (useSettingsStore.getState().showConsoleLogs) {
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    // Błędy są logowane zawsze
    console.error(...args);
  },
  info: (...args: any[]) => {
    if (useSettingsStore.getState().showConsoleLogs) {
      console.info(...args);
    }
  },
};
