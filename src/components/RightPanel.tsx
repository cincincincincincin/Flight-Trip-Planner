import { useState, useEffect, useMemo, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import type { Flight, Airport, City, CountryAirport } from '../types';
import FlightsList from './FlightsList';
import FlightsFilter from './FlightsFilter';
import DateInput from './DateInput';
import AirportTransferPicker from './AirportTransferPicker';
import { useSelectionStore } from '../stores/selectionStore';
import { useTripStore } from '../stores/tripStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFilterStore } from '../stores/filterStore';
import { useMapStore } from '../stores/mapStore';
import { useAirportInfoQuery, useAirportInfosQuery, useAirportsQuery, useAirportsByCountryQuery } from '../hooks/queries';
import { getCityAirports, getCountryCities } from '../api/search';
import './RightPanel.css';
import { TEXTS } from '../constants/text';
import { UI_SYMBOLS } from '../constants/ui';
import { FORMAT_LOCALES, FORMAT_OPTIONS } from '../constants/format';
import { CONFIG } from '../constants/config';


const haversineKm = (lon1: number, lat1: number, lon2: number, lat2: number): number => {
  const R = CONFIG.EARTH_RADIUS_KM;
  const toRad = (d: number) => d * CONFIG.DEG_TO_RAD;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const BROWSER_TIMEZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
})();

function buildTzGroups(airports: Array<{ code: string; name: string; time_zone?: string | null }>) {
  // Key by UTC offset in minutes to deduplicate same-offset IANA timezones (e.g. America/Detroit vs America/New_York)
  const groups = new Map<string | number, { tz: string; airports: Array<{ code: string; name: string }>; currentDT: string; utcLabel: string; currentDateStr: string; currentTimeStr: string }>();
  const now = new Date();
  const utcStr = now.toLocaleString(FORMAT_LOCALES.SE, { timeZone: 'UTC' });
  for (const airport of airports) {
    const tz = airport.time_zone ?? CONFIG.UNKNOWN_TIMEZONE;
    if (tz === CONFIG.UNKNOWN_TIMEZONE) {
      if (!groups.has(CONFIG.UNKNOWN_TIMEZONE)) {
        groups.set(CONFIG.UNKNOWN_TIMEZONE, { tz: CONFIG.UNKNOWN_TIMEZONE, airports: [], currentDT: CONFIG.UNKNOWN_TZ_DUMMY, utcLabel: CONFIG.UNKNOWN_TZ_UTCLABEL, currentDateStr: '', currentTimeStr: '' });
      }
      groups.get(CONFIG.UNKNOWN_TIMEZONE)!.airports.push(airport);
      continue;
    }
    const localStr = now.toLocaleString(FORMAT_LOCALES.SE, { timeZone: tz });
    const diffMin = Math.round((new Date(localStr.replace(' ', 'T')).getTime() - new Date(utcStr.replace(' ', 'T')).getTime()) / 60000);
    if (!groups.has(diffMin)) {
      const diffH = diffMin / CONFIG.MINUTES_IN_HOUR;
      const sign = diffH >= 0 ? '+' : '-';
      const absH = Math.abs(diffH);
      const h = Math.floor(absH);
      const m = Math.round((absH - h) * CONFIG.MINUTES_IN_HOUR);
      const utcLabel = `UTC${sign}${h}${m > 0 ? ':' + String(m).padStart(2, '0') : ''}`;
      const currentDateStr = now.toLocaleDateString(FORMAT_LOCALES.GB, { timeZone: tz, weekday: 'short', day: '2-digit', month: '2-digit' });
      const currentTimeStr = now.toLocaleTimeString(FORMAT_LOCALES.GB, { timeZone: tz, hour: '2-digit', minute: '2-digit' });
      groups.set(diffMin, { tz, airports: [], currentDT: localStr, utcLabel, currentDateStr, currentTimeStr });
    }
    groups.get(diffMin)!.airports.push(airport);
  }
  return Array.from(groups.values()).sort((a, b) => a.currentDT.localeCompare(b.currentDT));
}

