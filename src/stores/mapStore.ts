import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MAP_STYLES } from '../constants/mapStyles';
import { CONFIG } from '../constants/config';
import type { Viewport } from '../types';

export interface MapState {
  showAirports: boolean;
  mapStyle: string;
  globeMode: boolean;
  viewport: Viewport;
  controlsPanelOpen: boolean;
  flyToZoom: number | null;
  setShowAirports: (v: boolean) => void;
  setMapStyle: (v: string) => void;
  setGlobeMode: (v: boolean) => void;
  setViewport: (v: Viewport) => void;
  setControlsPanelOpen: (v: boolean) => void;
  setFlyToZoom: (zoom: number | null) => void;
}

export const useMapStore = create<MapState>()(
  persist(
    (set) => ({
      showAirports: true,
      mapStyle: MAP_STYLES.LIGHT,
      globeMode: false,
      viewport: { center: CONFIG.DEFAULT_MAP_CENTER, zoom: CONFIG.DEFAULT_MAP_ZOOM, pitch: 0, bearing: 0 },
      controlsPanelOpen: false,
      flyToZoom: null,

      setShowAirports: v => set({ showAirports: v }),
      setMapStyle: v => set({ mapStyle: v }),
      setGlobeMode: v => set({ globeMode: v }),
      setViewport: v => set({ viewport: v }),
      setControlsPanelOpen: v => set({ controlsPanelOpen: v }),
      setFlyToZoom: zoom => set({ flyToZoom: zoom }),
    }),
    {
      name: 'ftp-map',
      // Zapisujemy tylko styl mapy i tryb globu — viewport i stan UI pomijamy
      partialize: (state) => ({
        mapStyle: state.mapStyle,
        globeMode: state.globeMode,
      }),
    }
  )
);
