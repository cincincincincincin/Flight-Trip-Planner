import { useEffect } from 'react';
import type { RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { AirportFeatureProps, Flight } from '../../types';
import { buildGCPaths, addRoutesToAnimation, clearRouteAnimation } from './routeAnimations';
import type { GCPath } from './routeAnimations';

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
  currentAnimatingRef: RefObject<GCPath[]>;
  animationRef: RefObject<number | null>;
  renderedHighlightedRef: RefObject<Set<string>>;
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
}: UseRouteAnimationParams): void {
  useEffect(() => {
    if (!map.current || !mapLoaded || !coordsMap) return;

    if (highlightedAirports.length === 0) {
      clearRouteAnimation(map.current, animationRef, completedPathsRef, currentAnimatingRef);
      renderedHighlightedRef.current = new Set();
      return;
    }

    const currentSet = new Set(highlightedAirports);

    // Step 1: Handle highlighted airport removals (dest no longer in highlighted set)
    const hasRemovals = [...renderedHighlightedRef.current].some(a => !currentSet.has(a));
    if (hasRemovals) {
      if (animationRef.current !== null) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
      if (currentAnimatingRef.current.length > 0) {
        completedPathsRef.current = [...completedPathsRef.current, ...currentAnimatingRef.current];
        currentAnimatingRef.current = [];
      }
      completedPathsRef.current = completedPathsRef.current.filter(p => currentSet.has(p.destCode));
      renderedHighlightedRef.current = new Set([...renderedHighlightedRef.current].filter(a => currentSet.has(a)));
    }

    // Step 2: Remove stale src:dest paths no longer present in displayedFlights
    let hasStale = false;
    if (displayedFlights.length > 0 && (completedPathsRef.current.length > 0 || currentAnimatingRef.current.length > 0)) {
      const srcCodesSet = new Set<string>([...selectedAirportCodes, ...(selectedAirportCode ? [selectedAirportCode] : [])]);
      const wantedPairs = new Set(
        displayedFlights
          .filter(f => f.origin_airport_code && f.destination_airport_code &&
                       srcCodesSet.has(f.origin_airport_code) &&
                       currentSet.has(f.destination_airport_code))
          .map(f => `${f.origin_airport_code}:${f.destination_airport_code}`)
      );
      hasStale = [...completedPathsRef.current, ...currentAnimatingRef.current]
        .some(p => !wantedPairs.has(`${p.srcCode}:${p.destCode}`));
      if (hasStale) {
        if (animationRef.current !== null) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
        if (currentAnimatingRef.current.length > 0) {
          completedPathsRef.current = [...completedPathsRef.current, ...currentAnimatingRef.current];
          currentAnimatingRef.current = [];
        }
        completedPathsRef.current = completedPathsRef.current.filter(p => wantedPairs.has(`${p.srcCode}:${p.destCode}`));
        const remainingDests = new Set(completedPathsRef.current.map(p => p.destCode));
        renderedHighlightedRef.current = new Set([...renderedHighlightedRef.current].filter(a => remainingDests.has(a)));
      }
    }

    // Step 3: Build all desired paths, animate only truly new src:dest pairs
    const sourceSet = new Set<string>(selectedAirportCodes);
    if (selectedAirportCode) sourceSet.add(selectedAirportCode);
    const sourceCodes = [...sourceSet];
    if (sourceCodes.length === 0) return;

    const allWantedPaths = buildGCPaths(sourceCodes, highlightedAirports, coordsMap, displayedFlightsRef.current);
    const renderedPairs = new Set(
      [...completedPathsRef.current, ...currentAnimatingRef.current].map(p => `${p.srcCode}:${p.destCode}`)
    );
    const newPaths = allWantedPaths.filter(p => !renderedPairs.has(`${p.srcCode}:${p.destCode}`));

    if (newPaths.length === 0) {
      // Always sync source with completedPathsRef — handles style change (source recreated empty),
      // removals, stale cleanup, and toggling globe mode.
      const src = map.current.getSource('selected-routes') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData({
          type: 'FeatureCollection',
          features: completedPathsRef.current.map((d, i) => ({
            type: 'Feature' as const, id: i,
            geometry: { type: 'LineString' as const, coordinates: d.gcCoords },
            properties: { destCode: d.destCode, srcIdx: d.srcIdx },
          })),
        });
      }
      return;
    }

    newPaths.forEach(p => renderedHighlightedRef.current.add(p.destCode));
    addRoutesToAnimation(map.current, animationRef, completedPathsRef, currentAnimatingRef, newPaths);
  }, [highlightedAirports, mapLoaded, coordsMap, selectedAirportCode, selectedAirportCodes, displayedFlights]);
}
