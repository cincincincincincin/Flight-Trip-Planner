import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useMapStore } from '../stores/mapStore';
import { useColorStore } from '../stores/colorStore';
import { buildPrefsSnapshot } from '../utils/prefsUtils';
import { PREFERENCES_URL } from '../api/preferences';
import { supabase } from '../lib/supabaseClient';

/**
 * Automatyczny zapis ustawień przy opuszczaniu strony (Emergency Save).
 * Wykorzystuje 'visibilitychange' oraz 'fetch' z flagą 'keepalive'.
 */
export const useSettingsEmergencySave = () => {
  const settings = useSettingsStore();

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'hidden') return;

      const { savedSnapshot, updateSettings } = useSettingsStore.getState();
      const currentSettings = useSettingsStore.getState();
      const mapState = useMapStore.getState();
      const colorState = useColorStore.getState();

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const snap = buildPrefsSnapshot(
        currentSettings,
        mapState,
        colorState as unknown as Record<string, unknown>
      );
      const snapStr = JSON.stringify(snap);

      // [ZERO-WASTE DIRTY CHECK]
      // Only save if there's actually a difference from what we last loaded/saved.
      if (snapStr === savedSnapshot) return;

      console.log('[SETTINGS] Emergency save triggered (visibility hidden)...');

      // Use native fetch with keepalive to ensure request completes even if tab closes.
      // We must manually attach the Supabase token here.
      fetch(PREFERENCES_URL, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ data: snap }),
        keepalive: true
      }).then(res => {
         if (res.ok) {
           // We update the local savedSnapshot so next time we don't save redundant data.
           updateSettings({ savedSnapshot: snapStr });
         }
      }).catch(err => {
         console.warn('[SETTINGS] Emergency save failed:', err);
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);
};
