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
  const tvac            = ctx.tripVisibleAirportCodes;
  const ha              = ctx.highlightedAirports;
  const sac             = ctx.selectedAirportCode;
  const sacMulti        = ctx.selectedAirportCodes;
  const explorationCodes = ctx.explorationAirportCodes;
  const inTripMode      = tvac && tvac.length > 0;

  // INŻYNIERSKA NAPRAWA: MapLibre nie obsługuje poprawnie ['!in', 'code'] (pusta tablica).
  // Musimy jawnie sprawdzić obecność elementów lub ustawić filtr na null.
  const highlightedCodes = [...new Set([
    ...ha,
    ...(tvac ?? []),
    ...sacMulti,
    ...explorationCodes,
    ...(sac ? [sac] : []),
    ...ctx.manualTransferAirportCodes,
  ])];

  if (map.getLayer('airports-circles')) {
    if (inTripMode) {
      map.setFilter('airports-circles', ['==', 'code', '']);
    } else if (highlightedCodes.length > 0) {
      // Wykluczamy wszystko, co ma własną, bardziej priorytetową warstwę (Selected/Trip/Hl)
      map.setFilter('airports-circles', ['!in', 'code', ...highlightedCodes]);
    } else {
      map.setFilter('airports-circles', null);
    }
  }
  if (map.getLayer('airports-highlighted')) {
    map.setFilter('airports-highlighted', ['in', 'code', ...ha]);
  }
  if (map.getLayer('airports-trip')) {
    map.setFilter('airports-trip', ['in', 'code', ...(tvac ?? [])]);
  }
  {
    const hovCode = ctx.hoveredAirportCode;
    const cityLabelCodes      = ctx.cityLabelCodes;
    const cityCodeByAirport   = ctx.airportCityKeyMap;
    const cityLabelCodeByCity = ctx.cityLabelCodeByCity;

    if (map.getLayer('airports-labels-normal')) {
      if (inTripMode) {
        map.setFilter('airports-labels-normal', ['==', 'code', '']);
      } else {
        const baseFilter: maplibregl.LegacyFilterSpecification | null = highlightedCodes.length > 0
          ? ['!in', 'code', ...highlightedCodes]
          : null;
        const hoverFilter: maplibregl.LegacyFilterSpecification | null = hovCode
          ? ['!=', 'code', hovCode]
          : null;
        if (baseFilter && hoverFilter) {
          map.setFilter('airports-labels-normal', ['all', baseFilter, hoverFilter] as maplibregl.FilterSpecification);
        } else if (baseFilter) {
          map.setFilter('airports-labels-normal', baseFilter);
        } else if (hoverFilter) {
          map.setFilter('airports-labels-normal', hoverFilter);
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
        const baseCityFilter: maplibregl.LegacyFilterSpecification | null =
          cityLabelCodes.length > 0 ? ['in', 'code', ...cityLabelCodes] : null;
        const hoverCityFilter: maplibregl.LegacyFilterSpecification | null = hovCode
          ? ['!=', 'code', cityLabelCodeByCity[cityCodeByAirport[hovCode]] ?? hovCode]
          : null;
        const highlightedCityFilter: maplibregl.LegacyFilterSpecification | null =
          highlightedCityCodesFromHighlighted.size > 0
            ? ['!in', 'code', ...[...highlightedCityCodesFromHighlighted]]
            : null;
        const allFilters = [baseCityFilter, hoverCityFilter, highlightedCityFilter].filter(Boolean) as maplibregl.FilterSpecification[];
        if (allFilters.length > 1) {
          map.setFilter('airports-labels-normal-city', ['all', ...allFilters] as maplibregl.FilterSpecification);
        } else if (allFilters.length === 1) {
          map.setFilter('airports-labels-normal-city', allFilters[0] as maplibregl.FilterSpecification);
        } else if (baseCityFilter) {
          map.setFilter('airports-labels-normal-city', baseCityFilter);
        } else if (hoverCityFilter) {
          map.setFilter('airports-labels-normal-city', hoverCityFilter);
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
        const codesSet = new Set<string>(ha);
        
        if (inTripMode) {
          (tvac ?? []).forEach(c => codesSet.add(c));
          sacMulti.forEach(c => codesSet.add(c));
          ctx.manualTransferAirportCodes.forEach(c => codesSet.add(c));
        } else {
          if (sacMulti.length > 0) {
            sacMulti.forEach(c => codesSet.add(c));
          } else if (sac) {
            codesSet.add(sac);
          }
        }

        const codes = [...codesSet];
        writableRefs.highlightedLabelCodesRef.current = codes;

        const filterCodes = hovCode ? codes.filter(c => c !== hovCode) : codes;
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
          map.setFilter('airports-labels-highlighted', filter);
        }
        
        if (map.getLayer('airports-labels-highlighted-city')) {
          const cityFilter: maplibregl.FilterSpecification = highlightedCityCodes.length === 0
            ? ['==', 'code', '']
            : ['in', 'code', ...highlightedCityCodes];
          map.setFilter('airports-labels-highlighted-city', cityFilter);
        }
      }
    }
  }

  if (map.getLayer('airports-selected')) {
    if (sacMulti.length > 0) map.setFilter('airports-selected', ['in', 'code', ...sacMulti]);
    else if (sac) map.setFilter('airports-selected', ['==', 'code', sac]);
    else map.setFilter('airports-selected', ['==', 'code', '']);
  }

  // --- HOVER LAYERS (Zero-Waste Integration) ---
  const hovCode = ctx.hoveredAirportCode;
  const isHoverFocused = ctx.isHoverFocused;
  const excludeCodes = ctx.excludeCodes || [];

  if (map.getLayer('airports-hover')) {
    map.setFilter('airports-hover', ['==', 'code', hovCode ?? '']);
  }

  if (map.getLayer('airports-labels-hover')) {
    map.setFilter('airports-labels-hover', ['==', 'code', (isHoverFocused && hovCode) ? hovCode : '']);
  }

  if (map.getLayer('airports-labels-hover-general')) {
    map.setFilter('airports-labels-hover-general', ['==', 'code', (!isHoverFocused && hovCode) ? hovCode : '']);
  }

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
