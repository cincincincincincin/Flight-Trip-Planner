import maplibregl from 'maplibre-gl';
import { MAP_STYLES, isArcGISUrl } from '../../constants/mapStyles';
import { THEME_COLORS } from '../../constants/theme';
import { CONFIG } from '../../constants/config';

export const ARCGIS_API_KEY = import.meta.env.VITE_ARCGIS_API_KEY ?? '';

export const ARCGIS_PLUGIN_STYLES = new Set([MAP_STYLES.ARCGIS_IMAGERY, MAP_STYLES.ARCGIS_CHARTED, MAP_STYLES.ARCGIS_COMMUNITY]);

export function isArcGISPluginStyle(style: string): boolean {
  return ARCGIS_PLUGIN_STYLES.has(style);
}

// Convert MAP_STYLES.ARCGIS_IMAGERY → 'arcgis/imagery' (the format expected by the plugin)
export function toPluginStyleName(style: string): string {
  return style.replace(':', '/');
}

export function arcGISTransformRequest(url: string, _resourceType?: string): { url: string } {
  if (isArcGISUrl(url) && ARCGIS_API_KEY) {
    const separator = url.includes('?') ? '&' : '?';
    return { url: `${url}${separator}token=${ARCGIS_API_KEY}` };
  }
  return { url };
}

export function resolveMapStyle(style: string, globeMode = false): string | maplibregl.StyleSpecification {
  const projection = globeMode ? { type: 'globe' } : undefined;
  switch (style) {
    case MAP_STYLES.ARCGIS_SATELLITE:
      return {
        version: 8,
        name: 'Satellite Map',
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
        ...(projection && { projection } as any),
        sources: {
          satellite: {
            type: 'raster',
            tiles: [`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${ARCGIS_API_KEY}`],
            tileSize: 256,
            attribution: 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> | <a href="https://maplibre.org/" target="_blank" rel="noopener noreferrer">MapLibre</a> | Sources: Esri, TomTom, Garmin, FAO, NOAA, USGS, \u00a9 OpenStreetMap contributors, and the GIS User Community | Source: Esri, Vantor, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community',
          },
          world: {
            type: 'vector',
            url: 'https://demotiles.maplibre.org/tiles/tiles.json',
            attribution: '',
          },
        },
        layers: [
          { id: 'satellite', type: 'raster', source: 'satellite' } as maplibregl.RasterLayerSpecification,
          {
            id: 'country-borders',
            type: 'line',
            source: 'world',
            'source-layer': 'countries',
            paint: { 'line-color': THEME_COLORS.textInverse, 'line-width': 1.2 },
          } as maplibregl.LineLayerSpecification,
          {
            id: 'country-labels',
            type: 'symbol',
            source: 'world',
            'source-layer': 'centroids',
            layout: {
              'text-field': ['get', 'NAME'],
              'text-font': ['Open Sans Regular'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 0, 14, 5, CONFIG.HOVER_RADIUS_FALLBACK, 8, 22],
            },
            paint: { 'text-color': THEME_COLORS.textInverse, 'text-halo-color': THEME_COLORS.textBlack, 'text-halo-width': 1 },
          } as maplibregl.SymbolLayerSpecification,
        ],
      };
    case MAP_STYLES.ARCGIS_IMAGERY:
    case MAP_STYLES.ARCGIS_CHARTED:
    case MAP_STYLES.ARCGIS_COMMUNITY:
      return { version: 8, sources: {}, layers: [] } as maplibregl.StyleSpecification;
    default:
      return style;
  }
}
