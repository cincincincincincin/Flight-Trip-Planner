// Hook zwracający aktywny obiekt tłumaczeń na podstawie języka z ustawień
import { useSettingsStore } from '../stores/settingsStore';
import { TRANSLATIONS } from '../constants/text';

export const useTexts = () => {
  const language = useSettingsStore(s => s.language);
  return TRANSLATIONS[language];
};
