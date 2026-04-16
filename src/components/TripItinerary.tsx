import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import FlightCard from './FlightCard';
import SaveTripButton from './auth/SaveTripButton';
import type { Flight } from '../types';
import { useTripStore } from '../stores/tripStore';
import { useAirportsQuery, useAirportInfosQuery, useAirportsMap, useAirportIndexes } from '../hooks/queries';
import { useSettingsStore } from '../stores/settingsStore';
import { useColorStore } from '../stores/colorStore';
import { getLocalizedProp } from '../utils/i18n';
import './TripItinerary.css';
import { useTexts } from '../hooks/useTexts';
import { CONFIG } from '../constants/config';
import { UI_SYMBOLS } from '../constants/ui';
import { haversineKm } from '../utils/math';
import { formatTime, formatDate, formatDurationMs, getDuration, getDurationMs, computeTzDiff, formatTzDiff } from '../utils/dateFormatting';

// Aliasy używane lokalnie w pliku
const formatTimeInTz = formatTime;
const formatDateInTz = formatDate;

/**
 * KOMPONENT PLANU PODRÓŻY
 * Wyświetla chronologiczną listę etapów podróży.
 */

interface TripItineraryProps {
  onUndo?: () => void;
  onRedo?: () => void;
  onEditTrip?: () => void;
  onClose?: () => void;
  showSaveButton?: boolean;
}

