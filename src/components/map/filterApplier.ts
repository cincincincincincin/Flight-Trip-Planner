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

  if (map.getLayer('airports-circles')) {
    map.setFilter('airports-circles',
      inTripMode ? ['==', 'code', ''] : ['!in', 'code', ...ha]);
  }
  if (map.getLayer('airports-highlighted')) {
    map.setFilter('airports-highlighted', ['in', 'code', ...ha]);
  }
  if (map.getLayer('airports-trip')) {
    map.setFilter('airports-trip', ['in', 'code', ...(tvac ?? [])]);
  }
  {
    const hovCode = ctx.hoveredAirportCode;
    const highlightedCodes = [...new Set([
      ...ha,
      ...(tvac ?? []),
      ...sacMulti,
      ...explorationCodes,
      ...(sac ? [sac] : []),
      ...ctx.manualTransferAirportCodes,
    ])];
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

    // Only update highlighted labels if route hover is not active
    if (!ctx.isRouteHovered) {
      if (map.getLayer('airports-labels-highlighted') || map.getLayer('airports-labels-highlighted-city')) {
        const codes = [...ha];
        if (inTripMode) {
          (tvac ?? []).forEach(c => { if (!codes.includes(c)) codes.push(c); });
          sacMulti.forEach(c => { if (!codes.includes(c)) codes.push(c); });
          ctx.manualTransferAirportCodes.forEach(c => { if (!codes.includes(c)) codes.push(c); });
        } else if (sacMulti.length > 0) {
          sacMulti.forEach(c => { if (!codes.includes(c)) codes.push(c); });
        } else if (sac && !codes.includes(sac)) {
          codes.push(sac);
        }
        writableRefs.highlightedLabelCodesRef.current = codes;
        const filterCodes = hovCode ? codes.filter(c => c !== hovCode) : codes;
        const filter: maplibregl.FilterSpecification = filterCodes.length === 0 ? ['==', 'code', ''] : ['in', 'code', ...filterCodes];
        const highlightedCityCodes = new Set<string>();
        for (const code of filterCodes) {
          const cityKey = cityCodeByAirport[code];
          const rep = cityLabelCodeByCity[cityKey];
          if (rep) highlightedCityCodes.add(rep);
        }
        writableRefs.highlightedCityLabelCodesRef.current = [...highlightedCityCodes];
        if (map.getLayer('airports-labels-highlighted')) map.setFilter('airports-labels-highlighted', filter);
        if (map.getLayer('airports-labels-highlighted-city')) {
          const cityFilter: maplibregl.FilterSpecification = highlightedCityCodes.size === 0
            ? ['==', 'code', '']
            : ['in', 'code', ...writableRefs.highlightedCityLabelCodesRef.current];
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

  // Update permanent trip routes
  const tripSrc = map.getSource('trip-permanent-routes') as maplibregl.GeoJSONSource | undefined;
  if (tripSrc) {
    const features = ctx.tripRoutes.map((route, i) => ({
      type: 'Feature' as const, id: i,
      geometry: { type: 'LineString' as const, coordinates: generateGreatCircle(route.from, route.to) },
      properties: {}
    }));
    tripSrc.setData({ type: 'FeatureCollection', features });
  }
}
