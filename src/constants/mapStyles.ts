export const MAP_STYLES = {
  LIGHT: "https://demotiles.maplibre.org/style.json",
  DARK_MATTER: "https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  POSITRON: "https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  VOYAGER: "https://tiles.basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  ARCGIS_SATELLITE: "arcgis:satellite",
  ARCGIS_IMAGERY: "arcgis:imagery",
  ARCGIS_CHARTED: "arcgis:charted-territory",
  ARCGIS_COMMUNITY: "arcgis:community"
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
