import React, { useState, useMemo, memo, forwardRef } from 'react';
import type { Flight } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { useFlightOffersQuery, useAirportsQuery, useAirportInfoQuery } from '../hooks/queries';
import './FlightCard.css';
import { TEXTS } from '../constants/text';
import { CONFIG } from '../constants/config';
import { FORMAT_LOCALES, FORMAT_OPTIONS } from '../constants/format';
import { UI_SYMBOLS } from '../constants/ui';

const haversineKm = (lon1: number, lat1: number, lon2: number, lat2: number): number => {
  const R = CONFIG.EARTH_RADIUS_KM;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

interface FlightCardProps {
  flight: Flight;
  tripHighlight?: string;
  onAddToTrip?: (flight: Flight) => void;
  hideAddToTrip?: boolean;
  displayTimezone?: string;   // the selected display timezone
  airportTimezone?: string;   // the departure airport's own timezone
}

const FlightCard = forwardRef<HTMLDivElement, FlightCardProps>(({ flight, tripHighlight, onAddToTrip, hideAddToTrip = false, displayTimezone, airportTimezone }, ref) => {
  const { currency, travelDate } = useSettingsStore();
  const [showPrices, setShowPrices] = useState(false);
  const { data: airportsData } = useAirportsQuery();

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

  // Use the flight's actual departure date for price queries so that prices
  // shown in the TripItinerary popup match the stored flight, not the current
  // travelDate filter setting.
  const effectiveDate = useMemo(
    () => flight.scheduled_departure_utc?.slice(0, 10) ?? travelDate,
    [flight.scheduled_departure_utc, travelDate],
  );

  const offersParams = useMemo(() => ({
    departure_date: effectiveDate,
    currency,
  }), [effectiveDate, currency]);

  const {
    data: offersResponse,
    isFetching: priceLoading,
    isError: priceError,
  } = useFlightOffersQuery(
    flight.origin_airport_code,
    flight.destination_airport_code,
    offersParams,
    showPrices,
  );

  const priceData = useMemo(() => {
    if (!offersResponse?.success || !offersResponse.data?.length) return null;
    const flightTime = new Date(flight.scheduled_departure_utc ?? '');
    let best = offersResponse.data[0];
    let minDiff = Math.abs(new Date(best.departure_at).getTime() - flightTime.getTime());
    for (const offer of offersResponse.data) {
      const diff = Math.abs(new Date(offer.departure_at).getTime() - flightTime.getTime());
      if (diff < minDiff) { minDiff = diff; best = offer; }
    }
    return best;
  }, [offersResponse, flight.scheduled_departure_utc]);

  const formatTime = (dateString: string, tz?: string) => {
    if (!dateString) return TEXTS.card.na;
    return new Date(dateString).toLocaleTimeString(FORMAT_LOCALES.GB, { ...FORMAT_OPTIONS.TIME_24H, ...(tz ? { timeZone: tz } : {}) });
  };

  const formatDate = (dateString: string, tz?: string) => {
    if (!dateString) return TEXTS.card.na;
    return new Date(dateString).toLocaleDateString(FORMAT_LOCALES.GB, { ...FORMAT_OPTIONS.DATE_SHORT, ...(tz ? { timeZone: tz } : {}) });
  };

  // Compute origin timezone offset relative to display timezone (at departure time)
  const originTzOffsetHours = useMemo(() => {
    if (!displayTimezone || !airportTimezone || airportTimezone === displayTimezone) return null;
    const utcStr = flight.scheduled_departure_utc;
    if (!utcStr) return null;
    try {
      const d = new Date(utcStr);
      const getOffset = (tz: string) => {
        const s = d.toLocaleString(FORMAT_LOCALES.SE, { timeZone: tz });
        const [datePart, timePart] = s.split(' ');
        const [y, mo, day2] = datePart.split('-').map(Number);
        const [h, mi, sec] = timePart.split(':').map(Number);
        return (Date.UTC(y, mo - 1, day2, h, mi, sec) - d.getTime()) / 3600000;
      };
      const offset = getOffset(airportTimezone) - getOffset(displayTimezone);
      // Don't show badge if offsets are effectively equal (same UTC offset, different IANA name)
      return Math.abs(offset) < 0.1 ? null : offset;
    } catch { return null; }
  }, [flight.scheduled_departure_utc, displayTimezone, airportTimezone]);

  const calculateDuration = (departure: string, arrival: string) => {
    if (!departure || !arrival) return null;
    const diff = new Date(arrival).getTime() - new Date(departure).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const duration = calculateDuration(flight.scheduled_departure_utc ?? '', flight.scheduled_arrival_utc ?? '');

  const getUTCOffsetHours = (localStr: string, utcStr: string) => {
    if (!localStr || !utcStr) return null;
    const localAsUTC = new Date(localStr + 'Z');
    const utcDate = new Date(utcStr);
    if (isNaN(localAsUTC.getTime()) || isNaN(utcDate.getTime())) return null;
    return (localAsUTC.getTime() - utcDate.getTime()) / (1000 * 60 * 60);
  };

  const formatTzDiff = (diff: number) => {
    if (diff === 0) return null;
    const sign = diff > 0 ? '+' : '-';
    const abs = Math.abs(diff);
    const hours = Math.floor(abs);
    const mins = Math.round((abs - hours) * 60);
    return mins > 0 ? `${sign}${hours}.${mins}h` : `${sign}${hours}h`;
  };

  // Departure time: always show in the departure airport's own local timezone.
  // Uses UTC → airportTimezone conversion when available; falls back to the local string
  // (which is already in the airport's local time) or the display timezone.
  const depTimeStr = (() => {
    if (airportTimezone && flight.scheduled_departure_utc)
      return formatTime(flight.scheduled_departure_utc, airportTimezone);
    if (flight.scheduled_departure_local)
      return formatTime(flight.scheduled_departure_local);
    if (flight.scheduled_departure_utc && displayTimezone)
      return formatTime(flight.scheduled_departure_utc, displayTimezone);
    return TEXTS.card.na;
  })();

  // Arrival time: always show in the destination airport's own local time.
  // scheduled_arrival_local is already stored in destination-local time.
  const { data: destAirportInfo } = useAirportInfoQuery(flight.destination_airport_code ?? null);

  const estimatedArrUTC = useMemo(() => {
    if (flight.scheduled_arrival_local || flight.scheduled_arrival_utc) return null;
    if (!flight.scheduled_departure_utc) return null;
    const from = airportCoordsMap[flight.origin_airport_code ?? ''];
    const to = airportCoordsMap[flight.destination_airport_code ?? ''];
    if (!from || !to) return null;
    const distKm = haversineKm(from[0], from[1], to[0], to[1]);
    const blockHours = distKm / CONFIG.AVERAGE_AIRCRAFT_SPEED_KMH + CONFIG.ADDITIONAL_BLOCK_HOURS;
    const depMs = new Date(flight.scheduled_departure_utc).getTime();
    if (isNaN(depMs)) return null;
    return new Date(depMs + blockHours * 3600000).toISOString();
  }, [flight.scheduled_arrival_local, flight.scheduled_arrival_utc, flight.scheduled_departure_utc, flight.origin_airport_code, flight.destination_airport_code, airportCoordsMap]);

  const isArrivalEstimated = !flight.scheduled_arrival_local && !flight.scheduled_arrival_utc && !!estimatedArrUTC;

  const estimatedDuration = useMemo(() => {
    if (!isArrivalEstimated || !estimatedArrUTC || !flight.scheduled_departure_utc) return null;
    const diff = new Date(estimatedArrUTC).getTime() - new Date(flight.scheduled_departure_utc).getTime();
    if (diff <= 0) return null;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${UI_SYMBOLS.ESTIMATED}${h}h ${m}m`;
  }, [isArrivalEstimated, estimatedArrUTC, flight.scheduled_departure_utc]);

  const destTimezone = destAirportInfo?.time_zone ?? displayTimezone;

  const estimatedArrTzDiff = useMemo(() => {
    if (!isArrivalEstimated || !estimatedArrUTC || !airportTimezone || !destAirportInfo?.time_zone) return null;
    if (airportTimezone === destAirportInfo.time_zone) return null;
    const d = new Date(flight.scheduled_departure_utc ?? '');
    if (isNaN(d.getTime())) return null;
    try {
      const getOff = (tz: string) => {
        const s = d.toLocaleString(FORMAT_LOCALES.SE, { timeZone: tz });
        const [datePart, timePart] = s.split(' ');
        const [y, mo, day] = datePart.split('-').map(Number);
        const [h, mi, sec] = timePart.split(':').map(Number);
        return (Date.UTC(y, mo - 1, day, h, mi, sec) - d.getTime()) / 3600000;
      };
      const diff = getOff(destAirportInfo.time_zone) - getOff(airportTimezone);
      return Math.abs(diff) < 0.1 ? null : diff;
    } catch { return null; }
  }, [isArrivalEstimated, estimatedArrUTC, airportTimezone, destAirportInfo, flight.scheduled_departure_utc]);

  const arrTimeStr = (() => {
    if (flight.scheduled_arrival_local)
      return formatTime(flight.scheduled_arrival_local);
    if (flight.scheduled_arrival_utc && displayTimezone)
      return formatTime(flight.scheduled_arrival_utc, displayTimezone);
    if (estimatedArrUTC) {
      // Wait for destination timezone before showing to avoid flickering wrong time
      if (!destAirportInfo) return null;
      return formatTime(estimatedArrUTC, destTimezone);
    }
    return null;
  })();

  const depOffset = getUTCOffsetHours(flight.scheduled_departure_local ?? '', flight.scheduled_departure_utc ?? '');
  const arrOffset = getUTCOffsetHours(flight.scheduled_arrival_local ?? '', flight.scheduled_arrival_utc ?? '');
  // Always show the timezone difference between dep and arr airports so the user can
  // reconcile "4h flight but only 2h time difference" etc.
  const tzDiff = (depOffset !== null && arrOffset !== null) ? arrOffset - depOffset : null;
  const tzLabel = tzDiff !== null ? formatTzDiff(tzDiff) : null;

  const depDateStr = (() => {
    if (airportTimezone && flight.scheduled_departure_utc)
      return formatDate(flight.scheduled_departure_utc, airportTimezone);
    if (flight.scheduled_departure_local)
      return formatDate(flight.scheduled_departure_local);
    if (flight.scheduled_departure_utc && displayTimezone)
      return formatDate(flight.scheduled_departure_utc, displayTimezone);
    return null;
  })();

  const arrDateStr = (() => {
    if (flight.scheduled_arrival_local)
      return formatDate(flight.scheduled_arrival_local);
    if (flight.scheduled_arrival_utc && displayTimezone)
      return formatDate(flight.scheduled_arrival_utc, displayTimezone);
    if (estimatedArrUTC) {
      if (!destAirportInfo) return null;
      return formatDate(estimatedArrUTC, destTimezone);
    }
    return null;
  })();

  const isDifferentDay = arrDateStr && depDateStr && arrDateStr !== depDateStr;

  const buildGoogleSearchUrl = () => {
    const airlineName = flight.airline_name || flight.airline_code || '';
    const origin = (flight.origin_airport_code || '').toLowerCase();
    const dest = (flight.destination_airport_code || '').toLowerCase();
    const [year, month, day] = (effectiveDate || '').split('-');
    const date = year
      ? new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
          .toLocaleDateString(FORMAT_LOCALES.US, FORMAT_OPTIONS.DATE_LONG_YEAR)
      : '';
    const query = `${airlineName} ${origin} ${dest} ${date}${TEXTS.card.oneWay}`;
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  };

  const noPricesAvailable = showPrices && !priceLoading && !priceError && !priceData;

  return (
    <div className={`flight-card${tripHighlight ? ` flight-card--trip-${tripHighlight}` : ''}`} ref={ref}>
      <div className="flight-header">
        <div className="flight-number">
          <span className="number">{flight.flight_number}</span>
        </div>
        {flight.airline_name && <div className="airline-name">{flight.airline_name}</div>}
      </div>

      <div className="flight-route">
        <div className="airport origin">
          <div className="airport-code">
            {flight.origin_airport_code}
            {originTzOffsetHours !== null && (
              <span className={`origin-tz-diff ${originTzOffsetHours > 0 ? 'positive' : 'negative'}`}>
                ({originTzOffsetHours > 0 ? '+' : ''}{Math.round(originTzOffsetHours)}h)
              </span>
            )}
          </div>
          <div className="airport-name">{flight.origin_city_name || TEXTS.card.origin}</div>
        </div>

        <div className="flight-path"></div>

        <div className="airport destination">
          <div className="airport-code">{flight.destination_airport_code}</div>
          <div className="airport-name">{flight.destination_city_name || TEXTS.card.destination}</div>
        </div>
      </div>

      <div className="flight-times">
        <div className="times-row">
          <div className="time departure">
            <div className="time-label">{TEXTS.card.departure}</div>
            <div className="time-value">{depTimeStr}</div>
            <div className="date-value">{depDateStr}</div>
          </div>
          {duration && <div className="time-duration">{duration}</div>}
          {!duration && estimatedDuration && (
            <div className="time-duration" style={{ position: 'relative', display: 'inline-flex' }}>
              <span className="arr-estimated-time">
                {estimatedDuration}
                <span className="arr-estimated-tooltip">
                  {TEXTS.card.estimatedTooltip}
                </span>
              </span>
            </div>
          )}
          {arrTimeStr && (
            <div className="time arrival">
              <div className="time-label">{TEXTS.card.arrival}</div>
              <div className="time-value">
                {isArrivalEstimated ? (
                  <>
                    {estimatedArrTzDiff !== null && (
                      <span className={`tz-diff ${estimatedArrTzDiff > 0 ? 'positive' : 'negative'}`}>
                        ({formatTzDiff(estimatedArrTzDiff)})
                      </span>
                    )}
                    <span className="arr-estimated-wrapper">
                      <span className="arr-estimated-time">
                        {UI_SYMBOLS.ESTIMATED}{arrTimeStr}
                        <span className="arr-estimated-tooltip">
                          {TEXTS.card.estimatedTooltip}
                        </span>
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    {tzLabel && (
                      <span className={`tz-diff ${(tzDiff ?? 0) > 0 ? 'positive' : 'negative'}`}>
                        ({tzLabel})
                      </span>
                    )}
                    {arrTimeStr}
                  </>
                )}
              </div>
              <div className={`date-value${isDifferentDay ? ' different-day' : ''}`}>
                {arrDateStr}
              </div>
            </div>
          )}
        </div>
      </div>

      {(flight.departure_terminal || flight.departure_gate) && (
        <div className="flight-details">
          {flight.departure_terminal && <span className="detail">{TEXTS.card.terminal} {flight.departure_terminal}</span>}
          {flight.departure_gate && <span className="detail">{TEXTS.card.gate} {flight.departure_gate}</span>}
        </div>
      )}

      <div className="flight-actions">
        {!hideAddToTrip && (
          <button className="add-to-trip-button" onClick={() => onAddToTrip?.(flight)}>
            {TEXTS.card.addTrip}
          </button>
        )}
        <div className="flight-actions-row">
          <a
            href={buildGoogleSearchUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="search-online-button"
          >{TEXTS.card.searchOnline}</a>
          <button
            className={`price-button ${showPrices ? 'active' : ''}`}
            onClick={() => setShowPrices(prev => !prev)}
            disabled={priceLoading}
          >
            {priceLoading ? TEXTS.card.loading : showPrices ? TEXTS.card.hidePrices : TEXTS.card.showPrices}
          </button>
        </div>
      </div>

      {showPrices && (
        <div className="price-section">
          {priceLoading && <div className="price-loading">{TEXTS.card.loadingPrices}</div>}
          {priceError && <div className="price-error">{TEXTS.card.failedPrices}</div>}
          {noPricesAvailable && <div className="price-error">{TEXTS.card.noPrices}</div>}
          {priceData && (
            <div className="price-info">
              <div className="price-amount">
                <span className="currency">{priceData.currency}</span>
                <span className="amount">{priceData.price.toFixed(2)}</span>
              </div>
              {priceData.duration_to && (
                <>
                  <div className="price-detail">
                    {TEXTS.card.flightTime} {Math.floor(priceData.duration_to / 60)}h {priceData.duration_to % 60}m
                  </div>
                  <div className="price-detail">
                    {TEXTS.card.estArrival} {(() => {
                      const depTime = new Date(flight.scheduled_departure_utc ?? '');
                      const arrTime = new Date(depTime.getTime() + priceData.duration_to * 60000);
                      return arrTime.toLocaleTimeString(FORMAT_LOCALES.GB, FORMAT_OPTIONS.TIME_24H);
                    })()}
                  </div>
                </>
              )}
              {priceData.link && (
                <a
                  href={`https://www.aviasales.com${priceData.link}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="book-button"
                >{TEXTS.card.bookTicket}</a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default memo(FlightCard);
