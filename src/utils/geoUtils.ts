import type { AirportFeatureProps } from '../types';

type LocalizableField = 'name' | 'city_name' | 'country_name';

/**
 * Returns the localized string for a bilingual AirportFeatureProps field.
 * Falls back to English if the requested language is missing.
 */
export function getLocalizedProp(
  props: AirportFeatureProps,
  field: LocalizableField,
  lang: string,
): string {
  const key = `${field}_${lang}` as keyof AirportFeatureProps;
  const fallback = `${field}_en` as keyof AirportFeatureProps;
  return ((props[key] ?? props[fallback]) as string | undefined) ?? '';
}
