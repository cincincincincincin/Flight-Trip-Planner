import React, { useState, useMemo, memo, forwardRef } from 'react';
import type { Flight } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { useFlightOffersQuery } from '../hooks/queries';
import './FlightCard.css';

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
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  };

  const formatDate = (dateString: string, tz?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', ...(tz ? { timeZone: tz } : {}) });
  };

  // Compute origin timezone offset relative to display timezone (at departure time)
  const originTzOffsetHours = useMemo(() => {
    if (!displayTimezone || !airportTimezone || airportTimezone === displayTimezone) return null;
    const utcStr = flight.scheduled_departure_utc;
    if (!utcStr) return null;
    try {
      const d = new Date(utcStr);
      const getOffset = (tz: string) => {
        const s = d.toLocaleString('sv-SE', { timeZone: tz });
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
    return 'N/A';
  })();

  // Arrival time: always show in the destination airport's own local time.
  // scheduled_arrival_local is already stored in destination-local time.
  const arrTimeStr = (() => {
    if (flight.scheduled_arrival_local)
      return formatTime(flight.scheduled_arrival_local);
    if (flight.scheduled_arrival_utc && displayTimezone)
      return formatTime(flight.scheduled_arrival_utc, displayTimezone);
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
          .toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    const query = `${airlineName} ${origin} ${dest} ${date} one way`;
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
          <div className="airport-name">{flight.origin_city_name || 'Origin'}</div>
        </div>

        <div className="flight-path">
          <div className="path-line">→</div>
          {duration && <div className="duration">{duration}</div>}
        </div>

        <div className="airport destination">
          <div className="airport-code">{flight.destination_airport_code}</div>
          <div className="airport-name">{flight.destination_city_name || 'Destination'}</div>
        </div>
      </div>

      <div className="flight-times">
        <div className="times-row">
          <div className="time departure">
            <div className="time-label">Departure</div>
            <div className="time-value">{depTimeStr}</div>
            <div className="date-value">{depDateStr}</div>
          </div>
          {arrTimeStr && (
            <div className="time arrival">
              <div className="time-label">Arrival</div>
              <div className="time-value">
                {arrTimeStr}
                {tzLabel && (
                  <span className={`tz-diff ${(tzDiff ?? 0) > 0 ? 'positive' : 'negative'}`}>
                    ({tzLabel})
                  </span>
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
          {flight.departure_terminal && <span className="detail">Terminal: {flight.departure_terminal}</span>}
          {flight.departure_gate && <span className="detail">Gate: {flight.departure_gate}</span>}
        </div>
      )}

      <div className="flight-actions">
        {!hideAddToTrip && (
          <button className="add-to-trip-button" onClick={() => onAddToTrip?.(flight)}>
            + Add to trip
          </button>
        )}
        <div className="flight-actions-row">
          <a
            href={buildGoogleSearchUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="search-online-button"
          >
            Search online
          </a>
          <button
            className={`price-button ${showPrices ? 'active' : ''}`}
            onClick={() => setShowPrices(prev => !prev)}
            disabled={priceLoading}
          >
            {priceLoading ? 'Loading...' : showPrices ? 'Hide prices' : 'Show prices'}
          </button>
        </div>
      </div>

      {showPrices && (
        <div className="price-section">
          {priceLoading && <div className="price-loading">Loading prices...</div>}
          {priceError && <div className="price-error">Failed to load prices</div>}
          {noPricesAvailable && <div className="price-error">No prices available for this flight</div>}
          {priceData && (
            <div className="price-info">
              <div className="price-amount">
                <span className="currency">{priceData.currency}</span>
                <span className="amount">{priceData.price.toFixed(2)}</span>
              </div>
              {priceData.duration_to && (
                <>
                  <div className="price-detail">
                    Flight time: {Math.floor(priceData.duration_to / 60)}h {priceData.duration_to % 60}m
                  </div>
                  <div className="price-detail">
                    Est. arrival: {(() => {
                      const depTime = new Date(flight.scheduled_departure_utc ?? '');
                      const arrTime = new Date(depTime.getTime() + priceData.duration_to * 60000);
                      return arrTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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
                >
                  Book ticket
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default memo(FlightCard);
