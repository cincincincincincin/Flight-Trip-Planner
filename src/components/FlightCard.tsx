import React, { useState, useMemo, memo, forwardRef } from 'react';
import type { Flight } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useAirportsQuery, useAirportInfoQuery, useFlightOffersQuery, useAirportCoordsMap, useAirportNamesMap } from '../hooks/queries';
import './FlightCard.css';
import { useTexts } from '../hooks/useTexts';
import { CONFIG } from '../constants/config';
import { UI_SYMBOLS } from '../constants/ui';
import dayjs from '../lib/dayjs';
import { haversineKm } from '../utils/math';
import { formatTime, formatDate, getDuration, computeTzDiff, formatTzDiff } from '../utils/dateFormatting';

interface FlightCardProps {
  flight: Flight;
  tripHighlight?: string;
  onAddToTrip?: (flight: Flight) => void;
  hideAddToTrip?: boolean;
  displayTimezone?: string;   // wybrana strefa czasowa wyświetlania
  airportTimezone?: string;   // strefa czasowa lotniska wylotu
  isExpanded?: boolean;       // kontrolowane rozwijanie z rodzica
  onToggleExpand?: () => void;
  isAirportLoaded?: boolean;  // czy rozkład lotniska został w pełni załadowany
}

const FlightCard = forwardRef<HTMLDivElement, FlightCardProps>(({ flight, tripHighlight, onAddToTrip, hideAddToTrip = false, displayTimezone, airportTimezone, isExpanded = false, onToggleExpand, isAirportLoaded = true }, ref) => {
  const t = useTexts();
  const { currency, travelDate, language } = useSettingsStore();
  const isDeparted = useMemo(() => {
    if (!flight.scheduled_departure_utc) return false;
    return dayjs(flight.scheduled_departure_utc).isBefore(dayjs());
  }, [flight.scheduled_departure_utc]);

  const showPrices = isExpanded && !isDeparted; // kontrolowane przez rodzica, blokowane jeśli lot już się odbył

  /**
   * OPTYMALIZACJA WYDAJNOŚCI: O(N) -> O(1).
   * Korzystamy z globalnych, zmemoizowanych hooków, aby uniknąć redundancji
   * i zapewnić płynne renderowanie przy dużej liczbie kart.
   */
  const airportCoordsMap = useAirportCoordsMap();
  const airportCityNameMap = useAirportNamesMap();

  const offersParams = useMemo(() => ({
    departure_at: flight.scheduled_departure_local,
    currency,
    flight_number: flight.flight_number,
  }), [flight.scheduled_departure_local, flight.flight_number, currency]);

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

  // Serwer zwraca pojedynczą, najlepszą ofertę
  const priceData = offersResponse;

  // Parametry ceny

  // Oblicz przesunięcie strefy czasowej wylotu względem wybranej strefy wyświetlania
  const originTzOffsetHours = useMemo(() => {
    if (!displayTimezone || !airportTimezone || airportTimezone === displayTimezone) return null;
    return computeTzDiff(flight.scheduled_departure_utc ?? '', displayTimezone, airportTimezone);
  }, [flight.scheduled_departure_utc, displayTimezone, airportTimezone]);

  // Obliczanie czasu trwania oraz różnic stref czasowych - używamy centralnych narzędzi
  // aby uniknąć redundancji kodu i błędów w obliczeniach na krawędzi dni.
  const duration = getDuration(flight.scheduled_departure_utc ?? '', flight.scheduled_arrival_utc ?? '');

  const getUTCOffsetHours = (localStr: string, utcStr: string) => {
    if (!localStr || !utcStr) return null;
    const localAsUTC = new Date(localStr + 'Z');
    const utcDate = new Date(utcStr);
    if (isNaN(localAsUTC.getTime()) || isNaN(utcDate.getTime())) return null;
    return (localAsUTC.getTime() - utcDate.getTime()) / (1000 * 60 * 60);
  };

  // Czas wylotu: zawsze w lokalnej strefie czasowej lotniska wylotu.
  // Wykorzystuje konwersję UTC → lokalna strefa, jeśli dostępna.
  const depTimeStr = (() => {
    if (airportTimezone && flight.scheduled_departure_utc)
      return formatTime(flight.scheduled_departure_utc, airportTimezone);
    if (flight.scheduled_departure_local)
      return formatTime(flight.scheduled_departure_local);
    if (flight.scheduled_departure_utc && displayTimezone)
      return formatTime(flight.scheduled_departure_utc, displayTimezone);
    return t.card.na;
  })();

  const depTimeUTC = useMemo(() => {
    return flight.scheduled_departure_utc ? formatTime(flight.scheduled_departure_utc, 'UTC') : null;
  }, [flight.scheduled_departure_utc]);

  // Czas przylotu: zawsze w lokalnej strefie czasowej lotniska docelowego.
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
    const parts = [`${UI_SYMBOLS.ESTIMATED}${h}h`];
    if (m > 0) parts.push(`${m}m`);
    return parts.join(' ');
  }, [isArrivalEstimated, estimatedArrUTC, flight.scheduled_departure_utc]);

  const destTimezone = destAirportInfo?.time_zone ?? displayTimezone;

  const estimatedArrTzDiff = useMemo(() => {
    if (!isArrivalEstimated || !estimatedArrUTC || !airportTimezone || !destAirportInfo?.time_zone) return null;
    return computeTzDiff(flight.scheduled_departure_utc ?? '', airportTimezone, destAirportInfo.time_zone);
  }, [isArrivalEstimated, estimatedArrUTC, airportTimezone, destAirportInfo, flight.scheduled_departure_utc]);

  const arrTimeStr = (() => {
    if (flight.scheduled_arrival_local)
      return formatTime(flight.scheduled_arrival_local);
    if (flight.scheduled_arrival_utc && displayTimezone)
      return formatTime(flight.scheduled_arrival_utc, displayTimezone);
    if (estimatedArrUTC) {
      // Czekaj na strefę czasową docelową, aby uniknąć migotania błędnego czasu
      if (!destAirportInfo) return null;
      return formatTime(estimatedArrUTC, destTimezone);
    }
    return null;
  })();

  const depOffset = getUTCOffsetHours(flight.scheduled_departure_local ?? '', flight.scheduled_departure_utc ?? '');
  const arrOffset = getUTCOffsetHours(flight.scheduled_arrival_local ?? '', flight.scheduled_arrival_utc ?? '');
  // Pokazujemy różnicę stref czasowych między lotniskami
  const tzDiff = (depOffset !== null && arrOffset !== null) ? arrOffset - depOffset : null;
  const tzLabel = (tzDiff !== null && tzDiff !== 0) ? formatTzDiff(tzDiff) : null;

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
    const [year, month, day] = ((flight.scheduled_departure_utc?.slice(0, 10) ?? travelDate) || '').split('-');
    const date = year
      ? dayjs(`${year}-${month}-${day}`).format('MMMM D, YYYY')
      : '';
    const query = `${airlineName} ${origin} ${dest} ${date}${t.card.oneWay}`;
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  };

  const noPricesAvailable = showPrices && !priceLoading && !priceError && !priceData;

  return (
    <div 
      className={`flight-card${tripHighlight ? ` flight-card--trip-${tripHighlight}` : ''}`} 
      ref={ref}
    >
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
            {originTzOffsetHours !== null && originTzOffsetHours !== 0 && (
              <span className={`origin-tz-diff ${originTzOffsetHours > 0 ? 'positive' : 'negative'}`}>
                ({originTzOffsetHours > 0 ? '+' : ''}{Math.round(originTzOffsetHours)}h)
              </span>
            )}
          </div>
          <div className="airport-name">{airportCityNameMap[flight.origin_airport_code] || t.card.origin}</div>
        </div>

        <div className="flight-path"></div>

        <div className="airport destination">
          <div className="airport-code">{flight.destination_airport_code}</div>
          <div className="airport-name">{airportCityNameMap[flight.destination_airport_code] || t.card.destination}</div>
        </div>
      </div>

      <div className="flight-times">
        <div className="times-row">
          <div className="time departure">
            <div className="time-label">{t.card.departure}</div>
            <div className="time-value">
              {depTimeStr} 
              {depTimeUTC && <span className="utc-time">({depTimeUTC} UTC)</span>}
            </div>
            <div className="date-value">{depDateStr}</div>
          </div>
          {duration && <div className="time-duration">{duration}</div>}
          {!duration && estimatedDuration && (
            <div className="time-duration" style={{ position: 'relative', display: 'inline-flex' }}>
              <span className="arr-estimated-time">
                {estimatedDuration}
                <span className="arr-estimated-tooltip">
                  {t.card.estimatedTooltip}
                </span>
              </span>
            </div>
          )}
          {arrTimeStr && (
            <div className="time arrival">
              <div className="time-label">{t.card.arrival}</div>
              <div className="time-value">
                {isArrivalEstimated ? (
                  <>
                {estimatedArrTzDiff !== null && estimatedArrTzDiff !== 0 && (
                  <span className={`tz-diff ${estimatedArrTzDiff > 0 ? 'positive' : 'negative'}`}>
                    ({formatTzDiff(estimatedArrTzDiff)})
                  </span>
                )}
                    <span className="arr-estimated-wrapper">
                      <span className="arr-estimated-time">
                        {UI_SYMBOLS.ESTIMATED}{arrTimeStr}
                        <span className="arr-estimated-tooltip">
                          {t.card.estimatedTooltip}
                        </span>
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    {tzDiff !== null && tzDiff !== 0 && (
                      <span className={`tz-diff ${(tzDiff ?? 0) > 0 ? 'positive' : 'negative'}`}>
                        ({formatTzDiff(tzDiff)})
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
          {flight.departure_terminal && <span className="detail">{t.card.terminal} {flight.departure_terminal}</span>}
          {flight.departure_gate && <span className="detail">{t.card.gate} {flight.departure_gate}</span>}
        </div>
      )}

      <div className="flight-actions">
        {!hideAddToTrip && (
          <button 
            className={`add-to-trip-button${!isAirportLoaded ? ' loading' : ''}`} 
            onClick={() => isAirportLoaded && onAddToTrip?.(flight)}
            disabled={!isAirportLoaded}
          >
            {isAirportLoaded ? t.card.addTrip : t.flights.loading}
          </button>
        )}
        {!isDeparted && (
          <div className="flight-actions-row">
            <a
              href={buildGoogleSearchUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="search-online-button"
            >{t.card.searchOnline}</a>
            <button
              className={`price-button ${showPrices ? 'active' : ''}`}
              onClick={() => onToggleExpand?.()}
              disabled={priceLoading}
            >
              {priceLoading ? t.card.loading : showPrices ? t.card.hidePrices : t.card.showPrices}
            </button>
          </div>
        )}
      </div>

      {showPrices && (
        <div className="price-section">
          {priceLoading && <div className="price-loading">{t.card.loadingPrices}</div>}
          {priceError && <div className="price-error">{t.card.failedPrices}</div>}
          {noPricesAvailable && <div className="price-error">{t.card.noPrices}</div>}
          {priceData && (
            <div className="price-info">
              <div className="price-amount">
                <span className="currency">{priceData.currency}</span>
                <span className="amount">{priceData.price.toFixed(2)}</span>
              </div>
              {priceData.link && (
                <a
                  href={`https://www.aviasales.com${priceData.link}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="book-button"
                >{t.card.bookTicket}</a>
              )}
            </div>
          )}
          <div className="price-attribution">{t.card.ticketDataBy} <a href="https://www.aviasales.com" target="_blank" rel="noopener noreferrer" className="attribution-link">Aviasales</a></div>
        </div>
      )}
    </div>
  );
});

export default memo(FlightCard);
