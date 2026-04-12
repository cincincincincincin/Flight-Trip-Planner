import React, { useRef, memo, useEffect, useState, useMemo } from 'react';
import MapComponent from './components/MapComponent';
import ControlsPanel from './components/ControlsPanel';
import { useSettingsSync } from './hooks/useSettingsSync';
import Search from './components/Search';
import RightPanel from './components/RightPanel';
import TripItinerary from './components/TripItinerary';
import AuthModal from './components/auth/AuthModal';
import UserMenu from './components/auth/UserMenu';
import SavedTripsPanel from './components/auth/SavedTripsPanel';
import type { MapComponentRef } from './components/MapComponent';
import type { RightPanelRef } from './components/RightPanel';
import type { Flight } from './types';
import { useMapStore } from './stores/mapStore';
import { useSelectionStore } from './stores/selectionStore';
import { useTripStore } from './stores/tripStore';
import { useSettingsStore } from './stores/settingsStore';
import { useAuthStore } from './stores/authStore';
import { useFilterStore } from './stores/filterStore';
import { useColorStore } from './stores/colorStore';
import { useTexts } from './hooks/useTexts';
import { MAP_ASSETS } from './constants/mapStyles';
import { useMobileSheet } from './hooks/useMobileSheet';
import { useMapNavigation } from './hooks/useMapNavigation';
import { useAppSelection } from './hooks/useAppSelection';
import { useAppTrip } from './hooks/useAppTrip';
import './App.css';

const MemoizedMapComponent = memo(MapComponent);

