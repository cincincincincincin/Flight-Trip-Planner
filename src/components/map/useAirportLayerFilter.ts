import { useEffect } from 'react';
import type { RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import type { ExplorationItem } from '../../stores/selectionStore';

interface UseAirportLayerFilterParams {
  map: RefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  highlightedAirports: string[];
  previewAirportCode: string | null;
  selectedAirportCode: string | null;
  selectedAirportCodes: string[];
  explorationItems: ExplorationItem[];
  tripVisibleAirportCodes: string[] | null;
  manualTransferAirportCodes: string[];
  cityLabelCodesRef: RefObject<string[]>;
  airportCityKeyRef: RefObject<Record<string, string>>;
  cityLabelCodeByCityRef: RefObject<Record<string, string>>;
  isRouteHoveredRef: RefObject<boolean>;
  highlightedLabelCodesRef: RefObject<string[]>;
  highlightedCityLabelCodesRef: RefObject<string[]>;
}

export function useAirportLayerFilter({
  map,
  mapLoaded,
  highlightedAirports,
  previewAirportCode,
  selectedAirportCode,
  selectedAirportCodes,
  explorationItems,
  tripVisibleAirportCodes,
  manualTransferAirportCodes,
  cityLabelCodesRef,
  airportCityKeyRef,
  cityLabelCodeByCityRef,
  isRouteHoveredRef,
  highlightedLabelCodesRef,
  highlightedCityLabelCodesRef,
}: UseAirportLayerFilterParams): void {
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const airportsCircles = map.current.getLayer('airports-circles');
    const airportsHighlighted = map.current.getLayer('airports-highlighted');
    const airportsTrip = map.current.getLayer('airports-trip');
    const airportsSelected = map.current.getLayer('airports-selected');
    const labelsNormal = map.current.getLayer('airports-labels-normal');
    const labelsHighlighted = map.current.getLayer('airports-labels-highlighted');
    const labelsNormalCity = map.current.getLayer('airports-labels-normal-city');

    const inTripMode = tripVisibleAirportCodes && tripVisibleAirportCodes.length > 0;

    const effectiveHighlighted = (previewAirportCode && !highlightedAirports.includes(previewAirportCode))
      ? [...highlightedAirports, previewAirportCode]
      : highlightedAirports;

    if (airportsCircles) {
      if (inTripMode) {
        map.current.setFilter('airports-circles', ['==', 'code', '']);
      } else {
        map.current.setFilter('airports-circles', ['!in', 'code', ...effectiveHighlighted]);
      }
    }
    if (airportsHighlighted) {
      map.current.setFilter('airports-highlighted', ['in', 'code', ...effectiveHighlighted]);
    }
    if (airportsTrip) {
      map.current.setFilter('airports-trip', ['in', 'code', ...(tripVisibleAirportCodes ?? [])]);
    }
    if (airportsSelected) {
      if (selectedAirportCodes && selectedAirportCodes.length > 0) {
        map.current.setFilter('airports-selected', ['in', 'code', ...selectedAirportCodes]);
      } else if (selectedAirportCode) {
        map.current.setFilter('airports-selected', ['==', 'code', selectedAirportCode]);
      } else {
        map.current.setFilter('airports-selected', ['==', 'code', '']);
      }
    }
    const cityLabelCodes = cityLabelCodesRef.current;
    const cityCodeByAirport = airportCityKeyRef.current;
    const cityLabelCodeByCity = cityLabelCodeByCityRef.current;
    if (labelsNormal) {
      if (inTripMode) {
        map.current.setFilter('airports-labels-normal', ['==', 'code', '']);
      } else {
        const highlightedCodes = [...new Set([
          ...effectiveHighlighted,
          ...(tripVisibleAirportCodes ?? []),
          ...manualTransferAirportCodes,
          ...(selectedAirportCodes ?? []),
          ...(selectedAirportCode ? [selectedAirportCode] : []),
        ])];
        map.current.setFilter('airports-labels-normal',
          highlightedCodes.length > 0 ? ['!in', 'code', ...highlightedCodes] : null);
      }
    }
    if (labelsNormalCity) {
      if (inTripMode) {
        map.current.setFilter('airports-labels-normal-city', ['==', 'code', '']);
      } else {
        const highlightedCityCodesFromHighlighted = new Set<string>();
        const baseHighlightedCodes = [...new Set([
          ...effectiveHighlighted,
          ...(tripVisibleAirportCodes ?? []),
          ...manualTransferAirportCodes,
          ...(selectedAirportCodes ?? []),
          ...(selectedAirportCode ? [selectedAirportCode] : []),
        ])];
        for (const code of baseHighlightedCodes) {
          const cityKey = cityCodeByAirport[code];
          const rep = cityLabelCodeByCity[cityKey];
          if (rep) highlightedCityCodesFromHighlighted.add(rep);
        }
        const baseCityFilter: maplibregl.LegacyFilterSpecification | null =
          cityLabelCodes.length > 0 ? ['in', 'code', ...cityLabelCodes] : null;
        const highlightedCityFilter: maplibregl.LegacyFilterSpecification | null =
          highlightedCityCodesFromHighlighted.size > 0
            ? ['!in', 'code', ...[...highlightedCityCodesFromHighlighted]]
            : null;
        const allFilters = [baseCityFilter, highlightedCityFilter].filter(Boolean) as maplibregl.FilterSpecification[];
        if (allFilters.length > 1) {
          map.current.setFilter('airports-labels-normal-city', ['all', ...allFilters] as maplibregl.FilterSpecification);
        } else if (allFilters.length === 1) {
          map.current.setFilter('airports-labels-normal-city', allFilters[0] as maplibregl.FilterSpecification);
        } else {
          map.current.setFilter('airports-labels-normal-city', null);
        }
      }
    }
    // Only update highlighted labels if route hover is not active
    if (!isRouteHoveredRef.current) {
      if (labelsHighlighted || map.current.getLayer('airports-labels-highlighted-city')) {
        const codes = [...effectiveHighlighted];
        if (inTripMode) {
          (tripVisibleAirportCodes ?? []).forEach(c => { if (!codes.includes(c)) codes.push(c); });
          manualTransferAirportCodes.forEach(c => { if (!codes.includes(c)) codes.push(c); });
        }
        if (selectedAirportCodes && selectedAirportCodes.length > 0) {
          selectedAirportCodes.forEach(c => { if (!codes.includes(c)) codes.push(c); });
        } else if (selectedAirportCode) {
          if (!codes.includes(selectedAirportCode)) codes.push(selectedAirportCode);
        }
        highlightedLabelCodesRef.current = codes;
        const labelFilter: maplibregl.FilterSpecification = codes.length === 0 ? ['==', 'code', ''] : ['in', 'code', ...codes];
        const highlightedCityCodes = new Set<string>();
        for (const code of codes) {
          const cityKey = cityCodeByAirport[code];
          const rep = cityLabelCodeByCity[cityKey];
          if (rep) highlightedCityCodes.add(rep);
        }
        highlightedCityLabelCodesRef.current = [...highlightedCityCodes];
        if (labelsHighlighted) map.current.setFilter('airports-labels-highlighted', labelFilter);
        if (map.current.getLayer('airports-labels-highlighted-city')) {
          const cityFilter: maplibregl.FilterSpecification = highlightedCityCodes.size === 0
            ? ['==', 'code', '']
            : ['in', 'code', ...highlightedCityLabelCodesRef.current];
          map.current.setFilter('airports-labels-highlighted-city', cityFilter);
        }
      }
    }
  }, [highlightedAirports, previewAirportCode, selectedAirportCode, selectedAirportCodes, explorationItems, mapLoaded, tripVisibleAirportCodes, manualTransferAirportCodes]);
}