function resolveTimezone(
  airportCodes: string[],
  tzMap: Record<string, string>,
  lastAddedCode: string | null,
): string | null {
  const known = airportCodes.filter(c => tzMap[c]);
  if (known.length === 0) return null;

  const tzCount: Record<string, number> = {};
  for (const code of known) tzCount[tzMap[code]] = (tzCount[tzMap[code]] || 0) + 1;

  const maxCount = Math.max(...Object.values(tzCount));
  const leading = Object.entries(tzCount).filter(([, c]) => c === maxCount).map(([tz]) => tz);

  if (leading.length === 1) return leading[0];
  if (BROWSER_TIMEZONE && tzCount[BROWSER_TIMEZONE]) return BROWSER_TIMEZONE;
  if (lastAddedCode && tzMap[lastAddedCode]) return tzMap[lastAddedCode];
  return leading[0];
}

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
  const { selectedItem, flightsData, setSelectedAirportCodes, explorationItems, removeExplorationItem, addExplorationItem, clearExploration } = useSelectionStore();
  const { tripState, setManualTransferAirportCodes } = useTripStore();
  const { travelDate, setTravelDate, setTimezone, minTransferHours, minManualTransferHours } = useSettingsStore();
  const { clearFilters } = useFilterStore();
  const { viewMode } = useMapStore();
  const { data: airportsData } = useAirportsQuery();

  // ── Filter state ────────────────────────────────────────────────────────────

  // ── City mode state ─────────────────────────────────────────────────────────
  const [cityAirports, setCityAirports] = useState<Airport[]>([]);
  const [loadingCityAirports, setLoadingCityAirports] = useState(false);

  // ── Country mode state ──────────────────────────────────────────────────────
  const [countryCities, setCountryCities] = useState<City[]>([]);
  const [loadingCountry, setLoadingCountry] = useState(false);
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
      if (city && f.properties.flightable) {
        if (!map[city]) map[city] = { name: f.properties.city_name || city, country_code: f.properties.country_code || '', airportCount: 0 };
        map[city].airportCount++;
      }
    });
    return map;
  }, [airportsData]);

  const countryDisplayNames = useMemo(() => {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
  }, []);

  const countryInfoMap = useMemo<Record<string, { name: string; airportCount: number }>>(() => {
    if (!airportsData) return {};
    const map: Record<string, { name: string; airportCount: number }> = {};
    airportsData.features.forEach(f => {
      const cc = f.properties.country_code;
      if (cc && f.properties.flightable) {
        if (!map[cc]) {
          const name = countryDisplayNames?.of(cc) || f.properties.country_name || cc;
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
  // Track previous resolved timezone to sync travelDate when it auto-switches
  const prevResolvedTZRef = useRef<string | null | undefined>(undefined);
  const travelDateForTZRef = useRef(travelDate);
  useEffect(() => { travelDateForTZRef.current = travelDate; }, [travelDate]);

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
  const countryCode = selectedItem?.type === 'country' && viewMode === 'airports' ? selectedItem.data.code : null;
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
    ?? null;

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
    prevResolvedTZRef.current = undefined; // reset so next auto-TZ change is treated as initial
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

  // ── Load city airports when city selected ─────────────────────────────────
  useEffect(() => {
    if (selectedItem?.type !== 'city') {
      setCityAirports([]);
      return;
    }
    const cityCode = selectedItem.data.code;
    setLoadingCityAirports(true);
    setCityAirports([]);
    getCityAirports(cityCode, { limit: CONFIG.PAGE_LIMITS.GET_CITY_AIRPORTS, offset: 0 })
      .then(r => {
        const flightable = (r.data || []).filter((a: Airport) => a.flightable !== false);
        setCityAirports(flightable.slice(0, CONFIG.MAX_AIRPORTS));
      })
      .catch(console.error)
      .finally(() => setLoadingCityAirports(false));
  }, [selectedItem]);

  // ── Load country cities when country selected ─────────────────────────────
  useEffect(() => {
    if (selectedItem?.type !== 'country') {
      setCountryCities([]);
      setSelectedFlatAirports([]);
      setSelectedCities([]);
      return;
    }
    setLoadingCountry(true);
    setCountryCities([]);
    setSelectedFlatAirports([]);
    setSelectedCities([]);
    getCountryCities(selectedItem.data.code, { limit: CONFIG.PAGE_LIMITS.GET_COUNTRY_CITIES, offset: 0 })
      .then(r => setCountryCities(r.data || []))
      .catch(console.error)
      .finally(() => setLoadingCountry(false));
  }, [selectedItem]);

  // ── Build airportCountMap for country mode ────────────────────────────────
  const cityAirportCountMap = useMemo<Record<string, number>>(() => {
    if (!airportsData) return {};
    const map: Record<string, number> = {};
    airportsData.features.forEach(f => {
      const cityCode = f.properties.city_code;
      if (cityCode && f.properties.flightable) {
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
        .filter(f => f.properties.city_code === city.code && f.properties.flightable)
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

  // ── Travel date ────────────────────────────────────────────────────────────
  const prevSelectedItemKeyRef = useRef<string | null>(null);
  const prevTimezoneRef = useRef<string | null>(null);
  const prevExplorationItemsCountRef = useRef<number>(0);

  useEffect(() => {
    if (!timezone) return;
    // When the user manually overrides the timezone (via the TZ switch button),
    // preserve the current travelDate — we just shift the display window to the new TZ.
    // Only reset travelDate when selectedItem or arrival time changes.
    if (selectedTimezoneOverride) return;

    const overrideDatetime = selectedItem?.type === 'airport' ? selectedItem.overrideFromDatetime : undefined;
    const key = selectedItem
      ? `${selectedItem.type}:${(selectedItem.data as { code?: string })?.code ?? ''}:${overrideDatetime ?? ''}`
      : null;
    if (key !== prevSelectedItemKeyRef.current) {
      prevSelectedItemKeyRef.current = key;
      // selectedItem changed, reset date
      if (effectiveArrivalTimeUTC) {
        setTravelDate(new Date(effectiveArrivalTimeUTC).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone }));
      } else {
        setTravelDate(new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone }));
      }
      prevTimezoneRef.current = timezone;
      prevExplorationItemsCountRef.current = explorationItems.length;
      return;
    }

    // Check if airport(s) were removed (explorationItems decreased)
    const itemsWereRemoved = explorationItems.length < prevExplorationItemsCountRef.current;
    const timezoneChanged = timezone !== prevTimezoneRef.current;

    if (itemsWereRemoved && timezoneChanged && prevTimezoneRef.current) {
      // Smart date handling: check if the old timezone's "today" matches the current travelDate
      const oldTzToday = new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: prevTimezoneRef.current });

      if (travelDate === oldTzToday) {
        // User was viewing today in the old timezone, update to today in new timezone
        setTravelDate(new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone }));
      }
      // If travelDate was not today in the old timezone (user selected a different date),
      // keep the travelDate and only change the timezone
    } else if (!itemsWereRemoved && timezoneChanged) {
      // Timezone changed but airports weren't removed - reset date to today/arrival date
      if (effectiveArrivalTimeUTC) {
        setTravelDate(new Date(effectiveArrivalTimeUTC).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone }));
      } else {
        setTravelDate(new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone }));
      }
    }

    prevTimezoneRef.current = timezone;
    prevExplorationItemsCountRef.current = explorationItems.length;
  }, [selectedItem, timezone, explorationItems.length, setTravelDate, effectiveArrivalTimeUTC, selectedTimezoneOverride, travelDate]);

  // (countryDisplayTZ moved above timezone declaration)

  // ── Sync travelDate when resolvedTimezone auto-switches (e.g. Melbourne added) ──
  useEffect(() => {
    if (selectedItem?.type === 'country') return; // country mode has its own logic
    if (selectedTimezoneOverride) return; // user explicitly chose a TZ, don't interfere
    const prevTZ = prevResolvedTZRef.current;
    prevResolvedTZRef.current = resolvedTimezone;
    if (prevTZ === undefined || resolvedTimezone === prevTZ || !resolvedTimezone) return;
    // Only update travelDate if it was "today" in the previous timezone
    const todayInPrevTZ = prevTZ ? new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: prevTZ }) : null;
    if (!todayInPrevTZ || travelDateForTZRef.current === todayInPrevTZ) {
      setTravelDate(new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: resolvedTimezone }));
    }
  }, [resolvedTimezone, selectedTimezoneOverride, selectedItem?.type, setTravelDate]);

  // ── Set travelDate when country display TZ changes ─────────────────────────
  const prevCountryDisplayTZRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (selectedItem?.type !== 'country') return;
    if (countryDisplayTZ === prevCountryDisplayTZRef.current) return;
    prevCountryDisplayTZRef.current = countryDisplayTZ;
    if (countryDisplayTZ) {
      setTravelDate(new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: countryDisplayTZ }));
    }
  }, [selectedItem?.type, countryDisplayTZ, setTravelDate]);

  // Reset the ref when country changes so the effect fires again
  useEffect(() => {
    if (selectedItem?.type !== 'country') prevCountryDisplayTZRef.current = undefined;
  }, [selectedItem]);

  const initialFromDatetime = useMemo(() => {
    if (flightAirportCodes.length > 1) return null;
    if (!airportInfo) return null;
    if (selectedItem?.type === 'airport' && selectedItem.overrideFromDatetime) {
      return selectedItem.overrideFromDatetime.substring(0, 19);
    }
    // In trip mode with an effective arrival time (real or estimated), return null so
    // FlightsList uses getFromDatetimeForAirport → which converts tripArrivalTimeUTC to local.
    // This avoids loading from current time instead of the arrival time.
    if (effectiveArrivalTimeUTC) return null;
    return airportInfo.current_local_datetime ?? null;
  }, [airportInfo, selectedItem, flightAirportCodes.length, effectiveArrivalTimeUTC]);

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
  // Compute city-groups and country-groups from explorationItems
  interface ExplorationDisplayItem {
    kind: 'airport' | 'city-group' | 'country-group';
    itemId?: string;        // for single airports
    code: string;
    name: string;
    airportCodes: string[];
    cityCode?: string;      // for airport items
    countryCode?: string;
    // city-group / country-group
    isExpanded?: boolean;
    childCities?: Array<{ cityCode: string; cityName: string; airports: Array<{ id: string; code: string; name: string }> }>;
    missingAirports?: Array<{ code: string; name: string }>; // for partial cities in city mode
  }

  const explorationDisplayItems = useMemo((): ExplorationDisplayItem[] => {
    if (!airportsData || explorationItems.length === 0) return [];

    // Country-type items: already have name + all codes stored directly
    if (explorationItems.some(i => i.type === 'country')) {
      return explorationItems.map(item => {
        if (item.type === 'country') {
          const byCity = new Map<string, Array<{ id: string; code: string; name: string }>>();
          for (const code of item.airportCodes) {
            const feat = airportsData.features.find(f => f.properties.code === code);
            const cityCode = feat?.properties.city_code || '';
            if (!byCity.has(cityCode)) byCity.set(cityCode, []);
            byCity.get(cityCode)!.push({ id: item.id, code, name: feat?.properties.name || code });
          }
          const childCities = Array.from(byCity.entries()).map(([cityCode, aps]) => ({
            cityCode,
            cityName: cityInfoMap[cityCode]?.name || cityCode,
            airports: aps,
          }));
          return {
            kind: 'country-group' as const,
            code: item.code,
            name: item.name,
            airportCodes: item.airportCodes,
            isExpanded: expandedCityGroups.has(item.code),
            childCities,
          };
        }
        // fallback for mixed lists (shouldn't happen in practice)
        return {
          kind: 'airport' as const,
          itemId: item.id,
          code: item.code,
          name: item.name,
          airportCodes: item.airportCodes,
        };
      });
    }

    // In city mode
    if (viewMode === 'cities') {
      // City-type items: display directly as non-expandable city groups (no partial detection needed)
      if (explorationItems.every(i => i.type === 'city')) {
        return explorationItems.map(item => ({
          kind: 'city-group' as const,
          code: item.code,
          name: item.name,
          airportCodes: item.airportCodes,
          isExpanded: false,
          childCities: [{
            cityCode: item.code,
            cityName: item.name,
            airports: item.airportCodes.map(c => ({
              id: item.id,
              code: c,
              name: airportsData.features.find(f => f.properties.code === c)?.properties.name || c,
            })),
          }],
          missingAirports: [],
        }));
      }

      // Airport-type items (from airport mode): group by city, detect partial coverage
      const coveredCodes = new Set(explorationItems.flatMap(i => i.airportCodes));
      const byCity = new Map<string, Array<{ id: string; code: string; name: string }>>();
      for (const item of explorationItems) {
        for (const code of item.airportCodes) {
          const feat = airportsData.features.find(f => f.properties.code === code);
          const cityCode = feat?.properties.city_code || '';
          if (!byCity.has(cityCode)) byCity.set(cityCode, []);
          byCity.get(cityCode)!.push({ id: item.id, code, name: feat?.properties.name || code });
        }
      }
      return Array.from(byCity.entries()).map(([cityCode, aps]) => {
        const allCityAirports = airportsData.features
          .filter(f => f.properties.city_code === cityCode && f.properties.flightable)
          .map(f => ({ code: f.properties.code, name: f.properties.name }));
        const missingAirports = allCityAirports.filter(a => !coveredCodes.has(a.code));
        return {
          kind: 'city-group' as const,
          code: cityCode,
          name: cityInfoMap[cityCode]?.name || cityCode,
          airportCodes: aps.map(a => a.code),
          isExpanded: missingAirports.length > 0,
          childCities: [{ cityCode, cityName: cityInfoMap[cityCode]?.name || cityCode, airports: aps }],
          missingAirports,
        };
      });
    }

    // Airport mode: group airports by city
    // Collect all airport codes across all exploration items
    const allAirportItems: Array<{ id: string; code: string; name: string; cityCode: string; countryCode: string }> = [];
    for (const item of explorationItems) {
      for (const code of item.airportCodes) {
        const feat = airportsData.features.find(f => f.properties.code === code);
        allAirportItems.push({
          id: item.id,
          code,
          name: feat?.properties.name || code,
          cityCode: feat?.properties.city_code || '',
          countryCode: feat?.properties.country_code || '',
        });
      }
    }

    // Group by city
    const byCity = new Map<string, typeof allAirportItems>();
    for (const ap of allAirportItems) {
      if (!byCity.has(ap.cityCode)) byCity.set(ap.cityCode, []);
      byCity.get(ap.cityCode)!.push(ap);
    }

    // Determine which cities are complete
    const completeCityCodes = new Set<string>();
    for (const [cityCode, aps] of byCity.entries()) {
      if (!cityCode) continue;
      const total = cityInfoMap[cityCode]?.airportCount ?? 0;
      if (total > 0 && aps.length === total) completeCityCodes.add(cityCode);
    }

    // Determine which countries are complete (all cities complete)
    const byCountry = new Map<string, Set<string>>(); // country → set of cities
    for (const [cityCode] of byCity.entries()) {
      if (!cityCode) continue;
      const cc = cityInfoMap[cityCode]?.country_code || '';
      if (!byCountry.has(cc)) byCountry.set(cc, new Set());
      byCountry.get(cc)!.add(cityCode);
    }
    const completeCountryCodes = new Set<string>();
    for (const [cc] of byCountry.entries()) {
      if (!cc) continue;
      const totalCountryAirports = countryInfoMap[cc]?.airportCount ?? 0;
      const coveredAirports = allAirportItems.filter(ap => ap.countryCode === cc).length;
      if (totalCountryAirports > 0 && coveredAirports === totalCountryAirports) {
        completeCountryCodes.add(cc);
      }
    }

    // Build display items: countries > cities > airports
    const result: ExplorationDisplayItem[] = [];
    const processedCountries = new Set<string>();
    const processedCities = new Set<string>();

    // Country groups first
    for (const cc of completeCountryCodes) {
      processedCountries.add(cc);
      const citiesForCountry = Array.from(byCity.entries())
        .filter(([cityCode]) => cityInfoMap[cityCode]?.country_code === cc);

      const childCities = citiesForCountry.map(([cityCode, aps]) => ({
        cityCode,
        cityName: cityInfoMap[cityCode]?.name || cityCode,
        airports: aps.map(ap => ({ id: ap.id, code: ap.code, name: ap.name })),
      }));

      citiesForCountry.forEach(([cityCode]) => processedCities.add(cityCode));
      result.push({
        kind: 'country-group',
        code: cc,
        name: (() => { const n = countryInfoMap[cc]?.name; return (n && n !== cc) ? n : (countryNameCache[cc] || cc); })(),
        airportCodes: allAirportItems.filter(ap => ap.countryCode === cc).map(ap => ap.code),
        isExpanded: expandedCityGroups.has(cc),
        childCities,
      });
    }

    // City groups
    for (const [cityCode, aps] of byCity.entries()) {
      if (processedCities.has(cityCode)) continue;
      if (completeCityCodes.has(cityCode)) {
        processedCities.add(cityCode);
        result.push({
          kind: 'city-group',
          code: cityCode,
          name: cityInfoMap[cityCode]?.name || cityCode,
          airportCodes: aps.map(ap => ap.code),
          isExpanded: expandedCityGroups.has(cityCode),
          childCities: [{
            cityCode,
            cityName: cityInfoMap[cityCode]?.name || cityCode,
            airports: aps.map(ap => ({ id: ap.id, code: ap.code, name: ap.name })),
          }],
        });
      } else {
        // Individual airports (incomplete city)
        for (const ap of aps) {
          result.push({
            kind: 'airport',
            itemId: ap.id,
            code: ap.code,
            name: ap.name,
            airportCodes: [ap.code],
            cityCode: ap.cityCode,
            countryCode: ap.countryCode,
          });
        }
      }
    }

    return result;
  }, [explorationItems, airportsData, viewMode, cityInfoMap, countryInfoMap, countryNameCache, expandedCityGroups]);

  // ── Helper: remove all exploration items for a set of airport codes ────────
  const addMissingAirport = useCallback((ap: { code: string; name: string }) => {
    addExplorationItem({ type: 'airport', code: ap.code, name: ap.name, airportCodes: [ap.code] }, 'airports');
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

  // ── Render exploration list (shared by airport + city mode) ───────────────
  const renderExplorationList = () => (
    <div className="exploration-list">
      {explorationDisplayItems.map((item, idx) => {
        if (item.kind === 'airport') {
          const altTime = getAltTimeDisplay(item.code);
          return (
            <div key={item.itemId || idx} className="exploration-item">
              <span className="exploration-icon"></span>
              <span className="exploration-name">{item.name}</span>
              <span className="exploration-code">({item.code})</span>
              {altTime && (
                <button className="exploration-tz-btn" title={TEXTS.panel.switchTimezone}
                  onClick={() => handleSwitchTimezone(item.code)}>{altTime}</button>
              )}
              <button className="exploration-remove-btn" onClick={() => item.itemId && removeExplorationItem(item.itemId)}>{UI_SYMBOLS.CLOSE}</button>
            </div>
          );
        }

        if (item.kind === 'city-group') {
          const isPartial = (item.missingAirports?.length ?? 0) > 0;
          const altTime = item.airportCodes[0] ? getAltTimeDisplay(item.airportCodes[0]) : null;

          // Partial city (in city mode, from airport-type items): always expanded, add-only
          if (isPartial) {
            const total = item.airportCodes.length + (item.missingAirports?.length ?? 0);
            return (
              <div key={item.code} className="exploration-group">
                <div className="exploration-item exploration-item--group">
                  <span className="exploration-icon"></span>
                  <span className="exploration-name">{item.name}</span>
                  <span className="exploration-count">{item.airportCodes.length}/{total}ap</span>
                </div>
                {item.childCities?.[0].airports.map(ap => (
                  <div key={ap.code} className="exploration-item exploration-item--child">
                    <span className="exploration-icon"></span>
                    <span className="exploration-name">{ap.name}</span>
                    <span className="exploration-code">({ap.code})</span>
                  </div>
                ))}
                {item.missingAirports?.map(ap => (
                  <div key={ap.code} className="exploration-item exploration-item--child exploration-item--missing">
                    <span className="exploration-icon"></span>
                    <span className="exploration-name">{ap.name}</span>
                    <span className="exploration-code">({ap.code})</span>
                    <button className="exploration-add-btn" onClick={() => addMissingAirport(ap)}>+</button>
                  </div>
                ))}
              </div>
            );
          }

          // Complete city in city mode: non-expandable
          if (viewMode === 'cities') {
            return (
              <div key={item.code} className="exploration-item exploration-item--group">
                <span className="exploration-icon"></span>
                <span className="exploration-name">{item.name}</span>
                <span className="exploration-count">{item.airportCodes.length}{TEXTS.panel.airportAbbreviation}</span>
                {altTime && (
                  <button className="exploration-tz-btn" onClick={() => handleSwitchTimezone(item.airportCodes[0])}>{altTime}</button>
                )}
                <button className="exploration-remove-btn" onClick={() => removeAirportCodes(item.airportCodes)}>{UI_SYMBOLS.CLOSE}</button>
              </div>
            );
          }

          // Airport mode: expandable city-group
          const isExpanded = expandedCityGroups.has(item.code);
          return (
            <div key={item.code} className="exploration-group">
              <div className="exploration-item exploration-item--group">
                <button className="exploration-expand-btn" onClick={() => setExpandedCityGroups(prev => {
                  const s = new Set(prev);
                  if (s.has(item.code)) s.delete(item.code); else s.add(item.code);
                  return s;
                })}>{isExpanded ? '▾' : '▸'}</button>
                <span className="exploration-icon"></span>
                <span className="exploration-name">{item.name}</span>
                <span className="exploration-count">{item.airportCodes.length}{TEXTS.panel.airportAbbreviation}</span>
                {altTime && (
                  <button className="exploration-tz-btn" onClick={() => handleSwitchTimezone(item.airportCodes[0])}>{altTime}</button>
                )}
                <button className="exploration-remove-btn" onClick={() => removeAirportCodes(item.airportCodes)}>{UI_SYMBOLS.CLOSE}</button>
              </div>
              {isExpanded && item.childCities?.map(city =>
                city.airports.map(ap => (
                  <div key={ap.code} className="exploration-item exploration-item--child">
                    <span className="exploration-icon"></span>
                    <span className="exploration-name">{ap.name}</span>
                    <span className="exploration-code">({ap.code})</span>
                    <button className="exploration-remove-btn" onClick={() => removeExplorationItem(ap.id)}>{UI_SYMBOLS.CLOSE}</button>
                  </div>
                ))
              )}
            </div>
          );
        }

        if (item.kind === 'country-group') {
          const isExpanded = expandedCityGroups.has(item.code);
          // Determine TZ distribution: single TZ vs multiple
          const tzSet = new Set(item.airportCodes.map(c => airportTimezoneMap[c]).filter(Boolean));
          const hasSingleTZ = tzSet.size <= 1;
          const countryTzBtn = hasSingleTZ
            ? getAltTimeDisplay(item.airportCodes[0])
            : null;
          return (
            <div key={item.code} className="exploration-group">
              <div className="exploration-item exploration-item--group">
                <button className="exploration-expand-btn" onClick={() => setExpandedCityGroups(prev => {
                  const s = new Set(prev);
                  if (s.has(item.code)) s.delete(item.code); else s.add(item.code);
                  return s;
                })}>{isExpanded ? '▾' : '▸'}</button>
                <span className="exploration-icon"></span>
                <span className="exploration-name">{item.name}</span>
                <span className="exploration-count">{item.airportCodes.length}{TEXTS.panel.airportAbbreviation}</span>
                {countryTzBtn && (
                  <button className="exploration-tz-btn" title={TEXTS.panel.switchTimezone}
                    onClick={() => handleSwitchTimezone(item.airportCodes[0])}>{countryTzBtn}</button>
                )}
                <button className="exploration-remove-btn" onClick={() => removeAirportCodes(item.airportCodes)}>{UI_SYMBOLS.CLOSE}</button>
              </div>
              {isExpanded && item.childCities?.map(city => {
                const cityKey = `${item.code}:${city.cityCode}`;
                const isCityExpanded = expandedInnerCities.has(cityKey);
                const cityRepCode = city.airports[0]?.code;
                const cityTzBtn = !hasSingleTZ && cityRepCode ? getAltTimeDisplay(cityRepCode) : null;
                return (
                  <div key={city.cityCode} className="exploration-group exploration-group--nested">
                    <div className="exploration-item exploration-item--city-child">
                      <button className="exploration-expand-btn" onClick={() => setExpandedInnerCities(prev => {
                        const s = new Set(prev);
                        if (s.has(cityKey)) s.delete(cityKey); else s.add(cityKey);
                        return s;
                      })}>{isCityExpanded ? '▾' : '▸'}</button>
                      <span className="exploration-icon"></span>
                      <span className="exploration-name">{city.cityName}</span>
                      <span className="exploration-count">{city.airports.length}ap</span>
                      {cityTzBtn && cityRepCode && (
                        <button className="exploration-tz-btn" title={TEXTS.panel.switchTimezone}
                          onClick={() => handleSwitchTimezone(cityRepCode)}>{cityTzBtn}</button>
                      )}
                      <button className="exploration-remove-btn" onClick={() => removeAirportCodes(city.airports.map(a => a.code))}>{UI_SYMBOLS.CLOSE}</button>
                    </div>
                    {isCityExpanded && city.airports.map(ap => (
                      <div key={ap.code} className="exploration-item exploration-item--child">
                        <span className="exploration-icon"></span>
                        <span className="exploration-name">{ap.name}</span>
                        <span className="exploration-code">({ap.code})</span>
                        <button className="exploration-remove-btn" onClick={() => removeExplorationItem(ap.id)}>{UI_SYMBOLS.CLOSE}</button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        }

        return null;
      })}
    </div>
  );

  // ── Render trip mode airport section ──────────────────────────────────────
  const renderTripAirportSection = () => {
    if (!tripState || selectedItem.type !== 'airport') return null;
    return (
      <div className="trip-airports-section">
        <div className="trip-airports-list">
          {/* Original arrival airport – cannot be removed */}
          {(() => {
            const tzDisplay = getAltTimeDisplay(selectedItem.data.code);
            return (
              <div className="trip-airport-item trip-airport-item--original">
                <span className="exploration-icon"></span>
                <span className="exploration-name">{selectedItem.data.name}</span>
                <span className="exploration-code">({selectedItem.data.code})</span>
                {tzDisplay && (
                  <button className="exploration-tz-btn" title={TEXTS.panel.switchTimezone}
                    onClick={() => handleSwitchTimezone(selectedItem.data.code)}>{tzDisplay}</button>
                )}
              </div>
            );
          })()}
          {TEXTS.panel.transferAirports}
          {transferAirports.map(code => {
            const tzDisplay = getAltTimeDisplay(code);
            const feat = airportsData?.features.find(f => f.properties.code === code);
            const label = feat?.properties.name || code;
            return (
              <div key={code} className="trip-airport-item">
                <span className="exploration-icon"></span>
                <span className="exploration-name">{label}</span>
                <span className="exploration-code">({code})</span>
                {tzDisplay && (
                  <button className="exploration-tz-btn" title={TEXTS.panel.switchTimezone}
                    onClick={() => handleSwitchTimezone(code)}>{tzDisplay}</button>
                )}
                <button className="exploration-remove-btn" onClick={() => {
                  setTransferAirports(prev => prev.filter(c => c !== code));
                  if (selectedTimezoneAirportCode === code) {
                    setSelectedTimezoneOverride(null);
                    setSelectedTimezoneAirportCode(null);
                  }
                }}>{UI_SYMBOLS.CLOSE}</button>
              </div>
            );
          })}
        </div>
        {/* Inline search input — hidden when 6 airports already selected (1 original + 5 transfers) */}
        {transferAirports.length < CONFIG.MAX_TRANSFER_AIRPORTS && (
          <AirportTransferPicker
            currentAirport={selectedItem.data}
            inline
            preCheckedCodes={transferAirports}
            onSelectAirports={(newCodes) => {
              setTransferAirports(prev => {
                const combined = [...new Set([...prev, ...newCodes])];
                return combined.slice(0, CONFIG.MAX_TRANSFER_AIRPORTS);
              });
            }}
            onSelectAirport={(code) => {
              setTransferAirports(prev => {
                if (prev.includes(code) || prev.length >= CONFIG.MAX_TRANSFER_AIRPORTS) return prev;
                return [...prev, code];
              });
            }}
            onPreviewAirport={onPreviewAirport}
            onClearPreview={onClearPreview}
            maxSelect={CONFIG.MAX_TRANSFER_AIRPORTS - transferAirports.length}
          />
        )}
      </div>
    );
  };

  return (
    <div className="right-panel">
      <div className="panel-header">
        <div className="header-content">
          <h3>{TEXTS.panel.departureDate}</h3>
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
                    <div className="arrival-estimated-note">{TEXTS.card.estimated}</div>
                  )}
                  {isArrivalEstimated && (
                    <div className="arrival-estimated-tooltip">
                      {TEXTS.card.estimatedTooltip}
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
          <div className="pending-country-picker">
            <div className="pending-country-header">
              <span>{TEXTS.panel.addAirportsFrom}{pendingCountryPicker.name}</span>
              <button className="pending-country-close" onClick={onClearCountryPicker}>{UI_SYMBOLS.CLOSE}</button>
            </div>
            <div className="pending-country-content">
              {(() => {
                const hasMixedTZ = pendingCountryTzGroups.filter(g => g.tz !== CONFIG.UNKNOWN_TIMEZONE).length > 1;
                const alreadySelectedCodes = new Set(explorationItems.flatMap(i => i.airportCodes));
                const renderPendingCheckbox = (airport: { code: string; name: string }) => {
                  const alreadySelected = alreadySelectedCodes.has(airport.code);
                  const isPendingSelected = pendingSelectedAirports.includes(airport.code);
                  const isSelected = alreadySelected || isPendingSelected;
                  const canSelect = !alreadySelected && (isPendingSelected || pendingSelectedAirports.length < CONFIG.MAX_AIRPORTS);
                  return (
                    <label key={airport.code}
                      className={`country-airport-item ${isSelected ? 'selected' : ''} ${alreadySelected ? 'disabled locked' : !canSelect ? 'disabled' : ''}`}>
                      <input type="checkbox" checked={isSelected} disabled={alreadySelected || !canSelect}
                        onChange={() => {
                          if (alreadySelected) return;
                          setPendingSelectedAirports(prev =>
                            prev.includes(airport.code)
                              ? prev.filter(c => c !== airport.code)
                              : (prev.length < CONFIG.MAX_AIRPORTS ? [...prev, airport.code] : prev)
                          );
                        }} />
                      <span>{airport.name} ({airport.code})</span>
                    </label>
                  );
                };
                if (hasMixedTZ) {
                  return pendingCountryTzGroups.map(group => (
                    <div key={group.tz} className="country-tz-group">
                      {group.tz !== CONFIG.UNKNOWN_TIMEZONE && (
                        <div className="country-tz-header">
                          <span className="tz-offset">{group.utcLabel}</span>
                          <span className="tz-current-dt">{group.currentDateStr} · {group.currentTimeStr}</span>
                        </div>
                      )}
                      <div className="country-airports-flat-list">
                        {group.airports.map(renderPendingCheckbox)}
                      </div>
                    </div>
                  ));
                }
                return (
                  <div className="country-airports-flat-list">
                    {pendingCountryTzGroups.flatMap(g => g.airports).map(renderPendingCheckbox)}
                  </div>
                );
              })()}
            </div>
            {pendingSelectedAirports.length > 0 && (
              <button className="confirm-flights-btn" onClick={() => {
                const currentCodes = explorationItems.flatMap((i: any) => i.airportCodes as string[]);
                const willFill = pendingSelectedAirports.length >= CONFIG.MAX_AIRPORTS;
                if (willFill) clearExploration();
                const slotsLeft = CONFIG.MAX_AIRPORTS - (willFill ? 0 : currentCodes.length);
                const codesToAdd = pendingSelectedAirports.slice(0, slotsLeft);
                codesToAdd.forEach(code => {
                  const feat = airportsData?.features.find((f: any) => f.properties.code === code);
                  addExplorationItem(
                    { type: 'airport', code, name: feat?.properties.name || code, airportCodes: [code] },
                    viewMode
                  );
                });
                const allCodes = [
                  ...(willFill ? [] : currentCodes),
                  ...codesToAdd,
                ];
                onFitBounds?.(allCodes);
                onClearCountryPicker?.();
                setPendingSelectedAirports([]);
              }}>
                {TEXTS.panel.addCountAirports(Math.min(pendingSelectedAirports.length, CONFIG.MAX_AIRPORTS))}
              </button>
            )}
          </div>
        )}

        {/* ── Airport mode ──────────────────────────────────────── */}
        {selectedItem.type === 'airport' && (
          <>
            <div className="item-info">
              {tripState ? (
                renderTripAirportSection()
              ) : (
                explorationItems.length > 0 ? renderExplorationList() : (
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
              {explorationItems.length > 0 ? renderExplorationList() : (
                <div className="simplified-details">{getSimplifiedDetails()}</div>
              )}
              {loadingCityAirports && <div className="mode-loading">{TEXTS.panel.loadingAirports}</div>}
              {!loadingCityAirports && cityAirports.length === 0 && explorationItems.length === 0 && (
                <div className="mode-no-airports">{TEXTS.panel.noFlightableAirports}</div>
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

              {viewMode === 'airports' && (() => {
                const hasMixedTZ = countryTzGroups.filter(g => g.tz !== CONFIG.UNKNOWN_TIMEZONE).length > 1;
                const allCountryAirports = countryTzGroups.flatMap(g => g.airports);
                const renderAirportCheckbox = (airport: { code: string; name: string }) => {
                  const isSelected = selectedFlatAirports.some(a => a.code === airport.code);
                  const canSelect = isSelected || selectedFlatAirports.length < CONFIG.MAX_AIRPORTS;
                  return (
                    <label key={airport.code}
                      className={`country-airport-item ${isSelected ? 'selected' : ''} ${!canSelect ? 'disabled' : ''}`}>
                      <input type="checkbox" checked={isSelected} disabled={!canSelect}
                        onChange={() => handleCountryAirportToggle(airport)} />
                      <span>{airport.name} ({airport.code})</span>
                    </label>
                  );
                };
                return (
                  <div className="country-flat-airports">
                    <div className="country-mode-info">
                      {TEXTS.panel.selectAirportsMax(CONFIG.MAX_AIRPORTS)} {TEXTS.panel.selectedCount(selectedFlatAirports.length, CONFIG.MAX_AIRPORTS)}
                    </div>
                    {hasMixedTZ ? (
                      countryTzGroups.map(group => {
                        const relOffset = getCountryTzRelativeOffset(group.tz);
                        const isActive = group.tz === countryActiveTZ;
                        const hasSelected = selectedFlatAirports.some(a => group.airports.some(ga => ga.code === a.code));
                        return (
                          <div key={group.tz} className={`country-tz-group${isActive ? ' country-tz-group--active' : ''}`}>
                            {group.tz !== CONFIG.UNKNOWN_TIMEZONE && (
                              <div className="country-tz-header">
                                <span className="tz-offset">{group.utcLabel}</span>
                                <span className="tz-current-dt">{group.currentDateStr} · {group.currentTimeStr}</span>
                                {!isActive && hasSelected && relOffset && (
                                  <button className="tz-switch-btn" onClick={() => setCountryActiveTZ(group.tz)}>{relOffset}</button>
                                )}
                              </div>
                            )}
                            <div className="country-airports-flat-list">
                              {group.airports.map(renderAirportCheckbox)}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="country-airports-flat-list">
                        {allCountryAirports.map(renderAirportCheckbox)}
                      </div>
                    )}
                    {selectedFlatAirports.length > 0 && (
                      <button className="confirm-flights-btn" onClick={handleConfirmFlatAirports}>
                        {TEXTS.panel.loadFlightsFromCount(selectedFlatAirports.length)}
                      </button>
                    )}
                  </div>
                );
              })()}

              {viewMode === 'cities' && (
                <>
                  <div className="country-mode-info">
                    Select cities (max 6 airports total). Selected airports: {selectedCityAirportTotal} / {CONFIG.MAX_AIRPORTS}
                  </div>
                  {loadingCountry && <div className="mode-loading">{TEXTS.panel.loadingCities}</div>}
                  {!loadingCountry && countryCities.length > 0 && (
                    <div className="country-cities-list">
                      {countryCities.map(city => {
                        const airportCount = cityAirportCountMap[city.code] || 0;
                        if (airportCount === 0) return null;
                        const isSelected = selectedCities.some(c => c.code === city.code);
                        const wouldExceed = !isSelected && (selectedCityAirportTotal + airportCount > CONFIG.MAX_AIRPORTS);
                        return (
                          <label key={city.code}
                            className={`country-airport-item ${isSelected ? 'selected' : ''} ${wouldExceed ? 'disabled' : ''}`}>
                            <input type="checkbox" checked={isSelected}
                              onChange={() => {
                                setSelectedCities(prev => {
                                  if (prev.some(c => c.code === city.code)) return prev.filter(c => c.code !== city.code);
                                  if (wouldExceed) return prev;
                                  return [...prev, city];
                                });
                              }}
                              disabled={wouldExceed} />
                            <span>{city.name} <span className="airport-count-badge">({airportCount} airport{airportCount !== 1 ? 's' : ''})</span></span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {selectedCities.length > 0 && (
                    <button className="confirm-flights-btn" disabled={loadingConfirm} onClick={handleConfirmCities}>
                      {loadingConfirm ? TEXTS.panel.loadingFlights : `${TEXTS.panel.loadFlightsFromCount(selectedCities.length)} (${TEXTS.panel.selectedCount(selectedCityAirportTotal, CONFIG.MAX_AIRPORTS)})`}
                    </button>
                  )}
                </>
              )}
            </div>

            {!loadingCountry && selectedFlatAirports.length === 0 && selectedCities.length === 0 && (
              <div className="placeholder-message">
                <p>{TEXTS.panel.selectAirportsMax(CONFIG.MAX_AIRPORTS)}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default RightPanel;
