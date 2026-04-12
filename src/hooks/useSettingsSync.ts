import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useMapStore } from '../stores/mapStore';
import { useColorStore } from '../stores/colorStore';
import { buildPrefsSnapshot } from '../utils/prefsUtils';
import { savePreferences } from '../api/preferences';

/**
 * Unified Session Synchronization Hook.
 * Synchronizes local settings to the database only when the user leaves the page
 * or refreshes, and only if changes were made (Dirty Checking).
 */
export const useSettingsSync = () => {
  const syncLockRef = useRef(false);

  useEffect(() => {
    const handleSync = async () => {
      // Prevent multiple concurrent syncs
      if (syncLockRef.current) return;

      const { savedSnapshot, updateSettings } = useSettingsStore.getState();
      
      // 1. Build current state snapshot
      const currentSnap = buildPrefsSnapshot(
        useSettingsStore.getState(),
        useMapStore.getState(),
        useColorStore.getState() as any
      );
      const currentSnapStr = JSON.stringify(currentSnap);

      // 2. Dirty Check: Only sync if current state differs from last known saved/loaded state
      if (!savedSnapshot || currentSnapStr === savedSnapshot) {
        return;
      }

      try {
        syncLockRef.current = true;
        console.log('[SETTINGS] Session sync triggered (dirty state detected)...');

        // 3. Save to database
        await savePreferences(currentSnap);

        // 4. Update local "baseline" to avoid redundant saves
        updateSettings({ savedSnapshot: currentSnapStr });

      } catch (err) {
        console.warn('[SETTINGS] Session sync failed:', err);
      } finally {
        syncLockRef.current = false;
      }
    };

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
