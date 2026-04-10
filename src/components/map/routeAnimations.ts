/**
 * MODUŁ ANIMACJI TRAS (routeAnimations.ts)
 * Odpowiada za generowanie i animowanie ścieżek "Great-Circle" (ortodrom) na mapie.
 * Wykorzystuje rygorystyczne filtrowanie danych wejściowych, aby uniknąć błędnych połączeń
 * przy wielu aktywnych lotniskach startowych (Multi-start).
 */

import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { AirportFeatureProps, Flight } from '../../types';
import { generateGreatCircle } from './utils';
import { CONFIG } from '../../constants/config';


export interface GCPath {
  srcCoords: [number, number];
  destCode: string;
  srcCode: string;
  srcIdx: number;
  gcCoords: [number, number][];
}

/**
 * Buduje ścieżki ortodromy dla zestawu NOWYCH lotnisk docelowych.
 * Wykorzystuje flightsData do poprawnego trasowania każdego celu do jego lotniska źródłowego,
 * co jest kluczowe w trybie Multi-start.
 */
export function buildGCPaths(
  sourceCodes: string[],
  newDestCodes: string[],
  coordsMap: Record<string, [number, number]>,
  flightsData: Flight[],
): GCPath[] {
  if (sourceCodes.length === 0 || newDestCodes.length === 0) return [];

  let sourceToDestsMap: Map<string, Set<string>>;

  if (flightsData.length > 0) {
    // Weryfikacja zgodności z danymi lotów – zapobiega rysowaniu tras do lotnisk,
    // które nie są skomunikowane z aktualnym źródłem w danym oknie czasowym.
    sourceToDestsMap = new Map();
    const destSet = new Set(newDestCodes);
    const srcSet = new Set(sourceCodes);
    flightsData.forEach(f => {
      const src = (f.origin_airport_code || '').toUpperCase();
      const dst = (f.destination_airport_code || '').toUpperCase();
      if (src && dst && srcSet.has(src) && destSet.has(dst)) {
        if (!sourceToDestsMap.has(src)) sourceToDestsMap.set(src, new Set());
        sourceToDestsMap.get(src)!.add(dst);
      }
    });
    // Jeśli nie znaleziono dopasowań, przerywamy – dane mogą być nieaktualne (stale data).
    if (sourceToDestsMap.size === 0) return [];
  } else if (sourceCodes.length === 1) {
    // No flight data yet but only one source — optimistically assign all dests to it.
    // Safe because highlightedAirports was derived from that single airport's flights.
    sourceToDestsMap = new Map([[sourceCodes[0], new Set(newDestCodes)]]);
  } else {
    // Multiple sources, no flight data yet — can't determine routing safely.
    return [];
  }

  const paths: GCPath[] = [];
  sourceToDestsMap.forEach((dests, srcCode) => {
    const srcCoords = coordsMap[srcCode];
    if (!srcCoords) return;
    const srcIdx = sourceCodes.indexOf(srcCode);
    dests.forEach(destCode => {
      const destCoords = coordsMap[destCode];
      if (!destCoords) return;
      paths.push({
        srcCoords,
        destCode,
        srcCode,
        srcIdx,
        gcCoords: generateGreatCircle(srcCoords, destCoords, CONFIG.GC_POINTS),
      });
    });
  });

  return paths;
}

/**
 * Dodaje nowe trasy do animacji w sposób addytywny (nałożenie na już ukończone).
 * Jeśli animacja jest w toku, zostaje przerwana, a trasy "w trakcie" są natychmiastowo
 * promowane do ukończonych przed startem nowej fazy animacji.
 */
