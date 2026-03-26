import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BasemapStyle } from '@esri/maplibre-arcgis';
import type { SelectedItem, Viewport, Flight, TripRoute } from '../types';
import { useMapStore } from '../stores/mapStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useTripStore } from '../stores/tripStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useColorStore } from '../stores/colorStore';
import { useFilterStore } from '../stores/filterStore';
import { useAirportsQuery, useCitiesQuery } from '../hooks/queries';
import { generateGreatCircle, getHaloColorForTextColor, getTextColorForHaloColor, isBlackOrWhiteColor } from './map/utils';
import { getAirport } from '../api/search';
import { addAirportsLayer } from './map/airportsLayer';
// import { addCitiesLayer } from './map/citiesLayer';
// import { addRoutesLayer } from './map/routesLayer';
import { buildGCPaths, addRoutesToAnimation, clearRouteAnimation, startPreviewAnimation } from './map/routeAnimations';
import type { GCPath } from './map/routeAnimations';
import './MapComponent.css';
import './FlightCard.css';
import { useTexts } from '../hooks/useTexts';
import { UI_SYMBOLS } from '../constants/ui';
import { MAP_STYLES, isArcGISUrl } from '../constants/mapStyles';
import { FORMAT_LOCALES, FORMAT_OPTIONS } from '../constants/format';
import { THEME_COLORS } from '../constants/theme';
import { CONFIG } from '../constants/config';

const ARCGIS_API_KEY = import.meta.env.VITE_ARCGIS_API_KEY ?? '';



// Styles that use the @esri/maplibre-arcgis BasemapStyle plugin (not inline specs or raw URLs)
const ARCGIS_PLUGIN_STYLES = new Set([MAP_STYLES.ARCGIS_IMAGERY, MAP_STYLES.ARCGIS_CHARTED, MAP_STYLES.ARCGIS_COMMUNITY]);

function isArcGISPluginStyle(style: string): boolean {
  return ARCGIS_PLUGIN_STYLES.has(style);
}

// Convert MAP_STYLES.ARCGIS_IMAGERY → 'arcgis/imagery' (the format expected by the plugin)
function toPluginStyleName(style: string): string {
  return style.replace(':', '/');
}

function arcGISTransformRequest(url: string, _resourceType?: string): { url: string } {
  if (isArcGISUrl(url) && ARCGIS_API_KEY) {
    const separator = url.includes('?') ? '&' : '?';
    return { url: `${url}${separator}token=${ARCGIS_API_KEY}` };
  }
  return { url };
}

function resolveMapStyle(style: string, globeMode = false): string | maplibregl.StyleSpecification {
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
      // Plugin styles: map is initialised with a blank spec; BasemapStyle.applyStyle
      // fetches and applies the real style after the map's 'load' event fires.
      // Globe projection for plugin styles is applied via setProjection in onMapReady.
      return { version: 8, sources: {}, layers: [] } as maplibregl.StyleSpecification;
    default:
      // URL-based styles (carto, demotiles): return the URL as-is.
      // Globe projection is applied via setProjection after load.
      return style;
  }
}

interface MapComponentProps {
  onViewportChange: (viewport: Viewport) => void;
  onSelectItem: (item: SelectedItem) => void;
  rightPanelRef: React.RefObject<{ scrollToFlight: (code: string) => void } | null>;
}

