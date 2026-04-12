import { useEffect, useRef } from 'react';
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
  const lastFiltersRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const applyFilter = (layerId: string, filter: maplibregl.FilterSpecification | null) => {
      if (!map.current) return;
      const layer = map.current.getLayer(layerId);
      if (!layer) return;

      const filterStr = JSON.stringify(filter);
      if (lastFiltersRef.current[layerId] === filterStr) return;
      
      map.current.setFilter(layerId, filter);
      lastFiltersRef.current[layerId] = filterStr;
    };

    const inTripMode = tripVisibleAirportCodes && tripVisibleAirportCodes.length > 0;

    const effectiveHighlighted = (previewAirportCode && !highlightedAirports.includes(previewAirportCode))
      ? [...highlightedAirports, previewAirportCode]
      : highlightedAirports;

    applyFilter('airports-circles', inTripMode ? ['==', 'code', ''] : ['!in', 'code', ...effectiveHighlighted]);
    applyFilter('airports-highlighted', ['in', 'code', ...effectiveHighlighted]);
    applyFilter('airports-trip', ['in', 'code', ...(tripVisibleAirportCodes ?? [])]);
    
    let selectedFilter: maplibregl.FilterSpecification = ['==', 'code', ''];
    if (selectedAirportCodes && selectedAirportCodes.length > 0) {
      selectedFilter = ['in', 'code', ...selectedAirportCodes];
    } else if (selectedAirportCode) {
      selectedFilter = ['==', 'code', selectedAirportCode];
    }
    applyFilter('airports-selected', selectedFilter);

    const cityLabelCodes = cityLabelCodesRef.current;
    const cityCodeByAirport = airportCityKeyRef.current;
    const cityLabelCodeByCity = cityLabelCodeByCityRef.current;

    if (inTripMode) {
      applyFilter('airports-labels-normal', ['==', 'code', '']);
    } else {
      const highlightedCodes = [...new Set([
        ...effectiveHighlighted,
        ...(tripVisibleAirportCodes ?? []),
        ...manualTransferAirportCodes,
        ...(selectedAirportCodes ?? []),
        ...(selectedAirportCode ? [selectedAirportCode] : []),
      ])];
      applyFilter('airports-labels-normal', highlightedCodes.length > 0 ? ['!in', 'code', ...highlightedCodes] : null);
    }

    if (inTripMode) {
      applyFilter('airports-labels-normal-city', ['==', 'code', '']);
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
      
      let finalCityFilter: maplibregl.FilterSpecification | null = null;
      if (allFilters.length > 1) finalCityFilter = ['all', ...allFilters] as maplibregl.FilterSpecification;
      else if (allFilters.length === 1) finalCityFilter = allFilters[0] as maplibregl.FilterSpecification;
      
      applyFilter('airports-labels-normal-city', finalCityFilter);
    }

    // Only update highlighted labels if route hover is not active
    if (!isRouteHoveredRef.current) {
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

      applyFilter('airports-labels-highlighted', labelFilter);
      
      const cityFilter: maplibregl.FilterSpecification = highlightedCityCodes.size === 0
        ? ['==', 'code', '']
        : ['in', 'code', ...highlightedCityLabelCodesRef.current];
      applyFilter('airports-labels-highlighted-city', cityFilter);
    }
  }, [highlightedAirports, previewAirportCode, selectedAirportCode, selectedAirportCodes, explorationItems, mapLoaded, tripVisibleAirportCodes, manualTransferAirportCodes]);
}
