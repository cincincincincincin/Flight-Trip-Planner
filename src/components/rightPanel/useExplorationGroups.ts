import { useMemo } from 'react';
import type { FeatureCollection } from 'geojson';
import type { Point } from 'geojson';
import type { AirportFeatureProps } from '../../types';
import type { ExplorationItem } from '../../stores/selectionStore';
import type { ExplorationDisplayItem } from './ExplorationList';

type CityInfoMap = Record<string, { name: string; country_code: string; airportCount: number }>;
type CountryInfoMap = Record<string, { name: string; airportCount: number }>;

export function useExplorationGroups(
  explorationItems: ExplorationItem[],
  airportsData: FeatureCollection<Point, AirportFeatureProps> | undefined,
  cityInfoMap: CityInfoMap,
  countryInfoMap: CountryInfoMap,
  countryNameCache: Record<string, string>,
  expandedCityGroups: Set<string>,
): ExplorationDisplayItem[] {
  return useMemo((): ExplorationDisplayItem[] => {
    if (!airportsData || explorationItems.length === 0) return [];

    // Country-type items: already have name + all codes stored directly
    if (explorationItems.some(i => i.type === 'country')) {
      return explorationItems.map(item => {
        if (item.type === 'country') {
          const byCity = new Map<string, Array<{ id: string; code: string; name: string }>>();
          for (const code of item.airportCodes) {
            const feat = airportsData.features.find(f => f.properties.code === code);
            const cityCode = feat?.properties.city_code || '';
            if (!byCity.has(cityCode)) byCity.set(cityCode, []);
            byCity.get(cityCode)!.push({ id: item.id, code, name: feat?.properties.name ?? code });
          }
          const childCities = Array.from(byCity.entries()).map(([cityCode, aps]) => ({
            cityCode,
            cityName: cityInfoMap[cityCode]?.name || cityCode,
            airports: aps,
          }));
          return {
            kind: 'country-group' as const,
            code: item.code,
            name: item.name,
            airportCodes: item.airportCodes,
            isExpanded: expandedCityGroups.has(item.code),
            childCities,
          };
        }
        // fallback for mixed lists (shouldn't happen in practice)
        return {
          kind: 'airport' as const,
          itemId: item.id,
          code: item.code,
          name: item.name,
          airportCodes: item.airportCodes,
        };
      });
    }

    // Airport mode: group airports by city
    const allAirportItems: Array<{ id: string; code: string; name: string; cityCode: string; countryCode: string }> = [];
    for (const item of explorationItems) {
      for (const code of item.airportCodes) {
        const feat = airportsData.features.find(f => f.properties.code === code);
        allAirportItems.push({
          id: item.id,
          code,
          name: feat?.properties.name ?? code,
          cityCode: feat?.properties.city_code || '',
          countryCode: feat?.properties.country_code || '',
        });
      }
    }

    // Group by city
    const byCity = new Map<string, typeof allAirportItems>();
    for (const ap of allAirportItems) {
      if (!byCity.has(ap.cityCode)) byCity.set(ap.cityCode, []);
      byCity.get(ap.cityCode)!.push(ap);
    }

    // Determine which cities are complete
    const completeCityCodes = new Set<string>();
    for (const [cityCode, aps] of byCity.entries()) {
      if (!cityCode) continue;
      const total = cityInfoMap[cityCode]?.airportCount ?? 0;
      if (total > 0 && aps.length === total) completeCityCodes.add(cityCode);
    }

    // Determine which countries are complete (all cities complete)
    const byCountry = new Map<string, Set<string>>();
    for (const [cityCode] of byCity.entries()) {
      if (!cityCode) continue;
      const cc = cityInfoMap[cityCode]?.country_code || '';
      if (!byCountry.has(cc)) byCountry.set(cc, new Set());
      byCountry.get(cc)!.add(cityCode);
    }
    const completeCountryCodes = new Set<string>();
    for (const [cc] of byCountry.entries()) {
      if (!cc) continue;
      const totalCountryAirports = countryInfoMap[cc]?.airportCount ?? 0;
      const coveredAirports = allAirportItems.filter(ap => ap.countryCode === cc).length;
      if (totalCountryAirports > 0 && coveredAirports === totalCountryAirports) {
        completeCountryCodes.add(cc);
      }
    }

    // Build display items: countries > cities > airports
    const result: ExplorationDisplayItem[] = [];
    const processedCountries = new Set<string>();
    const processedCities = new Set<string>();

    // Country groups first
    for (const cc of completeCountryCodes) {
      processedCountries.add(cc);
      const citiesForCountry = Array.from(byCity.entries())
        .filter(([cityCode]) => cityInfoMap[cityCode]?.country_code === cc);

      const childCities = citiesForCountry.map(([cityCode, aps]) => ({
        cityCode,
        cityName: cityInfoMap[cityCode]?.name || cityCode,
        airports: aps.map(ap => ({ id: ap.id, code: ap.code, name: ap.name })),
      }));

      citiesForCountry.forEach(([cityCode]) => processedCities.add(cityCode));
      result.push({
        kind: 'country-group',
        code: cc,
        name: (() => { const n = countryInfoMap[cc]?.name; return (n && n !== cc) ? n : (countryNameCache[cc] || cc); })(),
        airportCodes: allAirportItems.filter(ap => ap.countryCode === cc).map(ap => ap.code),
        isExpanded: expandedCityGroups.has(cc),
        childCities,
      });
    }

    // City groups
    for (const [cityCode, aps] of byCity.entries()) {
      if (processedCities.has(cityCode)) continue;
      if (completeCityCodes.has(cityCode)) {
        processedCities.add(cityCode);
        result.push({
          kind: 'city-group',
          code: cityCode,
          name: cityInfoMap[cityCode]?.name || cityCode,
          airportCodes: aps.map(ap => ap.code),
          isExpanded: expandedCityGroups.has(cityCode),
          childCities: [{
            cityCode,
            cityName: cityInfoMap[cityCode]?.name || cityCode,
            airports: aps.map(ap => ({ id: ap.id, code: ap.code, name: ap.name })),
          }],
        });
      } else {
        // Individual airports (incomplete city)
        for (const ap of aps) {
          result.push({
            kind: 'airport',
            itemId: ap.id,
            code: ap.code,
            name: ap.name,
            airportCodes: [ap.code],
            cityCode: ap.cityCode,
            countryCode: ap.countryCode,
          });
        }
      }
    }

    return result;
  }, [explorationItems, airportsData, cityInfoMap, countryInfoMap, countryNameCache, expandedCityGroups]);
}
