import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import FlightCard from './FlightCard';
import SaveTripButton from './auth/SaveTripButton';
import type { Flight } from '../types';
import { useTripStore } from '../stores/tripStore';
import { useAirportsQuery } from '../hooks/queries';
import './TripItinerary.css';

const formatTime = (str: string | null | undefined): string => {
  if (!str) return '—';
  return new Date(str).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (str: string | null | undefined): string => {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

const formatDurationMs = (ms: number): string => {
  const totalMinutes = Math.floor(ms / 60000);
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
};

const getDuration = (dep: string | undefined, arr: string | undefined): string | null => {
  if (!dep || !arr) return null;
  const diff = new Date(arr).getTime() - new Date(dep).getTime();
  if (diff <= 0) return null;
  return formatDurationMs(diff);
};

const getDurationMs = (from: string | undefined, to: string | undefined): number | null => {
  if (!from || !to) return null;
  const diff = new Date(to).getTime() - new Date(from).getTime();
  return diff > 0 ? diff : null;
};

const haversineKm = (lon1: number, lat1: number, lon2: number, lat2: number): number => {
  const R = 6371;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

interface TripItineraryProps {
  onUndo?: () => void;
  onRedo?: () => void;
  onEditTrip?: () => void;
  onClose?: () => void;
  showSaveButton?: boolean;
}

const TripItinerary: React.FC<TripItineraryProps> = ({ onUndo, onRedo, onEditTrip, onClose, showSaveButton }) => {
  const { tripState, undo, redo, pastTrips, futureTrips, isLoadedTrip, editMode } = useTripStore();
  const { data: airportsData } = useAirportsQuery();

  const airportCityNameMap = useMemo<Record<string, string>>(() => {
    if (!airportsData) return {};
    const map: Record<string, string> = {};
    airportsData.features.forEach(f => {
      if (f.properties.code) map[f.properties.code] = f.properties.city_name || f.properties.name || f.properties.code;
    });
    return map;
  }, [airportsData]);

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

  const estimateArrivalUTC = (depUtc: string, fromCode: string, toCode: string): string | null => {
    const from = airportCoordsMap[fromCode];
    const to = airportCoordsMap[toCode];
    if (!from || !to) return null;
    const distKm = haversineKm(from[0], from[1], to[0], to[1]);
    const blockHours = distKm / 850 + 0.5;
    const depMs = new Date(depUtc).getTime();
    if (isNaN(depMs)) return null;
    return new Date(depMs + blockHours * 3600000).toISOString();
  };

  const [hoveredFlight, setHoveredFlight] = useState<Flight | null>(null);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const [estimatedTooltipPos, setEstimatedTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // In edit mode: block undo only if the last leg has already departed (real flight, past departure).
  // Manual legs have no departure time so they can always be undone.
  // Must be declared before any early return to satisfy Rules of Hooks.
  const canUndoInEditMode = useMemo(() => {
    if (pastTrips.length === 0) return false;
    if (!editMode) return true;
    const currentLegs = tripState?.legs ?? [];
    if (currentLegs.length === 0) return false;
    const lastLeg = currentLegs[currentLegs.length - 1];
    const isManual = (lastLeg as { type?: string }).type === 'manual';
    if (isManual) return true; // manual legs have no departure time — always undoable
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
    const left = wrapperRect ? wrapperRect.right + 8 : legRect.right + 8;
    const top = Math.min(legRect.top, window.innerHeight - 480);
    setHoveredFlight(flight);
    setPopupPos({ top, left });
  };

  const scheduleHide = () => {
    hideTimerRef.current = setTimeout(() => {
      setHoveredFlight(null);
      setPopupPos(null);
    }, 150);
  };

  const cancelHide = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  // Compute tripEnded for view mode
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
      {/* Actions bar — always on top */}
      <div className={`trip-itinerary-actions${legs.length > 0 ? ' trip-itinerary-actions--has-list' : ''}`}>
        {/* LEFT: Undo (disabled in view mode since pastTrips=[]) */}
        <button
          onClick={() => { undo(); onUndo?.(); }}
          disabled={editMode ? !canUndoInEditMode : pastTrips.length === 0}
          className="trip-action-btn trip-action-btn--undo"
          title="Undo"
        >
          ↩ Undo
        </button>

        {/* MIDDLE: Close (view mode) or Save/Update (edit/normal mode) */}
        <div className="trip-itinerary-middle">
          {isViewMode
            ? <button className="trip-action-btn trip-action-btn--close" onClick={onClose}>✕ Close</button>
            : showSaveButton && <SaveTripButton />
          }
        </div>

        {/* RIGHT: Edit (view mode) or Redo (edit/normal mode) */}
        {isViewMode ? (
          <button
            onClick={onEditTrip}
            disabled={tripEnded || !onEditTrip}
            className="trip-action-btn trip-action-btn--edit"
            title={tripEnded ? 'Trip has already ended' : 'Edit this trip'}
          >
            Edit
          </button>
        ) : (
          <button
            onClick={() => { redo(); onRedo?.(); }}
            disabled={futureTrips.length === 0}
            className="trip-action-btn trip-action-btn--redo"
          >
            Redo ↪
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
            const displayArrStr = arrStr || estimatedArrUTC;
            const isArrEstimated = !arrStr && !!estimatedArrUTC;
            const duration = !isManual
              ? getDuration(f?.scheduled_departure_utc, f?.scheduled_arrival_utc ?? estimatedArrUTC ?? undefined)
              : null;

            // "time available in: city" between two consecutive flight legs (no manual between them)
            let timeAvailableMs: number | null = null;
            let timeAvailableCity: string | null = null;
            if (!isManual && i > 0) {
              const prevLeg = legs[i - 1];
              if ((prevLeg as { type?: string }).type !== 'manual' && prevLeg.flight?.scheduled_arrival_utc && f?.scheduled_departure_utc) {
                timeAvailableMs = getDurationMs(prevLeg.flight.scheduled_arrival_utc, f.scheduled_departure_utc);
                timeAvailableCity = airportCityNameMap[leg.fromAirportCode] ?? leg.fromAirportCode;
              }
            }

            // "time to transfer" for manual legs
            let timeToTransferMs: number | null = null;
            if (isManual) {
              const lastRealLegBeforeManual = legs.slice(0, i).reverse().find(l => (l as { type?: string }).type !== 'manual');
              const nextRealLeg = legs.slice(i + 1).find(l => (l as { type?: string }).type !== 'manual');
              if (lastRealLegBeforeManual?.flight?.scheduled_arrival_utc && nextRealLeg?.flight?.scheduled_departure_utc) {
                timeToTransferMs = getDurationMs(lastRealLegBeforeManual.flight.scheduled_arrival_utc, nextRealLeg.flight.scheduled_departure_utc);
              }
            }

            return (
              <React.Fragment key={i}>
                {timeAvailableMs !== null && timeAvailableCity && (
                  <div className="trip-time-available">
                    ⏱ Time in {timeAvailableCity}: {formatDurationMs(timeAvailableMs)}
                  </div>
                )}
                {isManual ? (
                  <div className="trip-time-transfer">
                    Transfer: {timeToTransferMs !== null ? formatDurationMs(timeToTransferMs) : '—'}
                  </div>
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
                        {displayArrStr && (
                          <span className="trip-leg-datetime">
                            <span className="trip-leg-date">{formatDate(displayArrStr)}</span>
                            <span
                              className={`trip-leg-time${isArrEstimated ? ' trip-leg-time--estimated' : ''}`}
                              onMouseEnter={isArrEstimated ? (e) => {
                                const r = e.currentTarget.getBoundingClientRect();
                                setEstimatedTooltipPos({ top: r.bottom + 4, left: r.left });
                              } : undefined}
                              onMouseLeave={isArrEstimated ? () => setEstimatedTooltipPos(null) : undefined}
                            >
                              {formatTime(displayArrStr)}
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
          Estimated arrival — calculated from flight distance and average aircraft speed (~850 km/h)
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
          />
        </div>,
        document.body
      )}
    </div>
  );
};

export default TripItinerary;