const MapComponent = forwardRef<unknown, MapComponentProps>(({
  onViewportChange,
  onSelectItem,
  rightPanelRef,
}, ref) => {
  const t = useTexts();

  // Stores
  const { showAirports, /* showCities, */ mapStyle, globeMode, flyToZoom, setFlyToZoom } = useMapStore();
  const { highlightedAirports, selectedAirportCode, selectedAirportCodes, highlightedCities, flightsData, displayedFlights, explorationItems } = useSelectionStore();
  const { tripState, tripRoutes, previewAirportCode, manualTransferAirportCodes } = useTripStore();
  const { travelDate, timezone } = useSettingsStore();
  const { destinationFilter, airlineFilter } = useFilterStore();

  // Color store – subscribe to individual values so effects re-run on change
  const startPoints            = useColorStore(s => s.startPoints);
  const clrGeneral             = useColorStore(s => s.generalAirport);
  const clrDestination         = useColorStore(s => s.destinationAirport);
  const clrTripAirport         = useColorStore(s => s.tripAirport);
  const clrTripRoute           = useColorStore(s => s.tripRoute);
  const clrTransferRoute       = useColorStore(s => s.transferRoute);
  const clrTripHover           = useColorStore(s => s.tripAirportHover);
  const clrGeneralHover        = useColorStore(s => s.generalAirportHover);
  const clrDestinationHover    = useColorStore(s => s.destinationAirportHover);
  const clrTransferRouteHover  = useColorStore(s => s.transferRouteHover);
  const clrGeneralLabelHover   = useColorStore(s => s.generalLabelHoverColor);
  const clrGeneralLabel        = useColorStore(s => s.generalLabelColor);
  const clrDestinationLabel    = useColorStore(s => s.destinationLabelColor);
  const clrDestinationLabelHover = useColorStore(s => s.destinationLabelHoverColor);
  const clrTripLabel           = useColorStore(s => s.tripLabelColor);
  const clrTripLabelHover      = useColorStore(s => s.tripLabelHoverColor);
  const szRouteWidthMin        = useColorStore(s => s.routeLineWidthMin);
  const szRouteWidthMax        = useColorStore(s => s.routeLineWidthMax);
  const szRouteHoverWidthMin   = useColorStore(s => s.routeLineHoverWidthMin);
  const szRouteHoverWidthMax   = useColorStore(s => s.routeLineHoverWidthMax);
  const szHighlightedRadiusMin = useColorStore(s => s.highlightedAirportRadiusMin);
  const szHighlightedRadiusMax = useColorStore(s => s.highlightedAirportRadiusMax);
  const szHighlightedHoverRadiusMin = useColorStore(s => s.highlightedAirportHoverRadiusMin);
  const szHighlightedHoverRadiusMax = useColorStore(s => s.highlightedAirportHoverRadiusMax);
  const szGeneralRadiusMin     = useColorStore(s => s.generalAirportRadiusMin);
  const szGeneralRadiusMax     = useColorStore(s => s.generalAirportRadiusMax);
  const szGeneralHoverRadiusMin = useColorStore(s => s.generalAirportHoverRadiusMin);
  const szGeneralHoverRadiusMax = useColorStore(s => s.generalAirportHoverRadiusMax);
  const szTripRouteWidthMin    = useColorStore(s => s.tripRouteWidthMin);
  const szTripRouteWidthMax    = useColorStore(s => s.tripRouteWidthMax);
  const szTripRouteHoverWidthMin = useColorStore(s => s.tripRouteHoverWidthMin);
  const szTripRouteHoverWidthMax = useColorStore(s => s.tripRouteHoverWidthMax);
  const clrHighlightedCity     = useColorStore(s => s.highlightedCity);
  const clrGeneralCity         = useColorStore(s => s.generalCity);
  const szHighlightedCityRadius = useColorStore(s => s.highlightedCityRadius);
  const szGeneralCityRadius     = useColorStore(s => s.generalCityRadius);
  const szGeneralLabelSizeMin  = useColorStore(s => s.generalAirportLabelSizeMin);
  const szGeneralLabelSizeMax  = useColorStore(s => s.generalAirportLabelSizeMax);
  const szGeneralLabelHoverSizeMin = useColorStore(s => s.generalLabelHoverSizeMin);
  const szGeneralLabelHoverSizeMax = useColorStore(s => s.generalLabelHoverSizeMax);
  const szHighlightedLabelSizeMin = useColorStore(s => s.highlightedLabelSizeMin);
  const szHighlightedLabelSizeMax = useColorStore(s => s.highlightedLabelSizeMax);
  const szHighlightedLabelHoverSizeMin = useColorStore(s => s.highlightedLabelHoverSizeMin);
  const szHighlightedLabelHoverSizeMax = useColorStore(s => s.highlightedLabelHoverSizeMax);
  const zoomRangeMin = useColorStore(s => s.zoomRangeMin);
  const zoomRangeMax = useColorStore(s => s.zoomRangeMax);

  // React Query – geo data
  const { data: airportsData } = useAirportsQuery();
  // const { data: citiesData } = useCitiesQuery(showCities);
  // const { data: routesData } = useRoutesQuery(false);

  // Derived
  const tripVisibleAirportCodes = useMemo(() => {
    if (!tripState) return null;
    return [tripState.startAirport.code, ...tripState.legs.map(l => l.toAirportCode)];
  }, [tripState]);

  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [webglSupported, setWebglSupported] = useState(true);
  const isMapLoading = useRef(false);
  const onSelectItemRef = useRef(onSelectItem);
  const animationRef = useRef<number | null>(null);
  const previewAnimationRef = useRef<number | null>(null);
  // Additive animation state
  const completedPathsRef = useRef<GCPath[]>([]);
  const currentAnimatingRef = useRef<GCPath[]>([]);
  const renderedHighlightedRef = useRef<Set<string>>(new Set());
  const hoveredRouteId = useRef<string | number | null>(null);
  const hoveredTripRouteId = useRef<string | number | null>(null);
  const hoveredTransferRouteId = useRef<string | number | null>(null);
  const routeHoverAtPointRef = useRef<((point: { x: number; y: number }) => void) | null>(null);
  const clearRouteHoverRef = useRef<((opts?: { keepLabels?: boolean }) => void) | null>(null);
  const currentPopup = useRef<maplibregl.Popup | null>(null);

  // Refs for dynamic values used inside stable callbacks
  const tripVisibleAirportCodesRef = useRef<string[] | null>(null);
  const highlightedAirportsRef = useRef<string[]>([]);
  const airportsDataRef = useRef(airportsData);
  const highlightedLabelCodesRef = useRef<string[]>([]); // codes used for highlighted label filter (for hover exclusion)
  const selectedAirportCodeRef = useRef<string | null>(null);
  const selectedAirportCodesRef = useRef<string[]>([]);
  const explorationAirportCodesRef = useRef<string[]>([]);
  const tripRoutesRef = useRef<TripRoute[]>([]);
  const manualTransferAirportCodesRef = useRef<string[]>([]);

  // Ref to track whether a route hover is currently active
  const isRouteHoveredRef = useRef<boolean>(false);

  // Size refs for route hover styling
  const highlightedAirportHoverRadiusMinRef = useRef<number>(CONFIG.HOVER_STOP_DELAY_MS);
  const highlightedAirportHoverRadiusMaxRef = useRef<number>(CONFIG.HOVER_CLEAR_DELAY_MS);
  const highlightedLabelHoverSizeMinRef = useRef<number>(11);
  const highlightedLabelHoverSizeMaxRef = useRef<number>(22);
  const zoomRangeMinRef = useRef<number>(1.3);
  const zoomRangeMaxRef = useRef<number>(5.5);

  // Airport hover state managed directly via map.setFilter (no React state = no render delay)
  const hoveredAirportCodeRef = useRef<string | null>(null);
  // Pre-projected pixel positions of visible airports — rebuilt on moveend.
  const projectedAirportsRef = useRef<Array<{ code: string; x: number; y: number }>>([]);
  const lastDetectedCodeRef = useRef<string | null>(null);
  const hoverSampleCountRef = useRef(0);  // airports skipped since last hover update
  const mouseStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverLockUntilRef = useRef<number>(0);

  const airportNamesMap = useRef<Record<string, string>>({});
  // [lng, lat] per airport code — for zoom-in-on-click at low zoom levels
  const airportCoordsMapRef = useRef<Record<string, [number, number]>>({});
  const airportCityKeyRef = useRef<Record<string, string>>({});
  const cityLabelCodeByCityRef = useRef<Record<string, string>>({});
  const cityLabelCodesRef = useRef<string[]>([]);
  const highlightedCityLabelCodesRef = useRef<string[]>([]);
  const flightDetailsMap = useRef<Record<string, Flight[]>>({});
  const matchesFilterRef = useRef<((flight: Flight) => boolean) | null>(null);

  useEffect(() => {
    onSelectItemRef.current = (item) => {
      // In trip mode, clicking any airport should either be ignored (trip airports)
      // or toggle the destination filter (all others including highlighted destinations)
      if (
        tripVisibleAirportCodesRef.current &&
        tripVisibleAirportCodesRef.current.length > 0 &&
        item.type === 'airport'
      ) {
        // Trip airports (black dots) — do nothing
        if (tripVisibleAirportCodesRef.current.includes(item.data.code)) return;
        // All other airports — set destination filter (same as clicking a route line)
        useFilterStore.getState().setDestinationFilter({ airports: [item.data.code], cities: [], countries: [] });
        return;
      }
      onSelectItem(item);
    };
  }, [onSelectItem]);
  useEffect(() => { tripVisibleAirportCodesRef.current = tripVisibleAirportCodes; }, [tripVisibleAirportCodes]);
  useEffect(() => { highlightedAirportsRef.current = highlightedAirports; }, [highlightedAirports]);
  useEffect(() => { airportsDataRef.current = airportsData; }, [airportsData]);
  useEffect(() => { selectedAirportCodeRef.current = selectedAirportCode; }, [selectedAirportCode]);
  useEffect(() => { selectedAirportCodesRef.current = selectedAirportCodes; }, [selectedAirportCodes]);
  useEffect(() => {
    explorationAirportCodesRef.current = explorationItems.flatMap(i => i.airportCodes);
  }, [explorationItems]);
  useEffect(() => { tripRoutesRef.current = tripRoutes; }, [tripRoutes]);
  useEffect(() => { manualTransferAirportCodesRef.current = manualTransferAirportCodes; }, [manualTransferAirportCodes]);

  // Size refs for hover styling
  useEffect(() => {
    highlightedAirportHoverRadiusMinRef.current = szHighlightedHoverRadiusMin;
    highlightedAirportHoverRadiusMaxRef.current = szHighlightedHoverRadiusMax;
    highlightedLabelHoverSizeMinRef.current = szHighlightedLabelHoverSizeMin;
    highlightedLabelHoverSizeMaxRef.current = szHighlightedLabelHoverSizeMax;
    zoomRangeMinRef.current = zoomRangeMin;
    zoomRangeMaxRef.current = zoomRangeMax;
  }, [szHighlightedHoverRadiusMin, szHighlightedHoverRadiusMax, szHighlightedLabelHoverSizeMin, szHighlightedLabelHoverSizeMax, zoomRangeMin, zoomRangeMax]);

  const highlightedCitiesRef = useRef<string[]>([]);
  useEffect(() => { highlightedCitiesRef.current = highlightedCities; }, [highlightedCities]);

  const previewAirportCodeRef = useRef<string | null>(null);
  useEffect(() => { previewAirportCodeRef.current = previewAirportCode; }, [previewAirportCode]);

  const travelDateRef = useRef<string | null>(null);
  useEffect(() => { travelDateRef.current = travelDate; }, [travelDate]);

  const timezoneRef = useRef<string | null>(null);
  useEffect(() => { timezoneRef.current = timezone; }, [timezone]);

  useEffect(() => {
    if (airportsData) {
      const nameMap: Record<string, string> = {};
      const coordsMap: Record<string, [number, number]> = {};
      const codeToCity: Record<string, string> = {};
      const cityToCode: Record<string, string> = {};
      airportsData.features.forEach(f => {
        const code = f.properties.code;
        nameMap[code] = f.properties.name;
        coordsMap[code] = f.geometry.coordinates as [number, number];
        const cityKey = f.properties.city_code || f.properties.city_name || code;
        codeToCity[code] = cityKey;
        if (!cityToCode[cityKey]) cityToCode[cityKey] = code;
      });
      airportNamesMap.current = nameMap;
      airportCoordsMapRef.current = coordsMap;
      airportCityKeyRef.current = codeToCity;
      cityLabelCodeByCityRef.current = cityToCode;
      cityLabelCodesRef.current = Object.values(cityToCode);
    }
  }, [airportsData]);

  // ── Airport city and country maps for filter matching ───────────────────────
  const airportCityMap = useMemo<Record<string, string>>(() => {
    if (!airportsData) return {};
    const map: Record<string, string> = {};
    airportsData.features.forEach(f => {
      if (f.properties.code && f.properties.city_code) {
        map[f.properties.code] = f.properties.city_code;
      }
    });
    return map;
  }, [airportsData]);

  const airportCountryMap = useMemo<Record<string, string>>(() => {
    if (!airportsData) return {};
    const map: Record<string, string> = {};
    airportsData.features.forEach(f => {
      if (f.properties.code) {
        map[f.properties.code] = f.properties.country_code ?? '';
      }
    });
    return map;
  }, [airportsData]);

  // ── Filter matching function (same as FlightsList) ────────────────────────
  const matchesFilter = useCallback(
    (flight: Flight): boolean => {
      const hasFilters = destinationFilter.airports.length > 0 ||
        destinationFilter.cities.length > 0 ||
        destinationFilter.countries.length > 0 ||
        airlineFilter.length > 0;

      if (!hasFilters) return true;

      const destAirport = flight.destination_airport_code;
      const destCity = flight.destination_city_code || airportCityMap[destAirport];
      const destCountry = airportCountryMap[destAirport];
      const airline = flight.airline_code;

      const destFilterActive = destinationFilter.airports.length > 0 ||
        destinationFilter.cities.length > 0 ||
        destinationFilter.countries.length > 0;

      let destMatch = true;
      if (destFilterActive) {
        destMatch = !!(destAirport && destinationFilter.airports.includes(destAirport)) ||
          !!(destCity && destinationFilter.cities.includes(destCity)) ||
          !!(destCountry && destinationFilter.countries.includes(destCountry));
      }

      let airlineMatch = true;
      if (airlineFilter.length > 0) {
        airlineMatch = !!(airline && airlineFilter.includes(airline));
      }

      return destMatch && airlineMatch;
    },
    [destinationFilter, airlineFilter, airportCityMap, airportCountryMap]
  );

  // Keep matchesFilter in a ref so it can be used in closures (line 1CONFIG.HOVER_STOP_DELAY_MS0 for popup generation)
  useEffect(() => {
    matchesFilterRef.current = matchesFilter;
  }, [matchesFilter]);

  // Keep a ref for flightsData (all accumulated flights) for backward-compat uses.
  const flightsDataRef = useRef<Flight[]>(flightsData);
  useEffect(() => { flightsDataRef.current = flightsData; }, [flightsData]);

  // displayedFlights = only the flights currently visible in the RightPanel list
  // (today's TZ window, respecting filters). Used for route drawing and popup.
  const displayedFlightsRef = useRef<Flight[]>(displayedFlights);
  useEffect(() => {
    displayedFlightsRef.current = displayedFlights;
    const map: Record<string, Flight[]> = {};
    displayedFlights.forEach(flight => {
      const destCode = flight.destination_airport_code;
      if (!map[destCode]) map[destCode] = [];
      map[destCode].push(flight);
    });
    flightDetailsMap.current = map;
  }, [displayedFlights]);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      console.error('WebGL is not supported');
      setWebglSupported(false);
    }
  }, []);

  useImperativeHandle(ref, () => ({
    flyTo: (options: maplibregl.FlyToOptions) => {
      if (map.current) {
        map.current.flyTo(options);
      }
    },
    getZoom: () => {
      return map.current?.getZoom();
    },
    once: (event: string, callback: (...args: unknown[]) => void) => {
      if (map.current) {
        map.current.once(event, callback as maplibregl.Listener);
      }
    },
    fitBounds: (bounds: [[number, number], [number, number]], options?: { padding?: number; duration?: number; maxZoom?: number }) => {
      if (map.current) map.current.fitBounds(bounds as maplibregl.LngLatBoundsLike, options);
    },
  }));

  const initMapId = useRef(0);

  const initMap = useCallback(() => {
    if (!webglSupported || !mapContainer.current) return;

    if (map.current) {
      try {
        map.current.remove();
      } catch (e) {
        console.warn('Error removing old map:', e);
      }
      map.current = null;
      setMapLoaded(false);
    }

    isMapLoading.current = true;
    const initId = ++initMapId.current;

    const currentGlobeMode = useMapStore.getState().globeMode;
    const isPlugin = isArcGISPluginStyle(mapStyle);
    const resolvedStyle = resolveMapStyle(mapStyle, currentGlobeMode);

    const doCreateMap = (style: string | maplibregl.StyleSpecification) => {
      if (initId !== initMapId.current || !mapContainer.current) return;
      try {
        map.current = new maplibregl.Map({
          container: mapContainer.current,
          style,
          center: [19.0, 52.0],
          zoom: 4,
          attributionControl: false,
          antialias: true,
          preserveDrawingBuffer: true,
          failIfMajorPerformanceCaveat: false,
          desynchronized: false,
          dragRotate: false,
          transformRequest: arcGISTransformRequest,
        } as maplibregl.MapOptions);

        const onMapReady = () => {
          isMapLoading.current = false;
          setMapLoaded(true);
          addControls();
          addLayers();
          const { zoomRangeMin, zoomRangeMax } = useColorStore.getState();
          const minZ = Math.max(1, Math.min(zoomRangeMin, zoomRangeMax));
          const maxZ = Math.min(12, Math.max(zoomRangeMin, zoomRangeMax));
          map.current?.setMinZoom(minZ);
          map.current?.setMaxZoom(maxZ);
        };

        map.current.on('load', () => {
          if (isPlugin) {
            // Blank style is now loaded → isStyleLoaded() is true → safe to call applyStyle.
            const bs = BasemapStyle.applyStyle(map.current!, {
              map: map.current!,
              style: toPluginStyleName(mapStyle),
              token: ARCGIS_API_KEY,
            });
            bs.on('BasemapStyleLoad', () => {
              console.log('ArcGIS plugin style loaded:', mapStyle);
              onMapReady();
              // The plugin injects its own attribution control at bottom-right.
              // Move it to bottom-left and clean up the text to match other styles.
              requestAnimationFrame(() => {
                if (!map.current) return;
                const c = map.current.getContainer();
                const attrib = c.querySelector<HTMLElement>('.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib');
                const bottomLeft = c.querySelector('.maplibregl-ctrl-bottom-left');
                if (attrib && bottomLeft) {
                  bottomLeft.appendChild(attrib);
                }
                const inner = c.querySelector('.maplibregl-ctrl-attrib-inner');
                if (inner) {
                  inner.innerHTML = '© <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> and contributors';
                }
              });
            });
            bs.on('BasemapStyleError', (err: Error) => {
              console.error('ArcGIS basemap style error:', err);
              isMapLoading.current = false;
            });
          } else {
            console.log('Map loaded successfully');
            onMapReady();
          }
        });

        map.current.on('move', () => {
          if (!map.current || !onViewportChange) return;
          const center = map.current.getCenter();
          const zoom = map.current.getZoom();
          const pitch = map.current.getPitch();
          const bearing = map.current.getBearing();
          onViewportChange({
            center: [center.lng, center.lat],
            zoom,
            pitch,
            bearing
          });
        });

        map.current.on('error', (e) => {
          console.error('Map error:', e.error?.message || e);
        });
      } catch (error) {
        console.error('Error initializing map:', error);
        isMapLoading.current = false;
      }
    };

    // For URL-based styles in globe mode: fetch the style JSON, inject projection,
    // and pass the modified spec so the map starts as a globe immediately.
    if (currentGlobeMode && typeof resolvedStyle === 'string') {
      fetch(resolvedStyle)
        .then(r => r.json())
        .then((json: maplibregl.StyleSpecification) => {
          (json as any).projection = { type: 'globe' };
          doCreateMap(json);
        })
        .catch(() => doCreateMap(resolvedStyle));
    } else {
      doCreateMap(resolvedStyle);
    }
  }, [mapStyle, onViewportChange, webglSupported]);

  useEffect(() => {
    initMap();
    return () => {
      if (map.current) {
        try {
          map.current.remove();
        } catch (e) {}
        map.current = null;
        setMapLoaded(false);
      }
      isMapLoading.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (previewAnimationRef.current) {
        cancelAnimationFrame(previewAnimationRef.current);
      }
      if (currentPopup.current) {
        currentPopup.current.remove();
      }
    };
  }, [initMap]);

  const addControls = useCallback(() => {
    if (!map.current) return;
    try {
      map.current.addControl(new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
        visualizePitch: true
      }), 'top-right');
      map.current.addControl(new maplibregl.ScaleControl({
        maxWidth: 120,
        unit: 'metric'
      }), 'bottom-right');
      if (!isArcGISPluginStyle(mapStyle)) {
        const isDemotiles = mapStyle === MAP_STYLES.LIGHT;
        const customAttribution = isDemotiles
          ? '© <a href="https://maplibre.org/">MapLibre</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          : undefined;
        map.current.addControl(
          new maplibregl.AttributionControl({ compact: false, customAttribution }),
          'bottom-left'
        );
      }
    } catch (error) {
      console.error('Error adding controls:', error);
    }
  }, [mapStyle]);

  const safeRemoveLayer = useCallback((id: string) => {
    if (map.current && map.current.getLayer(id)) {
      map.current.removeLayer(id);
    }
  }, []);

  const safeRemoveSource = useCallback((id: string) => {
    if (map.current && map.current.getSource(id)) {
      map.current.removeSource(id);
    }
  }, []);

  // Central function updating airport filters and trip routes (uses refs)
  const applyAirportFilters = useCallback(() => {
    if (!map.current) return;
    const tvac = tripVisibleAirportCodesRef.current;
    const ha = highlightedAirportsRef.current;
    const sac = selectedAirportCodeRef.current;
    const sacMulti = selectedAirportCodesRef.current ?? [];
    const explorationCodes = explorationAirportCodesRef.current ?? [];
    const inTripMode = tvac && tvac.length > 0;

    if (map.current.getLayer('airports-circles')) {
      map.current.setFilter('airports-circles',
        inTripMode ? ['==', 'code', ''] : ['!in', 'code', ...ha]);
    }
    if (map.current.getLayer('airports-highlighted')) {
      map.current.setFilter('airports-highlighted', ['in', 'code', ...ha]);
    }
    if (map.current.getLayer('airports-trip')) {
      map.current.setFilter('airports-trip', ['in', 'code', ...(tvac ?? [])]);
    }
    {
      const hovCode = hoveredAirportCodeRef.current;
      const highlightedCodes = [...new Set([
        ...ha,
        ...(tvac ?? []),
        ...sacMulti,
        ...explorationCodes,
        ...(sac ? [sac] : []),
        ...manualTransferAirportCodesRef.current,
      ])];
      const cityLabelCodes = cityLabelCodesRef.current;
      const cityCodeByAirport = airportCityKeyRef.current;
      const cityLabelCodeByCity = cityLabelCodeByCityRef.current;
      if (map.current.getLayer('airports-labels-normal')) {
        if (inTripMode) {
          map.current.setFilter('airports-labels-normal', ['==', 'code', '']);
        } else {
          const baseFilter: maplibregl.LegacyFilterSpecification | null = highlightedCodes.length > 0
            ? ['!in', 'code', ...highlightedCodes]
            : null;
          const hoverFilter: maplibregl.LegacyFilterSpecification | null = hovCode
            ? ['!=', 'code', hovCode]
            : null;
          if (baseFilter && hoverFilter) {
            map.current.setFilter('airports-labels-normal', ['all', baseFilter, hoverFilter] as maplibregl.FilterSpecification);
          } else if (baseFilter) {
            map.current.setFilter('airports-labels-normal', baseFilter);
          } else if (hoverFilter) {
            map.current.setFilter('airports-labels-normal', hoverFilter);
          } else {
            map.current.setFilter('airports-labels-normal', null);
          }
        }
      }
      const highlightedCityCodesFromHighlighted = new Set<string>();
      for (const code of highlightedCodes) {
        const cityKey = cityCodeByAirport[code];
        const rep = cityLabelCodeByCity[cityKey];
        if (rep) highlightedCityCodesFromHighlighted.add(rep);
      }
      if (map.current.getLayer('airports-labels-normal-city')) {
        if (inTripMode) {
          map.current.setFilter('airports-labels-normal-city', ['==', 'code', '']);
        } else {
          const baseCityFilter: maplibregl.LegacyFilterSpecification | null =
            cityLabelCodes.length > 0 ? ['in', 'code', ...cityLabelCodes] : null;
          const hoverCityFilter: maplibregl.LegacyFilterSpecification | null = hovCode
            ? ['!=', 'code', cityLabelCodeByCity[cityCodeByAirport[hovCode]] ?? hovCode]
            : null;
          const highlightedCityFilter: maplibregl.LegacyFilterSpecification | null =
            highlightedCityCodesFromHighlighted.size > 0
              ? ['!in', 'code', ...[...highlightedCityCodesFromHighlighted]]
              : null;
          const allFilters = [baseCityFilter, hoverCityFilter, highlightedCityFilter].filter(Boolean) as maplibregl.FilterSpecification[];
          if (allFilters.length > 1) {
            map.current.setFilter('airports-labels-normal-city', ['all', ...allFilters] as maplibregl.FilterSpecification);
          } else if (allFilters.length === 1) {
            map.current.setFilter('airports-labels-normal-city', allFilters[0] as maplibregl.FilterSpecification);
          } else if (baseCityFilter) {
            map.current.setFilter('airports-labels-normal-city', baseCityFilter);
          } else if (hoverCityFilter) {
            map.current.setFilter('airports-labels-normal-city', hoverCityFilter);
          } else {
            map.current.setFilter('airports-labels-normal-city', null);
          }
        }
      }
      // Only update highlighted labels if route hover is not active
      if (!isRouteHoveredRef.current) {
        if (map.current.getLayer('airports-labels-highlighted') || map.current.getLayer('airports-labels-highlighted-city')) {
          const codes = [...ha];
          if (inTripMode) {
            (tvac ?? []).forEach(c => { if (!codes.includes(c)) codes.push(c); });
            sacMulti.forEach(c => { if (!codes.includes(c)) codes.push(c); });
            manualTransferAirportCodesRef.current.forEach(c => { if (!codes.includes(c)) codes.push(c); });
          } else if (sacMulti.length > 0) {
            sacMulti.forEach(c => { if (!codes.includes(c)) codes.push(c); });
          } else if (sac && !codes.includes(sac)) {
            codes.push(sac);
          }
          highlightedLabelCodesRef.current = codes;
          const filterCodes = hovCode ? codes.filter(c => c !== hovCode) : codes;
          const filter: maplibregl.FilterSpecification = filterCodes.length === 0 ? ['==', 'code', ''] : ['in', 'code', ...filterCodes];
          const highlightedCityCodes = new Set<string>();
          for (const code of filterCodes) {
            const cityKey = cityCodeByAirport[code];
            const rep = cityLabelCodeByCity[cityKey];
            if (rep) highlightedCityCodes.add(rep);
          }
          highlightedCityLabelCodesRef.current = [...highlightedCityCodes];
          if (map.current.getLayer('airports-labels-highlighted')) map.current.setFilter('airports-labels-highlighted', filter);
          if (map.current.getLayer('airports-labels-highlighted-city')) {
            const cityFilter: maplibregl.FilterSpecification = highlightedCityCodes.size === 0
              ? ['==', 'code', '']
              : ['in', 'code', ...highlightedCityLabelCodesRef.current];
            map.current.setFilter('airports-labels-highlighted-city', cityFilter);
          }
        }
      }
    }
    if (map.current.getLayer('airports-selected')) {
      if (sacMulti.length > 0) map.current.setFilter('airports-selected', ['in', 'code', ...sacMulti]);
      else if (sac) map.current.setFilter('airports-selected', ['==', 'code', sac]);
      else map.current.setFilter('airports-selected', ['==', 'code', '']);
    }
    // Update permanent trip routes
    const tripSrc = map.current.getSource('trip-permanent-routes') as maplibregl.GeoJSONSource | undefined;
    if (tripSrc) {
      const features = tripRoutesRef.current.map((route, i) => ({
        type: 'Feature' as const, id: i,
        geometry: { type: 'LineString' as const, coordinates: generateGreatCircle(route.from, route.to) },
        properties: {}
      }));
      tripSrc.setData({ type: 'FeatureCollection', features });
    }
  }, []); // stable – uses only refs

  // ── applyColors: update all paint properties from colorStore ──────────────
  // Reads current store state via getState() so the callback stays stable.
  const applyColors = useCallback(() => {
    if (!map.current) return;
      const { startPoints: sp, generalAirport, destinationAirport, tripAirport,
              tripRoute, tripRouteHover, transferRoute, transferRouteHover,
              generalAirportHover, destinationAirportHover, tripAirportHover,
              generalLabelHoverColor, generalLabelColor,
              destinationLabelColor, destinationLabelHoverColor,
              tripLabelColor, tripLabelHoverColor,
              routeLineWidthMin, routeLineWidthMax,
              routeLineHoverWidthMin, routeLineHoverWidthMax,
              tripRouteWidthMin, tripRouteWidthMax,
              tripRouteHoverWidthMin, tripRouteHoverWidthMax,
              highlightedAirportRadiusMin, highlightedAirportRadiusMax,
              highlightedAirportHoverRadiusMin, highlightedAirportHoverRadiusMax,
              generalAirportRadiusMin, generalAirportRadiusMax,
              generalAirportHoverRadiusMin, generalAirportHoverRadiusMax,
              highlightedCity, generalCity, highlightedCityRadius, generalCityRadius,
              zoomRangeMin, zoomRangeMax,
              generalAirportLabelSizeMin, generalAirportLabelSizeMax,
              generalLabelHoverSizeMin, generalLabelHoverSizeMax,
              highlightedLabelSizeMin, highlightedLabelSizeMax,
              highlightedLabelHoverSizeMin, highlightedLabelHoverSizeMax } = useColorStore.getState();
    const sacMulti  = selectedAirportCodesRef.current ?? [];
    const tvac      = tripVisibleAirportCodesRef.current;

    const ha = highlightedAirportsRef.current;
    const manualCodes = manualTransferAirportCodesRef.current ?? [];
    const explorationCodes = explorationAirportCodesRef.current ?? [];
    const baseStartCodes = sacMulti.length > 0
      ? sacMulti
      : explorationCodes.length > 0
        ? explorationCodes
        : (selectedAirportCodeRef.current ? [selectedAirportCodeRef.current] : []);
    const startCodes = [...new Set([...baseStartCodes, ...manualCodes])];
    const tripCodes = tvac ?? [];
    const highlightedCodes = [...new Set([...startCodes, ...ha, ...tripCodes])];

    // Static circle/line colors
    if (map.current.getLayer('airports-highlighted'))
      map.current.setPaintProperty('airports-highlighted', 'circle-color', destinationAirport);
    if (map.current.getLayer('airports-trip'))
      map.current.setPaintProperty('airports-trip', 'circle-color', tripAirport);
    if (map.current.getLayer('airports-circles'))
      map.current.setPaintProperty('airports-circles', 'circle-color', generalAirport);
    if (map.current.getLayer('airports-route-hover'))
      map.current.setPaintProperty('airports-route-hover', 'circle-color', destinationAirportHover);
    if (map.current.getLayer('transfer-preview-route-line'))
      map.current.setPaintProperty('transfer-preview-route-line', 'line-color', transferRoute);

    // Hover colors
    const startHoverExpr: any = sacMulti.length > 1
      ? ['match', ['get', 'code'],
          ...sacMulti.flatMap((code, i) => [code, sp[i]?.airportHover ?? THEME_COLORS.textBlack]),
          sp[0]?.airportHover ?? THEME_COLORS.textBlack,
        ]
      : (sp[0]?.airportHover ?? THEME_COLORS.textBlack);

    const destinationHoverCodes = [...new Set([
      ...ha,
      ...highlightedLabelCodesRef.current,
    ])].filter(c => !startCodes.includes(c) && !tripCodes.includes(c));
    if (map.current.getLayer('airports-hover'))
      map.current.setPaintProperty('airports-hover', 'circle-color', [
        'case',
        ['in', ['get', 'code'], ['literal', startCodes]],
        startHoverExpr,
        ['in', ['get', 'code'], ['literal', destinationHoverCodes]],
        destinationAirportHover,
        ['in', ['get', 'code'], ['literal', tripCodes]],
        tripAirportHover,
        generalAirportHover,
      ]);

      const zMin = Math.min(zoomRangeMin, zoomRangeMax);
      const zMax = Math.max(zoomRangeMin, zoomRangeMax);
      const zoomInterp = (min: number, max: number): any => (
        zMin === zMax
          ? max
          : ['interpolate', ['linear'], ['zoom'], zMin, min, zMax, max]
      );
      const labelOffsetExpr = (labelMin: number, labelMax: number, dotMin: number, dotMax: number): any => {
        const padding = CONFIG.LABEL_OFFSET_PADDING;
        const minOffset = Math.max(0.2, (dotMin + padding) / Math.max(6, labelMin));
        const maxOffset = Math.max(0.2, (dotMax + padding) / Math.max(6, labelMax));
        return zMin === zMax
          ? ['literal', [0, maxOffset]]
          : ['interpolate', ['linear'], ['zoom'], zMin, ['literal', [0, minOffset]], zMax, ['literal', [0, maxOffset]]];
      };

    // Label sizes and colors
      if (map.current.getLayer('airports-labels-normal')) {
        map.current.setLayoutProperty('airports-labels-normal', 'text-size', zoomInterp(generalAirportLabelSizeMin, generalAirportLabelSizeMax));
        map.current.setLayoutProperty('airports-labels-normal', 'text-offset', labelOffsetExpr(generalAirportLabelSizeMin, generalAirportLabelSizeMax, generalAirportRadiusMin, generalAirportRadiusMax));
        map.current.setPaintProperty('airports-labels-normal', 'text-color', generalLabelColor);
        map.current.setPaintProperty('airports-labels-normal', 'text-halo-color', getHaloColorForTextColor(generalLabelColor, mapStyle));
      }
      if (map.current.getLayer('airports-labels-normal-city')) {
        map.current.setLayoutProperty('airports-labels-normal-city', 'text-size', zoomInterp(generalAirportLabelSizeMin, generalAirportLabelSizeMax));
        map.current.setLayoutProperty('airports-labels-normal-city', 'text-offset', labelOffsetExpr(generalAirportLabelSizeMin, generalAirportLabelSizeMax, generalAirportRadiusMin, generalAirportRadiusMax));
        map.current.setPaintProperty('airports-labels-normal-city', 'text-color', generalLabelColor);
        map.current.setPaintProperty('airports-labels-normal-city', 'text-halo-color', getHaloColorForTextColor(generalLabelColor, mapStyle));
      }
    const startLabelExpr: any = sacMulti.length > 1
      ? ['match', ['get', 'code'],
          ...sacMulti.flatMap((code, i) => [code, sp[i]?.label ?? THEME_COLORS.textBlack]),
          sp[0]?.label ?? THEME_COLORS.textBlack,
        ]
      : (sp[0]?.label ?? THEME_COLORS.textBlack);
    const startLabelHoverExpr: any = sacMulti.length > 1
      ? ['match', ['get', 'code'],
          ...sacMulti.flatMap((code, i) => [code, sp[i]?.labelHover ?? THEME_COLORS.textBlack]),
          sp[0]?.labelHover ?? THEME_COLORS.textBlack,
        ]
      : (sp[0]?.labelHover ?? THEME_COLORS.textBlack);
    
    // Build corresponding halo expressions for start points
    const startLabelHaloExpr: any = sacMulti.length > 1
      ? ['match', ['get', 'code'],
          ...sacMulti.flatMap((code, i) => [code, getHaloColorForTextColor(sp[i]?.label ?? THEME_COLORS.textBlack, mapStyle)]),
          getHaloColorForTextColor(sp[0]?.label ?? THEME_COLORS.textBlack, mapStyle),
        ]
      : getHaloColorForTextColor(sp[0]?.label ?? THEME_COLORS.textBlack, mapStyle);
    const startLabelHoverHaloExpr: any = sacMulti.length > 1
      ? ['match', ['get', 'code'],
          ...sacMulti.flatMap((code, i) => [code, getHaloColorForTextColor(sp[i]?.labelHover ?? THEME_COLORS.textBlack, mapStyle)]),
          getHaloColorForTextColor(sp[0]?.labelHover ?? THEME_COLORS.textBlack, mapStyle),
        ]
      : getHaloColorForTextColor(sp[0]?.labelHover ?? THEME_COLORS.textBlack, mapStyle);
    
    const labelColorExpr: any = [
      'case',
      ['in', ['get', 'code'], ['literal', startCodes]],
      startLabelExpr,
      ['in', ['get', 'code'], ['literal', ha]],
      destinationLabelColor,
      ['in', ['get', 'code'], ['literal', tripCodes]],
      tripLabelColor,
      destinationLabelColor,
    ];
    
    // Build corresponding halo expression
    const labelHaloExpr: any = [
      'case',
      ['in', ['get', 'code'], ['literal', startCodes]],
      startLabelHaloExpr,
      ['in', ['get', 'code'], ['literal', ha]],
      getHaloColorForTextColor(destinationLabelColor, mapStyle),
      ['in', ['get', 'code'], ['literal', tripCodes]],
      getHaloColorForTextColor(tripLabelColor, mapStyle),
      getHaloColorForTextColor(destinationLabelColor, mapStyle),
    ];
    
    const labelHoverColorExpr: any = [
      'case',
      ['in', ['get', 'code'], ['literal', startCodes]],
      startLabelHoverExpr,
      ['in', ['get', 'code'], ['literal', ha]],
      destinationLabelHoverColor,
      ['in', ['get', 'code'], ['literal', tripCodes]],
      tripLabelHoverColor,
      destinationLabelHoverColor,
    ];
    
    // Build corresponding halo expression for hover
    const labelHoverHaloExpr: any = [
      'case',
      ['in', ['get', 'code'], ['literal', startCodes]],
      startLabelHoverHaloExpr,
      ['in', ['get', 'code'], ['literal', ha]],
      getHaloColorForTextColor(destinationLabelHoverColor, mapStyle),
      ['in', ['get', 'code'], ['literal', tripCodes]],
      getHaloColorForTextColor(tripLabelHoverColor, mapStyle),
      getHaloColorForTextColor(destinationLabelHoverColor, mapStyle),
    ];
      for (const id of ['airports-labels-highlighted', 'airports-labels-highlighted-city'] as const) {
        if (map.current.getLayer(id)) {
          map.current.setLayoutProperty(id, 'text-size', zoomInterp(highlightedLabelSizeMin, highlightedLabelSizeMax));
          map.current.setLayoutProperty(id, 'text-offset', labelOffsetExpr(highlightedLabelSizeMin, highlightedLabelSizeMax, highlightedAirportRadiusMin, highlightedAirportRadiusMax));
          map.current.setPaintProperty(id, 'text-color', labelColorExpr);
          map.current.setPaintProperty(id, 'text-halo-color', labelHaloExpr);
        }
      }
      if (map.current.getLayer('airports-labels-hover')) {
        map.current.setLayoutProperty('airports-labels-hover', 'text-size', zoomInterp(highlightedLabelHoverSizeMin, highlightedLabelHoverSizeMax));
        map.current.setLayoutProperty('airports-labels-hover', 'text-offset', labelOffsetExpr(highlightedLabelHoverSizeMin, highlightedLabelHoverSizeMax, highlightedAirportHoverRadiusMin, highlightedAirportHoverRadiusMax));
        map.current.setLayoutProperty('airports-labels-hover', 'text-font', ["Noto Sans Bold"]);
        map.current.setPaintProperty('airports-labels-hover', 'text-color', labelHoverColorExpr);
        map.current.setPaintProperty('airports-labels-hover', 'text-halo-color', labelHoverHaloExpr);
      }
      if (map.current.getLayer('airports-labels-hover-general')) {
        map.current.setLayoutProperty('airports-labels-hover-general', 'text-size', zoomInterp(generalLabelHoverSizeMin, generalLabelHoverSizeMax));
        map.current.setLayoutProperty('airports-labels-hover-general', 'text-offset', labelOffsetExpr(generalLabelHoverSizeMin, generalLabelHoverSizeMax, generalAirportHoverRadiusMin, generalAirportHoverRadiusMax));
        map.current.setLayoutProperty('airports-labels-hover-general', 'text-font', ["Noto Sans Bold"]);
        map.current.setPaintProperty('airports-labels-hover-general', 'text-color', generalLabelHoverColor);
        map.current.setPaintProperty('airports-labels-hover-general', 'text-halo-color', getHaloColorForTextColor(generalLabelHoverColor, mapStyle));
      }

    // airports-selected: per-startPoint match expression
    if (map.current.getLayer('airports-selected')) {
      if (sacMulti.length > 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matchExpr: any[] = ['match', ['get', 'code'],
          ...sacMulti.flatMap((code, i) => [code, sp[i]?.airport ?? THEME_COLORS.textBlack]),
          THEME_COLORS.textBlack,
        ];
        map.current.setPaintProperty('airports-selected', 'circle-color', matchExpr);
      } else {
        map.current.setPaintProperty('airports-selected', 'circle-color', sp[0]?.airport ?? THEME_COLORS.textBlack);
      }
    }

    // selected-routes: per-srcIdx color match expression + per-startPoint hover color
    // Zoom-interpolated size helper (reference size at zoom=6, 30% at zoom=1, 250% at zoom=12)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ziLegacy = (base: number): any => [
        'interpolate', ['linear'], ['zoom'],
        1, Math.max(0.1, base * CONFIG.SIZE_INTERPOLATION_MIN_FACTOR),
        6, base,
        12, base * CONFIG.SIZE_INTERPOLATION_MAX_FACTOR,
      ];

      if (map.current.getLayer('selected-routes')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let routeColorExpr: any;
      if (sacMulti.length > 1) {
        routeColorExpr = ['match', ['get', 'srcIdx'],
          ...sacMulti.flatMap((_, i) => [i, sp[i]?.route ?? '#ed6498']),
          sp[0]?.route ?? '#ed6498',
        ];
      } else {
        routeColorExpr = sp[0]?.route ?? '#ed6498';
      }
      // Per-startPoint hover: match srcIdx to hover color
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hoverColorExpr: any = sacMulti.length > 1
        ? ['match', ['get', 'srcIdx'],
            ...sacMulti.flatMap((_, i) => [i, sp[i]?.routeHover ?? '#b13b6b']),
            sp[0]?.routeHover ?? '#b13b6b',
          ]
        : (sp[0]?.routeHover ?? '#b13b6b');
      map.current.setPaintProperty('selected-routes', 'line-color', [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        hoverColorExpr,
        routeColorExpr,
      ]);
        map.current.setPaintProperty('selected-routes', 'line-width', [
          'interpolate', ['linear'], ['zoom'],
          1, ['case', ['boolean', ['feature-state', 'hover'], false], routeLineHoverWidthMin, routeLineWidthMin],
          12, ['case', ['boolean', ['feature-state', 'hover'], false], routeLineHoverWidthMax, routeLineWidthMax],
        ]);
      }

      if (map.current.getLayer('trip-permanent-routes-line')) {
      map.current.setPaintProperty('trip-permanent-routes-line', 'line-color', [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        tripRouteHover,
        tripRoute,
      ]);
        map.current.setPaintProperty('trip-permanent-routes-line', 'line-width', [
          'interpolate', ['linear'], ['zoom'],
          1, ['case', ['boolean', ['feature-state', 'hover'], false], tripRouteHoverWidthMin, tripRouteWidthMin],
          12, ['case', ['boolean', ['feature-state', 'hover'], false], tripRouteHoverWidthMax, tripRouteWidthMax],
        ]);
      }

    if (map.current.getLayer('manual-transfer-preview-line')) {
      map.current.setPaintProperty('manual-transfer-preview-line', 'line-color', [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        transferRouteHover,
        transferRoute,
      ]);
    }

    // Zoom-interpolated size properties
    if (map.current.getLayer('airports-highlighted'))
      map.current.setPaintProperty('airports-highlighted', 'circle-radius', zoomInterp(highlightedAirportRadiusMin, highlightedAirportRadiusMax));
    if (map.current.getLayer('airports-trip'))
      map.current.setPaintProperty('airports-trip', 'circle-radius', zoomInterp(highlightedAirportRadiusMin, highlightedAirportRadiusMax));
    if (map.current.getLayer('airports-circles'))
      map.current.setPaintProperty('airports-circles', 'circle-radius', zoomInterp(generalAirportRadiusMin, generalAirportRadiusMax));
    if (map.current.getLayer('airports-selected'))
      map.current.setPaintProperty('airports-selected', 'circle-radius', zoomInterp(highlightedAirportRadiusMin, highlightedAirportRadiusMax));
    if (map.current.getLayer('airports-hover'))
      map.current.setPaintProperty('airports-hover', 'circle-radius', [
        'interpolate', ['linear'], ['zoom'],
        1, ['case', ['in', ['get', 'code'], ['literal', highlightedCodes]], highlightedAirportHoverRadiusMin, generalAirportHoverRadiusMin],
        12, ['case', ['in', ['get', 'code'], ['literal', highlightedCodes]], highlightedAirportHoverRadiusMax, generalAirportHoverRadiusMax],
      ]);
    if (map.current.getLayer('airports-route-hover'))
      map.current.setPaintProperty('airports-route-hover', 'circle-radius', [
        'interpolate', ['linear'], ['zoom'],
        1, highlightedAirportHoverRadiusMin,
        12, highlightedAirportHoverRadiusMax,
      ]);
    if (map.current.getLayer('airports-labels-hover'))
      map.current.setLayoutProperty('airports-labels-hover', 'text-size', [
        'interpolate', ['linear'], ['zoom'],
        1, highlightedLabelHoverSizeMin,
        12, highlightedLabelHoverSizeMax,
      ]);
    if (map.current.getLayer('transfer-preview-route-line'))
      map.current.setPaintProperty('transfer-preview-route-line', 'line-width', zoomInterp(routeLineWidthMin, routeLineWidthMax));
    if (map.current.getLayer('manual-transfer-preview-line'))
      map.current.setPaintProperty('manual-transfer-preview-line', 'line-width', zoomInterp(routeLineWidthMin, routeLineWidthMax));
    if (map.current.getLayer('cities-circles')) {
      map.current.setPaintProperty('cities-circles', 'circle-color', generalCity);
      map.current.setPaintProperty('cities-circles', 'circle-radius', ziLegacy(generalCityRadius));
    }
    if (map.current.getLayer('cities-highlighted')) {
      map.current.setPaintProperty('cities-highlighted', 'circle-color', highlightedCity);
      map.current.setPaintProperty('cities-highlighted', 'circle-radius', ziLegacy(highlightedCityRadius));
    }
  }, []); // stable – reads from store via getState() and from refs

  // Popup helper functions
  const formatTime = (dateString: string | null | undefined, tz?: string) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleTimeString(FORMAT_LOCALES.GB, { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
    } catch { return ''; }
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return t.card.na;
    return new Date(dateString).toLocaleDateString(FORMAT_LOCALES.GB, FORMAT_OPTIONS.DATE_SHORT);
  };

  const popupHaversineKm = (lon1: number, lat1: number, lon2: number, lat2: number) => {
    const R = CONFIG.EARTH_RADIUS_KM;
    const toRad = (d: number) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  const popupFormatDuration = (minutes: number, estimated: boolean) => {
    const h = Math.floor(minutes / 60);
    const m = String(minutes % 60).padStart(2, '0');
    return estimated ? `~${h}h ${m}m` : `${h}h ${m}m`;
  };

  // Compute UTC offset of a local timestamp string relative to a UTC string
  const getUTCOffH = (localStr: string | null | undefined, utcStr: string | null | undefined): number | null => {
    if (!localStr || !utcStr) return null;
    const localAsUTC = new Date(localStr + 'Z');
    const utcDate = new Date(utcStr);
    if (isNaN(localAsUTC.getTime()) || isNaN(utcDate.getTime())) return null;
    return (localAsUTC.getTime() - utcDate.getTime()) / 3600000;
  };

  const formatTzLabel = (diff: number): string | null => {
    if (Math.abs(diff) < 0.1) return null;
    const sign = diff > 0 ? '+' : '-';
    const abs = Math.abs(diff);
    const h = Math.floor(abs);
    const m = Math.round((abs - h) * 60);
    return m > 0 ? `(${sign}${h}.${m}h)` : `(${sign}${h}h)`;
  };

  const calculateDuration = (departure: string | null | undefined, arrival: string | null | undefined) => {
    if (!departure || !arrival) return null;
    const diff = new Date(arrival).getTime() - new Date(departure).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  // Main function adding all layers
  const addLayers = useCallback(() => {
    if (!map.current || !mapLoaded || isMapLoading.current) return;

      safeRemoveLayer('airports-circles');
      safeRemoveLayer('airports-highlighted');
      safeRemoveLayer('airports-trip');
      safeRemoveLayer('airports-hover');
      safeRemoveLayer('airports-selected');
      safeRemoveLayer('airports-route-hover');
      safeRemoveLayer('airports-labels-normal');
      safeRemoveLayer('airports-labels-normal-city');
      safeRemoveLayer('airports-labels-highlighted-city');
      safeRemoveLayer('airports-labels-highlighted');
      safeRemoveLayer('airports-labels-hover');
      safeRemoveLayer('airports-labels-hover-general');
    safeRemoveLayer('cities-circles');
    safeRemoveLayer('cities-labels');
    safeRemoveLayer('cities-highlighted');
    safeRemoveLayer('cities-labels-highlighted');
    safeRemoveLayer('routes-lines');
    safeRemoveLayer('selected-routes');
    safeRemoveLayer('trip-permanent-routes-line');
    safeRemoveLayer('transfer-preview-route-line');
    safeRemoveLayer('manual-transfer-preview-line');
    safeRemoveSource('airports');
    safeRemoveSource('cities');
    safeRemoveSource('routes');
    safeRemoveSource('selected-routes');
    safeRemoveSource('trip-permanent-routes');
    safeRemoveSource('transfer-preview-route');
    safeRemoveSource('manual-transfer-preview');

    /*
    if (routesData && showRoutes) {
      addRoutesLayer(map.current, routesData, onSelectItemRef);
    }
    */

    // Permanent trip route source + layer
    map.current.addSource('trip-permanent-routes', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.current.addLayer({
      id: 'trip-permanent-routes-line',
      type: 'line',
      source: 'trip-permanent-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#1565C0',
        'line-width': 3,
        'line-opacity': 0.85,
        'line-dasharray': [3, 2]
      }
    });

    // Manual transfer preview source + layer
    map.current.addSource('transfer-preview-route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.current.addLayer({
      id: 'transfer-preview-route-line',
      type: 'line',
      source: 'transfer-preview-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#1565C0',
        'line-width': 3,
        'line-opacity': 0.45,
        'line-dasharray': [3, 2]
      }
    });

    // Manual transfer airports preview source + layer (static dashed semi-transparent lines)
    map.current.addSource('manual-transfer-preview', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.current.addLayer({
      id: 'manual-transfer-preview-line',
      type: 'line',
      source: 'manual-transfer-preview',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#9C27B0',
        'line-width': 2,
        'line-opacity': 0.45,
        'line-dasharray': [4, 4]
      }
    });

    // Animated routes source + layer
    map.current.addSource('selected-routes', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.current.addLayer({
      id: 'selected-routes',
      type: 'line',
      source: 'selected-routes',
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          '#b13b6b',
          '#ed6498'
        ],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          4,
          2
        ],
        'line-opacity': 0.8
      }
    });

    // Airport and city layers on top of all route lines
    if (airportsData && showAirports) {
      addAirportsLayer(map.current, airportsData, mapStyle);
    }

    // if (citiesData && showCities) {
    //   addCitiesLayer(map.current, citiesData, mapStyle, onSelectItemRef, hoveredAirportCodeRef);
    // }

    // Ensure hover layers are always on top of routes and city labels.
    const bringToFront = (ids: string[]) => {
      for (const id of ids) {
        if (map.current?.getLayer(id)) map.current.moveLayer(id);
      }
    };
    bringToFront([
      'airports-circles',
      'airports-highlighted',
      'airports-trip',
      'airports-selected',
      'airports-route-hover',
      'airports-hover',
      'airports-labels-normal',
      'airports-labels-normal-city',
      'airports-labels-highlighted-city',
      'airports-labels-highlighted',
      'airports-labels-hover-general',
      'airports-labels-hover',
    ]);

    // Helper: check if any airport is within THRESHOLD pixels of the given screen point.
    // Uses map.project() so it works at any zoom. Pre-filters by viewport bounds for performance.
    const isAirportNearPoint = (point: { x: number; y: number }): boolean => {
      if (!map.current) return false;
      const {
        highlightedAirportHoverRadiusMin,
        highlightedAirportHoverRadiusMax,
        generalAirportHoverRadiusMin,
        generalAirportHoverRadiusMax,
        zoomRangeMin,
        zoomRangeMax,
      } = useColorStore.getState();
      const zMin = Math.min(zoomRangeMin, zoomRangeMax);
      const zMax = Math.max(zoomRangeMin, zoomRangeMax);
      const z = map.current.getZoom();
      const interp = (min: number, max: number) => {
        if (zMin === zMax) return max;
        const clamped = Math.min(Math.max(z, zMin), zMax);
        const t = (clamped - zMin) / (zMax - zMin);
        return min + (max - min) * t;
      };
      const hoverRadius = Math.max(
        CONFIG.HOVER_RADIUS_FALLBACK,
        interp(highlightedAirportHoverRadiusMin, highlightedAirportHoverRadiusMax),
        interp(generalAirportHoverRadiusMin, generalAirportHoverRadiusMax),
      );
      const threshold = hoverRadius + CONFIG.HOVER_KEEP_RADIUS_EXTRA;
      const tSq = threshold * threshold;
      for (const ap of projectedAirportsRef.current) {
        const dx = ap.x - point.x;
        const dy = ap.y - point.y;
        if (dx * dx + dy * dy <= tSq) return true;
      }
      return false;
    };

    const clearRouteHover = (opts?: { keepLabels?: boolean }) => {
      // Immediately mark route hover as inactive
      isRouteHoveredRef.current = false;

      const keepLabels = opts?.keepLabels ?? false;
      const routeId = hoveredRouteId.current;
      if (routeId != null) {
        map.current?.setFeatureState({ source: 'selected-routes', id: routeId }, { hover: false });
        hoveredRouteId.current = null;
      }
      map.current?.setFilter('airports-route-hover', ['==', 'code', '']);
      if (!keepLabels) {
        map.current?.setFilter('airports-labels-hover', ['==', 'code', '']);
        map.current?.setFilter('airports-labels-hover-general', ['==', 'code', '']);
        // Restore highlighted label filter when clearing route hover
        applyAirportFilters();
      }
      if (currentPopup.current) { currentPopup.current.remove(); currentPopup.current = null; }
    };

    const applyRouteHoverAtPoint = (point: { x: number; y: number }) => {
      const m = map.current;
      if (!m) return;

      // Immediately mark route hover as active to block any concurrent updates
      isRouteHoveredRef.current = true;

      // Searched route takes priority — clear any active trip/transfer route hover
      if (hoveredTripRouteId.current !== null) {
        m.setFeatureState({ source: 'trip-permanent-routes', id: hoveredTripRouteId.current }, { hover: false });
        hoveredTripRouteId.current = null;
      }
      if (hoveredTransferRouteId.current !== null) {
        m.setFeatureState({ source: 'manual-transfer-preview', id: hoveredTransferRouteId.current }, { hover: false });
        hoveredTransferRouteId.current = null;
      }

      if (hoveredAirportCodeRef.current) {
        clearRouteHover({ keepLabels: true });
        return;
      }
      if (isAirportNearPoint(point)) {
        clearRouteHover();
        return;
      }
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [point.x - 4, point.y - 4],
        [point.x + 4, point.y + 4],
      ];
      let features: maplibregl.MapGeoJSONFeature[] = [];
      try {
        features = m.queryRenderedFeatures(bbox, { layers: ['selected-routes'] });
      } catch {
        features = [];
      }
      if (!features.length) {
        clearRouteHover();
        return;
      }

      const feature = features[0];
      const featureId = feature.id;
      const destCode = (feature.properties as { destCode?: string })?.destCode ?? '';
      if (featureId == null) {
        clearRouteHover();
        return;
      }

      const prevRouteId = hoveredRouteId.current;
      if (prevRouteId != null && prevRouteId !== featureId) {
        m.setFeatureState({ source: 'selected-routes', id: prevRouteId }, { hover: false });
      }
      m.setFeatureState({ source: 'selected-routes', id: featureId }, { hover: true });
      hoveredRouteId.current = featureId ?? null;

      // Hide the highlighted label for destCode FIRST to prevent a frame where both
      // the highlighted label and the hover label are visible simultaneously.
      const tvac = tripVisibleAirportCodesRef.current ?? [];
      const ha = highlightedAirportsRef.current;
      const sac = selectedAirportCodeRef.current;
      const sacMulti = selectedAirportCodesRef.current ?? [];
      const explorationCodes = explorationAirportCodesRef.current ?? [];
      const manualCodes = manualTransferAirportCodesRef.current ?? [];

      const allHighlighted = [...new Set([
        ...ha,
        ...tvac,
        ...sacMulti,
        ...explorationCodes,
        ...(sac ? [sac] : []),
        ...manualCodes,
      ])];

      const filterCodes = allHighlighted.filter(c => c !== destCode);
      const hlFilter: maplibregl.FilterSpecification = filterCodes.length === 0 
        ? ['==', 'code', '']
        : ['in', 'code', ...filterCodes];
      if (m.getLayer('airports-labels-highlighted')) m.setFilter('airports-labels-highlighted', hlFilter);
      
      // Also hide highlighted city label for destCode's city
      if (m.getLayer('airports-labels-highlighted-city')) {
        const hlCityCodes = highlightedCityLabelCodesRef.current;
        const destCityKey = airportCityKeyRef.current[destCode];
        const destCityCode = destCityKey ? cityLabelCodeByCityRef.current[destCityKey] : null;
        const filteredCityCodes = hlCityCodes.filter(c => c !== destCityCode);
        const hlCityFilter: maplibregl.FilterSpecification = filteredCityCodes.length === 0
          ? ['==', 'code', '']
          : ['in', 'code', ...filteredCityCodes];
        m.setFilter('airports-labels-highlighted-city', hlCityFilter);
      }

      // Now show hover label and dot — highlighted label for destCode is already hidden above
      m.setFilter('airports-labels-hover', ['==', 'code', destCode]);
      m.setFilter('airports-labels-hover-general', ['==', 'code', '']);
      m.setFilter('airports-route-hover', ['==', 'code', destCode]);

      const srcIdx = (feature.properties as { srcIdx?: number })?.srcIdx ?? 0;
      const startCodes = selectedAirportCodesRef.current.length > 0
        ? selectedAirportCodesRef.current
        : explorationAirportCodesRef.current.length > 0
          ? explorationAirportCodesRef.current
          : (selectedAirportCodeRef.current ? [selectedAirportCodeRef.current] : []);
      const srcCode = startCodes[srcIdx] ?? startCodes[0] ?? '';

      // flightDetailsMap is built from displayedFlights (already date/TZ/filter aware).
      // Only filter here by source airport.
      const displayFlights = (flightDetailsMap.current[destCode] || [])
        .filter(f => !srcCode || f.origin_airport_code === srcCode);

      // Removed redundant local MAX_POPUP_FLIGHTS
      const shownFlights = displayFlights.slice(0, CONFIG.MAX_POPUP_FLIGHTS);
      const extraCount = displayFlights.length - shownFlights.length;

      // Group shown flights by departure airport local date (for multi-day windows)
      const dateGroups = new Map<string, typeof shownFlights>();
      for (const f of shownFlights) {
        const key = f.scheduled_departure_local?.split('T')[0] ?? '';
        if (!dateGroups.has(key)) dateGroups.set(key, []);
        dateGroups.get(key)!.push(f);
      }
      // Check if source airports have flights on different calendar days
      const sourceDates = new Set<string>();
      for (const src of startCodes) {
        for (const flights of Object.values(flightDetailsMap.current)) {
          const flight = flights.find(f => f.origin_airport_code === src);
          if (flight?.scheduled_departure_local) {
            sourceDates.add(flight.scheduled_departure_local.split('T')[0]);
            break;
          }
        }
      }
      const sourcesHaveDifferentDays = sourceDates.size > 1;
      const showDateHeaders = dateGroups.size > 1 || sourcesHaveDifferentDays;
      const formatGroupDateLabel = (dateStr: string): string => {
        if (!dateStr) return '';
        try {
          const d = new Date(dateStr + 'T12:00:00Z');
          return d.toLocaleDateString(FORMAT_LOCALES.GB, { day: 'numeric', month: 'long', timeZone: 'UTC' });
        } catch { return dateStr; }
      };

      const srcAirportName = airportNamesMap.current[srcCode] ?? srcCode ?? t.common.unknown;
      const destAirportName = airportNamesMap.current[destCode] ?? destCode;
      const srcCityName = displayFlights[0]?.origin_city_name || srcAirportName;
      const destCityName = displayFlights[0]?.destination_city_name || destAirportName;

      // ── Route duration for header ─────────────────────────────────────────────
      let headerDurationStr = '';
      let headerDurationEstimated = false;
      const firstWithTimes = displayFlights.find(f => f.scheduled_departure_utc && f.scheduled_arrival_utc);
      if (firstWithTimes) {
        const min = Math.round((new Date(firstWithTimes.scheduled_arrival_utc!).getTime() - new Date(firstWithTimes.scheduled_departure_utc!).getTime()) / 60000);
        if (min > 0) headerDurationStr = popupFormatDuration(min, false);
      } else {
        const srcC = airportCoordsMapRef.current[srcCode];
        const dstC = airportCoordsMapRef.current[destCode];
        if (srcC && dstC) {
          const distKm = popupHaversineKm(srcC[0], srcC[1], dstC[0], dstC[1]);
          const min = Math.round((distKm / 850 + 0.5) * 60);
          headerDurationStr = popupFormatDuration(min, true);
          headerDurationEstimated = true;
        }
      }
      const headerDurationHtml = headerDurationStr
        ? headerDurationEstimated
          ? `<div class="mc-popup-duration-est" style="background:${THEME_COLORS.goldBg};color:${THEME_COLORS.goldText};border-color:${THEME_COLORS.goldBorder}">${headerDurationStr}</div>`
          : `<div class="mc-popup-duration-exact">${headerDurationStr}</div>`
        : `<div class="mc-popup-arrow">→</div>`;

      // ── Per-flight rows ───────────────────────────────────────────────────────
      const GOLD = THEME_COLORS.goldBg;
      const GOLD_BORDER = THEME_COLORS.goldBorder;
      const GOLD_TEXT = THEME_COLORS.goldText;

      // Derive UTC offsets from displayed flights for arrival-time estimation
      let destUTCOffset: number | null = null;
      let srcUTCOffset: number | null = null;
      for (const f of displayFlights) {
        if (destUTCOffset === null) {
          const off = getUTCOffH(f.scheduled_arrival_local, f.scheduled_arrival_utc);
          if (off !== null) destUTCOffset = off;
        }
        if (srcUTCOffset === null) {
          const off = getUTCOffH(f.scheduled_departure_local, f.scheduled_departure_utc);
          if (off !== null) srcUTCOffset = off;
        }
        if (destUTCOffset !== null && srcUTCOffset !== null) break;
      }

      // Build a single flight row (shared by all date groups)
      const buildFlightRow = (f: Flight) => {
        const airlineCode = f.airline_code || '';
        const rawFlightNum = f.flight_number || '';
        const cleanFlightCode = airlineCode && !rawFlightNum.toUpperCase().startsWith(airlineCode.toUpperCase())
          ? `${airlineCode}${rawFlightNum}`
          : rawFlightNum;
        const airlineName = f.airline_name || airlineCode;
        const centerLabel = [airlineName, cleanFlightCode].filter(Boolean).join('  ');

        let arrHtml = '';
        const hasArrival = !!(f.scheduled_arrival_local || f.scheduled_arrival_utc);
        if (hasArrival) {
          const arrStr = formatTime(f.scheduled_arrival_local || f.scheduled_arrival_utc);
          const depOff = getUTCOffH(f.scheduled_departure_local, f.scheduled_departure_utc);
          const arrOff = getUTCOffH(f.scheduled_arrival_local, f.scheduled_arrival_utc);
          const tzDiff = (depOff !== null && arrOff !== null) ? arrOff - depOff : null;
          const tzLabel = tzDiff !== null ? formatTzLabel(tzDiff) : null;
          const tzHtml = tzLabel
            ? `<span style="font-size:CONFIG.HOVER_STOP_DELAY_MSpx;color:${tzDiff! > 0 ? '#10b981' : '#ef4444'};margin-right:3px;">${tzLabel}</span>`
            : '';
          arrHtml = `${tzHtml}<span class="mc-popup-time">${arrStr}</span>`;
        } else if (f.scheduled_departure_utc) {
          const srcC = airportCoordsMapRef.current[f.origin_airport_code || ''];
          const dstC = airportCoordsMapRef.current[f.destination_airport_code || ''];
          if (srcC && dstC) {
            const distKm = popupHaversineKm(srcC[0], srcC[1], dstC[0], dstC[1]);
            const blockMs = (distKm / 850 + 0.5) * 3600000;
            const estArrUtc = new Date(new Date(f.scheduled_departure_utc).getTime() + blockMs);
            let estStr: string;
            if (destUTCOffset !== null) {
              const destLocalMs = estArrUtc.getTime() + destUTCOffset * 3600000;
              const d = new Date(destLocalMs);
              estStr = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
            } else {
              estStr = formatTime(estArrUtc.toISOString());
            }
            const estTzDiff = (srcUTCOffset !== null && destUTCOffset !== null) ? destUTCOffset - srcUTCOffset : null;
            const estTzLabel = estTzDiff !== null ? formatTzLabel(estTzDiff) : null;
            const estTzHtml = estTzLabel
              ? `<span style="font-size:CONFIG.HOVER_STOP_DELAY_MSpx;color:${estTzDiff! > 0 ? '#10b981' : '#ef4444'};margin-right:3px;">${estTzLabel}</span>`
              : '';
            arrHtml = `${estTzHtml}<span class="mc-popup-est-arr" style="background:${GOLD};color:${GOLD_TEXT};border-color:${GOLD_BORDER}">${UI_SYMBOLS.ESTIMATED}${estStr}</span>`;
          }
        }

        return `
          <div class="mc-popup-row">
            <div class="mc-popup-time">${formatTime(f.scheduled_departure_local || f.scheduled_departure_utc)}</div>
            <div class="mc-popup-airline">${centerLabel}</div>
            <div class="mc-popup-arr">${arrHtml}</div>
          </div>`;
      };

      // Render flight rows, grouped by departure local date when the window spans multiple days
      const flightRows = [...dateGroups.entries()].map(([dateStr, groupFlights]) => {
        const header = showDateHeaders
          ? `<div class="mc-popup-date-header">${formatGroupDateLabel(dateStr)}</div>`
          : '';
        return header + groupFlights.map(buildFlightRow).join('');
      }).join('');

      const popupHtml = `
        <div class="mc-popup-container">
          <div class="mc-popup-header">
            <div class="mc-popup-header-city">${srcCityName}</div>
            ${headerDurationHtml}
            <div class="mc-popup-header-city right">${destCityName}</div>
          </div>
          <div class="mc-popup-airports">
            <div class="mc-popup-header-city">${srcAirportName}</div>
            <div></div>
            <div class="mc-popup-header-city right">${destAirportName}</div>
          </div>
          <div>
            ${shownFlights.length > 0 ? flightRows : `<div class="mc-popup-no-flights">${t.card.noFlightsForDate}</div>`}
          </div>
          ${extraCount > 0
            ? `<div class="mc-popup-dots">...</div><div class="mc-popup-extra">${t.card.clickRouteToFilter}</div>`
            : ''
          }
        </div>
      `;
      if (currentPopup.current) currentPopup.current.remove();
      currentPopup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
        .setLngLat(m.unproject([point.x, point.y]))
        .setHTML(popupHtml)
        .addTo(m);
    };

    routeHoverAtPointRef.current = applyRouteHoverAtPoint;
    clearRouteHoverRef.current = clearRouteHover;

    // Click on animated route line → filter flights by destination
    map.current.on('click', 'selected-routes', (e) => {
      if (isAirportNearPoint(e.point)) return;

      if (e.features && e.features.length > 0) {
        const destCode = e.features[0].properties?.destCode;
        if (destCode) {
          useFilterStore.getState().setDestinationFilter({ airports: [destCode], cities: [], countries: [] });
        }
      }
    });

    // Hover on animated route lines → popup with flight info
    map.current.on('mousemove', 'selected-routes', (e) => {
      routeHoverAtPointRef.current?.({ x: e.point.x, y: e.point.y });
    });

    map.current.on('mouseleave', 'selected-routes', () => {
      clearRouteHoverRef.current?.();
    });

    map.current.on('mouseenter', 'selected-routes', () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer';
    });
    map.current.on('mouseleave', 'selected-routes', () => {
      if (map.current) map.current.getCanvas().style.cursor = '';
    });

    const bindLineHover = (
      layerId: string,
      sourceId: string,
      hoverRef: { current: string | number | null }
    ) => {
      map.current?.on('mousemove', layerId, (e) => {
        // Searched flight route has priority — suppress trip/transfer hover
        if (isRouteHoveredRef.current) {
          if (hoverRef.current !== null) {
            map.current?.setFeatureState({ source: sourceId, id: hoverRef.current }, { hover: false });
            hoverRef.current = null;
          }
          return;
        }
        if (!e.features || e.features.length === 0) return;
        const featureId = e.features[0].id;
        if (featureId == null) return;
        const prevId = hoverRef.current;
        if (prevId != null && prevId !== featureId) {
          map.current?.setFeatureState({ source: sourceId, id: prevId }, { hover: false });
        }
        map.current?.setFeatureState({ source: sourceId, id: featureId }, { hover: true });
        hoverRef.current = featureId ?? null;
      });
      map.current?.on('mouseenter', layerId, () => {
        if (map.current) map.current.getCanvas().style.cursor = 'pointer';
      });
      map.current?.on('mouseleave', layerId, () => {
        if (hoverRef.current !== null) {
          map.current?.setFeatureState({ source: sourceId, id: hoverRef.current }, { hover: false });
          hoverRef.current = null;
        }
        if (map.current) map.current.getCanvas().style.cursor = '';
      });
    };

    bindLineHover('trip-permanent-routes-line', 'trip-permanent-routes', hoveredTripRouteId);
    bindLineHover('manual-transfer-preview-line', 'manual-transfer-preview', hoveredTransferRouteId);

    const setLayerVisibility = (id: string, visible: boolean) => {
      if (map.current?.getLayer(id)) {
        map.current.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    };

    setLayerVisibility('airports-circles', showAirports);
    setLayerVisibility('airports-highlighted', showAirports);
    setLayerVisibility('airports-trip', showAirports);
    setLayerVisibility('airports-hover', showAirports);
    setLayerVisibility('airports-selected', showAirports);
    setLayerVisibility('airports-route-hover', showAirports);
    setLayerVisibility('airports-labels-normal', showAirports);
    setLayerVisibility('airports-labels-normal-city', showAirports);
    setLayerVisibility('airports-labels-highlighted-city', showAirports);
    setLayerVisibility('airports-labels-highlighted', showAirports);
    setLayerVisibility('airports-labels-hover', showAirports);
    setLayerVisibility('airports-labels-hover-general', showAirports);
    // setLayerVisibility('cities-circles', showCities);
    // setLayerVisibility('cities-labels', showCities);
    // setLayerVisibility('cities-highlighted', showCities);
    // setLayerVisibility('cities-labels-highlighted', showCities);
    // setLayerVisibility('routes-lines', showRoutes);
    setLayerVisibility('selected-routes', showAirports /*|| showCities*/);

    applyAirportFilters();
    applyColors();
  }, [mapLoaded, airportsData, /*citiesData,*/ mapStyle, showAirports, /*showCities,*/ safeRemoveLayer, safeRemoveSource, applyAirportFilters, applyColors, rightPanelRef]);

  // Update airport layer filters when highlightedAirports changes (no source rebuild)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const airportsCircles = map.current.getLayer('airports-circles');
    const airportsHighlighted = map.current.getLayer('airports-highlighted');
    const airportsTrip = map.current.getLayer('airports-trip');
    const airportsSelected = map.current.getLayer('airports-selected');
    const labelsNormal = map.current.getLayer('airports-labels-normal');
    const labelsHighlighted = map.current.getLayer('airports-labels-highlighted');
    const labelsNormalCity = map.current.getLayer('airports-labels-normal-city');

    const inTripMode = tripVisibleAirportCodes && tripVisibleAirportCodes.length > 0;

    const effectiveHighlighted = (previewAirportCode && !highlightedAirports.includes(previewAirportCode))
      ? [...highlightedAirports, previewAirportCode]
      : highlightedAirports;

    if (airportsCircles) {
      if (inTripMode) {
        map.current.setFilter('airports-circles', ['==', 'code', '']);
      } else {
        map.current.setFilter('airports-circles', ['!in', 'code', ...effectiveHighlighted]);
      }
    }
    if (airportsHighlighted) {
      map.current.setFilter('airports-highlighted', ['in', 'code', ...effectiveHighlighted]);
    }
    if (airportsTrip) {
      map.current.setFilter('airports-trip', ['in', 'code', ...(tripVisibleAirportCodes ?? [])]);
    }
    if (airportsSelected) {
      if (selectedAirportCodes && selectedAirportCodes.length > 0) {
        map.current.setFilter('airports-selected', ['in', 'code', ...selectedAirportCodes]);
      } else if (selectedAirportCode) {
        map.current.setFilter('airports-selected', ['==', 'code', selectedAirportCode]);
      } else {
        map.current.setFilter('airports-selected', ['==', 'code', '']);
      }
    }
    const cityLabelCodes = cityLabelCodesRef.current;
    const cityCodeByAirport = airportCityKeyRef.current;
    const cityLabelCodeByCity = cityLabelCodeByCityRef.current;
    if (labelsNormal) {
      if (inTripMode) {
        map.current.setFilter('airports-labels-normal', ['==', 'code', '']);
      } else {
        const highlightedCodes = [...new Set([
          ...effectiveHighlighted,
          ...(tripVisibleAirportCodes ?? []),
          ...manualTransferAirportCodes,
          ...(selectedAirportCodes ?? []),
          ...(selectedAirportCode ? [selectedAirportCode] : []),
        ])];
        map.current.setFilter('airports-labels-normal',
          highlightedCodes.length > 0 ? ['!in', 'code', ...highlightedCodes] : null);
      }
    }
    if (labelsNormalCity) {
      if (inTripMode) {
        map.current.setFilter('airports-labels-normal-city', ['==', 'code', '']);
      } else {
        const highlightedCityCodesFromHighlighted = new Set<string>();
        const baseHighlightedCodes = [...new Set([
          ...effectiveHighlighted,
          ...(tripVisibleAirportCodes ?? []),
          ...manualTransferAirportCodes,
          ...(selectedAirportCodes ?? []),
          ...(selectedAirportCode ? [selectedAirportCode] : []),
        ])];
        for (const code of baseHighlightedCodes) {
          const cityKey = cityCodeByAirport[code];
          const rep = cityLabelCodeByCity[cityKey];
          if (rep) highlightedCityCodesFromHighlighted.add(rep);
        }
        const baseCityFilter: maplibregl.LegacyFilterSpecification | null =
          cityLabelCodes.length > 0 ? ['in', 'code', ...cityLabelCodes] : null;
        const highlightedCityFilter: maplibregl.LegacyFilterSpecification | null =
          highlightedCityCodesFromHighlighted.size > 0
            ? ['!in', 'code', ...[...highlightedCityCodesFromHighlighted]]
            : null;
        const allFilters = [baseCityFilter, highlightedCityFilter].filter(Boolean) as maplibregl.FilterSpecification[];
        if (allFilters.length > 1) {
          map.current.setFilter('airports-labels-normal-city', ['all', ...allFilters] as maplibregl.FilterSpecification);
        } else if (allFilters.length === 1) {
          map.current.setFilter('airports-labels-normal-city', allFilters[0] as maplibregl.FilterSpecification);
        } else {
          map.current.setFilter('airports-labels-normal-city', null);
        }
      }
    }
    // Only update highlighted labels if route hover is not active
    if (!isRouteHoveredRef.current) {
      if (labelsHighlighted || map.current.getLayer('airports-labels-highlighted-city')) {
        const codes = [...effectiveHighlighted];
        if (inTripMode) {
          (tripVisibleAirportCodes ?? []).forEach(c => { if (!codes.includes(c)) codes.push(c); });
          manualTransferAirportCodes.forEach(c => { if (!codes.includes(c)) codes.push(c); });
        }
        if (selectedAirportCodes && selectedAirportCodes.length > 0) {
          selectedAirportCodes.forEach(c => { if (!codes.includes(c)) codes.push(c); });
        } else if (selectedAirportCode) {
          if (!codes.includes(selectedAirportCode)) codes.push(selectedAirportCode);
        }
        highlightedLabelCodesRef.current = codes;
        const labelFilter: maplibregl.FilterSpecification = codes.length === 0 ? ['==', 'code', ''] : ['in', 'code', ...codes];
        const highlightedCityCodes = new Set<string>();
        for (const code of codes) {
          const cityKey = cityCodeByAirport[code];
          const rep = cityLabelCodeByCity[cityKey];
          if (rep) highlightedCityCodes.add(rep);
        }
        highlightedCityLabelCodesRef.current = [...highlightedCityCodes];
        if (labelsHighlighted) map.current.setFilter('airports-labels-highlighted', labelFilter);
        if (map.current.getLayer('airports-labels-highlighted-city')) {
          const cityFilter: maplibregl.FilterSpecification = highlightedCityCodes.size === 0
            ? ['==', 'code', '']
            : ['in', 'code', ...highlightedCityLabelCodesRef.current];
          map.current.setFilter('airports-labels-highlighted-city', cityFilter);
        }
      }
    }
  }, [highlightedAirports, previewAirportCode, selectedAirportCode, selectedAirportCodes, explorationItems, mapLoaded, tripVisibleAirportCodes, manualTransferAirportCodes]);

  // Update city highlighting when highlightedCities changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    if (map.current.getLayer('cities-highlighted')) {
      if (highlightedCities.length > 0) {
        map.current.setFilter('cities-highlighted', ['in', 'code', ...highlightedCities]);
        map.current.setFilter('cities-labels-highlighted', ['in', 'code', ...highlightedCities]);
      } else {
        map.current.setFilter('cities-highlighted', ['in', 'code', '']);
        map.current.setFilter('cities-labels-highlighted', ['in', 'code', '']);
      }
    }
  }, [highlightedCities, mapLoaded]);

  // Keep hover colors in sync with highlighted/selected airports
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    applyColors();
  }, [highlightedAirports, selectedAirportCode, selectedAirportCodes, explorationItems, tripVisibleAirportCodes, manualTransferAirportCodes, mapLoaded, applyColors]);

  // Rebuild pixel-space projection cache whenever the map moves or airportsData changes.
  // map.on('move') fires at render-loop rate (≤60fps), so this is bounded even when panning.
  // mousemove then only needs plain arithmetic on the cached array — zero map.project() calls per event.
  useEffect(() => {
    if (!mapLoaded || !map.current || !airportsData) return;
    const m = map.current;

    const rebuildCache = () => {
      const b = m.getBounds();
      const pad = 1;
      const minLng = b.getWest() - pad, maxLng = b.getEast() + pad;
      const minLat = b.getSouth() - pad, maxLat = b.getNorth() + pad;
      const result: Array<{ code: string; x: number; y: number }> = [];
      for (const feat of airportsData.features) {
        const [lng, lat] = feat.geometry.coordinates as [number, number];
        if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
        const px = m.project([lng, lat]);
        result.push({ code: feat.properties.code, x: px.x, y: px.y });
      }
      projectedAirportsRef.current = result;
    };

    rebuildCache();

    // Throttle cache rebuilds to one per rAF frame during pan/zoom animation.
    // Without this, the cache is stale during inertia pan (several seconds),
    // causing the hover to lock onto airports that are no longer under the cursor.
    let rafId: number | null = null;
    const scheduleRebuild = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => { rafId = null; rebuildCache(); });
    };

    const onMoveEnd = () => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      rebuildCache();
      // Clear any hover that was based on stale cache positions
      hoveredAirportCodeRef.current = null;
      lastDetectedCodeRef.current = null;
      if (m.getLayer('airports-hover')) m.setFilter('airports-hover', ['==', 'code', '']);
    };

    m.on('move', scheduleRebuild);
    m.on('moveend', onMoveEnd);
    return () => {
      m.off('move', scheduleRebuild);
      m.off('moveend', onMoveEnd);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [mapLoaded, airportsData]);

  // Raw canvas DOM mousemove — fires at browser rate (not throttled to render loop).
  // Hover = dark red circle only (no label).
  // Sampling approach: show every Nth airport to avoid trailing effect. When cursor is
  // on ocean (null), clear immediately — no queue drain. CONFIG.HOVER_STOP_DELAY_MSms stop timer snaps to exact
  // current position after mouse stops moving.
  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    const m = map.current;
    const canvas = m.getCanvas();
    const HOVER_SAMPLE_EVERY = CONFIG.HOVER_SAMPLE_EVERY;
    const LABEL_CLEAR_RADIUS = CONFIG.LABEL_CLEAR_RADIUS;

    const getNearbyLabelCodes = (point: { x: number; y: number }) => {
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [point.x - LABEL_CLEAR_RADIUS, point.y - LABEL_CLEAR_RADIUS],
        [point.x + LABEL_CLEAR_RADIUS, point.y + LABEL_CLEAR_RADIUS],
      ];
      let features: maplibregl.MapGeoJSONFeature[] = [];
      try {
        features = m.queryRenderedFeatures(bbox, {
          layers: ['airports-labels-normal', 'airports-labels-normal-city', 'airports-labels-highlighted', 'airports-labels-highlighted-city'],
        });
      } catch {
        return [];
      }
      const codes = new Set<string>();
      for (const f of features) {
        const code = (f.properties as { code?: string })?.code;
        if (code) codes.add(code);
      }
      return [...codes];
    };
    const getNearbyAirportCodes = (point: { x: number; y: number }) => {
      const rSq = LABEL_CLEAR_RADIUS * LABEL_CLEAR_RADIUS;
      const codes = new Set<string>();
      for (const ap of projectedAirportsRef.current) {
        const dx = ap.x - point.x;
        const dy = ap.y - point.y;
        if ((dx * dx + dy * dy) <= rSq) {
          codes.add(ap.code);
        }
      }
      return [...codes];
    };

    const applyHover = (code: string | null, point?: { x: number; y: number }) => {
      const sameCode = code === hoveredAirportCodeRef.current;
      if (sameCode && !point) return;
      hoveredAirportCodeRef.current = code;
      if (m.getCanvas()) {
        m.getCanvas().style.cursor = code ? 'pointer' : '';
      }
      if (m.getLayer('airports-hover')) {
        m.setFilter('airports-hover', ['==', 'code', code ?? '']);
      }
      const prevRouteId = hoveredRouteId.current;
      if (code !== null && prevRouteId != null) {
        m.setFeatureState({ source: 'selected-routes', id: prevRouteId }, { hover: false });
        hoveredRouteId.current = null;
        m.setFilter('airports-route-hover', ['==', 'code', '']);
        m.setFilter('airports-labels-hover', ['==', 'code', '']);
        m.setFilter('airports-labels-hover-general', ['==', 'code', '']);
      }
      // Only update label hover if no route is being hovered (route hover manages its own label)
      if (code !== null || hoveredRouteId.current === null) {
        const isFocused = code !== null && (
          highlightedAirportsRef.current.includes(code) ||
          selectedAirportCodesRef.current.includes(code) ||
          explorationAirportCodesRef.current.includes(code) ||
          (tripVisibleAirportCodesRef.current?.includes(code) ?? false)
        );
      if (m.getLayer('airports-labels-hover')) {
        m.setFilter('airports-labels-hover', ['==', 'code', (isFocused || code === null) ? (code ?? '') : '']);
      }
      if (m.getLayer('airports-labels-hover-general')) {
        m.setFilter('airports-labels-hover-general', ['==', 'code', (!isFocused && code !== null) ? code : '']);
      }
      }
      // Exclude nearby labels around hover to avoid overlaps
      const inTripMode = !!(tripVisibleAirportCodesRef.current?.length);
      const cityKey = code ? airportCityKeyRef.current[code] : null;
      const cityRep = cityKey ? cityLabelCodeByCityRef.current[cityKey] : null;
      const nearbyAirports = point ? getNearbyAirportCodes(point) : [];
      const nearbyCityReps: string[] = [];
      for (const apCode of nearbyAirports) {
        const apCity = airportCityKeyRef.current[apCode];
        const rep = apCity ? cityLabelCodeByCityRef.current[apCity] : null;
        if (rep) nearbyCityReps.push(rep);
      }
      const nearby = [...new Set([...nearbyAirports, ...nearbyCityReps])].filter(c => c !== code);
      const excludeCodes = code ? [code, ...(cityRep ? [cityRep] : []), ...nearby] : nearby;
      if (m.getLayer('airports-labels-normal')) {
        if (inTripMode) {
          m.setFilter('airports-labels-normal', ['==', 'code', '']);
        } else {
          const baseFilter: maplibregl.LegacyFilterSpecification | null = highlightedLabelCodesRef.current.length > 0
            ? ['!in', 'code', ...highlightedLabelCodesRef.current]
            : null;
          if (excludeCodes.length > 0 && baseFilter) {
            m.setFilter('airports-labels-normal', ['all', baseFilter, ['!in', 'code', ...excludeCodes]] as maplibregl.FilterSpecification);
          } else if (excludeCodes.length > 0) {
            m.setFilter('airports-labels-normal', ['!in', 'code', ...excludeCodes]);
          } else if (baseFilter) {
            m.setFilter('airports-labels-normal', baseFilter);
          } else {
            m.setFilter('airports-labels-normal', null);
          }
        }
      }
      if (m.getLayer('airports-labels-normal-city')) {
        if (inTripMode) {
          m.setFilter('airports-labels-normal-city', ['==', 'code', '']);
        } else {
          const baseCityFilter: maplibregl.LegacyFilterSpecification | null =
            cityLabelCodesRef.current.length > 0 ? ['in', 'code', ...cityLabelCodesRef.current] : null;
          const highlightedCityFilter: maplibregl.LegacyFilterSpecification | null =
            highlightedCityLabelCodesRef.current.length > 0 ? ['!in', 'code', ...highlightedCityLabelCodesRef.current] : null;
          const hoverCityFilter: maplibregl.LegacyFilterSpecification | null =
            excludeCodes.length > 0 ? ['!in', 'code', ...excludeCodes] : null;
          const allFilters = [baseCityFilter, highlightedCityFilter, hoverCityFilter].filter(Boolean) as maplibregl.FilterSpecification[];
          if (allFilters.length > 1) {
            m.setFilter('airports-labels-normal-city', ['all', ...allFilters] as maplibregl.FilterSpecification);
          } else if (allFilters.length === 1) {
            m.setFilter('airports-labels-normal-city', allFilters[0] as maplibregl.FilterSpecification);
          } else {
            m.setFilter('airports-labels-normal-city', null);
          }
        }
      }
      // Don't update highlighted labels while route hover is active —
      // applyRouteHoverAtPoint manages its own highlighted label filtering
      // and the CONFIG.HOVER_STOP_DELAY_MSms stop timer calling applyHover(null) must not overwrite it.
      if (!isRouteHoveredRef.current) {
        const hlCodes = highlightedLabelCodesRef.current;
        const filteredHl = excludeCodes.length > 0 ? hlCodes.filter(c => !excludeCodes.includes(c)) : hlCodes;
        const hlFilter: maplibregl.FilterSpecification = filteredHl.length === 0 ? ['==', 'code', ''] : ['in', 'code', ...filteredHl];
        if (m.getLayer('airports-labels-highlighted')) m.setFilter('airports-labels-highlighted', hlFilter);
        if (m.getLayer('airports-labels-highlighted-city')) {
          const hlCityCodes = highlightedCityLabelCodesRef.current;
          const filteredCity = excludeCodes.length > 0 ? hlCityCodes.filter(c => !excludeCodes.includes(c)) : hlCityCodes;
          const hlCityFilter: maplibregl.FilterSpecification = filteredCity.length === 0 ? ['==', 'code', ''] : ['in', 'code', ...filteredCity];
          m.setFilter('airports-labels-highlighted-city', hlCityFilter);
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!map.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      let code: string | null = null;
      if (showAirports) {
        const THRESHOLD = CONFIG.HOVER_RADIUS_FALLBACK;
        const tSq = THRESHOLD * THRESHOLD;
        let bestDist = Infinity;
        for (const ap of projectedAirportsRef.current) {
          const dx = ap.x - x;
          const dy = ap.y - y;
          const dist = dx * dx + dy * dy;
          if (dist <= tSq && dist < bestDist) { bestDist = dist; code = ap.code; }
        }
      if (code !== null) {
        hoverLockUntilRef.current = Date.now() + CONFIG.HOVER_LOCK_DURATION_MS;
        const tripCodes = tripVisibleAirportCodesRef.current;
        if (tripCodes && tripCodes.length > 0) {
          if (!new Set([...tripCodes, ...highlightedAirportsRef.current]).has(code)) code = null;
        }
      }
    }

      if (hoveredAirportCodeRef.current && (!code || code === hoveredAirportCodeRef.current)) {
        const m = map.current;
        const {
          highlightedAirportHoverRadiusMin,
          highlightedAirportHoverRadiusMax,
          generalAirportHoverRadiusMin,
          generalAirportHoverRadiusMax,
          zoomRangeMin,
          zoomRangeMax,
        } = useColorStore.getState();
        const zMin = Math.min(zoomRangeMin, zoomRangeMax);
        const zMax = Math.max(zoomRangeMin, zoomRangeMax);
        const z = m.getZoom();
        const interp = (min: number, max: number) => {
          if (zMin === zMax) return max;
          const clamped = Math.min(Math.max(z, zMin), zMax);
          const t = (clamped - zMin) / (zMax - zMin);
          return min + (max - min) * t;
        };
        const keepRadius = Math.max(
          CONFIG.HOVER_RADIUS_FALLBACK,
          interp(highlightedAirportHoverRadiusMin, highlightedAirportHoverRadiusMax),
          interp(generalAirportHoverRadiusMin, generalAirportHoverRadiusMax),
        ) + 6;
        const keepRadiusSq = keepRadius * keepRadius;
        const hoveredCode = hoveredAirportCodeRef.current;
        const hoveredPoint = projectedAirportsRef.current.find(ap => ap.code === hoveredCode);
        if (hoveredPoint) {
          const dx = hoveredPoint.x - x;
          const dy = hoveredPoint.y - y;
          if (dx * dx + dy * dy <= keepRadiusSq) {
            code = hoveredCode;
            hoverLockUntilRef.current = Date.now() + CONFIG.HOVER_LOCK_EXTENSION;
          }
        }
      }

      if (!code && hoveredAirportCodeRef.current && Date.now() < hoverLockUntilRef.current) {
        code = hoveredAirportCodeRef.current;
      }

      lastDetectedCodeRef.current = code;

      if (code === null) {
        // Jeśli route hover jest aktywny, nie chcemy czyścić hovera lotniska (bo i tak null) ani resetować filtrów.
        if (!isRouteHoveredRef.current) {
          hoverSampleCountRef.current = 0;
          if (hoverClearTimerRef.current === null) {
            hoverClearTimerRef.current = setTimeout(() => {
              hoverClearTimerRef.current = null;
              applyHover(null);
            }, CONFIG.HOVER_CLEAR_DELAY_MS);
          }
        }
      } else if (code !== hoveredAirportCodeRef.current) {
      if (hoverClearTimerRef.current !== null) {
        clearTimeout(hoverClearTimerRef.current);
        hoverClearTimerRef.current = null;
      }
        // New airport detected: count it, show every Nth one
        hoverSampleCountRef.current += 1;
        if (hoverSampleCountRef.current >= HOVER_SAMPLE_EVERY) {
          hoverSampleCountRef.current = 0;
          applyHover(code, { x, y });
        }
      } else if (hoverClearTimerRef.current !== null) {
        clearTimeout(hoverClearTimerRef.current);
        hoverClearTimerRef.current = null;
      }

      // CONFIG.HOVER_STOP_DELAY_MS ms after last movement: snap to exact current position
      if (mouseStopTimerRef.current !== null) clearTimeout(mouseStopTimerRef.current);
      mouseStopTimerRef.current = setTimeout(() => {
        mouseStopTimerRef.current = null;
        hoverSampleCountRef.current = 0;
        if (hoverClearTimerRef.current !== null) {
          clearTimeout(hoverClearTimerRef.current);
          hoverClearTimerRef.current = null;
        }
        applyHover(lastDetectedCodeRef.current, { x, y });
      }, CONFIG.HOVER_STOP_DELAY_MS);

      /*
      if (!code && showRoutes && Date.now() >= hoverLockUntilRef.current && !hoveredAirportCodeRef.current) {
        routeHoverAtPointRef.current?.({ x, y });
      } else if (code && showRoutes) {
        clearRouteHoverRef.current?.({ keepLabels: true });
      }
      */
    };

    const handleMouseLeave = () => {
      lastDetectedCodeRef.current = null;
      hoverSampleCountRef.current = 0;
      if (mouseStopTimerRef.current !== null) { clearTimeout(mouseStopTimerRef.current); mouseStopTimerRef.current = null; }
      if (hoverClearTimerRef.current !== null) { clearTimeout(hoverClearTimerRef.current); hoverClearTimerRef.current = null; }
      applyHover(null);
      // if (showRoutes) clearRouteHoverRef.current?.();
    };
      
    const handleClick = (e: MouseEvent) => {
      if (!airportsDataRef.current || !map.current) return;
      const code = hoveredAirportCodeRef.current;
      if (!code) return;

      const feat = airportsDataRef.current.features.find(f => f.properties.code === code);
      if (!feat) return;
    
      const isTripAirport = (tripVisibleAirportCodesRef.current ?? []).includes(code);
      if (isTripAirport) return;
    
      const inTripMode = tripVisibleAirportCodesRef.current && tripVisibleAirportCodesRef.current.length > 0;
    
      if (inTripMode) {
        // In travel mode, clicking any destination airport toggles the destination filter
        useFilterStore.getState().setDestinationFilter({ airports: [code], cities: [], countries: [] });
        return;
      }
    
      // Normalna akcja
      const isHighlighted = highlightedAirportsRef.current.includes(code);
      (async () => {
        try {
          const data = await getAirport(code);
          onSelectItemRef.current?.({ type: 'airport', data, isHighlighted, fromMap: true });
        } catch {
          onSelectItemRef.current?.({ type: 'airport', data: feat.properties as any, isHighlighted, fromMap: true });
        }
      })();
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('click', handleClick);
      if (mouseStopTimerRef.current !== null) { clearTimeout(mouseStopTimerRef.current); mouseStopTimerRef.current = null; }
      if (hoverClearTimerRef.current !== null) { clearTimeout(hoverClearTimerRef.current); hoverClearTimerRef.current = null; }
    };
  }, [mapLoaded, showAirports]);

  // Update permanent trip routes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const source = map.current.getSource('trip-permanent-routes') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const features = tripRoutes.map((route, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'LineString' as const, coordinates: generateGreatCircle(route.from, route.to) },
      properties: {}
    }));
    source.setData({ type: 'FeatureCollection', features });
  }, [tripRoutes, mapLoaded]);

  // Update manual transfer preview lines (dashed semi-transparent lines to transfer airports)
  useEffect(() => {
    if (!map.current || !mapLoaded || !airportsData) return;
    const source = map.current.getSource('manual-transfer-preview') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    const features: Array<{ type: 'Feature'; id: number; geometry: { type: 'LineString'; coordinates: number[][] }; properties: Record<string, unknown> }> = [];
    let id = 0;

    if (tripState && manualTransferAirportCodes.length > 0) {
      const currentCode = tripState.legs.length > 0
        ? tripState.legs[tripState.legs.length - 1].toAirportCode
        : tripState.startAirport.code;
      const currentFeat = airportsData.features.find(f => f.properties.code === currentCode);
      if (currentFeat) {
        for (const code of manualTransferAirportCodes) {
          const feat = airportsData.features.find(f => f.properties.code === code);
          if (feat) {
            features.push({
              type: 'Feature',
              id: id++,
              geometry: {
                type: 'LineString',
                coordinates: generateGreatCircle(
                  currentFeat.geometry.coordinates as [number, number],
                  feat.geometry.coordinates as [number, number]
                ),
              },
              properties: {},
            });
          }
        }
      }
    }
    source.setData({ type: 'FeatureCollection', features });
  }, [manualTransferAirportCodes, tripState, airportsData, mapLoaded]);

  // Preview animation for manual transfer
  useEffect(() => {
    if (!map.current || !mapLoaded || !airportsData) return;
    startPreviewAnimation(map.current, previewAnimationRef, previewAirportCode, selectedAirportCode, airportsData);
  }, [previewAirportCode, selectedAirportCode, airportsData, mapLoaded]);

  // Update selected airport filter (no longer triggers animation — handled by highlightedAirports effect)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const layer = map.current.getLayer('airports-selected');
    if (layer) {
      if (selectedAirportCodes && selectedAirportCodes.length > 0) {
        map.current.setFilter('airports-selected', ['in', 'code', ...selectedAirportCodes]);
      } else if (selectedAirportCode) {
        map.current.setFilter('airports-selected', ['==', 'code', selectedAirportCode]);
      } else {
        map.current.setFilter('airports-selected', ['==', 'code', '']);
      }
    }
  }, [selectedAirportCode, selectedAirportCodes, mapLoaded]);

  // Rebuild layers when data/style changes
  useEffect(() => {
    if (!mapLoaded) return;
    addLayers();
  }, [mapLoaded, airportsData, /*citiesData,*/ mapStyle, addLayers]);


  // When style changes, auto-adjust all label colors to be opposite of style-default halo colors
  // BUT: only if labels are currently black/white (user hasn't customized them yet)
  useEffect(() => {
    if (!mapLoaded) return;
    
    // Determine style-default halo color (light style = white, dark style = black)
    const isLight = !mapStyle || (
      !mapStyle.includes('dark-matter') &&
      !mapStyle.includes('satelite') &&          // legacy typo kept for any cached value
      !mapStyle.startsWith(MAP_STYLES.ARCGIS_SATELLITE) && // our inline satellite styles
      !isArcGISPluginStyle(mapStyle)             // arcgis/imagery etc. are dark/satellite
    );
    const styleDefaultHalo = isLight ? THEME_COLORS.textInverse : THEME_COLORS.textBlack;
    
    // Calculate opposite text color
    const styleDefaultText = getTextColorForHaloColor(styleDefaultHalo);
    
    // Get current color state
    const currentState = useColorStore.getState();
    
    // Update only if current colors are black/white (meaning user hasn't customized them)
    const updates: any = {};
    
    if (isBlackOrWhiteColor(currentState.generalLabelColor)) {
      updates.generalLabelColor = styleDefaultText;
    }
    if (isBlackOrWhiteColor(currentState.generalLabelHoverColor)) {
      updates.generalLabelHoverColor = styleDefaultText;
    }
    if (isBlackOrWhiteColor(currentState.destinationLabelColor)) {
      updates.destinationLabelColor = styleDefaultText;
    }
    if (isBlackOrWhiteColor(currentState.destinationLabelHoverColor)) {
      updates.destinationLabelHoverColor = styleDefaultText;
    }
    if (isBlackOrWhiteColor(currentState.tripLabelColor)) {
      updates.tripLabelColor = styleDefaultText;
    }
    if (isBlackOrWhiteColor(currentState.tripLabelHoverColor)) {
      updates.tripLabelHoverColor = styleDefaultText;
    }
    
    // Also update start points labels, but only if they are black/white
    updates.startPoints = currentState.startPoints.map(sp => {
      const updated = { ...sp };
      if (isBlackOrWhiteColor(sp.label)) {
        updated.label = styleDefaultText;
      }
      if (isBlackOrWhiteColor(sp.labelHover)) {
        updated.labelHover = styleDefaultText;
      }
      return updated;
    });
    
    useColorStore.setState(updates);
  }, [mapLoaded, mapStyle]);

  // Apply globe/flat projection whenever globeMode or map changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    try {
      (map.current as any).setProjection(globeMode ? { type: 'globe' } : { type: 'mercator' });
    } catch (e) {
      console.warn('setProjection failed:', e);
    }
  }, [mapLoaded, globeMode]);


  // Toggle layer visibility
  useEffect(() => {
    if (!map.current || !mapLoaded || isMapLoading.current) return;

    const setLayerVisibility = (id: string, visible: boolean) => {
      if (map.current?.getLayer(id)) {
        map.current.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    };

    setLayerVisibility('airports-circles', showAirports);
    setLayerVisibility('airports-highlighted', showAirports);
    setLayerVisibility('airports-trip', showAirports);
    setLayerVisibility('airports-hover', showAirports);
    setLayerVisibility('airports-selected', showAirports);
    setLayerVisibility('airports-route-hover', showAirports);
    setLayerVisibility('airports-labels-normal', showAirports);
    setLayerVisibility('airports-labels-normal-city', showAirports);
    setLayerVisibility('airports-labels-highlighted-city', showAirports);
    setLayerVisibility('airports-labels-highlighted', showAirports);
    setLayerVisibility('airports-labels-hover', showAirports);
    setLayerVisibility('airports-labels-hover-general', showAirports);
    // setLayerVisibility('cities-circles', showCities);
    // setLayerVisibility('cities-labels', showCities);
    // setLayerVisibility('cities-highlighted', showCities);
    // setLayerVisibility('cities-labels-highlighted', showCities);
    // setLayerVisibility('routes-lines', showRoutes);
    setLayerVisibility('selected-routes', showAirports /*|| showCities*/);
  }, [showAirports, /*showCities,*/ mapLoaded]);

  // Route animation — draws routes for all displayed flights, handles additions/removals/timezone changes.
  // Uses src:dest pairs (not dest-only) so new sources for existing destinations are drawn correctly.
  useEffect(() => {
    if (!map.current || !mapLoaded || !airportsData) return;

    if (highlightedAirports.length === 0) {
      clearRouteAnimation(map.current, animationRef, completedPathsRef, currentAnimatingRef);
      renderedHighlightedRef.current = new Set();
      return;
    }

    const currentSet = new Set(highlightedAirports);

    // Step 1: Handle highlighted airport removals (dest no longer in highlighted set)
    const hasRemovals = [...renderedHighlightedRef.current].some(a => !currentSet.has(a));
    if (hasRemovals) {
      if (animationRef.current !== null) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
      if (currentAnimatingRef.current.length > 0) {
        completedPathsRef.current = [...completedPathsRef.current, ...currentAnimatingRef.current];
        currentAnimatingRef.current = [];
      }
      completedPathsRef.current = completedPathsRef.current.filter(p => currentSet.has(p.destCode));
      renderedHighlightedRef.current = new Set([...renderedHighlightedRef.current].filter(a => currentSet.has(a)));
    }

    // Step 2: Remove stale src:dest paths no longer present in displayedFlights
    let hasStale = false;
    if (displayedFlights.length > 0 && (completedPathsRef.current.length > 0 || currentAnimatingRef.current.length > 0)) {
      const srcCodesSet = new Set<string>([...selectedAirportCodes, ...(selectedAirportCode ? [selectedAirportCode] : [])]);
      const wantedPairs = new Set(
        displayedFlights
          .filter(f => f.origin_airport_code && f.destination_airport_code &&
                       srcCodesSet.has(f.origin_airport_code) &&
                       currentSet.has(f.destination_airport_code))
          .map(f => `${f.origin_airport_code}:${f.destination_airport_code}`)
      );
      hasStale = [...completedPathsRef.current, ...currentAnimatingRef.current]
        .some(p => !wantedPairs.has(`${p.srcCode}:${p.destCode}`));
      if (hasStale) {
        if (animationRef.current !== null) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
        if (currentAnimatingRef.current.length > 0) {
          completedPathsRef.current = [...completedPathsRef.current, ...currentAnimatingRef.current];
          currentAnimatingRef.current = [];
        }
        completedPathsRef.current = completedPathsRef.current.filter(p => wantedPairs.has(`${p.srcCode}:${p.destCode}`));
        const remainingDests = new Set(completedPathsRef.current.map(p => p.destCode));
        renderedHighlightedRef.current = new Set([...renderedHighlightedRef.current].filter(a => remainingDests.has(a)));
      }
    }

    // Step 3: Build all desired paths, animate only truly new src:dest pairs
    const sourceSet = new Set<string>(selectedAirportCodes);
    if (selectedAirportCode) sourceSet.add(selectedAirportCode);
    const sourceCodes = [...sourceSet];
    if (sourceCodes.length === 0) return;

    const allWantedPaths = buildGCPaths(sourceCodes, highlightedAirports, airportsData, displayedFlightsRef.current);
    const renderedPairs = new Set(
      [...completedPathsRef.current, ...currentAnimatingRef.current].map(p => `${p.srcCode}:${p.destCode}`)
    );
    const newPaths = allWantedPaths.filter(p => !renderedPairs.has(`${p.srcCode}:${p.destCode}`));

    if (newPaths.length === 0) {
      // Always sync source with completedPathsRef — handles style change (source recreated empty),
      // removals, stale cleanup, and toggling globe mode.
      const src = map.current.getSource('selected-routes') as import('maplibre-gl').GeoJSONSource | undefined;
      if (src) {
        src.setData({
          type: 'FeatureCollection',
          features: completedPathsRef.current.map((d, i) => ({
            type: 'Feature' as const, id: i,
            geometry: { type: 'LineString' as const, coordinates: d.gcCoords },
            properties: { destCode: d.destCode, srcIdx: d.srcIdx },
          })),
        });
      }
      return;
    }

    newPaths.forEach(p => renderedHighlightedRef.current.add(p.destCode));
    addRoutesToAnimation(map.current, animationRef, completedPathsRef, currentAnimatingRef, newPaths);
  }, [highlightedAirports, mapLoaded, airportsData, selectedAirportCode, selectedAirportCodes, displayedFlights]);

  // Re-apply all colors when colorStore values or selected airports change
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    applyColors();
  }, [
    mapLoaded, applyColors,
    // Color store subscriptions (trigger re-run when any color changes):
    startPoints, clrGeneral, clrDestination, clrTripAirport,
    clrTripRoute, clrTransferRoute,
    clrTripHover, clrGeneralHover, clrDestinationHover, clrTransferRouteHover,
    clrGeneralLabelHover, clrGeneralLabel, clrDestinationLabel, clrDestinationLabelHover, clrTripLabel, clrTripLabelHover,
    szRouteWidthMin, szRouteWidthMax, szRouteHoverWidthMin, szRouteHoverWidthMax,
    szTripRouteWidthMin, szTripRouteWidthMax, szTripRouteHoverWidthMin, szTripRouteHoverWidthMax,
    szHighlightedRadiusMin, szHighlightedRadiusMax, szHighlightedHoverRadiusMin, szHighlightedHoverRadiusMax,
    szGeneralRadiusMin, szGeneralRadiusMax, szGeneralHoverRadiusMin, szGeneralHoverRadiusMax,
    clrHighlightedCity, clrGeneralCity, szHighlightedCityRadius, szGeneralCityRadius,
    szGeneralLabelSizeMin, szGeneralLabelSizeMax, szGeneralLabelHoverSizeMin, szGeneralLabelHoverSizeMax,
    szHighlightedLabelSizeMin, szHighlightedLabelSizeMax, szHighlightedLabelHoverSizeMin, szHighlightedLabelHoverSizeMax,
    zoomRangeMin, zoomRangeMax,
    // Also re-apply when selected airports change (for per-airport color matching):
    selectedAirportCodes, tripVisibleAirportCodes,
  ]);

  // Fly to zoom when requested from settings panel
  useEffect(() => {
    if (flyToZoom !== null && map.current && mapLoaded) {
      map.current.flyTo({ zoom: flyToZoom });
      setFlyToZoom(null);
    }
  }, [flyToZoom, mapLoaded, setFlyToZoom]);

  // Enforce zoom range from settings
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const minZ = Math.max(1, Math.min(zoomRangeMin, zoomRangeMax));
    const maxZ = Math.min(12, Math.max(zoomRangeMin, zoomRangeMax));
    map.current.setMinZoom(minZ);
    map.current.setMaxZoom(maxZ);
    const current = map.current.getZoom();
    if (current < minZ || current > maxZ) {
      map.current.setZoom(Math.min(maxZ, Math.max(minZ, current)));
    }
  }, [zoomRangeMin, zoomRangeMax, mapLoaded]);

  if (!webglSupported) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: THEME_COLORS.gray100, color: THEME_COLORS.gray600,
        fontFamily: 'Arial, sans-serif', padding: '20px', textAlign: 'center'
      }}>
        <div>
          <h3 style={{ marginBottom: '10px', color: THEME_COLORS.errorRed }}>{t.errors.mapNotLoaded}</h3>
          <p>{t.errors.webglNotSupported}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="map-root">
      <div ref={mapContainer} className="map" />
    </div>
  );
});

export default MapComponent;