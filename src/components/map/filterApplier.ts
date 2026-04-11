import React from 'react';
import maplibregl from 'maplibre-gl';
import type { TripRoute } from '../../types';
import { generateGreatCircle } from './utils';

export interface FilterApplierContext {
  tripVisibleAirportCodes: string[] | null;
  highlightedAirports: string[];
  selectedAirportCode: string | null;
  selectedAirportCodes: string[];
  explorationAirportCodes: string[];
  hoveredAirportCode: string | null;
  cityLabelCodes: string[];
  airportCityKeyMap: Record<string, string>;
  cityLabelCodeByCity: Record<string, string>;
  manualTransferAirportCodes: string[];
  isRouteHovered: boolean;
  tripRoutes: TripRoute[];
  tripState: any;
  coordsMap: Record<string, [number, number]>;
  // HOVER STATE (Faza 2: Unified Filtering)
  excludeCodes?: string[];
  isHoverFocused?: boolean;
}

export interface FilterApplierWritableRefs {
  highlightedLabelCodesRef: React.MutableRefObject<string[]>;
  highlightedCityLabelCodesRef: React.MutableRefObject<string[]>;
}

export function applyMapAirportFilters(
  map: maplibregl.Map,
  ctx: FilterApplierContext,
  writableRefs: FilterApplierWritableRefs,
): void {
  const tvac = ctx.tripVisibleAirportCodes;
  const ha = ctx.highlightedAirports;
  const sac = ctx.selectedAirportCode;
  const sacMulti = ctx.selectedAirportCodes;
  const explorationCodes = ctx.explorationAirportCodes;
  const inTripMode = tvac && tvac.length > 0;

  // INŻYNIERSKA NAPRAWA: MapLibre nie obsługuje poprawnie ['!in', 'code'] (pusta tablica).
  // Musimy jawnie sprawdzić obecność elementów lub ustawić filtr na null.
  const highlightedCodes = [...new Set([
    ...ha.map(c => c.toUpperCase()),
    ...(tvac ?? []).map(c => c.toUpperCase()),
    ...sacMulti.map(c => c.toUpperCase()),
    ...explorationCodes.map(c => c.toUpperCase()),
    ...(sac ? [sac.toUpperCase()] : []),
    ...ctx.manualTransferAirportCodes.map(c => c.toUpperCase()),
  ])];

  if (map.getLayer('airports-circles')) {
    if (inTripMode) {
      map.setFilter('airports-circles', ['==', 'code', '']);
    } else if (highlightedCodes.length > 0) {
      map.setFilter('airports-circles', ['!in', 'code', ...highlightedCodes]);
    } else {
      map.setFilter('airports-circles', null);
    }
  }
  if (map.getLayer('airports-highlighted')) {
    map.setFilter('airports-highlighted', ['in', 'code', ...ha.map(c => c.toUpperCase())]);
  }
  if (map.getLayer('airports-trip')) {
    map.setFilter('airports-trip', ['in', 'code', ...(tvac ?? []).map(c => c.toUpperCase())]);
  }
  {
    const hovCode = ctx.hoveredAirportCode;
    const cityLabelCodes = ctx.cityLabelCodes;
    const cityCodeByAirport = ctx.airportCityKeyMap;
    const cityLabelCodeByCity = ctx.cityLabelCodeByCity;

    if (map.getLayer('airports-labels-normal')) {
      if (inTripMode) {
        map.setFilter('airports-labels-normal', ['==', 'code', '']);
      } else {
        const baseFilter: any[] = highlightedCodes.length > 0
          ? ['!in', 'code', ...highlightedCodes]
          : [];
        const excludeCodes = (ctx.excludeCodes || []).map(c => c.toUpperCase());
        const excludeFilter: any[] = excludeCodes.length > 0
          ? ['!in', 'code', ...excludeCodes]
          : [];

        const allFilters = [
          baseFilter.length > 0 ? baseFilter : null,
          excludeFilter.length > 0 ? excludeFilter : null
        ].filter(Boolean);

        if (allFilters.length > 1) {
          map.setFilter('airports-labels-normal', ['all', ...allFilters] as maplibregl.FilterSpecification);
        } else if (allFilters.length === 1) {
          map.setFilter('airports-labels-normal', allFilters[0] as maplibregl.FilterSpecification);
        } else {
          map.setFilter('airports-labels-normal', null);
        }
      }
    }

    const highlightedCityCodesFromHighlighted = new Set<string>();
    for (const code of highlightedCodes) {
      const cityKey = cityCodeByAirport[code];
      const rep = cityLabelCodeByCity[cityKey];
      if (rep) highlightedCityCodesFromHighlighted.add(rep);
    }

    if (map.getLayer('airports-labels-normal-city')) {
      if (inTripMode) {
        map.setFilter('airports-labels-normal-city', ['==', 'code', '']);
      } else {
        const baseCityFilter: any[] =
          cityLabelCodes.length > 0 ? ['in', 'code', ...cityLabelCodes] : [];
        const highlightCityFilter: any[] =
          highlightedCityCodesFromHighlighted.size > 0
            ? ['!in', 'code', ...[...highlightedCityCodesFromHighlighted]]
            : [];
        const excludeCodes = (ctx.excludeCodes || []).map(c => c.toUpperCase());
        const excludeCityFilter: any[] = excludeCodes.length > 0
          ? ['!in', 'code', ...excludeCodes]
          : [];

        const allFilters = [
          baseCityFilter.length > 0 ? baseCityFilter : null,
          highlightCityFilter.length > 0 ? highlightCityFilter : null,
          excludeCityFilter.length > 0 ? excludeCityFilter : null
        ].filter(Boolean) as maplibregl.FilterSpecification[];

        if (allFilters.length > 1) {
          map.setFilter('airports-labels-normal-city', ['all', ...allFilters] as maplibregl.FilterSpecification);
        } else if (allFilters.length === 1) {
          map.setFilter('airports-labels-normal-city', allFilters[0] as maplibregl.FilterSpecification);
        } else {
          map.setFilter('airports-labels-normal-city', null);
        }
      }
    }

    // TYLKO DLA PODŚWIETLONYCH ETYKIET (jeśli nie ma hovera na trasie)
    if (!ctx.isRouteHovered) {
      if (map.getLayer('airports-labels-highlighted') || map.getLayer('airports-labels-highlighted-city')) {
        // INŻYNIERSKA OPTYMALIZACJA (O(N)): Używamy Set zamiast wielokrotnych .includes w pętli.
        // Zapobiega to wydajnościowej degradacji O(N^2) przy dużej liczbie zaznaczonych punktów.
        const haUpper = ha.map(c => c.toUpperCase());
        const codesSet = new Set<string>(haUpper);

        if (inTripMode) {
          (tvac ?? []).forEach(c => codesSet.add(c.toUpperCase()));
          sacMulti.forEach(c => codesSet.add(c.toUpperCase()));
          ctx.manualTransferAirportCodes.forEach(c => codesSet.add(c.toUpperCase()));
        } else {
          if (sacMulti.length > 0) {
            sacMulti.forEach(c => codesSet.add(c.toUpperCase()));
          } else if (sac) {
            codesSet.add(sac.toUpperCase());
          }
        }

        const codes = [...codesSet];
        writableRefs.highlightedLabelCodesRef.current = codes;

        const hovCodeLower = ctx.hoveredAirportCode?.toUpperCase();
        const filterCodes = hovCodeLower ? codes.filter(c => c !== hovCodeLower) : codes;
        const filter: maplibregl.FilterSpecification = filterCodes.length === 0
          ? ['==', 'code', '']
          : ['in', 'code', ...filterCodes];

        // Wyznaczanie reprezentatywnych kodów miast dla podświetlonych lotnisk
        const highlightedCityCodesSet = new Set<string>();
        for (const code of filterCodes) {
          const cityKey = cityCodeByAirport[code];
          const rep = cityLabelCodeByCity[cityKey];
          if (rep) highlightedCityCodesSet.add(rep);
        }

        const highlightedCityCodes = [...highlightedCityCodesSet];
        writableRefs.highlightedCityLabelCodesRef.current = highlightedCityCodes;

        if (map.getLayer('airports-labels-highlighted')) {
          const excludeFilter: any[] = (ctx.excludeCodes || []).length > 0
            ? ['!in', 'code', ...ctx.excludeCodes!]
            : [];

          if (excludeFilter.length > 0) {
            map.setFilter('airports-labels-highlighted', ['all', filter, excludeFilter] as any);
          } else {
            map.setFilter('airports-labels-highlighted', filter);
          }
        }

        if (map.getLayer('airports-labels-highlighted-city')) {
          const cityFilter: maplibregl.FilterSpecification = highlightedCityCodes.length === 0
            ? ['==', 'code', '']
            : ['in', 'code', ...highlightedCityCodes];

          const excludeFilter: any[] = (ctx.excludeCodes || []).length > 0
            ? ['!in', 'code', ...ctx.excludeCodes!]
            : [];

          if (excludeFilter.length > 0) {
            map.setFilter('airports-labels-highlighted-city', ['all', cityFilter, excludeFilter] as any);
          } else {
            map.setFilter('airports-labels-highlighted-city', cityFilter);
          }
        }
      }
    }
  }

  if (map.getLayer('airports-selected')) {
    const sacMultiUpper = sacMulti.map(c => c.toUpperCase());
    const sacUpper = sac?.toUpperCase();
    if (sacMultiUpper.length > 0) map.setFilter('airports-selected', ['in', 'code', ...sacMultiUpper]);
    else if (sacUpper) map.setFilter('airports-selected', ['==', 'code', sacUpper]);
    else map.setFilter('airports-selected', ['==', 'code', '']);
  }

  // Wyłączamy stare filtry hover - teraz są obsługiwane przez airports-hover-single
  // (Warstwy te zostały usunięte w airportsLayer.ts, więc m.getLayer zwróci false)

  // --- SOURCE UPDATES (Zero-Waste Route Sync) ---

  // 1. Permanent trip routes (Itinerary)
  const tripSrc = map.getSource('trip-permanent-routes') as maplibregl.GeoJSONSource | undefined;
  if (tripSrc) {
    const features = (ctx.tripRoutes || [])
      .filter(route => route && route.from && route.to)
      .map((route, i) => ({
        type: 'Feature' as const, id: i,
        geometry: { type: 'LineString' as const, coordinates: generateGreatCircle(route.from, route.to) },
        properties: { isTripRoute: true }
      }));
    tripSrc.setData({ type: 'FeatureCollection', features });
  }

  // 2. Manual transfer preview routes
  const transferSrc = map.getSource('manual-transfer-preview') as maplibregl.GeoJSONSource | undefined;
  if (transferSrc) {
    const features: any[] = [];
    if (ctx.tripState && ctx.manualTransferAirportCodes.length > 0) {
      const lastLeg = ctx.tripState.legs[ctx.tripState.legs.length - 1];
      const currentCode = lastLeg ? lastLeg.toAirportCode : ctx.tripState.startAirport.code;
      const currentCoords = ctx.coordsMap[currentCode];

      if (currentCoords) {
        ctx.manualTransferAirportCodes.forEach((code, i) => {
          const targetCoords = ctx.coordsMap[code];
          if (targetCoords) {
            features.push({
              type: 'Feature',
              id: i,
              geometry: {
                type: 'LineString',
                coordinates: generateGreatCircle(currentCoords as [number, number], targetCoords as [number, number])
              },
              properties: { isTransferPreview: true }
            });
          }
        });
      }
    }
    transferSrc.setData({ type: 'FeatureCollection', features });
  }
}
