import { useMemo } from 'react';
import type { Feature, Point } from 'geojson';
import type { AirportFeatureProps } from '../../types';
import type { ExplorationItem } from '../../stores/selectionStore';
import type { ExplorationDisplayItem } from './ExplorationList';
import { useSettingsStore } from '../../stores/settingsStore';
import { getGeoName } from '../../utils/geoUtils';

/**
 * Silnik Konsolidacji Hierarchicznej.
 * Przekształca surowe kody lotnisk w inteligentne grupy Miasto/Kraj.
 */
export function useExplorationGroups(
  explorationItems: ExplorationItem[],
  airportsMap: Record<string, Feature<Point, AirportFeatureProps>>,
  cityInfoMap: Record<string, { name: string; airportCount: number }>,
  countryInfoMap: Record<string, { name: string; airportCount: number }>,
  countryNameCache: Record<string, string>,
  expandedCityGroups: Set<string>,
): ExplorationDisplayItem[] {
  const language = useSettingsStore(s => s.language);

  return useMemo((): ExplorationDisplayItem[] => {
    if (Object.keys(airportsMap).length === 0 || explorationItems.length === 0) return [];

    // Szybkie wyszukiwanie

    // 1. Zbieramy unikalny zestaw lotnisk z całego magazynu eksploracji
    const allAirportItems: Array<{ id: string; code: string; props: AirportFeatureProps }> = [];
    const seenCodes = new Set<string>();

    for (const item of explorationItems) {
      for (const code of item.airportCodes) {
        if (!seenCodes.has(code)) {
          const feat = airportsMap[code];
          if (feat) {
            allAirportItems.push({ id: item.id, code, props: feat.properties });
            seenCodes.add(code);
          }
        }
      }
    }

    // 2. Grupowanie rozproszonych lotnisk w Miasta i Kraje
    const airportsByCity = new Map<string, typeof allAirportItems>();
    const airportsByCountry = new Map<string, typeof allAirportItems>();

    for (const ap of allAirportItems) {
      const city = ap.props.city_code || '';
      const country = ap.props.country_code || '';

      if (!airportsByCity.has(city)) airportsByCity.set(city, []);
      airportsByCity.get(city)!.push(ap);

      if (!airportsByCountry.has(country)) airportsByCountry.set(country, []);
      airportsByCountry.get(country)!.push(ap);
    }

    // 3. Logika "Promocji" (Consolidation) - Wykrywanie kompletnych struktur
    const processedCities = new Set<string>();
    const processedCountries = new Set<string>();
    const result: ExplorationDisplayItem[] = [];

    // KRAJE (Najwyższy priorytet)
    for (const [cc, aps] of airportsByCountry.entries()) {
      if (!cc) continue;
      const totalInCountry = countryInfoMap[cc]?.airportCount || 0;
      
      // Jeżeli mamy "komplet" lotnisk z danego kraju, zwijamy go w grupę kraju
      if (totalInCountry > 0 && aps.length === totalInCountry) {
        processedCountries.add(cc);
        const childCities = Array.from(new Set(aps.map(a => a.props.city_code || ''))).map(cityCode => {
          const cityAps = aps.filter(a => a.props.city_code === cityCode);
          return {
            cityCode,
            cityName: cityInfoMap[cityCode]?.name || cityCode,
            airports: cityAps.map(a => ({ id: a.id, code: a.code, name: getGeoName(a.props, 'airport', language) }))
          };
        });

        childCities.forEach(c => processedCities.add(c.cityCode));

        result.push({
          kind: 'country-group',
          code: cc,
          name: countryInfoMap[cc]?.name || countryNameCache[cc] || cc,
          airportCodes: aps.map(a => a.code),
          isExpanded: expandedCityGroups.has(cc),
          childCities,
        });
      }
    }

    // MIASTA (Drugorzędny priorytet)
    for (const [cityCode, aps] of airportsByCity.entries()) {
      if (!cityCode || processedCities.has(cityCode)) continue;
      const totalInCity = cityInfoMap[cityCode]?.airportCount || 0;

      // Jeżeli mamy komplet miast, zwijamy je w grupę miasta
      if (totalInCity > 0 && aps.length === totalInCity) {
        processedCities.add(cityCode);
        result.push({
          kind: 'city-group',
          code: cityCode,
          name: cityInfoMap[cityCode]?.name || cityCode,
          airportCodes: aps.map(a => a.code),
          isExpanded: expandedCityGroups.has(cityCode),
          childCities: [{
            cityCode,
            cityName: cityInfoMap[cityCode]?.name || cityCode,
            airports: aps.map(a => ({ id: a.id, code: a.code, name: getGeoName(a.props, 'airport', language) }))
          }],
        });
      } else {
        // POJEDYNCZE LOTNISKA (Fallback)
        // Jeśli miasto jest niekompletne, wyświetlamy kody lotnisk jako osobne kafle
        for (const ap of aps) {
          result.push({
            kind: 'airport',
            itemId: ap.id,
            code: ap.code,
            name: getGeoName(ap.props, 'airport', language),
            airportCodes: [ap.code],
            cityCode: ap.props.city_code,
            countryCode: ap.props.country_code,
          });
        }
      }
    }

    return result;
  }, [explorationItems, airportsMap, cityInfoMap, countryInfoMap, countryNameCache, expandedCityGroups, language]);
}
