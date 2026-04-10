// Hook zwracający aktywny obiekt tłumaczeń na podstawie języka z ustawień
import { useSettingsStore } from '../stores/settingsStore';
import { TRANSLATIONS } from '../constants/text';
import type { Language } from '../constants/text';

export const useTexts = () => {
  const language = useSettingsStore(s => s.language) as Language;
  return TRANSLATIONS[language];
};
