import maplibregl from 'maplibre-gl';
import { useColorStore } from '../../stores/colorStore';
import { useMapStore } from '../../stores/mapStore';
import { getHaloColorForTextColor } from './utils';
import { THEME_COLORS } from '../../constants/theme';
import { CONFIG } from '../../constants/config';

export interface ColorApplierContext {
  selectedAirportCodes: string[];
  tripVisibleAirportCodes: string[] | null;
  highlightedAirports: string[];
  manualTransferAirportCodes: string[];
  explorationAirportCodes: string[];
  selectedAirportCode: string | null;
  highlightedLabelCodes: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyExpr = any;

export function applyMapColors(map: maplibregl.Map, ctx: ColorApplierContext): void {
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
  const mapStyle = useMapStore.getState().mapStyle;

  const sacMulti       = ctx.selectedAirportCodes;
  const tvac           = ctx.tripVisibleAirportCodes;
  const ha             = ctx.highlightedAirports;
  const manualCodes    = ctx.manualTransferAirportCodes;
  const explorationCodes = ctx.explorationAirportCodes;
  const baseStartCodes = sacMulti.length > 0
    ? sacMulti
    : explorationCodes.length > 0
      ? explorationCodes
      : (ctx.selectedAirportCode ? [ctx.selectedAirportCode] : []);
  const startCodes     = [...new Set([...baseStartCodes, ...manualCodes])];
  const tripCodes      = tvac ?? [];
  const highlightedCodes = [...new Set([...startCodes, ...ha, ...tripCodes])];

  // Static circle/line colors
  if (map.getLayer('airports-highlighted'))
    map.setPaintProperty('airports-highlighted', 'circle-color', destinationAirport);
  if (map.getLayer('airports-trip'))
    map.setPaintProperty('airports-trip', 'circle-color', tripAirport);
  if (map.getLayer('airports-circles'))
    map.setPaintProperty('airports-circles', 'circle-color', generalAirport);
  if (map.getLayer('airports-route-hover'))
    map.setPaintProperty('airports-route-hover', 'circle-color', destinationAirportHover);
  if (map.getLayer('transfer-preview-route-line'))
    map.setPaintProperty('transfer-preview-route-line', 'line-color', transferRoute);

  // Hover colors
  const startHoverExpr: AnyExpr = sacMulti.length > 1
    ? ['match', ['get', 'code'],
        ...sacMulti.flatMap((code, i) => [code, sp[i]?.airportHover ?? THEME_COLORS.textBlack]),
        sp[0]?.airportHover ?? THEME_COLORS.textBlack,
      ]
    : (sp[0]?.airportHover ?? THEME_COLORS.textBlack);

  const destinationHoverCodes = [...new Set([
    ...ha,
    ...ctx.highlightedLabelCodes,
  ])].filter(c => !startCodes.includes(c) && !tripCodes.includes(c));
  if (map.getLayer('airports-hover'))
    map.setPaintProperty('airports-hover', 'circle-color', [
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
  const zoomInterp = (min: number, max: number): AnyExpr => (
    zMin === zMax
      ? max
      : ['interpolate', ['linear'], ['zoom'], zMin, min, zMax, max]
  );
  const labelOffsetExpr = (labelMin: number, labelMax: number, dotMin: number, dotMax: number): AnyExpr => {
    const padding = CONFIG.LABEL_OFFSET_PADDING;
    const minOffset = Math.max(0.2, (dotMin + padding) / Math.max(6, labelMin));
    const maxOffset = Math.max(0.2, (dotMax + padding) / Math.max(6, labelMax));
    return zMin === zMax
      ? ['literal', [0, maxOffset]]
      : ['interpolate', ['linear'], ['zoom'], zMin, ['literal', [0, minOffset]], zMax, ['literal', [0, maxOffset]]];
  };

  // Label sizes and colors
  if (map.getLayer('airports-labels-normal')) {
    map.setLayoutProperty('airports-labels-normal', 'text-size', zoomInterp(generalAirportLabelSizeMin, generalAirportLabelSizeMax));
    map.setLayoutProperty('airports-labels-normal', 'text-offset', labelOffsetExpr(generalAirportLabelSizeMin, generalAirportLabelSizeMax, generalAirportRadiusMin, generalAirportRadiusMax));
    map.setPaintProperty('airports-labels-normal', 'text-color', generalLabelColor);
    map.setPaintProperty('airports-labels-normal', 'text-halo-color', getHaloColorForTextColor(generalLabelColor, mapStyle));
  }
  if (map.getLayer('airports-labels-normal-city')) {
    map.setLayoutProperty('airports-labels-normal-city', 'text-size', zoomInterp(generalAirportLabelSizeMin, generalAirportLabelSizeMax));
    map.setLayoutProperty('airports-labels-normal-city', 'text-offset', labelOffsetExpr(generalAirportLabelSizeMin, generalAirportLabelSizeMax, generalAirportRadiusMin, generalAirportRadiusMax));
    map.setPaintProperty('airports-labels-normal-city', 'text-color', generalLabelColor);
    map.setPaintProperty('airports-labels-normal-city', 'text-halo-color', getHaloColorForTextColor(generalLabelColor, mapStyle));
  }

  const startLabelExpr: AnyExpr = sacMulti.length > 1
    ? ['match', ['get', 'code'],
        ...sacMulti.flatMap((code, i) => [code, sp[i]?.label ?? THEME_COLORS.textBlack]),
        sp[0]?.label ?? THEME_COLORS.textBlack,
      ]
    : (sp[0]?.label ?? THEME_COLORS.textBlack);
  const startLabelHoverExpr: AnyExpr = sacMulti.length > 1
    ? ['match', ['get', 'code'],
        ...sacMulti.flatMap((code, i) => [code, sp[i]?.labelHover ?? THEME_COLORS.textBlack]),
        sp[0]?.labelHover ?? THEME_COLORS.textBlack,
      ]
    : (sp[0]?.labelHover ?? THEME_COLORS.textBlack);

  const startLabelHaloExpr: AnyExpr = sacMulti.length > 1
    ? ['match', ['get', 'code'],
        ...sacMulti.flatMap((code, i) => [code, getHaloColorForTextColor(sp[i]?.label ?? THEME_COLORS.textBlack, mapStyle)]),
        getHaloColorForTextColor(sp[0]?.label ?? THEME_COLORS.textBlack, mapStyle),
      ]
    : getHaloColorForTextColor(sp[0]?.label ?? THEME_COLORS.textBlack, mapStyle);
  const startLabelHoverHaloExpr: AnyExpr = sacMulti.length > 1
    ? ['match', ['get', 'code'],
        ...sacMulti.flatMap((code, i) => [code, getHaloColorForTextColor(sp[i]?.labelHover ?? THEME_COLORS.textBlack, mapStyle)]),
        getHaloColorForTextColor(sp[0]?.labelHover ?? THEME_COLORS.textBlack, mapStyle),
      ]
    : getHaloColorForTextColor(sp[0]?.labelHover ?? THEME_COLORS.textBlack, mapStyle);

  const labelColorExpr: AnyExpr = [
    'case',
    ['in', ['get', 'code'], ['literal', startCodes]],
    startLabelExpr,
    ['in', ['get', 'code'], ['literal', ha]],
    destinationLabelColor,
    ['in', ['get', 'code'], ['literal', tripCodes]],
    tripLabelColor,
    destinationLabelColor,
  ];

  const labelHaloExpr: AnyExpr = [
    'case',
    ['in', ['get', 'code'], ['literal', startCodes]],
    startLabelHaloExpr,
    ['in', ['get', 'code'], ['literal', ha]],
    getHaloColorForTextColor(destinationLabelColor, mapStyle),
    ['in', ['get', 'code'], ['literal', tripCodes]],
    getHaloColorForTextColor(tripLabelColor, mapStyle),
    getHaloColorForTextColor(destinationLabelColor, mapStyle),
  ];

  const labelHoverColorExpr: AnyExpr = [
    'case',
    ['in', ['get', 'code'], ['literal', startCodes]],
    startLabelHoverExpr,
    ['in', ['get', 'code'], ['literal', ha]],
    destinationLabelHoverColor,
    ['in', ['get', 'code'], ['literal', tripCodes]],
    tripLabelHoverColor,
    destinationLabelHoverColor,
  ];

  const labelHoverHaloExpr: AnyExpr = [
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
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'text-size', zoomInterp(highlightedLabelSizeMin, highlightedLabelSizeMax));
      map.setLayoutProperty(id, 'text-offset', labelOffsetExpr(highlightedLabelSizeMin, highlightedLabelSizeMax, highlightedAirportRadiusMin, highlightedAirportRadiusMax));
      map.setPaintProperty(id, 'text-color', labelColorExpr);
      map.setPaintProperty(id, 'text-halo-color', labelHaloExpr);
    }
  }
  if (map.getLayer('airports-labels-hover')) {
    map.setLayoutProperty('airports-labels-hover', 'text-size', zoomInterp(highlightedLabelHoverSizeMin, highlightedLabelHoverSizeMax));
    map.setLayoutProperty('airports-labels-hover', 'text-offset', labelOffsetExpr(highlightedLabelHoverSizeMin, highlightedLabelHoverSizeMax, highlightedAirportHoverRadiusMin, highlightedAirportHoverRadiusMax));
    map.setLayoutProperty('airports-labels-hover', 'text-font', ["Noto Sans Bold"]);
    map.setPaintProperty('airports-labels-hover', 'text-color', labelHoverColorExpr);
    map.setPaintProperty('airports-labels-hover', 'text-halo-color', labelHoverHaloExpr);
  }
  if (map.getLayer('airports-labels-hover-general')) {
    map.setLayoutProperty('airports-labels-hover-general', 'text-size', zoomInterp(generalLabelHoverSizeMin, generalLabelHoverSizeMax));
    map.setLayoutProperty('airports-labels-hover-general', 'text-offset', labelOffsetExpr(generalLabelHoverSizeMin, generalLabelHoverSizeMax, generalAirportHoverRadiusMin, generalAirportHoverRadiusMax));
    map.setLayoutProperty('airports-labels-hover-general', 'text-font', ["Noto Sans Bold"]);
    map.setPaintProperty('airports-labels-hover-general', 'text-color', generalLabelHoverColor);
    map.setPaintProperty('airports-labels-hover-general', 'text-halo-color', getHaloColorForTextColor(generalLabelHoverColor, mapStyle));
  }

  // airports-selected: per-startPoint match expression
  if (map.getLayer('airports-selected')) {
    if (sacMulti.length > 1) {
      const matchExpr: AnyExpr = ['match', ['get', 'code'],
        ...sacMulti.flatMap((code, i) => [code, sp[i]?.airport ?? THEME_COLORS.textBlack]),
        THEME_COLORS.textBlack,
      ];
      map.setPaintProperty('airports-selected', 'circle-color', matchExpr);
    } else {
      map.setPaintProperty('airports-selected', 'circle-color', sp[0]?.airport ?? THEME_COLORS.textBlack);
    }
  }

  // selected-routes and trip routes
  const ziLegacy = (base: number): AnyExpr => [
    'interpolate', ['linear'], ['zoom'],
    1, Math.max(0.1, base * CONFIG.SIZE_INTERPOLATION_MIN_FACTOR),
    6, base,
    12, base * CONFIG.SIZE_INTERPOLATION_MAX_FACTOR,
  ];

  if (map.getLayer('selected-routes')) {
    let routeColorExpr: AnyExpr;
    if (sacMulti.length > 1) {
      routeColorExpr = ['match', ['get', 'srcIdx'],
        ...sacMulti.flatMap((_, i) => [i, sp[i]?.route ?? '#ed6498']),
        sp[0]?.route ?? '#ed6498',
      ];
    } else {
      routeColorExpr = sp[0]?.route ?? '#ed6498';
    }
    const hoverColorExpr: AnyExpr = sacMulti.length > 1
      ? ['match', ['get', 'srcIdx'],
          ...sacMulti.flatMap((_, i) => [i, sp[i]?.routeHover ?? '#b13b6b']),
          sp[0]?.routeHover ?? '#b13b6b',
        ]
      : (sp[0]?.routeHover ?? '#b13b6b');
    map.setPaintProperty('selected-routes', 'line-color', [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      hoverColorExpr,
      routeColorExpr,
    ]);
    map.setPaintProperty('selected-routes', 'line-width', [
      'interpolate', ['linear'], ['zoom'],
      1, ['case', ['boolean', ['feature-state', 'hover'], false], routeLineHoverWidthMin, routeLineWidthMin],
      12, ['case', ['boolean', ['feature-state', 'hover'], false], routeLineHoverWidthMax, routeLineWidthMax],
    ]);
  }

  if (map.getLayer('trip-permanent-routes-line')) {
    map.setPaintProperty('trip-permanent-routes-line', 'line-color', [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      tripRouteHover,
      tripRoute,
    ]);
    map.setPaintProperty('trip-permanent-routes-line', 'line-width', [
      'interpolate', ['linear'], ['zoom'],
      1, ['case', ['boolean', ['feature-state', 'hover'], false], tripRouteHoverWidthMin, tripRouteWidthMin],
      12, ['case', ['boolean', ['feature-state', 'hover'], false], tripRouteHoverWidthMax, tripRouteWidthMax],
    ]);
  }

  if (map.getLayer('manual-transfer-preview-line')) {
    map.setPaintProperty('manual-transfer-preview-line', 'line-color', [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      transferRouteHover,
      transferRoute,
    ]);
  }

  // Zoom-interpolated size properties
  if (map.getLayer('airports-highlighted'))
    map.setPaintProperty('airports-highlighted', 'circle-radius', zoomInterp(highlightedAirportRadiusMin, highlightedAirportRadiusMax));
  if (map.getLayer('airports-trip'))
    map.setPaintProperty('airports-trip', 'circle-radius', zoomInterp(highlightedAirportRadiusMin, highlightedAirportRadiusMax));
  if (map.getLayer('airports-circles'))
    map.setPaintProperty('airports-circles', 'circle-radius', zoomInterp(generalAirportRadiusMin, generalAirportRadiusMax));
  if (map.getLayer('airports-selected'))
    map.setPaintProperty('airports-selected', 'circle-radius', zoomInterp(highlightedAirportRadiusMin, highlightedAirportRadiusMax));
  if (map.getLayer('airports-hover'))
    map.setPaintProperty('airports-hover', 'circle-radius', [
      'interpolate', ['linear'], ['zoom'],
      1, ['case', ['in', ['get', 'code'], ['literal', highlightedCodes]], highlightedAirportHoverRadiusMin, generalAirportHoverRadiusMin],
      12, ['case', ['in', ['get', 'code'], ['literal', highlightedCodes]], highlightedAirportHoverRadiusMax, generalAirportHoverRadiusMax],
    ]);
  if (map.getLayer('airports-route-hover'))
    map.setPaintProperty('airports-route-hover', 'circle-radius', [
      'interpolate', ['linear'], ['zoom'],
      1, highlightedAirportHoverRadiusMin,
      12, highlightedAirportHoverRadiusMax,
    ]);
  if (map.getLayer('airports-labels-hover'))
    map.setLayoutProperty('airports-labels-hover', 'text-size', [
      'interpolate', ['linear'], ['zoom'],
      1, highlightedLabelHoverSizeMin,
      12, highlightedLabelHoverSizeMax,
    ]);
  if (map.getLayer('transfer-preview-route-line'))
    map.setPaintProperty('transfer-preview-route-line', 'line-width', zoomInterp(routeLineWidthMin, routeLineWidthMax));
  if (map.getLayer('manual-transfer-preview-line'))
    map.setPaintProperty('manual-transfer-preview-line', 'line-width', zoomInterp(routeLineWidthMin, routeLineWidthMax));
  if (map.getLayer('cities-circles')) {
    map.setPaintProperty('cities-circles', 'circle-color', generalCity);
    map.setPaintProperty('cities-circles', 'circle-radius', ziLegacy(generalCityRadius));
  }
  if (map.getLayer('cities-highlighted')) {
    map.setPaintProperty('cities-highlighted', 'circle-color', highlightedCity);
    map.setPaintProperty('cities-highlighted', 'circle-radius', ziLegacy(highlightedCityRadius));
  }
}
