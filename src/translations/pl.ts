// Polski słownik tłumaczeń. Komentarze: mapowanie do komponentów.
export const TEXTS_PL = {
  appTitle: "Planer Podróży Lotniczych", // App.tsx (Tytuł SEO)
  common: {
    userFallback: "Użytkownik", // UserMenu.tsx fallback
    unknown: "Nieznany", // Phase2.tsx fallback
    localAtArrival: "Czas lokalny w miejscu przylotu",
    localAtSelected: "Czas lokalny w wybranym miejscu",
    localTime: "Czas lokalny",
  },
  buttons: {
    signIn: "Zaloguj się", // App.tsx, AuthModal.tsx
    signOut: "Wyloguj się", // UserMenu.tsx
    register: "Zarejestruj się", // AuthModal.tsx
    openControls: "Ustawienia", // App.tsx (Mapa)
    closeControls: "✕ Zamknij ustawienia", // App.tsx
    search: "Szukaj", // Search.tsx
    cancel: "Anuluj", // TripNameModal.tsx, ConfirmDeleteModal.tsx
    confirm: "Potwierdź", // ConfirmDeleteModal.tsx
    delete: "Usuń", // ConfirmDeleteModal.tsx, SavedTripsPanel.tsx
    save: "Zapisz", // SaveTripButton.tsx
    edit: "Edytuj", // TripItinerary.tsx
    clear: "Wyczyść", // FlightsFilter.tsx
    tryAgain: "Spróbuj ponownie", // FlightsList.tsx
    refresh: "Odśwież", // FlightsList.tsx
    load: "Wczytaj", // SavedTripsPanel.tsx
    rename: "Zmień nazwę", // SavedTripsPanel.tsx
    undo: "Cofnij", // TripItinerary.tsx
    redo: "Ponów", // TripItinerary.tsx
    close: "Zamknij"
  },
  auth: { // AuthModal.tsx (Supabase)
    updateTripTitle: "Zaktualizuj podróż",
    saveTripTitle: "Zapisz podróż",
    createAccount: "Utwórz konto",
    email: "Email",
    password: "Hasło",
    pleaseWait: "Proszę czekać...",
    register: "Zarejestruj się",
    checkEmail: "Sprawdź email, aby potwierdzić konto.",
    continueGoogle: "Kontynuuj z Google",
    noAccount: "Nie masz konta?",
    haveAccount: "Masz konto?",
    saveTrip: "Zapisz podróż", // TripItinerary.tsx
    updateTrip: "Zaktualizuj podróż", // TripItinerary.tsx
    saving: "Zapisywanie...", // preferencesSync.ts
    nameYourTrip: "Nazwij swoją podróż",
    autoNamePrefix: "Podróż ",
  },
  map: {
    searchPlaceholder: "Szukaj lokalizacji...", // Search.tsx
  },
  flights: {
    never: 'Nigdy',
    justNow: 'Przed chwilą',
    minutesAgo: (minutes: number) => `${minutes} min temu`,
    hoursAgo: (hours: number) => `${hours}h temu`,
    loadingFrom: (code: string) => `Ładowanie lotów z ${code}...`,
    noFlightsMatchFilters: "Żadne loty nie pasują do bieżących filtrów", // FlightsList.tsx
    noFlightsForDate: (date: string) => `Brak lotów ${date}`, // FlightsList.tsx
    tryAdjustFilters: "Spróbuj dostosować lub wyczyścić filtry",
    tryDifferentDate: "Spróbuj wybrać inną datę",
    lastUpdated: "Ostatnia aktualizacja: ",
    scheduleDataBy: "Dane rozkładów dzięki:"
  },
  date: { // DateInput.tsx
    placeholder: "DD/MM/RRRR",
    selectDate: "Wybierz datę wylotu",
  },
  search: { // SearchComponent.tsx (3 fazy)
    expandToShowCities: "Rozwiń, aby pokazać miasta",
    countries: "Kraje",
    cities: "Miasta",
    airports: "Lotniska",
    containsSearch: " (Zawiera szukane)",
    loaded: " (Załadowane)",
    placeholder: "Szukaj krajów, miast, lotnisk...",
    error: "Błąd komponentu wyszukiwania",
    loading: "Ładowanie...",
    loadingDetails: "Ładowanie szczegółów...",
    noCities: "Brak miast",
    noCitiesAvailable: "Brak dostępnych miast",
    scrollMore: "Przewiń, aby zobaczyć więcej",
    expandToShowAirports: "Rozwiń, aby pokazać lotniska", // Phase3.tsx
    collapse: "Zwiń",
    noAirportsForCity: (city: string) => `Brak lotnisk dla ${city}`, // Phase3.tsx
    loadingAirportsForCity: (city: string) => `Ładowanie lotnisk dla ${city}...`, // Phase3.tsx
    clickExpandCities: (country: string) => `Kliknij rozwiń, aby załadować miasta dla ${country}`, // CountryModeSection.tsx
    loadingCitiesForCountry: (country: string) => `Ładowanie miast dla ${country}...`, // CountryModeSection.tsx
    airportCode: "Kod lotniska",
    noResultsFound: (query: string) => `Nie znaleziono wyników dla "${query}"`, // Search.tsx
    searchResults: "Wyniki wyszukiwania",
    scrolling: (count: number) => ` (Przewijanie ${count} krajów...)`, // Phase2.tsx
    debugPhase1: (count: number) => `Faza 1: Wyświetlanie ${count} pasujących krajów`,
    expand: "Rozwiń"
  },
  filter: { // FlightsFilter.tsx
    title: "Filtry",
    countries: "Kraje",
    cities: "Miasta",
    airports: "Lotniska",
    searchDestinations: "Szukaj miejsc docelowych..."
  },
  transferPicker: { // AirportTransferPicker.tsx
    toSearch: "aby wyszukać",
    clickToAdd: "Kliknij, aby dodać lotniska do wyszukiwania",
    searchAirports: "Szukaj lotnisk do dodania...",
    noAirports: "Nie znaleziono lotnisk",
    addAirports: (count: number) => `Dodaj ${count} lotnisk${count === 1 ? 'ko' : count < 5 ? 'a' : ''}`,
    title: "Zmień lotnisko przesiadkowe",
    selectAirport: "Wybierz lotnisko, które będzie punktem przesiadkowym",
  },
  panel: { // RightPanel.tsx
    selectedCount: (selected: number, max: number) => `${selected}/${max} lotnisk wybranych`,
    originalAirport: "Lotnisko startowe",
    transferAirports: "Lotniska przesiadkowe",
    switchTimezone: "Kliknij, aby przełączyć strefę czasową",
    destinations: "Miejsca docelowe",
    airlines: "Linie lotnicze",
    departureDate: "Data wylotu",
    loadingAirports: "Ładowanie lotnisk...",
    noFlightableAirports: "Brak dostępnych lotnisk",
    loadingCities: "Ładowanie miast...",
    selectAirportsAbove: "Wybierz lotniska powyżej, aby zobaczyć odloty.",
    loadingFlights: "Ładowanie lotów...",
    departingFlights: "Odlatujące loty",
    selectAirportsMax: (max: number) => `Wybierz lotniska (maks. ${max})`,
    loadFlightsFromCount: (count: number) => `Wczytaj loty z ${count} lotnisk${count === 1 ? 'a' : ''}`, // CountryModeSection.tsx
    selectCitiesMax: (max: number) => `Wybierz miasta (maks. ${max} lotnisk łącznie)`,
    addAirportsFrom: "Dodaj lotniska z ", // PendingCountryPicker.tsx
    addCountAirports: (count: number) => `Dodaj ${count} lotnisk${count === 1 ? 'o' : count < 5 ? 'a' : ''}`,
    airportAbbreviation: "lotn."
  },
  card: { // FlightCard.tsx
    terminal: "Terminal:",
    gate: "Wyjście:",
    flightTime: "Czas lotu:",
    estArrival: "Szac. przylot:",
    departure: "Wylot",
    arrival: "Przylot",
    searchOnline: "Szukaj online",
    loadingPrices: "Ładowanie cen...",
    failedPrices: "Nie udało się załadować cen",
    noPrices: "Brak dostępnych cen dla tego lotu",
    ticketDataBy: "Dane biletów dzięki:", // Footnote
    bookTicket: "Kup bilet",
    addTrip: "Dodaj do podróży",
    showPrices: "Pokaż ceny",
    hidePrices: "Ukryj ceny",
    noFlightsForDate: "Brak lotów na wybraną datę",
    clickRouteToFilter: "Kliknij trasę, aby filtrować według celu", // MapComponent.tsx
    estimated: "~ szacowany",
    estimatedTooltip: "Szacowany przylot na podstawie odległości/prędkości (~850 km/h)",
    origin: "Wylot", // Fallback
    destination: "Przylot", // Fallback
    loading: "Ładowanie...",
    oneWay: " w jedną stronę",
    na: "N/D"
  },
  days: {
    mon: "Pon", tue: "Wt", wed: "Śr", thu: "Czw", fri: "Pt", sat: "Sob", sun: "Nd"
  },
  trip: { // TripItinerary.tsx
    tripEnded: "Podróż już się zakończyła",
    editTrip: "Edytuj tę podróż",
    timeInCity: (city: string) => `Czas w ${city}`,
    transfer: "Przesiadka: ",
  },
  savedTrips: { // SavedTripsPanel.tsx
    title: "Zapisane podróże",
    loading: "Ładowanie...",
    failed: "Nie udało się załadować podróży",
    noTrips: "Brak zapisanych podróży",
    tripId: (id: string | number) => `Podróż #${id}`,
    country: "kraj",
    countries: "kraje",
    rename: "Zmień nazwę",
    delete: "Usuń",
    load: "Wczytaj",
    nameYourTrip: "Nazwij swoją podróż",
    save: "Zapisz"
  },
  modals: { // ConfirmDeleteModal.tsx
    thisTrip: "tę podróż",
    undoWarning: "Tej akcji nie można cofnąć.",
    namePlaceholder: "Puste dla autogeneracji",
    deleteTrip: "Usunąć podróż?",
    sureDelete: "Czy na pewno chcesz usunąć",
  },
  controls: { // ControlsPanel.tsx
    layersTitle: "Warstwy mapy",
    darkMatter: "Ciemna materia",
    positron: "Pozyton",
    voyager: "Voyager",
    satellite: "Satelita",
    imagery: "ArcGIS — Zobrazowania",
    charted: "ArcGIS — Kartografia",
    community: "ArcGIS — Społeczność",
    humanGeo: "ArcGIS — Geografia",
    globe: "Glob",
    showRefresh: "Pokaż przycisk odświeżania",
    showConsole: "Pokaż logi konsoli",
    loadRoutes: "Wczytaj trasy",
    customizeStyles: "Dostosuj style", // ColorSettings.tsx
    hideStyles: "Ukryj style",
    developer: "Deweloper",
    hideDeveloper: "Ukryj dewelopera",
    mapSizeSettings: "Ustawienia rozmiarów mapy",
    hideSizeSettings: "Ukryj ustawienia rozmiarów",
    resetAll: "Resetuj wszystko",
    resetSizes: "Resetuj rozmiary",
    zoom: "Zoom:",
    eyedropper: "Kroplomierz",
    pickColor: "Wybierz kolor z ekranu",
    notSupportedBrowser: "Nieobsługiwane w tej przeglądarce",
    currency: "Waluta:",
    minTransferTime: "Min. czas przesiadki:",
    minManualTransfer: "Min. ręczna przesiadka:",
    mapStyle: "Styl mapy:",
    lightDefault: "Jasny (domyślny)",
    airportsCount: "Lotniska: ",
    routesCount: "Trasy: ",
    loading: "(ładowanie...)",
    switchToFlat: "Przełącz na mapę płaską",
    switchToGlobe: "Przełącz na glob",
    language: "Język",
    saveSettings: "Zapisz ustawienia",
    settingsSaved: "Zapisano",
    saving: "Zapisywanie...",
  },
  colorSettings: { // ColorSettings.tsx
    title: "Personalizacja kolorów mapy",
    picker: {
      selectWindow: "Wybierz okno...",
      clickToPick: "Kliknij, aby wybrać · Esc, aby anulować"
    },
    colors: "Kolory",
    reset: "Zresetuj kolory",
    water: "Obszar wody",
    land: "Główny ląd",
    landSecondary: "Pomocniczy ląd",
    labels: "Etykiety tekstowe",
    airports: "Znaczniki lotnisk",
    routes: "Trasy lotów",
    stars: "Gwiazdy w tle",
    unselected: "Nieaktywne elementy",
    size: "Rozmiar znaczników",
    colorHex: "HEX koloru",
    generalAirports: "Lotniska ogólne",
    destinationAirports: "Lotniska docelowe",
    tripAirports: "Lotniska podróży",
    sameAirport: "To samo lotnisko",
    sameCity: "To samo miasto",
    sameCountry: "Ten sam kraj",
    departsTooSoon: "Odlatuje zbyt wcześnie",
    tripRoute: "Trasa podróży",
    transferRoute: "Trasa przesiadkowa",
    transferPreview: "Podgląd przesiadki",
    routeLineWidth: "Szerokość linii trasy",
    routeLineHoverWidth: "Szerokość linii trasy (hover)",
    tripRouteWidth: "Szerokość linii trasy podróży",
    tripRouteHoverWidth: "Szerokość linii trasy podróży (hover)",
    generalDotSize: "Rozmiar kropki ogólnej",
    generalDotHoverSize: "Rozmiar kropki ogólnej (hover)",
    highlightedDotSize: "Rozmiar kropki zaznaczonej",
    highlightedDotHoverSize: "Rozmiar kropki zaznaczonej (hover)",
    generalLabelSize: "Rozmiar etykiety ogólnej",
    generalLabelHoverSize: "Rozmiar etykiety ogólnej (hover)",
    highlightedLabelSize: "Rozmiar etykiety zaznaczonej",
    highlightedLabelHoverSize: "Rozmiar etykiety zaznaczonej (hover)",
    startingPoints: "Punkty startowe",
    mapElements: "Elementy mapy",
    flightCardHighlights: "Podświetlenia kart lotów",
    sizes: "Rozmiary",
    zoomRange: "Zakres zoomu",
    pointLabel: (n: number) => `Punkt ${n}`,
    help: {
      airportDot: "Kropka lotniska",
      airportDotHover: "Kropka lotniska (hover)",
      routeLine: "Linia trasy",
      routeLineHover: "Linia trasy (hover)",
      labelColor: "Kolor etykiety",
      labelHoverColor: "Kolor etykiety (hover)",
      dotColor: "Kolor kropki",
      dotHoverColor: "Kolor kropki (hover)",
      color: "Kolor",
      hoverColor: "Kolor (hover)",
      bgColor: "Kolor tła",
      borderColor: "Kolor obramowania"
    }
  },
  errors: {
    generic: "Coś poszło nie tak.",
    mapNotLoaded: "Nie udało się załadować mapy",
    webglNotSupported: "WebGL nie jest obsługiwany.",
    noResults: "Nie znaleziono wyników"
  }
};
