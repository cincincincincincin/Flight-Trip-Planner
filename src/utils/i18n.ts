import type { Language } from '../constants/text';
import type { AirportFeatureProps } from '../types';

// Wyciąga zlokalizowaną nazwę (dla miast/krajów) - szuka w tłumaczeniach, inaczej bierze domyślną
export const getLocalizedName = (
  entity: { name: string; name_translations?: Record<string, string> },
  lang: Language
): string => entity.name_translations?.[lang] ?? entity.name;

/**
 * Szuka zlokalizowanej nazwy pola w danych lotniska (np. name_pl, city_name_en).
 * Jak nie znajdzie, wraca do angielskiego, a na koniec oddaje pusty string.
 */
export function getLocalizedProp(
  props: AirportFeatureProps,
  field: 'name' | 'city_name' | 'country_name',
  lang: string,
): string {
  const key = `${field}_${lang}`;
  const fallback = `${field}_en`;
  // @ts-ignore - dynamiczne klucze (name_pl, name_en itd.)
  return props[key] || props[fallback] || '';
}

