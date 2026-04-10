import { useCallback, useRef, useEffect } from 'react';
import { CONFIG } from '../constants/config';
import { calculateZoomByAirportCount } from '../components/map/zoomUtils';
import { useSelectionStore } from '../stores/selectionStore';
import { filterOutliers } from '../utils/math';
import { useCountryCentersQuery, useAirportsMap } from './queries';
import type { MapComponentRef } from '../components/MapComponent';

/**
 * Hook orkiestrujący nawigację kamery na mapie.
 * Zoptymalizowany pod kątem Zero-Waste: wykorzystuje pre-kalkulowane dane o krajach oraz szybki indeks lotnisk.
 */
export function useMapNavigation(mapRef: React.RefObject<MapComponentRef | null>) {
  const { data: countryCenters } = useCountryCentersQuery();
  const airportsMap = useAirportsMap();
  const highlightedAirports = useSelectionStore(s => s.highlightedAirports);
  const highlightedAirportsRef = useRef(highlightedAirports);
  
  useEffect(() => { 
    highlightedAirportsRef.current = highlightedAirports; 
  }, [highlightedAirports]);

  const flyToLocation = useCallback((lon: number, lat: number, zoom: number) => {
    mapRef.current?.flyTo({ 
      center: [lon, lat], 
      zoom, 
      essential: true, 
      duration: CONFIG.FLY_DURATION 
    });
  }, [mapRef]);

  /**
   * Dopasowuje widok do zestawu lotnisk (np. wyniki wyszukiwania).
   */
  const fitBoundsToAirportCodes = useCallback((codes: string[]) => {
    if (Object.keys(airportsMap).length === 0 || codes.length === 0) return;
    const allCodes = [...new Set([
      ...codes.map(c => c.toUpperCase()), 
      ...highlightedAirportsRef.current.map(c => c.toUpperCase())
    ])];
    const points = allCodes
      .map(code => airportsMap[code]?.geometry?.coordinates as [number, number] | undefined)
      .filter((p): p is [number, number] => !!p);
      
    if (points.length === 0) return;
    if (points.length === 1) { 
      flyToLocation(points[0][0], points[0][1], CONFIG.FALLBACK_ZOOM.AIRPORT); 
      return; 
    }
    
    // Zapobiegaj "rozciąganiu" mapy przez lotniska na drugim końcu świata
    const filteredPoints = filterOutliers(points);
    const lons = filteredPoints.map(p => p[0]);
    const lats = filteredPoints.map(p => p[1]);
    
    mapRef.current?.fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], 
      { padding: CONFIG.FIT_BOUNDS_PADDING, duration: CONFIG.FLY_DURATION, maxZoom: CONFIG.FIT_BOUNDS_MAX_ZOOM }
    );
  }, [airportsMap, flyToLocation, mapRef]);

  /**
   * Inteligentne dopasowanie widoku do państwa.
   * Wykorzystuje pre-kalkulowany bbox (bounding box) wygenerowany przez skrypt Pythona,
   * co eliminuje potrzebę liczenia outliersów po stronie klienta.
   */
  const fitToCountry = useCallback((countryCode: string) => {
    const center = countryCenters?.[countryCode];
    if (!center) return;

    // Jeśli skrypt dostarczył pre-kalkulowaną ramkę kontynentalną (bbox), używamy fitBounds
    if (center.bbox) {
      const [minLon, minLat, maxLon, maxLat] = center.bbox;
      mapRef.current?.fitBounds(
        [[minLon, minLat], [maxLon, maxLat]],
        { 
          padding: CONFIG.FIT_BOUNDS_PADDING, 
          duration: CONFIG.FLY_DURATION, 
          maxZoom: Math.max(CONFIG.MAX_ZOOM_FOR_COUNTRY, calculateZoomByAirportCount(center.airportCount)) 
        }
      );
    } else {
      // Fallback: prosty przelot do środka ciężkości
      flyToLocation(center.lon, center.lat, calculateZoomByAirportCount(center.airportCount));
    }
  }, [countryCenters, flyToLocation, mapRef]);

  return {
    flyToLocation,
    fitBoundsToAirportCodes,
    fitToCountry,
  };
}
