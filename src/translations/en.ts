// Słownik angielski
export const TEXTS_EN = {
  appTitle: "Flight Trip Planner", // App.tsx (Tytuł SEO)
  common: {
    userFallback: "User", // UserMenu.tsx fallback
    unknown: "Unknown", // Phase2.tsx fallback
    localAtArrival: "Local time at arrival",
    localAtSelected: "Local time at selected",
    localTime: "Local time",
  },
  buttons: {
    signIn: "Sign In", // App.tsx, AuthModal.tsx
    signOut: "Sign Out", // UserMenu.tsx
    register: "Register", // AuthModal.tsx
    openControls: "Settings", // App.tsx (Mapa)
    closeControls: "✕ Close settings", // App.tsx
    search: "Search", // Search.tsx
    cancel: "Cancel", // TripNameModal.tsx, ConfirmDeleteModal.tsx
    confirm: "Confirm", // ConfirmDeleteModal.tsx
    delete: "Delete", // ConfirmDeleteModal.tsx, SavedTripsPanel.tsx
    save: "Save", // SaveTripButton.tsx
    edit: "Edit", // TripItinerary.tsx
    clear: "Clear", // FlightsFilter.tsx
    tryAgain: "Try again", // FlightsList.tsx
    refresh: "Refresh", // FlightsList.tsx
    load: "Load", // SavedTripsPanel.tsx
    rename: "Rename", // SavedTripsPanel.tsx
    undo: "Undo", // TripItinerary.tsx
    redo: "Redo", // TripItinerary.tsx
    close: "Close"
  },
  auth: { // AuthModal.tsx (Supabase)
    updateTripTitle: "Update existing trip",
    saveTripTitle: "Save current trip",
    createAccount: "Create Account",
    email: "Email",
    password: "Password",
    pleaseWait: "Please wait...",
    register: "Register",
    checkEmail: "Check your email to confirm your account.",
    continueGoogle: "Continue with Google",
    noAccount: "No account?",
    haveAccount: "Have an account?",
    saveTrip: "Save Trip", // TripItinerary.tsx
    updateTrip: "Update Trip", // TripItinerary.tsx
    saving: "Saving...", // preferencesSync.ts
    nameYourTrip: "Name your trip",
    autoNamePrefix: "Trip ",
  },
  map: {
    searchPlaceholder: "Search locations...", // Search.tsx
  },
  flights: {
    never: 'Never',
    justNow: 'Just now',
    minutesAgo: (minutes: number) => `${minutes} min ago`,
    hoursAgo: (hours: number) => `${hours}h ago`,
    loadingFrom: (code: string) => `Loading flights from ${code}...`,
    noFlightsMatchFilters: "No flights match the current filters", // FlightsList.tsx
    noFlightsForDate: (date: string) => `No flights for ${date}`, // FlightsList.tsx
    tryAdjustFilters: "Try adjusting or clearing filters",
    tryDifferentDate: "Try selecting a different date",
    lastUpdated: "Last updated: ",
    scheduleDataBy: "Schedule data thanks to:",
    loading: "Loading..."
  },
  date: { // DateInput.tsx
    placeholder: "DD/MM/YYYY",
    selectDate: "Select departure date",
  },
  search: { // SearchComponent.tsx (3 fazy)
    expandToShowCities: "Expand to show cities",
    countries: "Countries",
    cities: "Cities",
    airports: "Airports",
    containsSearch: " (Contains Search)",
    loaded: " (Loaded)",
    placeholder: "Search countries, cities, airports...",
    error: "Search Component Error",
    loading: "Loading...",
    loadingDetails: "Loading details...",
    noCities: "No cities",
    noCitiesAvailable: "No cities available",
    scrollMore: "Scroll for more",
    expandToShowAirports: "Expand to show airports", // Phase3.tsx
    collapse: "Collapse",
    noAirportsForCity: (city: string) => `No airports available for ${city}`, // Phase3.tsx
    loadingAirportsForCity: (city: string) => `Loading airports for ${city}...`, // Phase3.tsx
    clickExpandCities: (country: string) => `Click expand to load cities for ${country}`, // CountryModeSection.tsx
    loadingCitiesForCountry: (country: string) => `Loading cities for ${country}...`, // CountryModeSection.tsx
    airportCode: "Airport code",
    noResultsFound: (query: string) => `No results found for "${query}"`, // Search.tsx
    searchResults: "Search Results",
    scrolling: (count: number) => ` (Scrolling ${count} countries...)`, // Phase2.tsx
    debugPhase1: (count: number) => `Phase 1: Showing ${count} matching countries`,
    expand: "Expand"
  },
  filter: { // FlightsFilter.tsx
    title: "Filters",
    countries: "Countries",
    cities: "Cities",
    airports: "Airports",
    searchDestinations: "Search destinations..."
  },
  transferPicker: { // AirportTransferPicker.tsx
    toSearch: "to search",
    clickToAdd: "Click to add airports to search",
    searchAirports: "Search airports to add...",
    noAirports: "No airports found",
    addAirports: (count: number) => `Add ${count} airport${count !== 1 ? 's' : ''}`,
    title: "Change transfer airport",
    selectAirport: "Select an airport to use as a connection point",
  },
  panel: { // RightPanel.tsx
    selectedCount: (selected: number, max: number) => `${selected}/${max} airports selected`,
    originalAirport: "Original airport",
    transferAirports: "Transfer airports",
    switchTimezone: "Click to switch timezone",
    destinations: "Destinations",
    airlines: "Airlines",
    departureDate: "Departure date",
    loadingAirports: "Loading airports...",
    noFlightableAirports: "No airports available",
    loadingCities: "Loading cities...",
    selectAirportsAbove: "Select airports above to view departing flights.",
    loadingFlights: "Loading flights...",
    departingFlights: "Departing Flights",
    selectAirportsMax: (max: number) => `Select airports (max ${max})`,
    loadFlightsFromCount: (count: number) => `Load flights from ${count} airport(s)`, // CountryModeSection.tsx
    selectCitiesMax: (max: number) => `Select cities (max ${max} airports total)`,
    addAirportsFrom: "Add airports from ", // PendingCountryPicker.tsx
    addCountAirports: (count: number) => `Add ${count} airport${count !== 1 ? 's' : ''}`,
    airportAbbreviation: "ap"
  },
  card: { // FlightCard.tsx
    terminal: "Terminal:",
    gate: "Gate:",
    flightTime: "Flight time:",
    estArrival: "Est. arrival:",
    departure: "Departure",
    arrival: "Arrival",
    searchOnline: "Search online",
    loadingPrices: "Loading prices...",
    failedPrices: "Failed to load prices",
    noPrices: "No prices available for this flight",
    ticketDataBy: "Ticket data thanks to:", // Footnote
    bookTicket: "Book ticket",
    addTrip: "Add to trip",
    showPrices: "Show prices",
    hidePrices: "Hide prices",
    noFlightsForDate: "No flights for selected date",
    clickRouteToFilter: "Click route to filter by destination", // MapComponent.tsx
    estimated: "~ estimated",
    estimatedTooltip: "Estimated arrival based on distance/speed (~850 km/h)",
    origin: "Origin", // Fallback
    destination: "Destination", // Fallback
    loading: "Loading...",
    oneWay: " one way",
    na: "N/A"
  },
  days: {
    mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun"
  },
  trip: { // TripItinerary.tsx
    tripEnded: "Trip has already ended",
    editTrip: "Edit this trip",
    timeInCity: (city: string) => `Time in ${city}`,
    transfer: "Transfer: ",
  },
  savedTrips: { // SavedTripsPanel.tsx
    title: "Saved trips",
    loading: "Loading...",
    failed: "Failed to load trips",
    noTrips: "No saved trips",
    tripId: (id: string | number) => `Trip #${id}`,
    country: "country",
    countries: "countries",
    rename: "Rename",
    delete: "Delete",
    load: "Load",
    nameYourTrip: "Name your trip",
    save: "Save"
  },
  modals: { // ConfirmDeleteModal.tsx
    thisTrip: "this trip",
    undoWarning: "This action cannot be undone.",
    namePlaceholder: "Empty for auto-name",
    deleteTrip: "Delete trip?",
    sureDelete: "Are you sure you want to delete ",
  },
  controls: { // ControlsPanel.tsx
    layersTitle: "Map Layers",
    darkMatter: "Dark Matter",
    positron: "Positron",
    voyager: "Voyager",
    satellite: "Satellite",
    imagery: "ArcGIS Imagery",
    charted: "ArcGIS Charted Territory",
    community: "ArcGIS Community",
    humanGeo: "ArcGIS Human Geography",
    globe: "Globe",
    showRefresh: "Show Refresh Button",
    showConsole: "Show Console Logs",
    loadRoutes: "Load Routes",
    customizeStyles: "Customize Styles", // ColorSettings.tsx
    hideStyles: "Hide Styles",
    developer: "Developer",
    hideDeveloper: "Hide Developer",
    mapSizeSettings: "Map Size Settings",
    hideSizeSettings: "Hide Size Settings",
    resetAll: "Reset all",
    resetSizes: "Reset sizes",
    zoom: "Zoom:",
    eyedropper: "Eyedropper",
    pickColor: "Pick color from screen",
    notSupportedBrowser: "Not supported in this browser",
    currency: "Currency:",
    minTransferTime: "Min. transfer time:",
    minManualTransfer: "Min. manual transfer:",
    mapStyle: "Map Style:",
    lightDefault: "Light (default)",
    airportsCount: "Airports: ",
    routesCount: "Routes: ",
    loading: "(loading...)",
    switchToFlat: "Switch to flat map",
    switchToGlobe: "Switch to globe",
    language: "Language",
    saveSettings: "Save settings",
    settingsSaved: "Saved",
    saving: "Saving...",
  },
  colorSettings: { // ColorSettings.tsx
    title: "Map Color Customization",
    picker: {
      selectWindow: "Select window...",
      clickToPick: "Click to pick color · Esc to cancel"
    },
    colors: "Colors",
    reset: "Reset Colors",
    water: "Water Area",
    land: "Primary Land",
    landSecondary: "Secondary Land",
    labels: "Text Labels",
    airports: "Airport Markers",
    routes: "Flight Routes",
    stars: "Background Stars",
    unselected: "Inactive Elements",
    size: "Marker Size",
    colorHex: "Color HEX",
    generalAirports: "General airports",
    destinationAirports: "Destination airports",
    tripAirports: "Trip airports",
    sameAirport: "Same airport",
    sameCity: "Same city",
    sameCountry: "Same country",
    departsTooSoon: "Departs too soon",
    tripRoute: "Trip route",
    transferRoute: "Transfer route",
    transferPreview: "Transfer preview",
    routeLineWidth: "Route line width",
    routeLineHoverWidth: "Route line hover width",
    tripRouteWidth: "Trip route line width",
    tripRouteHoverWidth: "Trip route line hover width",
    generalDotSize: "General dot size",
    generalDotHoverSize: "General dot hover size",
    highlightedDotSize: "Highlighted dot size",
    highlightedDotHoverSize: "Highlighted dot hover size",
    generalLabelSize: "General label size",
    generalLabelHoverSize: "General label hover size",
    highlightedLabelSize: "Highlighted label size",
    highlightedLabelHoverSize: "Highlighted label hover size",
    startingPoints: "Starting points",
    mapElements: "Map elements",
    flightCardHighlights: "Flight card highlights",
    sizes: "Sizes",
    zoomRange: "Zoom range",
    pointLabel: (n: number) => `Point ${n}`,
    help: {
      airportDot: "Airport dot",
      airportDotHover: "Airport dot hover",
      routeLine: "Route line",
      routeLineHover: "Route line hover",
      labelColor: "Label color",
      labelHoverColor: "Label hover color",
      dotColor: "Dot color",
      dotHoverColor: "Dot hover color",
      color: "Color",
      hoverColor: "Hover color",
      bgColor: "Background color",
      borderColor: "Border color"
    }
  },
  errors: {
    generic: "Something went wrong.",
    mapNotLoaded: "Map could not be loaded",
    webglNotSupported: "WebGL is not supported in your browser.",
    noResults: "No results found"
  }
};