function App() {
  const t = useTexts();
  const mapRef = useRef<MapComponentRef>(null); // Ref do kontrolowania instancji MapLibre
  const rightPanelRef = useRef<RightPanelRef>(null);

  /**
   * Ref do "mostka" dla funkcji operujących na stanie.
   * Używane, żeby callbacki w MapComponents (WebGL/MapLibre) zawsze miały 
   * dostęp do najnowszej wersji handlera bez błędu "stale closures".
   * Dzięki temu nie musimy co chwila przeładowywać całej mapy.
   */
  const handleAddToTripRef = useRef<((flight: Flight) => Promise<void>) | null>(null);

  // Dane z Zustand stores
  const { setViewport, controlsPanelOpen, setControlsPanelOpen } = useMapStore();
  const { selectedItem, clearSelection, clearExploration } = useSelectionStore();
  const { language, currency, minTransferHours, minManualTransferHours, showRefreshButton, showConsoleLogs, updateSettings } = useSettingsStore();
  const { tripState, clearTrip, updateTrip } = useTripStore();
  const { user } = useAuthStore();
  const isLoggedIn = !!user;

  // Logika wydzielona do hooków
  const mapNav = useMapNavigation(mapRef);

  // Obsługa kliknięć na mapie i wyników wyszukiwania
  const selection = useAppSelection({
    mapNav,
    mapRef,
    handleAddToTripRef
  });

  const {
    handleSelectItem,
    handleSwitchToCountryView,
    handleCountryAirportsConfirmed,
    pendingCountryPicker,
    setPendingCountryPicker,
    fitCameraOnFlightsRef,
    extractCoordinates
  } = selection;

  // Planer: trasy, historia undo/redo, edycja zapisanych podróży
  const trip = useAppTrip({
    mapNav,
    selection: {
      ...selection,
      setFullSelection: useSelectionStore.getState().setFullSelection,
      setSelectedAirportCode: useSelectionStore.getState().setSelectedAirportCode,
      setSelectedItem: useSelectionStore.getState().setSelectedItem,
      clearExploration: useSelectionStore.getState().clearExploration,
      extractCoordinates: selection.extractCoordinates,
    },
    rightPanelRef
  });

  const {
    handleAddToTrip,
    handleUndoRedo,
    handleCloseTrip,
    handleEditLoadedTrip
  } = trip;

  handleAddToTripRef.current = handleAddToTrip;

  // Sheet do obsługi UI na telefonach (gesty przesuwania)
  const {
    mobileSheetExpanded,
    mobileSheetRef,
  } = useMobileSheet(selectedItem);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSavedTrips, setShowSavedTrips] = useState(false);


  // Synchronizacja kolorów ze store'a do zmiennych CSS (wykorzystywane w stylach komponentów)
  const colors = useColorStore();
  useEffect(() => {
    const root = document.documentElement;
    const mappings: Record<string, string> = {
      '--fc-highlight-airport-bg': colors.fcHighlightAirportBg,
      '--fc-highlight-airport-border': colors.fcHighlightAirportBorder,
      '--fc-highlight-city-bg': colors.fcHighlightCityBg,
      '--fc-highlight-city-border': colors.fcHighlightCityBorder,
      '--fc-highlight-country-bg': colors.fcHighlightCountryBg,
      '--fc-highlight-country-border': colors.fcHighlightCountryBorder,
      '--fc-highlight-soon-bg': colors.fcHighlightSoonBg,
      '--fc-highlight-soon-border': colors.fcHighlightSoonBorder,
    };

    Object.entries(mappings).forEach(([varName, value]) => {
      root.style.setProperty(varName, value);
    });
  }, [colors]);

  const { selectedAirportCodes, selectedAirportCode, highlightedAirports } = useSelectionStore();

  useEffect(() => {
    // Tło mapy z parametrów
    document.documentElement.style.setProperty('--map-bg-image', MAP_ASSETS.BACKGROUND_IMAGE);
  }, []);

  // Emergency save on exit/tab switch
  // Session Sync Logic
  useSettingsSync();

  const handleLanguageChange = (lang: string) => updateSettings({ language: lang as any });
  const handleCurrencyChange = (curr: string) => updateSettings({ currency: curr });

  const handleCloseLoadedTrip = () => {
    setPendingCountryPicker(null);
    handleCloseTrip();
  };

  const handleClosePanel = () => {
    setPendingCountryPicker(null);
    handleCloseTrip();
    clearSelection();
    clearTrip();
    clearExploration();
  };


  return (
    <div className="app">
      {/* Sidebar z ustawieniami */}
      {controlsPanelOpen && (
        <ControlsPanel
          onClose={() => setControlsPanelOpen(false)}
        />
      )}

      <div className="map-container">
        {/* Overlay z search-boxem i kontrolkami nawigacji */}
        <div className="map-search-overlay">
          {!tripState && <Search onSelectItem={handleSelectItem} />}
          <div className="overlay-controls-row">
            <button
              className="open-controls-btn"
              onClick={() => setControlsPanelOpen(!controlsPanelOpen)}
            >
              {controlsPanelOpen ? t.buttons.closeControls : t.buttons.openControls}
            </button>
            {!user && (
              <button className="sign-in-btn" onClick={() => setShowAuthModal(true)}>
                {t.buttons.signIn}
              </button>
            )}
            {user && <UserMenu onOpenSavedTrips={() => setShowSavedTrips(true)} />}
          </div>

          {/* Panel podróży: undo/redo, saving itp */}
          <TripItinerary
            onUndo={handleUndoRedo}
            onRedo={handleUndoRedo}
            onEditTrip={handleEditLoadedTrip}
            onClose={handleCloseLoadedTrip}
            showSaveButton={!!user}
          />
        </div>

        {/* Sam komponent mapy (memoizowany dla WebGL performance) */}
        <MemoizedMapComponent
          ref={mapRef}
          onViewportChange={setViewport}
          onSelectItem={handleSelectItem}
          rightPanelRef={rightPanelRef}
        />
      </div>

      {/* Auth & Modale */}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {showSavedTrips && <SavedTripsPanel onClose={() => setShowSavedTrips(false)} onTripLoaded={() => { clearSelection(); clearExploration(); }} />}

      {/* Szuflada z detalami - na mobile działa jako 'swipe sheet' */}
      {selectedItem && (
        <div
          ref={mobileSheetRef}
          className={`mobile-sheet${mobileSheetExpanded ? ' mobile-sheet--expanded' : ''}`}
        >
          <RightPanel
            ref={rightPanelRef}
            onClose={handleClosePanel}
            onAddToTrip={handleAddToTrip}
            onPreviewAirport={(code) => updateTrip({ previewAirportCode: code })}
            onClearPreview={() => updateTrip({ previewAirportCode: null })}
            pendingCountryPicker={pendingCountryPicker}
            onClearCountryPicker={() => setPendingCountryPicker(null)}
            onFitBounds={mapNav.fitBoundsToAirportCodes}
            onCountryAirportsConfirmed={handleCountryAirportsConfirmed}
            onSwitchToCountryView={handleSwitchToCountryView}
          />
        </div>
      )}
    </div>
  );
}

export default App;
