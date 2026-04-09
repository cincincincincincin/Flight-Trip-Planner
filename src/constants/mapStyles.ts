export const MAP_STYLES = {
  LIGHT: "MapLibre_Light",
  ARCGIS_IMAGERY: "ArcGIS_Imagery",
  ARCGIS_CHARTED: "ArcGIS_ChartedTerritory",
  ARCGIS_COMMUNITY: "ArcGIS_Community",
  ARCGIS_HUMAN_GEOGRAPHY: "ArcGIS_HumanGeography"
} as const;

export type MapStyleKey = keyof typeof MAP_STYLES;

/**
 * Rozwiązuje URL stylu mapy na podstawie wybranego stylu i trybu Globu.
 * Dla stylów ArcGIS wybiera lokalny, statyczny plik JSON (zoptymalizowany diff).
 */
export const resolveMapStyle = (mapStyle: string, globeMode: boolean): string => {
  // Jeśli styl jest kluczem zestawu ArcGIS (np. ArcGIS_Imagery)
  if (mapStyle.startsWith("ArcGIS_")) {
    const base = mapStyle;
    const suffix = globeMode ? "_globe" : "";
    return `/data/styles/${base}${suffix}.json`;
  }

  // Dla zewnętrznych stylów (MapLibre Demo, Carto) zwracamy oryginalny URL
  // Uwaga: Te style mogą nie wspierać płynnego diffa dla Globu bez dodatkowej obróbki
  const found = Object.values(MAP_STYLES).find(v => v === mapStyle);
  return found || mapStyle;
};

export const MAP_ASSETS = {
  BACKGROUND_IMAGE: 'url("https://images.pexels.com/photos/1169754/pexels-photo-1169754.jpeg")',
  ATTRIBUTION_SATELLITE: 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> | <a href="https://maplibre.org/" target="_blank" rel="noopener noreferrer">MapLibre</a> | Sources: Esri, TomTom, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors, and the GIS User Community | Source: Esri, Vantor, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community',
  ATTRIBUTION_ESRI: '© <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> and contributors',
  ATTRIBUTION_DEMOTILES: '© <a href="https://maplibre.org/">MapLibre</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
};

export const isArcGISUrl = (url: string) => {
  return url.includes('arcgis.com');
};
