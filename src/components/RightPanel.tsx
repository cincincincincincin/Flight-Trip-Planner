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
import { useAirportInfoQuery, useAirportInfosQuery, useAirportsQuery, useAirportsByCountryQuery } from '../hooks/queries';
import { useTravelDate } from '../hooks/useTravelDate';
import './RightPanel.css';
import { useTexts } from '../hooks/useTexts';
import type { Language } from '../constants/text';
import { UI_SYMBOLS } from '../constants/ui';
import { FORMAT_LOCALES, FORMAT_OPTIONS } from '../constants/format';
import { CONFIG } from '../constants/config';
import { haversineKm } from '../utils/math';
import { BROWSER_TIMEZONE, buildTzGroups, resolveTimezone } from '../utils/timezoneUtils';

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

const RightPanel = forwardRef<unknown, RightPanelProps>(({ onClose, onAddToTrip, onPreviewAirport, onClearPreview, pendingCountryPicker, onClearCountryPicker, onFitBounds, onCountryAirportsConfirmed, onSwitchToCountryView }, ref) => {
  const t = useTexts();
  const { selectedItem, flightsData, setSelectedAirportCodes, explorationItems, removeExplorationItem, addExplorationItem } = useSelectionStore();
  const { tripState, setManualTransferAirportCodes } = useTripStore();
  const { travelDate, setTravelDate, setTimezone, minTransferHours, minManualTransferHours, language } = useSettingsStore();
  const { clearFilters } = useFilterStore();
  // const { viewMode } = useMapStore();
  const { data: airportsData } = useAirportsQuery();

  // ── Filter state ────────────────────────────────────────────────────────────

  // ── City mode state ─────────────────────────────────────────────────────────
  const [cityAirports, setCityAirports] = useState<Airport[]>([]);
  const [loadingCityAirports] = useState(false);

  // ── Country mode state ──────────────────────────────────────────────────────
  const [countryCities, setCountryCities] = useState<City[]>([]);
  const [loadingCountry] = useState(false);
  const [selectedFlatAirports, setSelectedFlatAirports] = useState<CountryAirport[]>([]);
  const [selectedCities, setSelectedCities] = useState<City[]>([]);
  const [loadingConfirm] = useState(false);

  // ── Country TZ mode state ───────────────────────────────────────────────────
  const [countryActiveTZ, setCountryActiveTZ] = useState<string | null>(null);
  const [pendingSelectedAirports, setPendingSelectedAirports] = useState<string[]>([]);
  const [countryNameCache, setCountryNameCache] = useState<Record<string, string>>({});

  // ── Trip mode: manual transfer airports ────────────────────────────────────
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
    setManualTransferAirportCodes(transferAirports);
  }, [transferAirports, setManualTransferAirportCodes]);

  // ── Exploration grouping state ─────────────────────────────────────────────
  const [expandedCityGroups, setExpandedCityGroups] = useState<Set<string>>(new Set());
  const [expandedInnerCities, setExpandedInnerCities] = useState<Set<string>>(new Set());

  // ── Airport grouping maps ──────────────────────────────────────────────────

  const cityInfoMap = useMemo<Record<string, { name: string; country_code: string; airportCount: number }>>(() => {
    if (!airportsData) return {};
    const map: Record<string, { name: string; country_code: string; airportCount: number }> = {};
    airportsData.features.forEach(f => {
      const city = f.properties.city_code;
      if (city) {
        if (!map[city]) {
          const cityName = f.properties.city_name ?? city;
          map[city] = { name: cityName, country_code: f.properties.country_code || '', airportCount: 0 };
        }
        map[city].airportCount++;
      }
    });
    return map;
  }, [airportsData]);

  const countryDisplayNames = useMemo(() => {
    const localeMap: Record<Language, string> = { en: 'en-US', pl: 'pl-PL' };
    try { return new Intl.DisplayNames([localeMap[language]], { type: 'region' }); } catch { return null; }
  }, [language]);

  const countryInfoMap = useMemo<Record<string, { name: string; airportCount: number }>>(() => {
    if (!airportsData) return {};
    const map: Record<string, { name: string; airportCount: number }> = {};
    airportsData.features.forEach(f => {
      const cc = f.properties.country_code;
      if (cc) {
        if (!map[cc]) {
          let name = countryDisplayNames?.of(cc);
          if (!name || name === cc) {
            name = f.properties.country_name || cc;
          }
          map[cc] = { name, airportCount: 0 };
        }
        map[cc].airportCount++;
      }
    });
    return map;
  }, [airportsData, countryDisplayNames]);

  // ── Trip state derived ─────────────────────────────────────────────────────
  const airportCoordsMap = useMemo<Record<string, [number, number]>>(() => {
    if (!airportsData) return {};
    const map: Record<string, [number, number]> = {};
    airportsData.features.forEach(f => {
      if (f.properties.code && f.geometry?.coordinates) {
        map[f.properties.code] = f.geometry.coordinates as [number, number];
      }
    });
    return map;
  }, [airportsData]);

  const tripCurrentArrivalTimeUTC = useMemo(() => {
    if (!tripState?.legs?.length) return null;
    for (let i = tripState.legs.length - 1; i >= 0; i--) {
      const leg = tripState.legs[i];
      if ((leg as { type?: string }).type !== 'manual' && leg.flight?.scheduled_arrival_utc) {
        return leg.flight.scheduled_arrival_utc;
      }
    }
    return null;
  }, [tripState]);

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
  const [, setNowTick] = useState(0);

  // ── Airport info for timezone ──────────────────────────────────────────────
  const primaryAirportCode = useMemo(() => {
    if (explorationItems.length > 0) return explorationItems[explorationItems.length - 1].airportCodes[0] ?? null;
    if (selectedItem?.type === 'airport') return selectedItem.data.code;
    if (selectedItem?.type === 'city' && cityAirports.length > 0) return cityAirports[0].code;
    if (selectedItem?.type === 'country' && selectedFlatAirports.length > 0) return selectedFlatAirports[0].code;
    return null;
  }, [explorationItems, selectedItem, cityAirports, selectedFlatAirports]);

  const { data: airportInfo } = useAirportInfoQuery(primaryAirportCode);

  // ── Country airports – single query per country (includes time_zone) ────────
  const countryCode = selectedItem?.type === 'country' ? selectedItem.data.code : null;
  const { data: countryAirportsData } = useAirportsByCountryQuery(countryCode);
  const countryFlatAirports = countryAirportsData ?? [];

  const { data: pendingCountryAirportsData } = useAirportsByCountryQuery(pendingCountryPicker?.code ?? null);
  const pendingCountryFlatAirports = pendingCountryAirportsData ?? [];

  const countryTzGroups = useMemo(() => buildTzGroups(countryFlatAirports), [countryFlatAirports]);
  const pendingCountryTzGroups = useMemo(() => buildTzGroups(pendingCountryFlatAirports), [pendingCountryFlatAirports]);

  // ── Airport codes to pass to FlightsList ──────────────────────────────────
  const flightAirportCodes = useMemo(() => {
    // Trip mode: original airport + transfer airports
    if (tripState && selectedItem?.type === 'airport') {
      return [selectedItem.data.code, ...transferAirports];
    }
    if (explorationItems.length > 0) {
      return [...new Set(explorationItems.flatMap(i => i.airportCodes))];
    }
    if (selectedItem?.type === 'airport') return [selectedItem.data.code];
    if (selectedItem?.type === 'city') return cityAirports.map(a => a.code);
    return [];
  }, [selectedItem, cityAirports, explorationItems, tripState, transferAirports]);

  // ── Multi-airport timezone resolution ─────────────────────────────────────
  const airportInfosResults = useAirportInfosQuery(flightAirportCodes);

  const airportTimezoneMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    flightAirportCodes.forEach((code, i) => {
      const tz = airportInfosResults[i]?.data?.time_zone;
      if (tz) map[code] = tz;
    });
    return map;
  }, [flightAirportCodes, airportInfosResults]);

  // In trip mode use the last transfer airport as "last added"; otherwise use exploration items
  const lastAddedCode = useMemo(() => {
    if (tripState && transferAirports.length > 0) return transferAirports[transferAirports.length - 1];
    if (explorationItems.length > 0) return explorationItems[explorationItems.length - 1].airportCodes[0];
    return null;
  }, [tripState, transferAirports, explorationItems]);

  const lastRealLeg = useMemo(() => {
    if (!tripState?.legs?.length) return null;
    for (let i = tripState.legs.length - 1; i >= 0; i--) {
      const leg = tripState.legs[i];
      if ((leg as { type?: string }).type !== 'manual') return leg;
    }
    return null;
  }, [tripState]);

  const resolvedTimezone = useMemo(() => {
    // In trip mode: always pin to the arrival airport's TZ so adding transfer airports
    // doesn't auto-switch the displayed timezone.
    if (effectiveArrivalTimeUTC && lastRealLeg?.toAirportCode) {
      const arrTZ = airportTimezoneMap[lastRealLeg.toAirportCode];
      if (arrTZ) return arrTZ;
    }
    return resolveTimezone(flightAirportCodes, airportTimezoneMap, lastAddedCode);
  }, [effectiveArrivalTimeUTC, lastRealLeg, flightAirportCodes, airportTimezoneMap, lastAddedCode]);

  // ── "Display TZ" for country mode: active TZ → earliest group → browser ────
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
    setTimezone(timezone);
  }, [timezone, setTimezone]);

  // ── Reset filter + timezone override when selectedItem changes ───────────
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

  // ── Load city airports from GeoJSON when city selected ────────────────────
  useEffect(() => {
    if (selectedItem?.type !== 'city') {
      setCityAirports([]);
      return;
    }
    const cityCode = selectedItem.data.code;
    const airports: Airport[] = (airportsData?.features ?? [])
      .filter(f => f.properties.city_code === cityCode)
      .map(f => ({
        type: 'airport' as const,
        code: f.properties.code,
        name: f.properties.name,
        city_code: f.properties.city_code,
        city_name: f.properties.city_name,
        country_code: f.properties.country_code,
        country_name: f.properties.country_name,
        time_zone: f.properties.time_zone ?? undefined,
      }));
    setCityAirports(airports.slice(0, CONFIG.MAX_AIRPORTS));
  }, [selectedItem, airportsData]);

  // ── Load country cities from GeoJSON when country selected ───────────────
  useEffect(() => {
    if (selectedItem?.type !== 'country') {
      setCountryCities([]);
      setSelectedFlatAirports([]);
      setSelectedCities([]);
      return;
    }
    const countryCode = selectedItem.data.code;
    const cityMap: Record<string, import('../types').City> = {};
    for (const f of (airportsData?.features ?? [])) {
      if (f.properties.country_code !== countryCode) continue;
      const cityCode = f.properties.city_code;
      if (!cityCode) continue;
      if (!cityMap[cityCode]) {
        cityMap[cityCode] = {
          type: 'city',
          code: cityCode,
          name: f.properties.city_name ?? cityCode,
          country_code: countryCode,
          airports: [],
        };
      }
      cityMap[cityCode].airports!.push({
        type: 'airport',
        code: f.properties.code,
        name: f.properties.name,
        city_code: f.properties.city_code,
        city_name: f.properties.city_name,
        country_code: f.properties.country_code,
        country_name: f.properties.country_name,
      });
    }
    setCountryCities(Object.values(cityMap).sort((a, b) => a.name.localeCompare(b.name)));
  }, [selectedItem, airportsData]);

  // ── Build airportCountMap for country mode ────────────────────────────────
  const cityAirportCountMap = useMemo<Record<string, number>>(() => {
    if (!airportsData) return {};
    const map: Record<string, number> = {};
    airportsData.features.forEach(f => {
      const cityCode = f.properties.city_code;
      if (cityCode) {
        map[cityCode] = (map[cityCode] || 0) + 1;
      }
    });
    return map;
  }, [airportsData]);

  const selectedCityAirportTotal = useMemo(() =>
    selectedCities.reduce((total, city) => total + (cityAirportCountMap[city.code] || 0), 0),
  [selectedCities, cityAirportCountMap]);

  // ── Country mode: confirm cities selection ────────────────────────────────
  const handleConfirmCities = useCallback(() => {
    if (!airportsData) return;
    const codes: string[] = [];
    selectedCities.forEach(city => {
      airportsData.features
        .filter(f => f.properties.city_code === city.code)
        .forEach(f => codes.push(f.properties.code));
    });
    if (selectedItem?.type !== 'country') return;
    onCountryAirportsConfirmed(codes.slice(0, CONFIG.MAX_AIRPORTS), selectedItem.data.code, selectedItem.data.name);
  }, [selectedCities, airportsData, onCountryAirportsConfirmed, selectedItem]);


  // ── Country flat airports: toggle with TZ tracking ────────────────────────
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

  // ── Country flat airports: confirm selection ───────────────────────────────
  const handleConfirmFlatAirports = useCallback(() => {
    if (selectedItem?.type !== 'country') return;
    const codes = selectedFlatAirports.map(a => a.code);
    onCountryAirportsConfirmed(codes, selectedItem.data.code, selectedItem.data.name);
  }, [selectedFlatAirports, onCountryAirportsConfirmed, selectedItem]);

  // ── Wrap onAddToTrip to also reset filter ─────────────────────────────────
  const handleAddToTripWithReset = useCallback((flight: Flight) => {
    clearFilters();
    setFilterOpen(false);
    onAddToTrip(flight);
  }, [clearFilters, onAddToTrip]);

  // ── Clear local state on close ─────────────────────────────────────────────
  const handleClose = useCallback(() => {
    clearFilters();
    onClose();
  }, [clearFilters, onClose]);

  // ── Travel date management ─────────────────────────────────────────────────
  useTravelDate({
    selectedItem, timezone, explorationItems, effectiveArrivalTimeUTC,
    selectedTimezoneOverride, resolvedTimezone, countryDisplayTZ,
    travelDate, setTravelDate,
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
    // Fallback: use the display timezone (or browser TZ) to compute current local datetime
    const tz = timezone ?? BROWSER_TIMEZONE;
    if (!tz) return null;
    const now = new Date();
    const local = now.toLocaleString('sv-SE', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    return local.replace(' ', 'T').substring(0, 19);
  }, [airportInfo, selectedItem, flightAirportCodes.length, effectiveArrivalTimeUTC, timezone]);

  const handleManualDateChange = useCallback((newDate: string) => {
    setTravelDate(newDate);
    flightsListRef.current?.jumpToDate(newDate);
  }, [setTravelDate]);

  const minDate = useMemo(() => {
    if (!effectiveArrivalTimeUTC) return undefined;
    const thresholdMs = new Date(effectiveArrivalTimeUTC).getTime()
      + (minTransferHours + manualTransferCount * minManualTransferHours) * 3600000;
    const thresholdDate = new Date(thresholdMs);
    if (timezone) return thresholdDate.toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone });
    return thresholdDate.toISOString().split('T')[0];
  }, [effectiveArrivalTimeUTC, minTransferHours, manualTransferCount, minManualTransferHours, timezone]);

  useImperativeHandle(ref, () => ({
    scrollToFlight: (destCode: string) => flightsListRef.current?.scrollToFlight(destCode),
    clearTransferAirports: () => setTransferAirports([]),
  }));

  const isToday = useMemo(() => {
    if (!timezone) return false;
    const now = new Date();
    return travelDate === now.toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone });
  }, [timezone, travelDate]);

  const actualArrivalDate = useMemo(() => {
    if (!effectiveArrivalTimeUTC || !timezone) return null;
    return new Date(effectiveArrivalTimeUTC).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone });
  }, [effectiveArrivalTimeUTC, timezone]);

  const actualArrivalLocalTime = useMemo(() => {
    if (!effectiveArrivalTimeUTC || !timezone) return null;
    return new Date(effectiveArrivalTimeUTC).toLocaleTimeString(FORMAT_LOCALES.GB, {
      timeZone: timezone, hour: '2-digit', minute: '2-digit',
    });
  }, [effectiveArrivalTimeUTC, timezone]);

  useEffect(() => {
    if (!timezone) { setAirportTime(null); return; }
    const updateTime = () => {
      try {
        setAirportTime(new Date().toLocaleTimeString(FORMAT_LOCALES.GB, { timeZone: timezone, hour: '2-digit', minute: '2-digit' }));
        setNowTick(t => t + 1);
      } catch { setAirportTime(null); }
    };
    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, [timezone]);

  // ── Two-timezone arrival time (when TZ switched in trip mode) ─────────────
  const arrivalTwoTZ = useMemo(() => {
    if (!effectiveArrivalTimeUTC || !selectedTimezoneOverride || !selectedTimezoneAirportCode) return null;
    const originalArrCode = lastRealLeg?.toAirportCode ?? null;
    if (!originalArrCode) return null;
    const originalTZ = airportTimezoneMap[originalArrCode];
    if (!originalTZ || originalTZ === selectedTimezoneOverride) return null;

    const date = new Date(effectiveArrivalTimeUTC);
    const selectedTime = date.toLocaleTimeString(FORMAT_LOCALES.GB, { timeZone: selectedTimezoneOverride, hour: '2-digit', minute: '2-digit' });
    const originalTime = date.toLocaleTimeString(FORMAT_LOCALES.GB, { timeZone: originalTZ, hour: '2-digit', minute: '2-digit' });

    // Compute hour offset: how many hours originalTZ is ahead of selectedTZ
    const toUTCOffset = (tz: string) => {
      const utcStr = date.toLocaleString(FORMAT_LOCALES.SE, { timeZone: 'UTC' });
      const localStr = date.toLocaleString(FORMAT_LOCALES.SE, { timeZone: tz });
      return Math.round((new Date(localStr.replace(' ', 'T') + 'Z').getTime() - new Date(utcStr.replace(' ', 'T') + 'Z').getTime()) / 3600000);
    };
    const diff = toUTCOffset(originalTZ) - toUTCOffset(selectedTimezoneOverride);
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;

    return { selectedCode: selectedTimezoneAirportCode, selectedTime, originalCode: originalArrCode, originalTime, diffStr };
  }, [effectiveArrivalTimeUTC, selectedTimezoneOverride, selectedTimezoneAirportCode, lastRealLeg, airportTimezoneMap]);

  // ── Per-airport alt-timezone offset display ────────────────────────────────
  const getAltTimeDisplay = useCallback((airportCode: string): string | null => {
    if (!timezone) return null;
    const tz = airportTimezoneMap[airportCode];
    if (!tz || tz === timezone) return null;
    const now = new Date();
    const getOffsetMs = (tzName: string) => {
      const utcStr = now.toLocaleString(FORMAT_LOCALES.SE, { timeZone: 'UTC' });
      const localStr = now.toLocaleString(FORMAT_LOCALES.SE, { timeZone: tzName });
      return new Date(localStr).getTime() - new Date(utcStr).getTime();
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
      const utcStr = now.toLocaleString(FORMAT_LOCALES.SE, { timeZone: 'UTC' });
      const localStr = now.toLocaleString(FORMAT_LOCALES.SE, { timeZone: tzName });
      return new Date(localStr).getTime() - new Date(utcStr).getTime();
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
      const arrivalDateInCurrentTZ = new Date(effectiveArrivalTimeUTC).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone ?? 'UTC' });
      if (travelDate === arrivalDateInCurrentTZ) {
        setTravelDate(new Date(effectiveArrivalTimeUTC).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: tz }));
      }
    } else {
      // Non-trip mode: if viewing TODAY in current TZ, jump to TODAY in new TZ
      // If viewing a manually-selected date, keep it
      const todayInCurrentTZ = new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone ?? 'UTC' });
      if (travelDate === todayInCurrentTZ) {
        setTravelDate(new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: tz }));
      }
    }
  }, [airportTimezoneMap, selectedTimezoneOverride, setTravelDate, effectiveArrivalTimeUTC, timezone, travelDate]);

  // ── Reset timezone override if the airport it was set for is removed ──────
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
        const todayInOverrideTZ = new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: selectedTimezoneOverride });
        if (travelDate === todayInOverrideTZ) {
          setTravelDate(new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: resolvedTimezone }));
        }
      }
    }
  }, [explorationItems, transferAirports, selectedTimezoneOverride, airportTimezoneMap, resolvedTimezone, travelDate, setTravelDate]);

  // ── Exploration groups (airport mode) ─────────────────────────────────────
  const explorationDisplayItems = useExplorationGroups(
    explorationItems, airportsData, cityInfoMap, countryInfoMap, countryNameCache, expandedCityGroups,
  );

  // ── Helper: remove all exploration items for a set of airport codes ────────
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

  const showFlightsList = flightAirportCodes.length > 0 && !!timezone &&
    (flightAirportCodes.length > 1 || !!initialFromDatetime || !!effectiveArrivalTimeUTC);

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
          {(selectedItem.type === 'airport' || (selectedItem.type === 'city' && cityAirports.length > 0) || selectedItem.type === 'country') && (
            <div className="header-info">
              <DateInput value={travelDate} onChange={handleManualDateChange}
                timezone={(selectedItem.type === 'country' ? (countryDisplayTZ ?? undefined) : timezone) ?? undefined}
                minDate={minDate} />
              {selectedItem.type === 'airport' && effectiveArrivalTimeUTC && travelDate === actualArrivalDate && (
                <div className={`airport-time airport-time--arrival${isArrivalEstimated ? ' airport-time--estimated' : ''}`}>
                  {arrivalTwoTZ ? (
                    <>
                      <div>{arrivalTwoTZ.selectedCode}: {arrivalTwoTZ.selectedTime}</div>
                      <div className="arrival-secondary">
                        {arrivalTwoTZ.originalCode}: {arrivalTwoTZ.originalTime}
                        {' '}<span className="arrival-tz-diff">{arrivalTwoTZ.diffStr}</span>
                      </div>
                    </>
                  ) : (
                    <div>{lastRealLeg?.toAirportCode}: {actualArrivalLocalTime}</div>
                  )}
                  {isArrivalEstimated && (
                    <div className="arrival-estimated-note">{t.card.estimated}</div>
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
            airportsData={airportsData}
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
                  airportsData={airportsData}
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
                  timezone={timezone!}
                  initialFromDatetime={initialFromDatetime ?? undefined}
                  airportTimezones={airportTimezoneMap}
                  originalAirportCode={tripState ? selectedItem.data.code : null}
                  tripArrivalTimeUTC={tripState ? effectiveArrivalTimeUTC : null}
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
              {loadingCityAirports && <div className="mode-loading">{t.panel.loadingAirports}</div>}
              {!loadingCityAirports && cityAirports.length === 0 && explorationItems.length === 0 && (
                <div className="mode-no-airports">{t.panel.noFlightableAirports}</div>
              )}
            </div>
            {showFlightsList && (
              <div className="flights-section">
                <FlightsFilter allFlights={flightsData} isOpen={filterOpen} onToggle={() => setFilterOpen(o => !o)} />
                <FlightsList
                  ref={flightsListRef}
                  airportCodes={flightAirportCodes}
                  timezone={timezone!}
                  initialFromDatetime={initialFromDatetime ?? undefined}
                  airportTimezones={airportTimezoneMap}
                  onAddToTrip={handleAddToTripWithReset}
                />
              </div>
            )}
          </>
        )}

        {/* ── Country mode ──────────────────────────────────────── */}
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
                airportsData={airportsData}
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
