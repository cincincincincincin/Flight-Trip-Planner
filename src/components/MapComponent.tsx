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
import { useAirportsQuery } from '../hooks/queries';
import { generateGreatCircle, getTextColorForHaloColor, isBlackOrWhiteColor } from './map/utils';
import { addAirportsLayer } from './map/airportsLayer';

import { startPreviewAnimation } from './map/routeAnimations';
import type { GCPath } from './map/routeAnimations';
import './MapComponent.css';
import './FlightCard.css';
import { useTexts } from '../hooks/useTexts';
import { MAP_STYLES } from '../constants/mapStyles';
import { THEME_COLORS } from '../constants/theme';
import { CONFIG } from '../constants/config';
import { ARCGIS_API_KEY, isArcGISPluginStyle, toPluginStyleName, arcGISTransformRequest, resolveMapStyle } from './map/styleResolver';
import { applyMapColors } from './map/colorApplier';
import { applyMapAirportFilters } from './map/filterApplier';
import { setupRouteLayers } from './map/layerSetup';
import { useMapHover } from './map/useMapHover';
import type { MapHoverRefs } from './map/useMapHover';
import { setupRouteHoverListeners } from './map/routeHover';
import type { RouteHoverRefs } from './map/routeHover';
import { useMapColors } from './map/useMapColors';
import { useRouteAnimation } from './map/useRouteAnimation';
import { useAirportLayerFilter } from './map/useAirportLayerFilter';

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
  const { showAirports, mapStyle, globeMode, flyToZoom, setFlyToZoom } = useMapStore();
  const { highlightedAirports, selectedAirportCode, selectedAirportCodes, highlightedCities, flightsData, displayedFlights, explorationItems } = useSelectionStore();
  const { tripState, tripRoutes, previewAirportCode, manualTransferAirportCodes } = useTripStore();
  const { travelDate, timezone } = useSettingsStore();
  const { destinationFilter, airlineFilter } = useFilterStore();

  // Color store – subscribe to individual values so effects re-run on change
  const {
    startPoints, clrGeneral, clrDestination, clrTripAirport, clrTripRoute, clrTransferRoute,
    clrTripHover, clrGeneralHover, clrDestinationHover, clrTransferRouteHover,
    clrGeneralLabelHover, clrGeneralLabel, clrDestinationLabel, clrDestinationLabelHover,
    clrTripLabel, clrTripLabelHover,
    szRouteWidthMin, szRouteWidthMax, szRouteHoverWidthMin, szRouteHoverWidthMax,
    szHighlightedRadiusMin, szHighlightedRadiusMax, szHighlightedHoverRadiusMin, szHighlightedHoverRadiusMax,
    szGeneralRadiusMin, szGeneralRadiusMax, szGeneralHoverRadiusMin, szGeneralHoverRadiusMax,
    szTripRouteWidthMin, szTripRouteWidthMax, szTripRouteHoverWidthMin, szTripRouteHoverWidthMax,
    clrHighlightedCity, clrGeneralCity, szHighlightedCityRadius, szGeneralCityRadius,
    szGeneralLabelSizeMin, szGeneralLabelSizeMax, szGeneralLabelHoverSizeMin, szGeneralLabelHoverSizeMax,
    szHighlightedLabelSizeMin, szHighlightedLabelSizeMax, szHighlightedLabelHoverSizeMin, szHighlightedLabelHoverSizeMax,
    zoomRangeMin, zoomRangeMax,
  } = useMapColors();

  // React Query – geo data
  const { data: airportsData } = useAirportsQuery();


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

  // Ref to track whether route hover listeners have been registered on the current map instance.
  // Listeners are tied to the map instance (not to layers), so they need to be set up once per
  // instance. Reset this flag whenever map.current is replaced in initMap.
  const listenersAttachedRef = useRef(false);

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
      listenersAttachedRef.current = false; // new map instance — listeners must be re-attached
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
    applyMapAirportFilters(
      map.current,
      {
        tripVisibleAirportCodes: tripVisibleAirportCodesRef.current,
        highlightedAirports: highlightedAirportsRef.current,
        selectedAirportCode: selectedAirportCodeRef.current,
        selectedAirportCodes: selectedAirportCodesRef.current ?? [],
        explorationAirportCodes: explorationAirportCodesRef.current ?? [],
        hoveredAirportCode: hoveredAirportCodeRef.current,
        cityLabelCodes: cityLabelCodesRef.current,
        airportCityKeyMap: airportCityKeyRef.current,
        cityLabelCodeByCity: cityLabelCodeByCityRef.current,
        manualTransferAirportCodes: manualTransferAirportCodesRef.current,
        isRouteHovered: isRouteHoveredRef.current,
        tripRoutes: tripRoutesRef.current,
      },
      { highlightedLabelCodesRef, highlightedCityLabelCodesRef },
    );
  }, []); // stable – uses only refs

  // ── applyColors: update all paint properties from colorStore ──────────────
  // Reads current store state via getState() so the callback stays stable.
  // ── applyColors: update all paint properties from colorStore ──────────────
  const applyColors = useCallback(() => {
    if (!map.current) return;
    applyMapColors(map.current, {
      selectedAirportCodes: selectedAirportCodesRef.current ?? [],
      tripVisibleAirportCodes: tripVisibleAirportCodesRef.current,
      highlightedAirports: highlightedAirportsRef.current,
      manualTransferAirportCodes: manualTransferAirportCodesRef.current ?? [],
      explorationAirportCodes: explorationAirportCodesRef.current ?? [],
      selectedAirportCode: selectedAirportCodeRef.current,
      highlightedLabelCodes: highlightedLabelCodesRef.current,
    });
  }, []); // stable – uses only refs

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



    setupRouteLayers(map.current);

    // Airport and city layers on top of all route lines
    if (airportsData && showAirports) {
      addAirportsLayer(map.current, airportsData, mapStyle);
    }



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

    // Route hover — event listeners and popup logic delegated to routeHover.ts
    const routeHoverRefs: RouteHoverRefs = {
      map,
      projectedAirportsRef,
      hoveredAirportCodeRef,
      hoveredRouteId,
      hoveredTripRouteId,
      hoveredTransferRouteId,
      isRouteHoveredRef,
      tripVisibleAirportCodesRef,
      highlightedAirportsRef,
      selectedAirportCodeRef,
      selectedAirportCodesRef,
      explorationAirportCodesRef,
      manualTransferAirportCodesRef,
      airportCityKeyRef,
      cityLabelCodeByCityRef,
      highlightedCityLabelCodesRef,
      flightDetailsMap,
      airportNamesMap,
      airportCoordsMapRef,
      currentPopup,
      routeHoverAtPointRef,
      clearRouteHoverRef,
      applyAirportFilters,
      texts: {
        noFlightsForDate: t.card.noFlightsForDate,
        clickRouteToFilter: t.card.clickRouteToFilter,
        unknown: t.common.unknown,
      },
    };
    if (!listenersAttachedRef.current) {
      setupRouteHoverListeners(map.current, routeHoverRefs);
      listenersAttachedRef.current = true;
    }

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
    setLayerVisibility('selected-routes', showAirports);

    applyAirportFilters();
    applyColors();
  }, [mapLoaded, airportsData, mapStyle, showAirports, safeRemoveLayer, safeRemoveSource, applyAirportFilters, applyColors, rightPanelRef]);

  // Update airport layer filters when highlightedAirports changes (no source rebuild)
  useAirportLayerFilter({
    map,
    mapLoaded,
    highlightedAirports,
    previewAirportCode,
    selectedAirportCode,
    selectedAirportCodes,
    explorationItems,
    tripVisibleAirportCodes,
    manualTransferAirportCodes,
    cityLabelCodesRef,
    airportCityKeyRef,
    cityLabelCodeByCityRef,
    isRouteHoveredRef,
    highlightedLabelCodesRef,
    highlightedCityLabelCodesRef,
  });

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

  // Raw canvas DOM mousemove — airport hover logic delegated to useMapHover
  const hoverRefs: MapHoverRefs = {
    map,
    projectedAirportsRef,
    hoveredAirportCodeRef,
    lastDetectedCodeRef,
    hoverSampleCountRef,
    mouseStopTimerRef,
    hoverClearTimerRef,
    hoverLockUntilRef,
    isRouteHoveredRef,
    hoveredRouteId,
    airportCityKeyRef,
    cityLabelCodeByCityRef,
    cityLabelCodesRef,
    highlightedLabelCodesRef,
    highlightedCityLabelCodesRef,
    highlightedAirportsRef,
    selectedAirportCodesRef,
    explorationAirportCodesRef,
    tripVisibleAirportCodesRef,
    airportsDataRef,
    onSelectItemRef,
  };
  useMapHover(hoverRefs, mapLoaded, showAirports);


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
  useRouteAnimation({
    map,
    mapLoaded,
    highlightedAirports,
    airportsData,
    selectedAirportCode,
    selectedAirportCodes,
    displayedFlights,
    displayedFlightsRef,
    completedPathsRef,
    currentAnimatingRef,
    animationRef,
    renderedHighlightedRef,
  });

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