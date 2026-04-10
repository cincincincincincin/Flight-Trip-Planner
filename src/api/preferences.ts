import apiClient from './client';
import type { PrefsSnapshot } from '../utils/prefsUtils';

export const PREFERENCES_URL = `${import.meta.env.VITE_API_URL}/preferences`;

interface PreferencesResponse {
  data: PrefsSnapshot;
}

export const fetchPreferences = async (): Promise<PrefsSnapshot | null> => {
  try {
    const { data } = await apiClient.get<PreferencesResponse>('/preferences');
    return data.data;
  } catch (error: any) {
    if (error.response?.status === 404) return null;
    throw error;
  }
};

export const savePreferences = async (snapshot: PrefsSnapshot): Promise<PrefsSnapshot> => {
  const { data } = await apiClient.put<PreferencesResponse>('/preferences', { data: snapshot });
  return data.data;
};
