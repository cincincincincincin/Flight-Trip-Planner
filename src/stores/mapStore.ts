import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MAP_INITIAL_STATE } from '../constants/mapDefaults';
import type { Viewport } from '../types';

/**
 * Magazyn stanu mapy kontroluje kamerę, warstwy
 */
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
      ...MAP_INITIAL_STATE,
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
      // Persystencja: zapamiętujemy styl mapy i tryb 3D.
      // Świadomie pomijamy viewport, aby przy nowej sesji mapa zawsze startowała z domyślnego widoku
      partialize: (state) => ({
        mapStyle: state.mapStyle,
        globeMode: state.globeMode,
      }),
    }
  )
);
