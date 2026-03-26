import apiClient from './client';
import type { PrefsSnapshot } from '../utils/i18n';

interface PreferencesResponse {
  data: PrefsSnapshot;
}

export const fetchPreferences = async (): Promise<PrefsSnapshot> => {
  const { data } = await apiClient.get<PreferencesResponse>('/preferences');
  return data.data;
};

export const savePreferences = async (snapshot: PrefsSnapshot): Promise<PrefsSnapshot> => {
  const { data } = await apiClient.put<PreferencesResponse>('/preferences', { data: snapshot });
  return data.data;
};
