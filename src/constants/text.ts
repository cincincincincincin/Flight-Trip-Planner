import { TEXTS_EN } from '../translations/en';
import { TEXTS_PL } from '../translations/pl';

export type Language = 'en' | 'pl';
export const SUPPORTED_LANGUAGES: Language[] = ['en', 'pl'];

export const TRANSLATIONS: Record<Language, typeof TEXTS_EN> = {
  en: TEXTS_EN,
  pl: TEXTS_PL,
};

