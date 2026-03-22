export const CONFIG = {

  // ──────────────────────────────────────────────────────────────────────────
  // AirportTransferPicker.tsx
  // ──────────────────────────────────────────────────────────────────────────

  /** Initial number of airports shown in the dropdown list before scroll-loading more */
  INITIAL_DISPLAY_COUNT: 30,
  /** Remaining scroll pixels below which the next page of airports is loaded */
  SCROLL_LOAD_THRESHOLD: 100,
  /** Delay (ms) before focusing the search input after the picker opens */
  FOCUS_DELAY_MS: 50,
  /** Kilometre threshold above which formatDist switches from "X km" to "X k km" (AirportTransferPicker.tsx) */
  KM_THRESHOLD: 1000,
  /** Approximate kilometres per one degree of latitude or longitude (used for fast distance estimation) */
  KM_PER_DEGREE: 111,
  /** Distance unit label for values < KM_THRESHOLD */
  UNIT_KM: 'km',
  /** Distance unit label for values ≥ KM_THRESHOLD */
  UNIT_K_KM: 'k km',

  // ──────────────────────────────────────────────────────────────────────────
  // ColorSettings.tsx – inline colour-picker canvas dimensions
  // ──────────────────────────────────────────────────────────────────────────

  /** Width (px) of the saturation/value gradient canvas */
  COLOR_PICKER_SV_WIDTH: 148,
  /** Height (px) of the saturation/value gradient canvas */
  COLOR_PICKER_SV_HEIGHT: 120,
  /** Width (px) of the hue strip canvas */
  COLOR_PICKER_STRIP_WIDTH: 14,
  /** Height (px) of the hue strip canvas */
  COLOR_PICKER_STRIP_HEIGHT: 120,

  // ──────────────────────────────────────────────────────────────────────────
  // MapComponent.tsx / TripItinerary.tsx – popup positioning
  // ──────────────────────────────────────────────────────────────────────────

  /** Maximum vertical height (px) used when clamping a popup to stay inside the viewport */
  POPUP_MAX_HEIGHT: 480,
  /** Horizontal gap (px) between the triggering element boundary and the popup left edge */
  POPUP_OFFSET: 8,

  // ──────────────────────────────────────────────────────────────────────────
  // RightPanel.tsx / MapComponent.tsx – timezone sentinel values
  // ──────────────────────────────────────────────────────────────────────────

  /** Sentinel timezone code used when an airport's timezone is genuinely unknown */
  UNKNOWN_TIMEZONE: '_unknown',
  /** Sort key injected so that unknown-timezone airports sort after all real UTC offsets */
  UNKNOWN_TZ_DUMMY: '9999',
  /** UTC label displayed when no timezone can be determined */
  UNKNOWN_TZ_UTCLABEL: '?',

  // ──────────────────────────────────────────────────────────────────────────
  // api/client.ts
  // ──────────────────────────────────────────────────────────────────────────

  /** Axios request timeout (ms) applied to every API call */
  API_TIMEOUT_MS: 30000,

  // ──────────────────────────────────────────────────────────────────────────
  // api/geo.ts – default query parameters
  // ──────────────────────────────────────────────────────────────────────────

  /** Filter airports to only those that have scheduled commercial flights */
  FLIGHTABLE_ONLY: true,
  /** Filter locations to only those that contain at least one airport */
  HAS_AIRPORT_ONLY: true,

  // ──────────────────────────────────────────────────────────────────────────
  // DateInput.tsx
  // ──────────────────────────────────────────────────────────────────────────

  /** Maximum number of days in the future a departure date can be selected */
  MAX_DAYS_FORWARD: 180,
  /** Number of months to scan forward when searching for the closest valid day-of-month */
  MAX_MONTHS_FOR_DAY_SEARCH: 7,

  // ──────────────────────────────────────────────────────────────────────────
  // FlightsFilter.tsx / RightPanel.tsx – UI timing
  // ──────────────────────────────────────────────────────────────────────────

  /** Sentinel value stored in the city-group key when a flight has no city association */
  NO_CITY_PLACEHOLDER: '__nocity__',
  /** Delay (ms) before closing a search dropdown on input blur, allowing click events to fire first */
  INPUT_BLUR_DELAY_MS: 50,

  // ──────────────────────────────────────────────────────────────────────────
  // FlightsList.tsx
  // ──────────────────────────────────────────────────────────────────────────

  /** Number of virtual-list items kept rendered outside the visible area (react-virtuoso overscan) */
  VIRTUOSO_OVERSCAN: 200,
  /** Delay (ms) after a "jump to date" action before re-enabling automatic scroll behaviour */
  MANUAL_JUMP_TIMEOUT_MS: 500,

  // ──────────────────────────────────────────────────────────────────────────
  // MapComponent.tsx – interaction geometry
  // ──────────────────────────────────────────────────────────────────────────

  /** Minimum zoom level at which airport/city labels become visible */
  LABEL_MIN_ZOOM: 5,
  /** Minutes in a full day (used in TripItinerary.tsx duration formatting) */
  MINUTES_PER_DAY: 1440,
  /** Scaling factor applied to a style property at the minimum zoom anchor in ziLegacy (MapComponent.tsx) */
  SIZE_INTERPOLATION_MIN_FACTOR: 0.3,
  /** Scaling factor applied to a style property at the maximum zoom anchor in ziLegacy (MapComponent.tsx) */
  SIZE_INTERPOLATION_MAX_FACTOR: 2.5,
  /** rootMargin for the visibility IntersectionObserver that tracks which expanded country/city is in view (Search.tsx) */
  VISIBILITY_OBSERVER_ROOT_MARGIN: '-10% 0px -80% 0px',
  /** Half-size (px) of the bounding box used to hit-test route hover events */
  ROUTE_HOVER_BBOX_SIZE: 4,
  /** Delay (ms) before hiding the map flight-info popup after the cursor leaves */
  POPUP_HIDE_DELAY_MS: 150,
  /** Padding (px) added above the airport label expression to avoid label overlap */
  LABEL_OFFSET_PADDING: 4,

  // ──────────────────────────────────────────────────────────────────────────
  // Search.tsx – IntersectionObserver infinite scroll
  // ──────────────────────────────────────────────────────────────────────────

  /** CSS rootMargin that triggers the next page load before the sentinel element is fully visible */
  INFINITE_SCROLL_MARGIN: '100px',
  /** IntersectionObserver threshold ratio required to fire the callback */
  INTERSECTION_THRESHOLD: 0.1,
  /** Delay (ms) before collapsing the search results panel after input loses focus */
  SEARCH_BLUR_DELAY_MS: 200,
  /** Delay (ms) before restoring scroll position after search panel closes */
  SCROLL_RESTORE_DELAY_MS: 50,

  // ──────────────────────────────────────────────────────────────────────────
  // Shared maths / geo utilities
  // ──────────────────────────────────────────────────────────────────────────

  /** Multiply degrees by this to get radians */
  DEG_TO_RAD: Math.PI / 180,
  /** Multiply radians by this to get degrees */
  RAD_TO_DEG: 180 / Math.PI,
  /** Earth radius in kilometres (used in the Haversine formula) */
  EARTH_RADIUS_KM: 6371,

  // ──────────────────────────────────────────────────────────────────────────
  // App-wide limits
  // ──────────────────────────────────────────────────────────────────────────

  /** Maximum number of departure airports that can be selected simultaneously */
  MAX_AIRPORTS: 6,
  /** Maximum number of transfer (stopover) airports that can be added to a segment */
  MAX_TRANSFER_AIRPORTS: 5,
  /** Maximum number of flights shown in the map airport hover popup */
  MAX_POPUP_FLIGHTS: 6,
  /** Maximum number of flights fetched per API request */
  FLIGHT_LIMIT: 200,

  // ──────────────────────────────────────────────────────────────────────────
  // MapComponent.tsx – animation / fly-to
  // ──────────────────────────────────────────────────────────────────────────

  /** Duration (ms) of the MapLibre camera fly-to animation */
  FLY_DURATION: 800,
  /** Pixel padding applied on all sides when fitting the map to a set of coordinates */
  FIT_BOUNDS_PADDING: 80,
  /** Maximum zoom level allowed when fitting bounds (prevents over-zooming on close airports) */
  FIT_BOUNDS_MAX_ZOOM: 8,
  /** Maximum latitude/longitude spread (degrees) before a point is considered an outlier */
  OUTLIER_MAX_DEG: 5,
  /** Maximum zoom level at which a country view is rendered instead of zooming in further */
  MAX_ZOOM_FOR_COUNTRY: 7,
  /** Default map center [lng, lat] (central Europe) */
  DEFAULT_MAP_CENTER: [19.0, 52.0] as [number, number],
  /** Default map zoom level on initial load */
  DEFAULT_MAP_ZOOM: 4,

  // ──────────────────────────────────────────────────────────────────────────
  // TripItinerary.tsx – flight time estimation
  // ──────────────────────────────────────────────────────────────────────────

  /** Assumed average cruise speed (km/h) used to estimate flight duration when no schedule exists */
  AVERAGE_AIRCRAFT_SPEED_KMH: 850,
  /** Extra hours added to the raw flight-time estimate to account for taxi, climb and descent */
  ADDITIONAL_BLOCK_HOURS: 0.5,

  // ──────────────────────────────────────────────────────────────────────────
  // Map layers – zoom interpolation breakpoints (MapComponent.tsx / ColorSettings.tsx)
  // ──────────────────────────────────────────────────────────────────────────

  /** Minimum zoom level used as the lower anchor of zoom-based style interpolations */
  MIN_ZOOM: 1,
  /** Maximum zoom level used as the upper anchor of zoom-based style interpolations */
  MAX_ZOOM: 12,
  /** Mid-point zoom level used as the middle anchor of zoom-based style interpolations */
  REFERENCE_ZOOM: 6,

  // ──────────────────────────────────────────────────────────────────────────
  // MapComponent.tsx – great-circle route rendering
  // ──────────────────────────────────────────────────────────────────────────

  /** Number of intermediate points used to draw great-circle arcs */
  GC_POINTS: 64,
  /** Step size of the route animation per frame (fraction of total arc length) */
  ANIMATION_SPEED: 0.005,

  // ──────────────────────────────────────────────────────────────────────────
  // MapComponent.tsx – hover state machine timings
  // ──────────────────────────────────────────────────────────────────────────

  /** Process at most one hover event out of this many mouse-move events (reduces CPU load) */
  HOVER_SAMPLE_EVERY: 10,
  /** Duration (ms) a hover lock is held after a click to prevent jitter */
  HOVER_LOCK_DURATION_MS: 80,
  /** Delay (ms) before clearing the hover state after the cursor leaves a feature */
  HOVER_CLEAR_DELAY_MS: 40,
  /** Delay (ms) after mouse movement stops before snapping hover to the exact position */
  HOVER_STOP_DELAY_MS: 10,
  /** Extra pixel radius added around a hovered airport before clearing the hover state */
  HOVER_KEEP_RADIUS_EXTRA: 6,
  /** Milliseconds the hover state is extended after a lock ends */
  HOVER_LOCK_EXTENSION: 120,
  /** Pixel radius fallback used for hit-testing when the map projection is unavailable */
  HOVER_RADIUS_FALLBACK: 18,
  /** Minimum pixel distance between labels before one is hidden to prevent overlap */
  LABEL_CLEAR_RADIUS: 70,

  // ──────────────────────────────────────────────────────────────────────────
  // Search.tsx / MapComponent.tsx – typeahead and debounce
  // ──────────────────────────────────────────────────────────────────────────

  /** Debounce delay (ms) for search input and other high-frequency input handlers */
  DEBOUNCE_TIME_MS: 150,
  /** Maximum results returned per search category (main results / cities / airports) */
  SEARCH_LIMITS: { main: 20, cities: 50, airports: 50 },

  // ──────────────────────────────────────────────────────────────────────────
  // MapComponent.tsx – layer radius/text size arrays
  // ──────────────────────────────────────────────────────────────────────────

  /** Pixel offset added to the map bbox used for click detection */
  MAP_BBOX_OFFSET: 4,
  /** Zoom level at which an airport label starts to appear significantly larger */
  AIRPORT_ZOOM_THRESHOLD: 1.2,
  /** Fallback zoom levels when flying to a selected airport / city / country */
  FALLBACK_ZOOM: { AIRPORT: 6, CITY: 5, COUNTRY: 4 },
  /** Airport circle sizes (radius px) at different zoom breakpoints */
  MAP_AIRPORT_LAYER: {
    RADIUS_TINY: 4, RADIUS_SMALL: 6, RADIUS_MEDIUM: 8, RADIUS_LARGE: 10,
    TEXT_SMALL: 10, TEXT_MEDIUM: 11, TEXT_LARGE: 12
  },
  /** City circle sizes (radius px) at different zoom breakpoints */
  MAP_CITY_LAYER: {
    RADIUS_SMALL: 5, RADIUS_MEDIUM: 8,
    TEXT_SMALL: 11, TEXT_LARGE: 13
  },

  // ──────────────────────────────────────────────────────────────────────────
  // ColorSettings.tsx – colour luminance thresholds
  // ──────────────────────────────────────────────────────────────────────────

  /** RGB channel value below which a colour is considered "black" for contrast purposes */
  COLOR_THRESHOLDS: {
    BLACK_RGB: 20, WHITE_RGB: 235
  },

  // ──────────────────────────────────────────────────────────────────────────
  // RightPanel.tsx – drag / panel geometry
  // ──────────────────────────────────────────────────────────────────────────

  /** Extra pixels added to the draggable header height to ease grab targeting */
  DRAG_HEADER_EXTRA: 20,
  /** Peek height (px) of the panel when collapsed / minimised */
  PEEK_H: 100,
  /** Minimum drag distance (px) required to trigger a panel open/close gesture */
  DRAG_THRESHOLD: 60,

  // ──────────────────────────────────────────────────────────────────────────
  // FlightsList.tsx – timestamp / date helpers
  // ──────────────────────────────────────────────────────────────────────────

  /** Delay (ms) before scrolling to a specific date after the user taps "Jump to date" */
  JUMP_TO_DATE_TIMEOUT: 500,
  /** Milliseconds in one hour (used for timestamp arithmetic) */
  HOUR_IN_MS: 3600000,
  /** Minutes in one hour */
  MINUTES_IN_HOUR: 60,
  /** Hours in one day */
  HOURS_IN_DAY: 24,

  // ──────────────────────────────────────────────────────────────────────────
  // api/geo.ts – pagination
  // ──────────────────────────────────────────────────────────────────────────

  /** API page-size limits for geo endpoints */
  PAGE_LIMITS: { GET_CITY_AIRPORTS: 200, GET_COUNTRY_CITIES: 200 },

  // ──────────────────────────────────────────────────────────────────────────
  // Stores / misc
  // ──────────────────────────────────────────────────────────────────────────

  /** Milliseconds within which a cached API response is considered fresh and not re-fetched */
  CACHE_FRESHNESS_MS: 1000,
  /** Alias for MAX_DAYS_FORWARD used by the date store */
  MAX_DATE_DAYS: 180,

  // ──────────────────────────────────────────────────────────────────────────
  // ColorSettings.tsx – slider ranges for map style tuning
  // ──────────────────────────────────────────────────────────────────────────

  /** Min / max / step ranges for each map style slider in the colour-settings panel */
  SIZE_SLIDER_RANGES: {
    routeLineWidth:            { min: 1,  max: 10, step: 0.5, label: 'Animated route line max width' },
    routeLineHoverWidth:       { min: 2,  max: 20, step: 0.5, label: 'Hover animated route line width' },
    tripRouteWidth:            { min: 1,  max: 10, step: 0.5, label: 'Trip permanent route line width' },
    tripRouteHoverWidth:       { min: 2,  max: 20, step: 0.5, label: 'Hover trip permanent route width' },
    highlightedAirportRadius:      { min: 2,  max: 25, step: 0.5, label: 'Target airport max radius' },
    highlightedAirportHoverRadius: { min: 5,  max: 40, step: 0.5, label: 'Hover target airport radius' },
    generalAirportRadius:          { min: 1,  max: 15, step: 0.5, label: 'General airport max radius' },
    generalAirportHoverRadius:     { min: 4,  max: 30, step: 0.5, label: 'Hover general airport radius' },
    highlightedLabelSize:          { min: 10, max: 30, step: 1,   label: 'Target airport label size' },
    highlightedLabelHoverSize:     { min: 12, max: 40, step: 1,   label: 'Hover target label size' },
    generalAirportLabelSize:       { min: 8,  max: 25, step: 1,   label: 'General airport label size' },
    generalLabelHoverSize:         { min: 10, max: 35, step: 1,   label: 'Hover general label size' },
  },
};
