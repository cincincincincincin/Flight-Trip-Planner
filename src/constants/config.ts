export const CONFIG = {
  /** Czas przechowywania danych o lotniskach w pamięci podręcznej (ms) */
  CACHE_AIRPORT_INFO_MS: 300000,
  /** Włączenie szczegółowych logów diagnostycznych w konsoli */
  DEBUG_LOGS: true,

  // AirportTransferPicker.tsx
  /** Początkowa liczba lotnisk wyświetlanych na liście przed dociągnięciem kolejnych */
  INITIAL_DISPLAY_COUNT: 30,
  /** Próg przewinięcia w pikselach, poniżej którego ładowana jest kolejna strona lotnisk */
  SCROLL_LOAD_THRESHOLD: 100,
  /** Opóźnienie (ms) przed ustawieniem fokusu na polu wyszukiwania po otwarciu wybieraka */
  FOCUS_DELAY_MS: 50,
  /** Próg w kilometrach, powyżej którego formatowanie zmienia się z "X km" na "X k km" */
  KM_THRESHOLD: 1000,
  /** Przybliżona liczba kilometrów na jeden stopień szerokości lub długości geograficznej */
  KM_PER_DEGREE: 111,
  /** Etykieta jednostki odległości dla wartości poniżej progu KM_THRESHOLD */
  UNIT_KM: 'km',
  /** Etykieta jednostki odległości dla wartości powyżej progu KM_THRESHOLD */
  UNIT_K_KM: 'k km',

  // ColorSettings.tsx – wymiary płótna wybieraka kolorów
  /** Szerokość (px) płótna gradientu nasycenia/wartości */
  COLOR_PICKER_SV_WIDTH: 148,
  /** Wysokość (px) płótna gradientu nasycenia/wartości */
  COLOR_PICKER_SV_HEIGHT: 120,
  /** Szerokość (px) płótna paska odcienia */
  COLOR_PICKER_STRIP_WIDTH: 14,
  /** Wysokość (px) płótna paska odcienia */
  COLOR_PICKER_STRIP_HEIGHT: 120,

  // MapComponent.tsx / TripItinerary.tsx – pozycjonowanie popupów
  /** Maksymalna wysokość pionowa (px) przy dociąganiu popupu do krawędzi ekranu */
  POPUP_MAX_HEIGHT: 480,
  /** Poziomy odstęp (px) między krawędzią elementu a lewą krawędzią popupu */
  POPUP_OFFSET: 8,

  // RightPanel.tsx / MapComponent.tsx – wartości specjalne stref czasowych
  /** Kod strefy czasowej używany, gdy strefa lotniska jest nieznana */
  UNKNOWN_TIMEZONE: '_unknown',
  /** Klucz sortowania wymuszający pojawienie się nieznanych stref po wszystkich offsetach UTC */
  UNKNOWN_TZ_FALLBACK: '9999',
  /** Etykieta UTC wyświetlana, gdy nie można ustalić strefy czasowej */
  UNKNOWN_TZ_UTCLABEL: '?',

  // api/client.ts
  /** Limit czasu żądania Axios (ms) stosowany do każdego połączenia API */
  API_TIMEOUT_MS: 30000,

  // DateInput.tsx
  /** Maksymalna liczba dni w przód, na jaką można wybrać datę wylotu */
  MAX_DAYS_FORWARD: 180,
  /** Liczba miesięcy skanowanych w przód przy szukaniu najbliższego poprawnego dnia miesiąca */
  MAX_MONTHS_FOR_DAY_SEARCH: 7,

  // FlightsFilter.tsx / RightPanel.tsx – timingi interfejsu
  /** Wartość specjalna klucza grupy miast, gdy lot nie jest przypisany do żadnego miasta */
  NO_CITY_PLACEHOLDER: '__nocity__',
  /** Opóźnienie (ms) przed zamknięciem listy wyszukiwania po utracie fokusu (pozwala na kliknięcie) */
  INPUT_BLUR_DELAY_MS: 50,

  // FlightsList.tsx
  /** Liczba elementów wirtualnej listy renderowanych poza widocznym obszarem (overscan) */
  VIRTUOSO_OVERSCAN: 200,
  /** Opóźnienie (ms) po ręcznym "skoku do daty" przed przywróceniem automatycznego przewijania */
  MANUAL_JUMP_TIMEOUT_MS: 500,

  // MapComponent.tsx – geometria interakcji
  /** Minimalny poziom przybliżenia, od którego etykiety lotnisk/miast stają się widoczne */
  LABEL_MIN_ZOOM: 5,
  /** Współczynnik skalowania właściwości stylu przy minimalnym przybliżeniu (ziLegacy) */
  SIZE_INTERPOLATION_MIN_FACTOR: 0.3,
  /** Współczynnik skalowania właściwości stylu przy maksymalnym przybliżeniu (ziLegacy) */
  SIZE_INTERPOLATION_MAX_FACTOR: 2.5,
  /** Margines rootMargin dla obserwatora widoczności śledzącego wybrane kraje/miasta (Search.tsx) */
  VISIBILITY_OBSERVER_ROOT_MARGIN: '-10% 0px -80% 0px',
  /** Połowa rozmiaru (px) ramki ograniczającej dla detekcji najechania na trasę */
  ROUTE_HOVER_BBOX_SIZE: 4,
  /** Opóźnienie (ms) przed ukryciem popupu z informacjami o locie po opuszczeniu kursora */
  POPUP_HIDE_DELAY_MS: 150,
  /** Margines (px) dodawany nad etykietą lotniska w celu uniknięcia nakładania się napisów */
  LABEL_OFFSET_PADDING: 4,

  // Search.tsx – nieskończone przewijanie
  /** Margines CSS wyzwalający ładowanie kolejnej strony przed pełnym pokazaniem elementu */
  INFINITE_SCROLL_MARGIN: '100px',
  /** Próg stosunku przecięcia wymagany do wywołania callbacku IntersectionObserver */
  INTERSECTION_THRESHOLD: 0.1,
  /** Opóźnienie (ms) przed zwinięciem panelu wyników wyszukiwania po utracie fokusu */
  SEARCH_BLUR_DELAY_MS: 200,
  /** Opóźnienie (ms) przed przywróceniem pozycji przewinięcia po zamknięciu wyszukiwarki */
  SCROLL_RESTORE_DELAY_MS: 50,

  /** Limity globalne aplikacji */
  /** Maksymalna liczba lotnisk startowych, które można wybrać jednocześnie */
  MAX_AIRPORTS: 6,
  /** Maksymalna liczba lotnisk przesiadkowych dodawanych do jednego odcinka */
  MAX_TRANSFER_AIRPORTS: 5,
  /** Maksymalna liczba lotów wyświetlanych w popupie po najechaniu na lotnisko */
  MAX_POPUP_FLIGHTS: 6,
  /** Maksymalna liczba lotów pobieranych w jednym żądaniu API */
  FLIGHT_LIMIT: 1400,

  // MapComponent.tsx – animacje i nawigacja
  /** Czas trwania (ms) animacji kamery "fly-to" w MapLibre */
  FLY_DURATION: 800,
  /** Margines w pikselach stosowany przy dopasowywaniu widoku mapy do współrzędnych */
  FIT_BOUNDS_PADDING: 80,
  /** Maksymalny poziom zoomu przy dopasowywaniu widoku (zapobiega zbytniemu zbliżeniu) */
  FIT_BOUNDS_MAX_ZOOM: 8,
  /** Maksymalna rozpiętość stopni geograficznych przed uznaniem punktu za element odstający */
  OUTLIER_MAX_DEG: 5,
  /** Maksymalny poziom zoomu, przy którym renderowany jest widok kraju zamiast zbliżenia */
  MAX_ZOOM_FOR_COUNTRY: 7,
  /** Domyślne centrum mapy [lon, lat] (Europa Środkowa) */
  DEFAULT_MAP_CENTER: [19.0, 52.0] as [number, number],
  /** Domyślny poziom przybliżenia mapy przy starcie */
  DEFAULT_MAP_ZOOM: 4,

  /** Przyjęta średnia prędkość przelotowa (km/h) do estymacji czasu lotu bez rozkładu */
  AVERAGE_AIRCRAFT_SPEED_KMH: 850,
  /** Dodatkowe godziny doliczane do czasu lotu (kołowanie, wznoszenie, zniżanie) */
  ADDITIONAL_BLOCK_HOURS: 0.5,

  /** Punkty kontrolne interpolacji zoomu */
  /** Minimalny zoom używany jako dolna kotwica interpolacji stylów */
  MIN_ZOOM: 1,
  /** Maksymalny zoom używany jako górna kotwica interpolacji stylów */
  MAX_ZOOM: 12,
  /** Punkt środkowy zoomu używany jako referencyjna kotwica interpolacji */
  REFERENCE_ZOOM: 6,

  // MapComponent.tsx – renderowanie tras ortodromicznych
  /** Liczba punktów pośrednich używanych do rysowania łuków tras (Great-Circle) */
  GC_POINTS: 64,
  /** Rozmiar kroku animacji trasy na klatkę (ułamek całkowitej długości łuku) */
  ANIMATION_SPEED: 0.005,

  // MapComponent.tsx – timingi maszyny stanów 'hover'
  /** Przetwarzaj maksymalnie jedno zdarzenie hover na tyle ruchów myszy (optymalizacja CPU) */
  HOVER_SAMPLE_EVERY: 10,
  /** Czas (ms) blokady hovera po kliknięciu w celu uniknięcia drgań interfejsu */
  HOVER_LOCK_DURATION_MS: 80,
  /** Opóźnienie (ms) przed wyczyszczeniem stanu hover po opuszczeniu obiektu przez kursor */
  HOVER_CLEAR_DELAY_MS: 40,
  /** Opóźnienie (ms) po zatrzymaniu ruchu myszy przed precyzyjnym dopasowaniem hovera */
  HOVER_STOP_DELAY_MS: 10,
  /** Dodatkowy promień w pikselach wokół lotniska przed wyczyszczeniem stanu podświetlenia */
  HOVER_KEEP_RADIUS_EXTRA: 6,
  /** Liczba milisekund przedłużenia stanu hover po zakończeniu blokady (lock) */
  HOVER_LOCK_EXTENSION: 120,
  /** Rezerwowy promień trafienia (px), gdy projekcja mapy jest niedostępna */
  HOVER_RADIUS_FALLBACK: 18,
  /** Minimalna odległość (px) między etykietami przed ukryciem jednej z nich (anty-kolizja) */
  LABEL_CLEAR_RADIUS: 70,

  /** Maksymalna liczba wyników wyszukiwania na kategorię */
  SEARCH_LIMITS: { main: 20, cities: 50, airports: 50 },

  /** Minimalny rozmiar etykiety przy podświetleniu (hover) */
  MAP_HOVER_LABEL_MIN_SIZE: 11,
  /** Maksymalny rozmiar etykiety przy podświetleniu (hover) */
  MAP_HOVER_LABEL_MAX_SIZE: 22,
  /** Domyślny minimalny zakres zoomu mapy */
  MAP_ZOOM_MIN_DEFAULT: 1.3,
  /** Domyślny maksymalny zakres zoomu mapy */
  MAP_ZOOM_MAX_DEFAULT: 12.0,

  // MapComponent.tsx – tablice promieni warstw i rozmiarów tekstu
  /** Margines dodany do ramki mapy używany przy detekcji kliknięć */
  MAP_BBOX_OFFSET: 4,
  /** Poziom przybliżenia, przy którym etykieta lotniska zaczyna się znacząco powiększać */
  AIRPORT_ZOOM_THRESHOLD: 1.2,
  /** Domyślne poziomy zoomu przy nawigacji do wybranych obiektów */
  FALLBACK_ZOOM: { AIRPORT: 6, CITY: 5, COUNTRY: 4 },
  /** Rozmiary kółek lotnisk (promień w px) dla różnych poziomów przybliżenia */
  MAP_AIRPORT_LAYER: {
    RADIUS_TINY: 4, RADIUS_SMALL: 6, RADIUS_MEDIUM: 8, RADIUS_LARGE: 10,
    TEXT_TINY: 9, TEXT_SMALL: 10, TEXT_MEDIUM: 11, TEXT_LARGE: 12
  },
  /** Rozmiary kółek miast (promień w px) dla różnych poziomów przybliżenia */
  MAP_CITY_LAYER: {
    RADIUS_SMALL: 5, RADIUS_MEDIUM: 8,
    TEXT_SMALL: 11, TEXT_LARGE: 13
  },

  // ColorSettings.tsx – progi luminancji kolorów
  /** Wartości kanałów RGB, poniżej których kolor uznawany jest za "czarny" dla kontrastu */
  COLOR_THRESHOLDS: {
    BLACK_RGB: 20, WHITE_RGB: 235
  },

  // RightPanel.tsx – geometria panelu bocznego i gestów
  /** Dodatkowe piksele wysokości nagłówka ułatwiające uchwycenie panelu do przeciągania */
  DRAG_HEADER_EXTRA: 20,
  /** Wysokość wysunięcia panelu (px) w stanie zminimalizowanym */
  PEEK_H: 100,
  /** Minimalna odległość przeciągania (px) wymagana do wyzwolenia gestu otwarcia/zamknięcia */
  DRAG_THRESHOLD: 60,

  // FlightsList.tsx – pomocniki czasu i dat
  /** Opóźnienie (ms) przed przewinięciem do daty po kliknięciu "Skocz do daty" */
  JUMP_TO_DATE_TIMEOUT: 500,
  /** Milisekundy w jednej godzinie */
  HOUR_IN_MS: 3600000,
  /** Minuty w jednej godzinie */
  MINUTES_IN_HOUR: 60,
  /** Godziny w jednej dobie */
  HOURS_IN_DAY: 24,

  // api/geo.ts – paginacja
  /** Limity rozmiaru strony dla endpointów geograficznych */
  PAGE_LIMITS: { GET_CITY_AIRPORTS: 200, GET_COUNTRY_CITIES: 200 },

  // Magazyny (Stores) i inne
  /** Czas (ms), w którym odpowiedź z API jest uznawana za świeżą i nie wymaga ponownego pobrania */
  CACHE_FRESHNESS_MS: 1000,
  /** Alias dla MAX_DAYS_FORWARD używany przez magazyn dat */
  MAX_DATE_DAYS: 180,

  /** Bazowy adres URL API backendu */
  API_BASE_URL: import.meta.env.VITE_API_URL ?? '',

  // Domyślne ustawienia użytkownika
  /** Domyślna waluta wybrana przy pierwszym uruchomieniu */
  DEFAULT_CURRENCY: 'PLN',
  /** Domyślny minimalny czas na przesiadkę (h) dla lotów automatycznych */
  DEFAULT_MIN_TRANSFER_HOURS: 2,
  /** Domyślny minimalny czas na przesiadkę (h) dla odcinków własnych/ręcznych */
  DEFAULT_MIN_MANUAL_TRANSFER_HOURS: 1,

  /** Poziomy przybliżenia mapy zależne od liczby lotnisk w danym kraju */
  COUNTRY_ZOOM_LEVELS: {
    '0': 5.0,
    '5': 5.0,
    '15': 4.5,
    '40': 3.5,
    '100': 2.6,
    'default': 1.8
  }
};

/** Dostępne waluty do wyboru przez użytkownika */
export const CURRENCIES = [
  { code: 'PLN', label: 'PLN - Złoty polski' },
  { code: 'USD', label: 'USD - Dolar amerykański' },
  { code: 'EUR', label: 'EUR - Euro' },
  { code: 'GBP', label: 'GBP - Funt brytyjski' },
] as const;
