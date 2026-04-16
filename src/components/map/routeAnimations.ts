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
  key: string; // Unikalna para SRC:DEST
  srcCoords: [number, number];
  destCode: string;
  srcCode: string;
  srcIdx: number;
  gcCoords: [number, number][];
}

/** Konwertuje string na deterministyczny numer 32-bit */
export const hashString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const toFeature = (d: GCPath, coords: [number, number][]) => ({
  type: 'Feature' as const,
  id: hashString(d.key), // Stały hash kodu
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
    if (sourceToDestsMap.size === 0) return [];
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

export interface GCAnimationBatch {
  paths: GCPath[];
  progress: number;
}

/**
 * Dodaje nowe trasy do animacji w sposób addytywny (system pakietowy).
 * Zapobiega przerywaniu trwających animacji przy napływie nowych danych.
 */
export function addRoutesToAnimation(
  map: MapLibreMap,
  animRef: { current: number | null },
  completedPathsRef: { current: GCPath[] },
  currentAnimatingBatchesRef: { current: GCAnimationBatch[] },
  newPaths: GCPath[],
): void {
  if (!map || !newPaths.length) return;

  const source = map.getSource('selected-routes') as GeoJSONSource | undefined;
  if (!source) return;

  // Dodajemy nowy pakiet do kolejki animacji
  currentAnimatingBatchesRef.current.push({
    paths: newPaths,
    progress: 0
  });

  // Jeśli animacja nie trwa, uruchamiamy pętlę
  if (animRef.current !== null) return;

  const speed = CONFIG.ANIMATION_SPEED;

  const renderFrame = () => {
    let hasRunning = false;
    const completedIndices: number[] = [];

    // Aktualizacja wszystkich aktywnych pakietów
    currentAnimatingBatchesRef.current.forEach((batch, idx) => {
      batch.progress += speed;
      if (batch.progress >= 1) {
        completedPathsRef.current = [...completedPathsRef.current, ...batch.paths];
        completedIndices.push(idx);
      } else {
        hasRunning = true;
      }
    });

    // Usuwanie zakończonych pakietów (od końca)
    completedIndices.sort((a, b) => b - a).forEach(idx => {
      currentAnimatingBatchesRef.current.splice(idx, 1);
    });

    // Przygotowanie danych do wyświetlenia (completed + animowane kawałki)
    const features: any[] = completedPathsRef.current.map(d => toFeature(d, d.gcCoords));

    currentAnimatingBatchesRef.current.forEach(batch => {
      const numVisible = Math.max(2, Math.ceil(batch.progress * CONFIG.GC_POINTS) + 1);
      batch.paths.forEach(d => {
        features.push(toFeature(d, d.gcCoords.slice(0, numVisible)));
      });
    });

    source.setData({ type: 'FeatureCollection', features });

    if (hasRunning) {
      animRef.current = requestAnimationFrame(renderFrame);
    } else {
      animRef.current = null;
    }
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
  currentAnimatingBatchesRef: { current: GCAnimationBatch[] | any[] },
): void {
  if (animRef.current !== null) {
    cancelAnimationFrame(animRef.current);
    animRef.current = null;
  }
  completedPathsRef.current = [];
  currentAnimatingBatchesRef.current = [];
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
