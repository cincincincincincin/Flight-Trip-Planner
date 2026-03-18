import { create } from 'zustand';
import type { Viewport } from '../types';

interface MapState {
  showAirports: boolean;
  showCities: boolean;
  showRoutes: boolean;
  mapStyle: string;
  viewport: Viewport;
  controlsPanelOpen: boolean;
  viewMode: 'airports' | 'cities';
  flyToZoom: number | null;
  setShowAirports: (v: boolean) => void;
  setShowCities: (v: boolean) => void;
  setShowRoutes: (v: boolean) => void;
  setMapStyle: (v: string) => void;
  setViewport: (v: Viewport) => void;
  setControlsPanelOpen: (v: boolean) => void;
  setViewMode: (v: 'airports' | 'cities') => void;
  setFlyToZoom: (zoom: number | null) => void;
}

export const useMapStore = create<MapState>(set => ({
  showAirports: true,
  showCities: false,
  showRoutes: false,
  mapStyle: 'https://demotiles.maplibre.org/style.json',
  viewport: { center: [19.0, 52.0], zoom: 4, pitch: 0, bearing: 0 },
  controlsPanelOpen: false,
  viewMode: 'airports',
  flyToZoom: null,

  setShowAirports: v => set({ showAirports: v }),
  setShowCities: v => set({ showCities: v }),
  setShowRoutes: v => set({ showRoutes: v }),
  setMapStyle: v => set({ mapStyle: v }),
  setViewport: v => set({ viewport: v }),
  setControlsPanelOpen: v => set({ controlsPanelOpen: v }),
  setViewMode: v => set({ viewMode: v }),
  setFlyToZoom: zoom => set({ flyToZoom: zoom }),
}));
