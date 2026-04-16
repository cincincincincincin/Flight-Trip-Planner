import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useMapStore } from '../stores/mapStore';
import { useColorStore } from '../stores/colorStore';
import { buildPrefsSnapshot } from '../utils/prefsUtils';
import { savePreferences } from '../api/preferences';
import { logger } from '../utils/logger';

/**
 * HOOK SYNCHRONIZACJI SESYJNEJ (Session Sync Controller)
 * Synchronizuje lokalne ustawienia użytkownika z bazą danych tylko w kluczowych momentach 
 * (np. zamknięcie karty, zmiana widoczności strony), wykorzystując mechanizm Dirty Checking.
 */
export const useSettingsSync = () => {
  const syncLockRef = useRef(false);

  useEffect(() => {
    const handleSync = async () => {
      // Prevent multiple concurrent syncs
      if (syncLockRef.current) return;

      const { savedSnapshot, updateSettings } = useSettingsStore.getState();

      // 1. Budujemy migawkę aktualnego stanu (Snapshot) ze wszystkich magazynów
      const currentSnap = buildPrefsSnapshot(
        useSettingsStore.getState(),
        useMapStore.getState(),
        useColorStore.getState() as any
      );
      const currentSnapStr = JSON.stringify(currentSnap);

      // 2. DIRTY CHECK: Synchronizuj tylko jeśli obecny stan różni się od ostatnio zapisanego
      if (!savedSnapshot || currentSnapStr === savedSnapshot) {
        return;
      }

      try {
        syncLockRef.current = true;
        logger.log('[SETTINGS] Rozpoczęto synchronizację sesji (wykryto zmiany)...');

        // 3. Zapis do bazy danych (Supabase)
        await savePreferences(currentSnap);

        // 4. Aktualizacja lokalnego "punktu odniesienia" (baseline), aby uniknąć nadmiarowych zapisów
        updateSettings({ savedSnapshot: currentSnapStr });

      } catch (err) {
        logger.warn('[SETTINGS] Synchronizacja sesji nie powiodła się:', err);
      } finally {
        syncLockRef.current = false;
      }
    };

    /**
     * OBSŁUGA CYKLU ŻYCIA PRZEGLĄDARKI
     * Nasłuchujemy zdarzeń, które sugerują kończenie sesji użytkownika.
     */
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleSync();
      }
    };

    const onPageHide = () => {
      handleSync();
    };

    window.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);
};
