import { useEffect } from 'react';
import type { RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { AirportFeatureProps, Flight } from '../../types';
import { buildGCPaths, addRoutesToAnimation, clearRouteAnimation, hashString } from './routeAnimations';
import type { GCPath, GCAnimationBatch } from './routeAnimations';

interface UseRouteAnimationParams {
  map: RefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  highlightedAirports: string[];
  coordsMap: Record<string, [number, number]> | undefined;
  selectedAirportCode: string | null;
  selectedAirportCodes: string[];
  displayedFlights: Flight[];
  displayedFlightsRef: RefObject<Flight[]>;
  completedPathsRef: RefObject<GCPath[]>;
  currentAnimatingRef: RefObject<GCAnimationBatch[]>;
  animationRef: RefObject<number | null>;
  renderedHighlightedRef: RefObject<Set<string>>;
  isFlightsLoading: boolean; // Flaga ładowania
}

export function useRouteAnimation({
  map,
  mapLoaded,
  highlightedAirports,
  coordsMap,
  selectedAirportCode,
  selectedAirportCodes,
  displayedFlights,
  displayedFlightsRef,
  completedPathsRef,
  currentAnimatingRef,
  animationRef,
  renderedHighlightedRef,
  manualTransferAirportCodes,
  isFlightsLoading, // Flaga ładowania
}: UseRouteAnimationParams & { manualTransferAirportCodes: string[] }): void {
  useEffect(() => {
    if (!map.current || !mapLoaded || !coordsMap) return;

    if (highlightedAirports.length === 0) {
      clearRouteAnimation(map.current, animationRef, completedPathsRef, currentAnimatingRef);
      renderedHighlightedRef.current = new Set();
      return;
    }

    const currentSet = new Set(highlightedAirports);

    // Krok 1: Obsługa usuwania podświetlonych lotnisk
    const hasRemovals = [...renderedHighlightedRef.current].some(a => !currentSet.has(a));
    if (hasRemovals) {
      if (animationRef.current !== null) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
      if (currentAnimatingRef.current.length > 0) {
        const allAnimatingPaths = currentAnimatingRef.current.flatMap(b => b.paths);
        completedPathsRef.current = [...completedPathsRef.current, ...allAnimatingPaths];
        currentAnimatingRef.current = [];
      }
      completedPathsRef.current = completedPathsRef.current.filter(p => currentSet.has(p.destCode));
      renderedHighlightedRef.current = new Set([...renderedHighlightedRef.current].filter(a => currentSet.has(a)));
    }

    // Krok 2: Usuwanie nieaktualnych ścieżek src:dest
    // Zaczekaj aż ładowanie się skończy zanim usuniesz stare trasy.
    // Pozwala to na "optymistyczne" zachowanie tras przy zmianie daty.
    let hasStale = false;
    const allAnimatingPathsForStale = currentAnimatingRef.current.flatMap(b => b.paths);
    if (displayedFlights.length > 0 && (completedPathsRef.current.length > 0 || allAnimatingPathsForStale.length > 0)) {
      // Zredukowany zestaw źródeł
      const srcCodesSet = new Set<string>(selectedAirportCodes);
      manualTransferAirportCodes.forEach(c => srcCodesSet.add(c));
      if (selectedAirportCode) srcCodesSet.add(selectedAirportCode);

      const wantedPairs = new Set(
        displayedFlights
          .filter(f => f.origin_airport_code && f.destination_airport_code &&
                       srcCodesSet.has(f.origin_airport_code) &&
                       currentSet.has(f.destination_airport_code))
          .map(f => `${f.origin_airport_code}:${f.destination_airport_code}`)
      );
      
      hasStale = [...completedPathsRef.current, ...allAnimatingPathsForStale]
        .some(p => !wantedPairs.has(`${p.srcCode}:${p.destCode}`));
        
      if (hasStale) {
        if (animationRef.current !== null) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
        if (currentAnimatingRef.current.length > 0) {
          completedPathsRef.current = [...completedPathsRef.current, ...allAnimatingPathsForStale];
          currentAnimatingRef.current = [];
        }
        completedPathsRef.current = completedPathsRef.current.filter(p => wantedPairs.has(`${p.srcCode}:${p.destCode}`));
        const remainingDests = new Set(completedPathsRef.current.map(p => p.destCode));
        renderedHighlightedRef.current = new Set([...renderedHighlightedRef.current].filter(a => remainingDests.has(a)));

        // Natychmiastowa aktualizacja źródła
        const src = map.current.getSource('selected-routes') as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData({
            type: 'FeatureCollection',
            features: completedPathsRef.current.map((d) => ({
              type: 'Feature', 
              id: hashString(d.key), // Stały identyfikator
              geometry: { type: 'LineString', coordinates: d.gcCoords },
              properties: { destCode: d.destCode, srcIdx: d.srcIdx, key: d.key },
            })),
          });
        }
      }
    }

    // Krok 3: Budowanie wszystkich pożądanych ścieżek
    const sourceSet = new Set<string>(selectedAirportCodes);
    manualTransferAirportCodes.forEach(c => sourceSet.add(c));
    if (selectedAirportCode) sourceSet.add(selectedAirportCode);
    const sourceCodes = [...sourceSet];

    if (sourceCodes.length === 0) {
      clearRouteAnimation(map.current, animationRef, completedPathsRef, currentAnimatingRef);
      return;
    }

    const allWantedPaths = buildGCPaths(sourceCodes, highlightedAirports, coordsMap, displayedFlights);
    const renderedPairs = new Set(
      [...completedPathsRef.current, ...currentAnimatingRef.current.flatMap(b => b.paths)].map(p => p.key)
    );
    const newPaths = allWantedPaths.filter(p => !renderedPairs.has(p.key));

    if (newPaths.length === 0) {
      // Synchronizacja źródła z completedPathsRef
      const src = map.current.getSource('selected-routes') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData({
          type: 'FeatureCollection',
          features: completedPathsRef.current.map((d) => ({
            type: 'Feature' as const,
            id: hashString(d.key), // Stały identyfikator
            geometry: { type: 'LineString' as const, coordinates: d.gcCoords },
            properties: { destCode: d.destCode, srcIdx: d.srcIdx, key: d.key },
          })),
        });
      }
      return;
    }

    newPaths.forEach(p => renderedHighlightedRef.current.add(p.destCode));
    addRoutesToAnimation(map.current, animationRef, completedPathsRef, currentAnimatingRef, newPaths);
  }, [highlightedAirports, mapLoaded, coordsMap, selectedAirportCode, selectedAirportCodes, manualTransferAirportCodes, displayedFlights, isFlightsLoading]);
}
