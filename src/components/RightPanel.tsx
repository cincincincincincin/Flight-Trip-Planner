import { useState, useEffect, useMemo, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import type { Flight, Airport, City, CountryAirport } from '../types';
import FlightsList from './FlightsList';
import FlightsFilter from './FlightsFilter';
import DateInput from './DateInput';
import ExplorationList from './rightPanel/ExplorationList';
import TripAirportSection from './rightPanel/TripAirportSection';
import PendingCountryPicker from './rightPanel/PendingCountryPicker';
import CountryModeSection from './rightPanel/CountryModeSection';
import { useExplorationGroups } from './rightPanel/useExplorationGroups';
import { useSelectionStore } from '../stores/selectionStore';
import { useTripStore } from '../stores/tripStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFilterStore } from '../stores/filterStore';
import { 
  useAirportInfoQuery, 
  useAirportInfosQuery, 
  useAirportsByCountryQuery, 
  useAirportsMap,
  useCityAirports,
  useCountryData,
  useCityAirportsMap,
  useCityInfoMap,
  useCountryInfoMap,
  useAirportCoordsMap
} from '../hooks/queries';
import { useTravelDate } from '../hooks/useTravelDate';
import './RightPanel.css';
import { useTexts } from '../hooks/useTexts';
import type { Language } from '../constants/text';
import { UI_SYMBOLS } from '../constants/ui';
import { CONFIG } from '../constants/config';
import dayjs from '../lib/dayjs';
import { haversineKm } from '../utils/math';
import { BROWSER_TIMEZONE, buildTzGroups } from '../utils/timezoneUtils';
import { getLocalizedProp } from '../utils/i18n';
import { getTripCurrentArrivalTimeUTC, getIsoDate, getIsoDatetime, getTodayInTz } from '../utils/dateFormatting';

interface RightPanelProps {
  onClose: () => void;
  onAddToTrip: (flight: Flight) => void;
  onPreviewAirport: (code: string) => void;
  onClearPreview: () => void;
  pendingCountryPicker?: { code: string; name: string } | null;
  onClearCountryPicker?: () => void;
  onFitBounds?: (codes: string[]) => void;
  onCountryAirportsConfirmed: (codes: string[], countryCode: string, countryName: string) => void;
  onSwitchToCountryView?: (code: string, name: string) => void;
}

/**
 * INTERFEJS REFERENCJI PANELU BOCZNEGO
 * Pozwala nadrzędnym komponentom na zdalne sterowanie widokiem lotów i filtrami.
 */
export interface RightPanelRef {
  scrollToFlight: (destCode: string) => void;
  clearTransferAirports: () => void;
}

const RightPanel = forwardRef<RightPanelRef, RightPanelProps>(({ onClose, onAddToTrip, onPreviewAirport, onClearPreview, pendingCountryPicker, onClearCountryPicker, onFitBounds, onCountryAirportsConfirmed, onSwitchToCountryView }, ref) => {
  const t = useTexts();
  const { selectedItem, flightsData, setSelectedAirportCodes, explorationItems, removeExplorationItem, addExplorationItem } = useSelectionStore();
  const { tripState, updateTrip: updateTripStore } = useTripStore();
  const { travelDate, minTransferHours, minManualTransferHours, language, updateSettings } = useSettingsStore();
  const { clearFilters } = useFilterStore();
  
  console.log(`%c[DEBUG-PANEL] %cRENDER | selectedItem: ${selectedItem?.type} (${(selectedItem?.data as any)?.code}), travelDate: ${travelDate}`, 'color: #ec4899; font-weight: bold', 'color: inherit');

  const airportCoordsMap = useAirportCoordsMap();
  const airportsMap = useAirportsMap();

  // Stan trybu kraju
  const [loadingCountry] = useState(false);
  const [selectedFlatAirports, setSelectedFlatAirports] = useState<CountryAirport[]>([]);
  const [selectedCities, setSelectedCities] = useState<City[]>([]);
  const [loadingConfirm] = useState(false);

  // Strefy czasowe w trybie kraju
  const [countryActiveTZ, setCountryActiveTZ] = useState<string | null>(null);
  const [pendingSelectedAirports, setPendingSelectedAirports] = useState<string[]>([]);
  const [countryNameCache, setCountryNameCache] = useState<Record<string, string>>({});

  // Trip mode: lotniska przesiadkowe (manualne)
  const [transferAirports, setTransferAirports] = useState<string[]>([]);

  // Reset transfer airports when we move to a new airport in trip mode
  const prevTripAirportRef = useRef<string | null>(null);
  useEffect(() => {
    const currentCode = selectedItem?.type === 'airport' ? selectedItem.data.code : null;
    if (currentCode !== prevTripAirportRef.current) {
      prevTripAirportRef.current = currentCode;
      setTransferAirports([]);
    }
  }, [selectedItem]);

  // Sync transfer airports to store (for map preview lines)
  useEffect(() => {
    updateTripStore({ manualTransferAirportCodes: transferAirports });
  }, [transferAirports, updateTripStore]);

  // Grupowanie w trybie eksploracji
  const [expandedCityGroups, setExpandedCityGroups] = useState<Set<string>>(new Set());
  const [expandedInnerCities, setExpandedInnerCities] = useState<Set<string>>(new Set());

  /**
   * ARCHITEKTURA "WARSTWY DANYCH":
   * Zrezygnowaliśmy z "luster stanu" (state mirroring) - czyli synchronizacji lokalnego
   * stanu cityAirports z wynikiem hooka. Zamiast tego, komponent pije dane bezpośrednio
   * z `queriedCityAirports`. Eliminuje to błędy "stale state" i upraszcza cykl życia komponentu.
   */
  const cityCode = selectedItem?.type === 'city' ? selectedItem.data.code : null;
  const queriedCityAirports = useCityAirports(cityCode);

  const tripCurrentArrivalTimeUTC = useMemo(() => getTripCurrentArrivalTimeUTC(tripState), [tripState]);

  const tripEstimatedArrivalUTC = useMemo(() => {
    if (tripCurrentArrivalTimeUTC || !tripState?.legs?.length) return null;
    for (let i = tripState.legs.length - 1; i >= 0; i--) {
      const leg = tripState.legs[i];
      if ((leg as { type?: string }).type !== 'manual' && leg.flight?.scheduled_departure_utc) {
        const from = airportCoordsMap[leg.fromAirportCode];
        const to = airportCoordsMap[leg.toAirportCode];
        if (!from || !to) return null;
        const distKm = haversineKm(from[0], from[1], to[0], to[1]);
        const blockHours = distKm / CONFIG.AVERAGE_AIRCRAFT_SPEED_KMH + CONFIG.ADDITIONAL_BLOCK_HOURS;
        const depMs = new Date(leg.flight.scheduled_departure_utc).getTime();
        if (isNaN(depMs)) return null;
        return new Date(depMs + blockHours * 3600000).toISOString();
      }
    }
    return null;
  }, [tripCurrentArrivalTimeUTC, tripState, airportCoordsMap]);

  const isArrivalEstimated = !tripCurrentArrivalTimeUTC && !!tripEstimatedArrivalUTC;
  const effectiveArrivalTimeUTC = tripCurrentArrivalTimeUTC ?? tripEstimatedArrivalUTC;

  const manualTransferCount = useMemo(() => {
    if (!tripState?.legs?.length) return 0;
    let count = 0;
    for (let i = tripState.legs.length - 1; i >= 0; i--) {
      if ((tripState.legs[i] as { type?: string }).type === 'manual') count++;
      else break;
    }
    return count;
  }, [tripState]);

  const flightsListRef = useRef<{ scrollToFlight: (code: string) => void; jumpToDate: (date: string) => void } | null>(null);
  const [airportTime, setAirportTime] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedTimezoneOverride, setSelectedTimezoneOverride] = useState<string | null>(null);
  const [selectedTimezoneAirportCode, setSelectedTimezoneAirportCode] = useState<string | null>(null);


  // Lotniska w kraju (pojedynczy query z TZ)
  const countryCode = selectedItem?.type === 'country' ? selectedItem.data.code : null;
  const { data: countryAirportsData } = useAirportsByCountryQuery(countryCode);
  const countryFlatAirports = countryAirportsData ?? [];

  const { data: pendingCountryAirportsData } = useAirportsByCountryQuery(pendingCountryPicker?.code ?? null);
  const pendingCountryFlatAirports = pendingCountryAirportsData ?? [];

  const countryTzGroups = useMemo(() => buildTzGroups(countryFlatAirports), [countryFlatAirports]);
  const pendingCountryTzGroups = useMemo(() => buildTzGroups(pendingCountryFlatAirports), [pendingCountryFlatAirports]);

  // Inteligentne wyznaczanie głównego lotniska dla strefy czasowej
  const primaryAirportCode = useMemo(() => {
    // 1. Ostatni element z listy eksploracji (najnowszy kontekst)
    if (explorationItems.length > 0) return explorationItems[explorationItems.length - 1].airportCodes[0];
    
    // 2. Aktualnie wybrany element bezpośredni
    if (selectedItem?.type === 'airport') return selectedItem.data.code;
    
    // 3. Lotnisko z wybranego miasta lub kraju (fallback)
    if (selectedItem?.type === 'city') return queriedCityAirports[0]?.code;
    if (selectedItem?.type === 'country') return selectedFlatAirports[0]?.code || countryFlatAirports[0]?.code;
    
    return null;
  }, [explorationItems, selectedItem, queriedCityAirports, selectedFlatAirports, countryFlatAirports]);

  const { data: airportInfo } = useAirportInfoQuery(primaryAirportCode);

  // Agregacja kodów lotnisk dla listy ofert/lotów
  const flightAirportCodes = useMemo(() => {
    // Planowanie podróży: lotnisko docelowe + ewentualne przesiadki
    if (tripState && selectedItem?.type === 'airport') {
      return [selectedItem.data.code, ...transferAirports];
    }
    
    // Eksploracja: suma wszystkich lotnisk ze wszystkich kafli
    if (explorationItems.length > 0) {
      return Array.from(new Set(explorationItems.flatMap(i => i.airportCodes)));
    }
    
    // Podgląd bezpośredni (Airport/City)
    if (selectedItem?.type === 'airport') return [selectedItem.data.code];
    if (selectedItem?.type === 'city') return queriedCityAirports.map(a => a.code);
    
    return [];
  }, [selectedItem, queriedCityAirports, explorationItems, tripState, transferAirports]);

  // Rozwiązywanie stref czasowych dla wielu lotnisk
  const airportInfosResults = useAirportInfosQuery(flightAirportCodes);

  const airportTimezoneMapRef = useRef<Record<string, string>>({});
  const airportTimezoneMap = useMemo<Record<string, string>>(() => {
    const nextMap: Record<string, string> = {};
    let changed = false;
    flightAirportCodes.forEach((code, i: number) => {
      const tz = airportInfosResults[i]?.data?.time_zone;
      if (tz) {
        nextMap[code] = tz;
        if (airportTimezoneMapRef.current[code] !== tz) changed = true;
      }
    });

    // Also check if any were removed
    if (!changed && Object.keys(nextMap).length !== Object.keys(airportTimezoneMapRef.current).length) {
      changed = true;
    }

    if (changed) {
      airportTimezoneMapRef.current = nextMap;
    }
    return airportTimezoneMapRef.current;
  }, [flightAirportCodes, airportInfosResults]);

  const lastRealLeg = useMemo(() => {
    if (!tripState?.legs?.length) return null;
    for (let i = tripState.legs.length - 1; i >= 0; i--) {
      const leg = tripState.legs[i];
      if ((leg as { type?: string }).type !== 'manual') return leg;
    }
    return null;
  }, [tripState]);

  const resolvedTimezone = useMemo(() => {
    // In trip mode: always pin to the arrival airport's TZ.
    if (effectiveArrivalTimeUTC && lastRealLeg?.toAirportCode) {
      const arrTZ = airportTimezoneMap[lastRealLeg.toAirportCode];
      if (arrTZ) return arrTZ;
    }
    // Use the first airport's timezone — no auto-switching when new airports are added.
    const firstCode = flightAirportCodes[0];
    return (firstCode && airportTimezoneMap[firstCode]) ?? null;
  }, [effectiveArrivalTimeUTC, lastRealLeg, flightAirportCodes, airportTimezoneMap]);

  // Wyliczanie strefy czasowej dla wyświetlania
  const countryDisplayTZ = useMemo(() => {
    if (selectedItem?.type !== 'country') return null;
    return countryActiveTZ ?? countryTzGroups.find(g => g.tz !== CONFIG.UNKNOWN_TIMEZONE)?.tz ?? BROWSER_TIMEZONE;
  }, [selectedItem?.type, countryActiveTZ, countryTzGroups]);

  const timezone = selectedTimezoneOverride
    ?? (selectedItem?.type === 'country' ? countryDisplayTZ : null)
    ?? resolvedTimezone
    ?? airportInfo?.time_zone
    ?? (flightAirportCodes.length > 0 ? BROWSER_TIMEZONE : null);

  useEffect(() => {
    setSelectedAirportCodes(flightAirportCodes);
  }, [flightAirportCodes, setSelectedAirportCodes]);

  useEffect(() => {
    if (timezone) {
      updateSettings({ timezone });
    }
  }, [timezone, updateSettings]);

  // Reset filtrów przy zmianie wyboru
  useEffect(() => {
    clearFilters();
    setFilterOpen(false);
    setSelectedCities([]);
    setSelectedTimezoneOverride(null);
    setSelectedTimezoneAirportCode(null);
    setCountryActiveTZ(null);
  }, [selectedItem, clearFilters]);

  // ── Reset pendingSelectedAirports when pendingCountryPicker changes ────────
  useEffect(() => {
    setPendingSelectedAirports([]);
    if (pendingCountryPicker?.code && pendingCountryPicker.name && pendingCountryPicker.name !== pendingCountryPicker.code) {
      setCountryNameCache(prev => prev[pendingCountryPicker.code] ? prev : { ...prev, [pendingCountryPicker.code]: pendingCountryPicker.name });
    }
  }, [pendingCountryPicker]);

  // ── Close panel when exploration items become empty (non-trip mode) ────────
  useEffect(() => {
    if (!tripState && selectedItem && (selectedItem.type === 'airport' || selectedItem.type === 'city')) {
      if (explorationItems.length === 0) {
        if (pendingCountryPicker) {
          // Instead of closing, switch to the country view
          onSwitchToCountryView?.(pendingCountryPicker.code, pendingCountryPicker.name);
        } else {
          clearFilters();
          onClose();
        }
      }
    }
  }, [explorationItems.length, tripState, selectedItem, clearFilters, onClose, pendingCountryPicker, onSwitchToCountryView]);

  // Pobieranie danych dla krajów - miasta i płaska lista lotnisk.
  const countryData = useCountryData(countryCode);

  useEffect(() => {
    if (selectedItem?.type !== 'country') {
      setSelectedFlatAirports([]);
      setSelectedCities([]);
      return;
    }
  }, [selectedItem]);

  // Wyliczamy sumę lotnisk dla wybranych miast (bezpośrednio z cityInfoMap).
  const cityInfoMap = useCityInfoMap();
  const selectedCityAirportTotal = useMemo(() =>
    selectedCities.reduce((total, city) => total + (cityInfoMap[city.code]?.airportCount || 0), 0),
  [selectedCities, cityInfoMap]);

  // Potwierdzanie wyboru miast w trybie kraju
  const cityAirportsMap = useCityAirportsMap();
  const handleConfirmCities = useCallback(() => {
    const codes: string[] = [];
    selectedCities.forEach(city => {
      const cityAps = cityAirportsMap[city.code] ?? [];
      codes.push(...cityAps);
    });
    if (selectedItem?.type !== 'country') return;
    onCountryAirportsConfirmed(codes.slice(0, CONFIG.MAX_AIRPORTS), selectedItem.data.code, selectedItem.data.name);
  }, [selectedCities, cityAirportsMap, onCountryAirportsConfirmed, selectedItem]);


  // Przełączanie lotnisk z uwzględnieniem stref czasowych
  const handleCountryAirportToggle = useCallback((airport: CountryAirport) => {
    // Find the group representative TZ for an airport (used instead of raw IANA name to match group keys)
    const getGroupTz = (code: string) => countryTzGroups.find(g => g.airports.some(a => a.code === code))?.tz ?? null;
    setSelectedFlatAirports(prev => {
      const isSelected = prev.some(a => a.code === airport.code);
      if (isSelected) {
        const next = prev.filter(a => a.code !== airport.code);
        const removedGroupTz = getGroupTz(airport.code);
        if (removedGroupTz && removedGroupTz === countryActiveTZ) {
          const stillActiveInGroup = next.filter(a => getGroupTz(a.code) === countryActiveTZ).length;
          if (stillActiveInGroup === 0) {
            const nextAirport = next.find(a => getGroupTz(a.code));
            setCountryActiveTZ(nextAirport ? getGroupTz(nextAirport.code) : null);
          }
        }
        return next;
      } else {
        if (prev.length >= CONFIG.MAX_AIRPORTS) return prev;
        if (prev.length === 0) {
          const groupTz = getGroupTz(airport.code);
          if (groupTz && groupTz !== CONFIG.UNKNOWN_TIMEZONE) setCountryActiveTZ(groupTz);
        }
        return [...prev, airport];
      }
    });
  }, [countryActiveTZ, countryTzGroups]);

  // Potwierdzanie wyboru konkretnych lotnisk
  const handleConfirmFlatAirports = useCallback(() => {
    if (selectedItem?.type !== 'country') return;
    const codes = selectedFlatAirports.map(a => a.code);
    onCountryAirportsConfirmed(codes, selectedItem.data.code, selectedItem.data.name);
  }, [selectedFlatAirports, onCountryAirportsConfirmed, selectedItem]);

  // Dodawanie do trasy (reset filtrów)
  const handleAddToTripWithReset = useCallback((flight: Flight) => {
    clearFilters();
    setFilterOpen(false);
    onAddToTrip(flight);
  }, [clearFilters, onAddToTrip]);

  // Zamykanie panelu i czyszczenie stanu
  const handleClose = useCallback(() => {
    clearFilters();
    onClose();
  }, [clearFilters, onClose]);

  // Zarządzanie datą podróży
  const { effectiveTravelDate } = useTravelDate({
    selectedItem, timezone, explorationItems, effectiveArrivalTimeUTC,
    selectedTimezoneOverride, resolvedTimezone, countryDisplayTZ,
    travelDate, updateSettings,
  });

  const initialFromDatetime = useMemo(() => {
    if (flightAirportCodes.length > 1) return null;
    if (selectedItem?.type === 'airport' && selectedItem.overrideFromDatetime) {
      return selectedItem.overrideFromDatetime.substring(0, 19);
    }
    // In trip mode with an effective arrival time (real or estimated), return null so
    // FlightsList uses getFromDatetimeForAirport → which converts tripArrivalTimeUTC to local.
    // This avoids loading from current time instead of the arrival time.
    if (effectiveArrivalTimeUTC) return null;
    if (airportInfo?.current_local_datetime) return airportInfo.current_local_datetime;
    const tz = timezone ?? BROWSER_TIMEZONE;
    if (!tz) return null;
    return getIsoDatetime(new Date(), tz);
  }, [airportInfo, selectedItem, flightAirportCodes.length, effectiveArrivalTimeUTC, timezone]);

  const handleManualDateChange = useCallback((newDate: string) => {
    updateSettings({ travelDate: newDate });
    flightsListRef.current?.jumpToDate(newDate);
  }, [updateSettings]);

  const minDate = useMemo(() => {
    if (!effectiveArrivalTimeUTC) return undefined;
    const thresholdMs = new Date(effectiveArrivalTimeUTC).getTime()
      + (minTransferHours + manualTransferCount * minManualTransferHours) * 3600000;
    const thresholdDate = new Date(thresholdMs);
    if (timezone) return getIsoDate(thresholdDate, timezone);
    return thresholdDate.toISOString().split('T')[0];
  }, [effectiveArrivalTimeUTC, minTransferHours, manualTransferCount, minManualTransferHours, timezone]);

  useImperativeHandle(ref, () => ({
    scrollToFlight: (destCode: string) => flightsListRef.current?.scrollToFlight(destCode),
    clearTransferAirports: () => setTransferAirports([]),
  }));

  const isToday = useMemo(() => {
    if (!timezone) return false;
    return travelDate === getTodayInTz(timezone);
  }, [timezone, travelDate]);

  const actualArrivalDate = useMemo(() => {
    if (!effectiveArrivalTimeUTC || !timezone) return null;
    return getIsoDate(new Date(effectiveArrivalTimeUTC), timezone);
  }, [effectiveArrivalTimeUTC, timezone]);

  const actualArrivalLocalTime = useMemo(() => {
    if (!effectiveArrivalTimeUTC || !timezone) return null;
    return dayjs(effectiveArrivalTimeUTC).tz(timezone).format('HH:mm');
  }, [effectiveArrivalTimeUTC, timezone]);

  const travelDateRef = useRef(travelDate);
  useEffect(() => { travelDateRef.current = travelDate; }, [travelDate]);

  // [FLICKER GUARD]: Stabilize timezone passed to list
  const lastValidTimezoneRef = useRef<string | null>(timezone);
  useEffect(() => {
    if (timezone) lastValidTimezoneRef.current = timezone;
  }, [timezone]);
  const stableTimezone = timezone || lastValidTimezoneRef.current || undefined;

  useEffect(() => {
    if (!timezone) { setAirportTime(null); return; }
    let intervalId: ReturnType<typeof setInterval>;
    const updateTime = () => {
      try {
        setAirportTime(dayjs().tz(timezone).format('HH:mm'));
      } catch { setAirportTime(null); }
      // Midnight detection: advance travelDate when the day rolls over
      const newToday = getTodayInTz(timezone);
      if (travelDateRef.current !== newToday) {
        // Only auto-advance if the user hadn't manually chosen a different date.
        // We detect this by checking whether the stored date was "yesterday" in this TZ.
        const yesterday = getIsoDate(new Date(Date.now() - 86400000), timezone);
        if (travelDateRef.current === yesterday) {
          updateSettings({ travelDate: newToday });
        }
      }
    };
    updateTime();
    // Synchronise to the system clock: wait until the next full minute, then tick every 60 s.
    const msToNextMinute = 60000 - (Date.now() % 60000);
    const timeoutId = setTimeout(() => {
      updateTime();
      intervalId = setInterval(updateTime, 60000);
    }, msToNextMinute);
    return () => { clearTimeout(timeoutId); clearInterval(intervalId); };
  }, [timezone, updateSettings]);

  // Obsługa dwóch stref czasowych (przesiadki)
  const arrivalTwoTZ = useMemo(() => {
    if (!effectiveArrivalTimeUTC || !selectedTimezoneOverride || !selectedTimezoneAirportCode) return null;
    const originalArrCode = lastRealLeg?.toAirportCode ?? null;
    if (!originalArrCode) return null;
    const originalTZ = airportTimezoneMap[originalArrCode];
    if (!originalTZ || originalTZ === selectedTimezoneOverride) return null;

    const date = dayjs(effectiveArrivalTimeUTC);
    const selectedTime = date.tz(selectedTimezoneOverride).format('HH:mm');
    const originalTime = date.tz(originalTZ).format('HH:mm');

    // Compute hour offset: how many hours originalTZ is ahead of selectedTZ
    const toUTCOffset = (tz: string) => {
      const utcStr = getIsoDatetime(date.toDate(), 'UTC');
      const localStr = getIsoDatetime(date.toDate(), tz);
      return Math.round((new Date((localStr || '') + ':00Z').getTime() - new Date((utcStr || '') + ':00Z').getTime()) / 3600000);
    };
    const diff = toUTCOffset(originalTZ) - toUTCOffset(selectedTimezoneOverride);
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;

    const selectedDay = getIsoDate(date.toDate(), selectedTimezoneOverride);
    const originalDay = getIsoDate(date.toDate(), originalTZ);
    const dayLabel = selectedDay !== originalDay
      ? date.tz(originalTZ).format('D MMM')
      : null;

    const dayDiff = selectedDay !== originalDay 
      ? Math.round((new Date(originalDay).getTime() - new Date(selectedDay).getTime()) / 86400000)
      : 0;

    const invDiff = -diff;
    const invDiffStr = invDiff > 0 ? `+${invDiff}` : `${invDiff}`;
    return { selectedCode: selectedTimezoneAirportCode, selectedTime, originalCode: originalArrCode, originalTime, diffH: diff, invDiffStr, dayLabel, dayDiff };
  }, [effectiveArrivalTimeUTC, selectedTimezoneOverride, selectedTimezoneAirportCode, lastRealLeg, airportTimezoneMap]);

  // Wyświetlanie alternatywnych stref czasowych
  const getAltTimeDisplay = useCallback((airportCode: string): string | null => {
    if (!timezone) return null;
    const tz = airportTimezoneMap[airportCode];
    if (!tz || tz === timezone) return null;
    const now = new Date();
    const getOffsetMs = (tzName: string) => {
      const utcStr = getIsoDatetime(now, 'UTC');
      const localStr = getIsoDatetime(now, tzName);
      return new Date(localStr + ':00').getTime() - new Date(utcStr + ':00').getTime();
    };
    const diffH = (getOffsetMs(tz) - getOffsetMs(timezone)) / 3600000;
    if (diffH === 0) return null;
    const sign = diffH > 0 ? '+' : '-';
    const absH = Math.abs(diffH);
    if (Number.isInteger(absH)) return `(${sign}${absH}h)`;
    const h = Math.floor(absH);
    const m = Math.round((absH - h) * CONFIG.MINUTES_IN_HOUR);
    return `(${sign}${h}h${m}m)`;
  }, [timezone, airportTimezoneMap]);

  // Relative offset of a country TZ group vs the currently active country TZ
  const getCountryTzRelativeOffset = useCallback((tz: string): string | null => {
    const relativeTo = countryActiveTZ;
    if (!relativeTo || tz === relativeTo || tz === CONFIG.UNKNOWN_TIMEZONE) return null;
    const now = new Date();
    const getOffsetMs = (tzName: string) => {
      const utcStr = getIsoDatetime(now, 'UTC');
      const localStr = getIsoDatetime(now, tzName);
      return new Date(localStr + ':00').getTime() - new Date(utcStr + ':00').getTime();
    };
    const diffH = (getOffsetMs(tz) - getOffsetMs(relativeTo)) / 3600000;
    if (diffH === 0) return null;
    const sign = diffH > 0 ? '+' : '-';
    const absH = Math.abs(diffH);
    if (Number.isInteger(absH)) return `(${sign}${absH}h)`;
    const h = Math.floor(absH);
    const m = Math.round((absH - h) * CONFIG.MINUTES_IN_HOUR);
    return `(${sign}${h}h${m}m)`;
  }, [countryActiveTZ]);

  const handleSwitchTimezone = useCallback((airportCode: string) => {
    const tz = airportTimezoneMap[airportCode];
    if (!tz || tz === selectedTimezoneOverride) return;
    setSelectedTimezoneOverride(tz);
    setSelectedTimezoneAirportCode(airportCode);
    if (effectiveArrivalTimeUTC) {
      // Trip mode: only jump to arrival date in new TZ if currently on the arrival date.
      // If user manually changed the date, preserve it.
      const arrivalDateInCurrentTZ = getIsoDate(new Date(effectiveArrivalTimeUTC), timezone ?? 'UTC');
      if (travelDate === arrivalDateInCurrentTZ) {
        updateSettings({ travelDate: getIsoDate(new Date(effectiveArrivalTimeUTC), tz) });
      }
    } else {
      // Non-trip mode: if viewing TODAY in current TZ, jump to TODAY in new TZ
      // If viewing a manually-selected date, keep it
      const todayInCurrentTZ = getTodayInTz(timezone ?? 'UTC');
      if (travelDate === todayInCurrentTZ) {
        updateSettings({ travelDate: getTodayInTz(tz) });
      }
    }
  }, [airportTimezoneMap, selectedTimezoneOverride, updateSettings, effectiveArrivalTimeUTC, timezone, travelDate]);

  // Resetowanie nadpisania strefy przy usunięciu lotniska
  useEffect(() => {
    if (!selectedTimezoneOverride) return;
    const allCodes = [
      ...explorationItems.flatMap(i => i.airportCodes),
      ...transferAirports,
    ];
    const hasMatch = allCodes.some(c => airportTimezoneMap[c] === selectedTimezoneOverride);
    if (!hasMatch) {
      setSelectedTimezoneOverride(null);
      setSelectedTimezoneAirportCode(null);
      // Update travelDate to today in the restored timezone if the user was viewing today.
      // (The main travelDate effect won't catch this because resolvedTimezone didn't change.)
      if (resolvedTimezone) {
        const todayInOverrideTZ = getTodayInTz(selectedTimezoneOverride);
        if (travelDate === todayInOverrideTZ) {
          updateSettings({ travelDate: getTodayInTz(resolvedTimezone) });
        }
      }
    }
  }, [explorationItems, transferAirports, selectedTimezoneOverride, airportTimezoneMap, resolvedTimezone, travelDate, updateSettings]);

  // Grupy w trybie eksploracji (lotniska)
  const countryInfoMap = useCountryInfoMap();
  const explorationDisplayItems = useExplorationGroups(
    explorationItems, airportsMap, cityInfoMap, countryInfoMap, countryNameCache, expandedCityGroups,
  );

  // Zarządzanie usuwaniem pozycji z listy eksploracji
  const addMissingAirport = useCallback((ap: { code: string; name: string }) => {
    addExplorationItem({ type: 'airport', code: ap.code, name: ap.name, airportCodes: [ap.code] } /*, 'airports'*/);
  }, [addExplorationItem]);

  const removeAirportCodes = useCallback((codes: string[]) => {
    const codeSet = new Set(codes);
    explorationItems
      .filter(item => item.airportCodes.some(c => codeSet.has(c)))
      .forEach(item => removeExplorationItem(item.id));
  }, [explorationItems, removeExplorationItem]);

  if (!selectedItem) return null;

  const getSimplifiedDetails = () => {
    if (selectedItem.type === 'airport') {
      const parts = [selectedItem.data.name];
      if (selectedItem.data.city_name) parts.push(selectedItem.data.city_name);
      if (selectedItem.data.country_name) parts.push(selectedItem.data.country_name);
      return parts.join(', ');
    } else if (selectedItem.type === 'city') {
      const parts = [selectedItem.data.name];
      if (selectedItem.data.country_name) parts.push(selectedItem.data.country_name);
      return parts.join(', ');
    } else if (selectedItem.type === 'country') {
      return selectedItem.data.name;
    }
    return '';
  };

  const isExplorationActive = explorationItems.length > 0;
  // ULTRA-LEAN: Don't unmount FlightsList just because timezone is flickering during transition.
  // As long as we have airports to show, keep the component alive to preserve its downloaded data.
  const showFlightsList = flightAirportCodes.length > 0;

  const explorationListEl = (
    <ExplorationList
      items={explorationDisplayItems}
      expandedCityGroups={expandedCityGroups}
      setExpandedCityGroups={setExpandedCityGroups}
      expandedInnerCities={expandedInnerCities}
      setExpandedInnerCities={setExpandedInnerCities}
      getAltTimeDisplay={getAltTimeDisplay}
      onSwitchTimezone={handleSwitchTimezone}
      onRemoveItem={removeExplorationItem}
      onRemoveCodes={removeAirportCodes}
      onAddMissingAirport={addMissingAirport}
    />
  );

  return (
    <div className="right-panel">
      <div className="panel-header">
        <div className="header-content">
          <h3>{t.panel.departureDate}</h3>
          {(selectedItem.type === 'airport' || (selectedItem.type === 'city' && queriedCityAirports.length > 0) || selectedItem.type === 'country') && (
            <div className="header-info">
              <DateInput value={travelDate} onChange={handleManualDateChange}
                timezone={(selectedItem.type === 'country' ? (countryDisplayTZ ?? undefined) : timezone) ?? undefined}
                minDate={minDate} />
              {selectedItem.type === 'airport' && effectiveArrivalTimeUTC && travelDate === actualArrivalDate && (
                <div className={`airport-time airport-time--arrival${arrivalTwoTZ ? ' airport-time--double' : ''}${isArrivalEstimated ? ' airport-time--estimated' : ''}`}>
                  {arrivalTwoTZ ? (
                    <div className="arrival-two-tz">
                      <div className="arrival-main">
                        <span className="tz-label">{t.common?.localAtArrival || 'Arr'}:</span> {arrivalTwoTZ.originalTime}
                        {arrivalTwoTZ.dayLabel && (
                          <span className={`arrival-different-day ${arrivalTwoTZ.dayDiff > 0 ? 'positive' : arrivalTwoTZ.dayDiff < 0 ? 'negative' : ''}`}>
                            ({arrivalTwoTZ.dayLabel})
                          </span>
                        )}
                      </div>
                      <div className="arrival-alt">
                        <span className="tz-label">{t.common?.localAtSelected || 'Sel'}:</span> {arrivalTwoTZ.selectedTime}
                        {arrivalTwoTZ.diffH !== 0 && (
                          <span className={`arrival-tz-diff ${arrivalTwoTZ.diffH > 0 ? 'negative' : 'positive'}`}>
                            ({arrivalTwoTZ.invDiffStr}h)
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="arrival-single-tz">
                      <span className="tz-label">{t.common?.localTime || 'Local'}:</span> {actualArrivalLocalTime}
                    </div>
                  )}
                  {isArrivalEstimated && (
                    <div className="arrival-estimated-note">
                      <span className="est-icon">~</span> {t.card.estimated}
                    </div>
                  )}
                  {isArrivalEstimated && (
                    <div className="arrival-estimated-tooltip">
                      {t.card.estimatedTooltip}
                    </div>
                  )}
                </div>
              )}
              {((selectedItem.type === 'airport' && !effectiveArrivalTimeUTC) ||
                selectedItem.type === 'city' ||
                (selectedItem.type === 'country' && countryTzGroups.filter(g => g.tz !== CONFIG.UNKNOWN_TIMEZONE).length <= 1)) &&
                isToday && airportTime && (
                <div className="airport-time">{airportTime}</div>
              )}
            </div>
          )}
        </div>
        <button className="close-button" onClick={handleClose}>{UI_SYMBOLS.CLOSE}</button>
      </div>

      <div className="panel-content">
        {/* ── Inline pending country picker (shown when panel is open in airport/city mode) ── */}
        {pendingCountryPicker && selectedItem.type !== 'country' && (
          <PendingCountryPicker
            pendingCountryPicker={pendingCountryPicker}
            pendingCountryTzGroups={pendingCountryTzGroups}
            pendingSelectedAirports={pendingSelectedAirports}
            setPendingSelectedAirports={setPendingSelectedAirports}
            explorationItems={explorationItems}
            onFitBounds={onFitBounds}
            onClearCountryPicker={onClearCountryPicker}
          />
        )}

        {/* ── Airport mode ──────────────────────────────────────── */}
        {selectedItem.type === 'airport' && (
          <>
            <div className="item-info">
              {tripState ? (
                <TripAirportSection
                  selectedAirport={selectedItem.data}
                  transferAirports={transferAirports}
                  setTransferAirports={setTransferAirports}
                  getAltTimeDisplay={getAltTimeDisplay}
                  onSwitchTimezone={handleSwitchTimezone}
                  selectedTimezoneAirportCode={selectedTimezoneAirportCode}
                  setSelectedTimezoneOverride={setSelectedTimezoneOverride}
                  setSelectedTimezoneAirportCode={setSelectedTimezoneAirportCode}
                  onPreviewAirport={onPreviewAirport}
                  onClearPreview={onClearPreview}
                />
              ) : (
                explorationItems.length > 0 ? explorationListEl : (
                  <div className="simplified-details">{getSimplifiedDetails()}</div>
                )
              )}
            </div>
            {showFlightsList && (
              <div className="flights-section">
                <FlightsFilter allFlights={flightsData} isOpen={filterOpen} onToggle={() => setFilterOpen(o => !o)} />
                <FlightsList
                  ref={flightsListRef}
                  airportCodes={flightAirportCodes}
                  timezone={stableTimezone}
                  initialFromDatetime={initialFromDatetime ?? undefined}
                  airportTimezones={airportTimezoneMap}
                  originalAirportCode={tripState ? selectedItem.data.code : null}
                  tripArrivalTimeUTC={tripState ? effectiveArrivalTimeUTC : null}
                  travelDateOverride={effectiveTravelDate}
                  onAddToTrip={handleAddToTripWithReset}
                />
              </div>
            )}
          </>
        )}

        {/* ── City mode ─────────────────────────────────────────── */}
        {selectedItem.type === 'city' && (
          <>
            <div className="item-info">
              {explorationItems.length > 0 ? explorationListEl : (
                <div className="simplified-details">{getSimplifiedDetails()}</div>
              )}
              {queriedCityAirports.length === 0 && explorationItems.length === 0 && (
                <div className="mode-no-airports">{t.panel.noFlightableAirports}</div>
              )}
            </div>
            {showFlightsList && (
              <div className="flights-section">
                <FlightsFilter allFlights={flightsData} isOpen={filterOpen} onToggle={() => setFilterOpen(o => !o)} />
                <FlightsList
                  ref={flightsListRef}
                  airportCodes={flightAirportCodes}
                  timezone={stableTimezone}
                  initialFromDatetime={initialFromDatetime ?? undefined}
                  airportTimezones={airportTimezoneMap}
                  travelDateOverride={effectiveTravelDate}
                  onAddToTrip={handleAddToTripWithReset}
                />
              </div>
            )}
          </>
        )}

        {/* ── Tryb kraju ────────────────────────────────────────── */}
        {selectedItem.type === 'country' && (
          <>
            <div className="item-info">
              <div className="simplified-details">{getSimplifiedDetails()}</div>
              <CountryModeSection
                countryTzGroups={countryTzGroups}
                countryActiveTZ={countryActiveTZ}
                setCountryActiveTZ={setCountryActiveTZ}
                selectedFlatAirports={selectedFlatAirports}
                onAirportToggle={handleCountryAirportToggle}
                onConfirm={handleConfirmFlatAirports}
                getCountryTzRelativeOffset={getCountryTzRelativeOffset}
              />

            </div>
            {!loadingCountry && selectedFlatAirports.length === 0 && selectedCities.length === 0 && (
              <div className="placeholder-message">
                <p>{t.panel.selectAirportsMax(CONFIG.MAX_AIRPORTS)}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default RightPanel;