export function addRoutesToAnimation(
  map: MapLibreMap,
  animRef: { current: number | null },
  completedPathsRef: { current: GCPath[] },
  currentAnimatingRef: { current: GCPath[] },
  newPaths: GCPath[],
): void {
  if (!map || !newPaths.length) return;

  const source = map.getSource('selected-routes') as GeoJSONSource | undefined;
  if (!source) return;

  // If an animation is running, promote the in-progress paths to completed instantly
  if (animRef.current !== null) {
    cancelAnimationFrame(animRef.current);
    animRef.current = null;
    if (currentAnimatingRef.current.length > 0) {
      completedPathsRef.current = [...completedPathsRef.current, ...currentAnimatingRef.current];
      currentAnimatingRef.current = [];
    }
  }

  currentAnimatingRef.current = newPaths;
  const snapshotCompleted = completedPathsRef.current; // snapshot so closure is stable
  const speed = CONFIG.ANIMATION_SPEED;
  let progress = 0;

  const toFeature = (d: GCPath, i: number, coords: [number, number][]) => ({
    type: 'Feature' as const,
    id: i,
    geometry: { type: 'LineString' as const, coordinates: coords },
    properties: { destCode: d.destCode, srcIdx: d.srcIdx },
  });

  const renderFrame = () => {
    progress += speed;

    if (progress >= 1) {
      completedPathsRef.current = [...snapshotCompleted, ...newPaths];
      currentAnimatingRef.current = [];
      source.setData({
        type: 'FeatureCollection',
        features: completedPathsRef.current.map((d, i) => toFeature(d, i, d.gcCoords)),
      });
      animRef.current = null;
      return;
    }

    const numVisible = Math.max(2, Math.ceil(progress * CONFIG.GC_POINTS) + 1);
    source.setData({
      type: 'FeatureCollection',
      features: [
        ...snapshotCompleted.map((d, i) => toFeature(d, i, d.gcCoords)),
        ...newPaths.map((d, i) =>
          toFeature(d, snapshotCompleted.length + i, d.gcCoords.slice(0, numVisible)),
        ),
      ],
    });
    animRef.current = requestAnimationFrame(renderFrame);
  };

  animRef.current = requestAnimationFrame(renderFrame);
}

/**
 * Przerywa trwającą animację i czyści wszystkie warstwy tras z mapy.
 */
export function clearRouteAnimation(
  map: MapLibreMap,
  animRef: { current: number | null },
  completedPathsRef: { current: GCPath[] },
  currentAnimatingRef: { current: GCPath[] },
): void {
  if (animRef.current !== null) {
    cancelAnimationFrame(animRef.current);
    animRef.current = null;
  }
  completedPathsRef.current = [];
  currentAnimatingRef.current = [];
  const source = map.getSource('selected-routes') as GeoJSONSource | undefined;
  if (source) source.setData({ type: 'FeatureCollection', features: [] });
}

export function startPreviewAnimation(
  map: MapLibreMap,
  previewAnimRef: { current: number | null },
  previewAirportCode: string | null,
  selectedAirportCode: string | null,
  coordsMap: Record<string, [number, number]> | null,
) {
  if (previewAnimRef.current) {
    cancelAnimationFrame(previewAnimRef.current);
    previewAnimRef.current = null;
  }

  if (!map || !coordsMap) return;

  const source = map.getSource('transfer-preview-route') as GeoJSONSource | undefined;
  if (!source) return;

  if (!previewAirportCode || !selectedAirportCode) {
    source.setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  const startCoords = selectedAirportCode ? coordsMap[selectedAirportCode.toUpperCase()] : null;
  const destCoords = previewAirportCode ? coordsMap[previewAirportCode.toUpperCase()] : null;

  if (!startCoords || !destCoords) {
    source.setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  const gcCoords = generateGreatCircle(startCoords, destCoords, CONFIG.GC_POINTS);
  let progress = 0;
  const speed = CONFIG.ANIMATION_SPEED;

  const animate = () => {
    progress += speed;
    if (progress >= 1) {
      source.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', id: 0, geometry: { type: 'LineString', coordinates: gcCoords }, properties: {} }],
      });
      return;
    }
    const numVisible = Math.max(2, Math.ceil(progress * CONFIG.GC_POINTS) + 1);
    source.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 0, geometry: { type: 'LineString', coordinates: gcCoords.slice(0, numVisible) }, properties: {} }],
    });
    previewAnimRef.current = requestAnimationFrame(animate);
  };

  previewAnimRef.current = requestAnimationFrame(animate);
}
