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
  key: string; // [STABLE ID v12.1]: Unique SRC:DEST pair
  srcCoords: [number, number];
  destCode: string;
  srcCode: string;
  srcIdx: number;
  gcCoords: [number, number][];
}

/** [STABLE ID v12.1]: Konwertuje string na deterministyczny numer 32-bit (dla MapLibre feature id) */
export const hashString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const toFeature = (d: GCPath, coords: [number, number][]) => ({
  type: 'Feature' as const,
  id: hashString(d.key), // Używamy stałego hasha zamiast indeksu 'i'
  geometry: { type: 'LineString' as const, coordinates: coords },
  properties: { destCode: d.destCode, srcIdx: d.srcIdx, key: d.key },
});

/**
 * Buduje ścieżki ortodromy dla zestawu NOWYCH lotnisk docelowych.
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
    sourceToDestsMap = new Map();
    const destSet = new Set(newDestCodes.map(d => d.toUpperCase()));
    const srcSet = new Set(sourceCodes.map(s => s.toUpperCase()));
    flightsData.forEach(f => {
      const src = (f.origin_airport_code || '').toUpperCase();
      const dst = (f.destination_airport_code || '').toUpperCase();
      if (src && dst && srcSet.has(src) && destSet.has(dst)) {
        if (!sourceToDestsMap.has(src)) sourceToDestsMap.set(src, new Set());
        sourceToDestsMap.get(src)!.add(dst);
      }
    });
    if (sourceToDestsMap.size === 0) return [];
  } else if (sourceCodes.length === 1) {
    sourceToDestsMap = new Map([[sourceCodes[0], new Set(newDestCodes)]]);
  } else {
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
        key: `${srcCode}:${destCode}`,
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
 * Dodaje nowe trasy do animacji w sposób addytywny.
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
      
      // [ZERO-GAP PROMOTION v11.98]: Synchronize source immediately to avoid empty-frame flicker
      const currentSnapshot = completedPathsRef.current;
      source.setData({
        type: 'FeatureCollection',
        features: currentSnapshot.map((d) => toFeature(d, d.gcCoords)),
      });
    }
  }

  currentAnimatingRef.current = newPaths;
  const snapshotCompleted = [...completedPathsRef.current];
  const speed = CONFIG.ANIMATION_SPEED;
  let progress = 0;

  const renderFrame = () => {
    progress += speed;

    if (progress >= 1) {
      completedPathsRef.current = [...snapshotCompleted, ...newPaths];
      currentAnimatingRef.current = [];
      source.setData({
        type: 'FeatureCollection',
        features: completedPathsRef.current.map((d) => toFeature(d, d.gcCoords)),
      });
      animRef.current = null;
      return;
    }

    const numVisible = Math.max(2, Math.ceil(progress * CONFIG.GC_POINTS) + 1);
    source.setData({
      type: 'FeatureCollection',
      features: [
        ...snapshotCompleted.map((d) => toFeature(d, d.gcCoords)),
        ...newPaths.map((d) => toFeature(d, d.gcCoords.slice(0, numVisible))),
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

  const source = map.getSource('manual-transfer-preview') as GeoJSONSource | undefined;
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
        features: [{ type: 'Feature', id: 888, geometry: { type: 'LineString', coordinates: gcCoords }, properties: { srcIdx: 0 } }],
      });
      return;
    }
    const numVisible = Math.max(2, Math.ceil(progress * CONFIG.GC_POINTS) + 1);
    source.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 888, geometry: { type: 'LineString', coordinates: gcCoords.slice(0, numVisible) }, properties: { srcIdx: 0 } }],
    });
    previewAnimRef.current = requestAnimationFrame(animate);
  };

  previewAnimRef.current = requestAnimationFrame(animate);
}
