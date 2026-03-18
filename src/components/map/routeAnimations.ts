import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { AirportFeatureProps, Flight } from '../../types';
import { generateGreatCircle } from './utils';

const GC_POINTS = 64;

export interface GCPath {
  srcCoords: [number, number];
  destCode: string;
  srcIdx: number;
  gcCoords: [number, number][];
}

/**
 * Build great-circle paths for a set of NEW destination codes.
 * Uses flightsData to correctly route each destination to its origin airport
 * when multiple source airports are selected.
 */
export function buildGCPaths(
  sourceCodes: string[],
  newDestCodes: string[],
  airportsData: FeatureCollection<Point, AirportFeatureProps>,
  flightsData: Flight[],
): GCPath[] {
  if (sourceCodes.length === 0 || newDestCodes.length === 0) return [];

  let sourceToDestsMap: Map<string, Set<string>>;

  if (flightsData.length > 0 && sourceCodes.length > 1) {
    sourceToDestsMap = new Map();
    const destSet = new Set(newDestCodes);
    flightsData.forEach(f => {
      const src = f.origin_airport_code;
      const dst = f.destination_airport_code;
      if (src && dst && sourceCodes.includes(src) && destSet.has(dst)) {
        if (!sourceToDestsMap.has(src)) sourceToDestsMap.set(src, new Set());
        sourceToDestsMap.get(src)!.add(dst);
      }
    });
    if (sourceToDestsMap.size === 0) {
      sourceToDestsMap = new Map([[sourceCodes[0], new Set(newDestCodes)]]);
    }
  } else {
    sourceToDestsMap = new Map([[sourceCodes[0], new Set(newDestCodes)]]);
  }

  const paths: GCPath[] = [];
  sourceToDestsMap.forEach((dests, srcCode) => {
    const srcFeat = airportsData.features.find(f => f.properties.code === srcCode);
    if (!srcFeat) return;
    const srcCoords = srcFeat.geometry.coordinates as [number, number];
    const srcIdx = sourceCodes.indexOf(srcCode);
    dests.forEach(destCode => {
      const destFeat = airportsData.features.find(f => f.properties.code === destCode);
      if (!destFeat) return;
      paths.push({
        srcCoords,
        destCode,
        srcIdx,
        gcCoords: generateGreatCircle(srcCoords, destFeat.geometry.coordinates as [number, number], GC_POINTS),
      });
    });
  });

  return paths;
}

/**
 * Additively animate new route paths on top of already-completed ones.
 * If an animation is already running, it is cancelled and the in-progress
 * paths are instantly promoted to completed before the new animation starts.
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
  const speed = 0.005;
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

    const numVisible = Math.max(2, Math.ceil(progress * GC_POINTS) + 1);
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
 * Cancel any running animation and clear all route data from the map source.
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
  airportsData: FeatureCollection<Point, AirportFeatureProps> | null,
) {
  if (previewAnimRef.current) {
    cancelAnimationFrame(previewAnimRef.current);
    previewAnimRef.current = null;
  }

  if (!map || !airportsData) return;

  const source = map.getSource('transfer-preview-route') as GeoJSONSource | undefined;
  if (!source) return;

  if (!previewAirportCode || !selectedAirportCode) {
    source.setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  const startFeature = airportsData.features.find(f => f.properties.code === selectedAirportCode);
  const destFeature = airportsData.features.find(f => f.properties.code === previewAirportCode);

  if (!startFeature || !destFeature) {
    source.setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  const startCoords = startFeature.geometry.coordinates as [number, number];
  const destCoords = destFeature.geometry.coordinates as [number, number];
  const gcCoords = generateGreatCircle(startCoords, destCoords, GC_POINTS);
  let progress = 0;
  const speed = 0.005;

  const animate = () => {
    progress += speed;
    if (progress >= 1) {
      source.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', id: 0, geometry: { type: 'LineString', coordinates: gcCoords }, properties: {} }],
      });
      return;
    }
    const numVisible = Math.max(2, Math.ceil(progress * GC_POINTS) + 1);
    source.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 0, geometry: { type: 'LineString', coordinates: gcCoords.slice(0, numVisible) }, properties: {} }],
    });
    previewAnimRef.current = requestAnimationFrame(animate);
  };

  previewAnimRef.current = requestAnimationFrame(animate);
}