const TripItinerary: React.FC<TripItineraryProps> = ({ onUndo, onRedo, onEditTrip, onClose, showSaveButton }) => {
  const t = useTexts();
  const { tripState, undo, redo, pastTrips, futureTrips, isLoadedTrip, editMode } = useTripStore();
  const { namesMap, coordsMap, cityNamesMap } = useAirportIndexes();
  const {
    currency, language, minTransferHours, minManualTransferHours
  } = useSettingsStore();
  const { fcHighlightSoonBorder, fcHighlightSoonBg } = useColorStore();

  const allLegCodes = useMemo(() => {
    const legs = tripState?.legs ?? [];
    const codes = new Set<string>();
    legs.forEach(l => {
      if ((l as { type?: string }).type !== 'manual') {
        if (l.fromAirportCode) codes.add(l.fromAirportCode);
        if (l.toAirportCode) codes.add(l.toAirportCode);
      }
    });
    return Array.from(codes);
  }, [tripState]);

  const airportInfosResults = useAirportInfosQuery(allLegCodes);

  const airportTimezoneMap = useMemo(() => {
    const map: Record<string, string> = {};
    allLegCodes.forEach((code, i) => {
      const tz = airportInfosResults[i]?.data?.time_zone;
      if (tz) map[code] = tz;
    });
    return map;
  }, [allLegCodes, airportInfosResults]);

  /**
   * SZACOWANIE CZASU PRZYLOTU
   * Wyliczanie przybliżonego czasu lądowania na podstawie dystansu.
   */
  const estimateArrivalUTC = (depUtc: string, fromCode: string, toCode: string): string | null => {
    const from = coordsMap[fromCode];
    const to = coordsMap[toCode];
    if (!from || !to) return null;
    const distKm = haversineKm(from[0], from[1], to[0], to[1]);
    const blockHours = distKm / CONFIG.AVERAGE_AIRCRAFT_SPEED_KMH + CONFIG.ADDITIONAL_BLOCK_HOURS;
    const depMs = new Date(depUtc).getTime();
    if (isNaN(depMs)) return null;
    return new Date(depMs + blockHours * 3600000).toISOString();
  };

  const [hoveredFlight, setHoveredFlight] = useState<Flight | null>(null);
  const [isPopupExpanded, setIsPopupExpanded] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const [estimatedTooltipPos, setEstimatedTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // W trybie edycji: blokuj cofanie tylko jeśli ostatni etap już wystartował.
  // Etapy ręczne nie mają czasu startu, więc zawsze można je cofnąć.
  /**
   * LOGIKA COFANIA ZMIAN
   * Uniemożliwia cofnięcie lotu, który już wystartował.
   */
  const canUndoInEditMode = useMemo(() => {
    if (pastTrips.length === 0) return false;
    if (!editMode) return true;
    const currentLegs = tripState?.legs ?? [];
    if (currentLegs.length === 0) return false;
    const lastLeg = currentLegs[currentLegs.length - 1];
    const isManual = (lastLeg as { type?: string }).type === 'manual';
    if (isManual) return true; // Lotniska zmieniane ręcznie
    if (!lastLeg.flight?.scheduled_departure_utc) return true;
    return new Date(lastLeg.flight.scheduled_departure_utc).getTime() >= Date.now();
  }, [editMode, pastTrips.length, tripState]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!tripState && pastTrips.length === 0 && futureTrips.length === 0) return null;

  const legs = tripState?.legs || [];

  const showPopup = (e: React.MouseEvent<HTMLDivElement>, flight: Flight | undefined) => {
    if (!flight) return;
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    const legRect = e.currentTarget.getBoundingClientRect();
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const left = wrapperRect ? wrapperRect.right + CONFIG.POPUP_OFFSET : legRect.right + 8;
    const top = Math.min(legRect.top, window.innerHeight - CONFIG.POPUP_MAX_HEIGHT);
    setHoveredFlight(flight);
    setPopupPos({ top, left });
  };

  const scheduleHide = () => {
    hideTimerRef.current = setTimeout(() => {
      setHoveredFlight(null);
      setPopupPos(null);
      setIsPopupExpanded(false);
    }, 150);
  };

  const cancelHide = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  // Obliczanie zakończenia podróży
  const lastArrivalUTC = (() => {
    if (!tripState?.legs?.length) return null;
    for (let i = tripState.legs.length - 1; i >= 0; i--) {
      const leg = tripState.legs[i];
      if ((leg as { type?: string }).type !== 'manual' && leg.flight?.scheduled_arrival_utc) {
        return leg.flight.scheduled_arrival_utc;
      }
    }
    return null;
  })();
  const tripEnded = lastArrivalUTC ? new Date(lastArrivalUTC) < new Date() : false;
  const isViewMode = isLoadedTrip && !editMode;

  return (
    <div className="trip-itinerary-wrapper" ref={wrapperRef}>
      {/* Pasek akcji zawsze na górze */}
      <div className={`trip-itinerary-actions${legs.length > 0 ? ' trip-itinerary-actions--has-list' : ''}`}>
        {/* LEWO: Cofnij */}
        <button
          onClick={() => { undo(); onUndo?.(); }}
          disabled={editMode ? !canUndoInEditMode : pastTrips.length === 0}
          className="trip-action-btn trip-action-btn--undo"
          title={t.buttons.undo}
        >
          {UI_SYMBOLS.UNDO} {t.buttons.undo}
        </button>

        {/* ŚRODEK: Zamknij lub Zapisz */}
        <div className="trip-itinerary-middle">
          {isViewMode
            ? <button className="trip-action-btn trip-action-btn--close" onClick={onClose}>{UI_SYMBOLS.CLOSE} {t.buttons.close}</button>
            : showSaveButton && <SaveTripButton />
          }
        </div>

        {/* PRAWO: Edytuj lub Ponów */}
        {isViewMode ? (
          <button
            onClick={onEditTrip}
            disabled={tripEnded || !onEditTrip}
            className="trip-action-btn trip-action-btn--edit"
            title={tripEnded ? t.trip.tripEnded : t.trip.editTrip}
          >{t.buttons.edit}</button>
        ) : (
          <button
            onClick={() => { redo(); onRedo?.(); }}
            disabled={futureTrips.length === 0}
            className="trip-action-btn trip-action-btn--redo"
          >
            {t.buttons.redo} {UI_SYMBOLS.REDO}
          </button>
        )}
      </div>

      {legs.length > 0 && (
        <div className="trip-itinerary">
          {legs.map((leg, i) => {
            const isManual = leg.type === 'manual';
            const f = leg.flight;
            const depStr = f?.scheduled_departure_local || f?.scheduled_departure_utc;
            const arrStr = f?.scheduled_arrival_local || f?.scheduled_arrival_utc;
            const estimatedArrUTC = !arrStr && !isManual && f?.scheduled_departure_utc
              ? estimateArrivalUTC(f.scheduled_departure_utc, leg.fromAirportCode, leg.toAirportCode)
              : null;
            const isArrEstimated = !arrStr && !!estimatedArrUTC;
            const depTz = airportTimezoneMap[leg.fromAirportCode];
            const destTz = airportTimezoneMap[leg.toAirportCode];
            const tzDiff = (depTz && destTz && f?.scheduled_departure_utc)
              ? computeTzDiff(f.scheduled_departure_utc, depTz, destTz)
              : null;
            const duration = !isManual
              ? getDuration(f?.scheduled_departure_utc, f?.scheduled_arrival_utc ?? estimatedArrUTC ?? undefined)
              : null;

            // Logika przylotu dla czasów trwania
            const getBestArrivalUTC = (legItem: any) => {
              if (!legItem || legItem.type === 'manual') return null;
              if (legItem.flight?.scheduled_arrival_utc) return legItem.flight.scheduled_arrival_utc;
              return estimateArrivalUTC(legItem.flight?.scheduled_departure_utc, legItem.fromAirportCode, legItem.toAirportCode);
            };

            // CZAS W MIEŚCIE
            // Między lądowaniem a kolejnym startem.
            let timeAvailableMs: number | null = null;
            let timeAvailableCity: string | null = null;
            if (!isManual && i > 0) {
              const prevLeg = legs[i - 1];
              const prevArrUtc = getBestArrivalUTC(prevLeg);
              if (prevLeg.type !== 'manual' && prevArrUtc && f?.scheduled_departure_utc) {
                timeAvailableMs = getDurationMs(prevArrUtc, f.scheduled_departure_utc);
                timeAvailableCity = cityNamesMap[leg.fromAirportCode] ?? namesMap[leg.fromAirportCode] ?? leg.fromAirportCode;
              }
            }

            // CZAS NA PRZESIADKĘ
            // Przy samodzielnym przemieszczaniu się.
            let timeToTransferMs: number | null = null;
            if (isManual) {
              const lastRealLeg = legs.slice(0, i).reverse().find(l => l.type !== 'manual');
              const nextRealLeg = legs.slice(i + 1).find(l => l.type !== 'manual');
              const lastArrUtc = getBestArrivalUTC(lastRealLeg);
              if (lastArrUtc && nextRealLeg?.flight?.scheduled_departure_utc) {
                timeToTransferMs = getDurationMs(lastArrUtc, nextRealLeg.flight.scheduled_departure_utc);
              }
            }

            return (
              <React.Fragment key={i}>
                {timeAvailableMs !== null && timeAvailableCity && (() => {
                  const isShortStay = timeAvailableMs < minTransferHours * CONFIG.HOUR_IN_MS;
                  return (
                    <div
                      className={`trip-time-available ${isShortStay ? 'trip-duration-alert' : ''}`}
                      style={isShortStay ? {
                        '--alert-color': fcHighlightSoonBorder,
                        '--alert-bg': fcHighlightSoonBg
                      } as React.CSSProperties : {}}
                    >
                      {UI_SYMBOLS.CLOCK} {t.trip.timeInCity(timeAvailableCity)}: {formatDurationMs(timeAvailableMs)}
                    </div>
                  );
                })()}
                {isManual ? (
                  (() => {
                    const isShortTransfer = timeToTransferMs !== null && timeToTransferMs < (minTransferHours + minManualTransferHours) * CONFIG.HOUR_IN_MS;
                    return (
                      <div
                        className={`trip-time-transfer ${isShortTransfer ? 'trip-duration-alert' : ''}`}
                        style={isShortTransfer ? {
                          '--alert-color': fcHighlightSoonBorder,
                          '--alert-bg': fcHighlightSoonBg
                        } as React.CSSProperties : {}}
                      >
                        {t.trip.transfer}{timeToTransferMs !== null ? formatDurationMs(timeToTransferMs) : UI_SYMBOLS.DASH}
                      </div>
                    );
                  })()
                ) : (
                  <div
                    className="trip-leg"
                    onMouseEnter={(e) => showPopup(e, f)}
                    onMouseLeave={scheduleHide}
                  >
                    <div className="trip-leg-row">
                      <div className="trip-leg-airport">
                        <span className="trip-leg-code">{leg.fromAirportCode}</span>
                        {depStr && (
                          <span className="trip-leg-datetime">
                            <span className="trip-leg-date">{formatDate(depStr)}</span>
                            <span className="trip-leg-time">{formatTime(depStr)}</span>
                          </span>
                        )}
                      </div>

                      <div className="trip-leg-middle">
                        {duration && <span className="trip-leg-duration">{duration}</span>}
                      </div>

                      <div className="trip-leg-airport trip-leg-airport--dest">
                        <span className="trip-leg-code">{leg.toAirportCode}</span>
                        {(arrStr || (isArrEstimated && estimatedArrUTC && destTz)) && (
                          <span className="trip-leg-datetime">
                            <span className="trip-leg-date">
                              {arrStr
                                ? formatDate(arrStr)
                                : formatDateInTz(estimatedArrUTC!, destTz!)}
                            </span>
                            <span className="trip-leg-time-row">
                              {tzDiff !== null && tzDiff !== 0 && (
                                <span className={`trip-leg-tz-diff ${tzDiff > 0 ? 'positive' : 'negative'}`}>
                                  ({formatTzDiff(tzDiff)})
                                </span>
                              )}
                              {isArrEstimated ? (
                                <span
                                  className="trip-leg-time trip-leg-time--estimated"
                                  onMouseEnter={(e) => {
                                    const r = e.currentTarget.getBoundingClientRect();
                                    setEstimatedTooltipPos({ top: r.bottom + 4, left: r.left });
                                  }}
                                  onMouseLeave={() => setEstimatedTooltipPos(null)}
                                >
                                  {UI_SYMBOLS.ESTIMATED}{formatTimeInTz(estimatedArrUTC!, destTz!)}
                                </span>
                              ) : (
                                <span className="trip-leg-time">{formatTime(arrStr!)}</span>
                              )}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {estimatedTooltipPos && createPortal(
        <div
          className="trip-estimated-tooltip"
          style={{ top: estimatedTooltipPos.top, left: estimatedTooltipPos.left }}
        >
          {t.card.estimatedTooltip}
        </div>,
        document.body
      )}

      {hoveredFlight && popupPos && createPortal(
        <div
          className="trip-leg-popup"
          style={{ top: popupPos.top, left: popupPos.left }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <FlightCard
            key={hoveredFlight.flight_number}
            flight={hoveredFlight}
            hideAddToTrip={true}
            airportTimezone={airportTimezoneMap[hoveredFlight.origin_airport_code ?? '']}
            isExpanded={isPopupExpanded}
            onToggleExpand={() => setIsPopupExpanded(!isPopupExpanded)}
          />
        </div>,
        document.body
      )}
    </div>
  );
};

export default TripItinerary;
