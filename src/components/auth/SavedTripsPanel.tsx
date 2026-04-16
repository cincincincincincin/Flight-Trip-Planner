import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTrips, deleteTrip, updateTrip } from '../../api/trips';
import type { SavedTrip } from '../../api/trips';
import { useTripStore } from '../../stores/tripStore';
import { useAirportsQuery } from '../../hooks/queries';
import TripNameModal from '../TripNameModal';
import ConfirmDeleteModal from '../ConfirmDeleteModal';
import './SavedTripsPanel.css';
import { useTexts } from '../../hooks/useTexts';
import { UI_SYMBOLS } from '../../constants/ui';
import dayjs from '../../lib/dayjs';

interface SavedTripsPanelProps {
  onClose: () => void;
  onTripLoaded?: (trip: SavedTrip) => void;
}

const SavedTripsPanel: React.FC<SavedTripsPanelProps> = ({ onClose, onTripLoaded }) => {
  const t = useTexts();
  const qc = useQueryClient();
  const { updateTrip: updateTripStore } = useTripStore();

  const [renamingTrip, setRenamingTrip] = useState<SavedTrip | null>(null);
  const [deletingTrip, setDeletingTrip] = useState<SavedTrip | null>(null);

  const { data: airportsData } = useAirportsQuery();

  const airportCountryMap = useMemo<Record<string, string>>(() => {
    if (!airportsData) return {};
    const map: Record<string, string> = {};
    airportsData.features.forEach(f => {
      if (f.properties.code && f.properties.country_code) {
        map[f.properties.code] = f.properties.country_code;
      }
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

  const getTripMeta = (trip: SavedTrip) => {
    const { trip_state } = trip;
    // Odwiedzone kraje
    const countries = new Set<string>();
    if (trip_state.startAirport?.country_code) countries.add(trip_state.startAirport.country_code);
    trip_state.legs.forEach(leg => {
      const cc = airportCountryMap[leg.toAirportCode];
      if (cc) countries.add(cc);
    });
    // Zakres dat
    let dateRange = '';
    if (trip_state.legs.length > 0) {
      const firstLeg = trip_state.legs[0];
      const lastLeg = trip_state.legs[trip_state.legs.length - 1];
      if (firstLeg.flight?.scheduled_departure_utc && lastLeg.flight?.scheduled_arrival_utc) {
        const start = dayjs(firstLeg.flight.scheduled_departure_utc).format('DD/MM/YYYY');
        const end = dayjs(lastLeg.flight.scheduled_arrival_utc).format('DD/MM/YYYY');
        dateRange = `${start} - ${end}`;
      }
    }

    return {
      countriesCount: countries.size,
      dateRange
    };
  };

  const { data: trips, isLoading, isError } = useQuery({
    queryKey: ['user-trips'],
    queryFn: fetchTrips,
    staleTime: 60000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTrip,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-trips'] });
      setDeletingTrip(null);
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ trip, name }: { trip: SavedTrip; name: string }) =>
      updateTrip(trip.id, { name, trip_state: trip.trip_state }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-trips'] });
      setRenamingTrip(null);
    },
  });

  const handleLoad = (trip: SavedTrip) => {
    // Obliczamy trasy w locie
    const calculatedRoutes: any[] = [];
    if (trip.trip_state.startAirport?.code && trip.trip_state.legs) {
      let currentAirportCode = trip.trip_state.startAirport.code;
      trip.trip_state.legs.forEach(leg => {
        const fromCoord = airportCoordsMap[currentAirportCode];
        const toCoord = airportCoordsMap[leg.toAirportCode];
        if (fromCoord && toCoord) {
          calculatedRoutes.push({ from: fromCoord, to: toCoord });
        }
        currentAirportCode = leg.toAirportCode;
      });
    }

    updateTripStore({
      tripState: trip.trip_state,
      tripRoutes: calculatedRoutes,
      savedTripId: trip.id,
      savedTripStateJSON: JSON.stringify(trip.trip_state),
      isLoadedTrip: true,
      editMode: false,
      pastTrips: [],
      futureTrips: [],
    });

    onTripLoaded?.(trip);
    onClose();
  };

  const handleRenameConfirm = (name: string) => {
    if (!renamingTrip) return;
    const autoName = t.savedTrips.tripId(renamingTrip.id);
    renameMutation.mutate({ trip: renamingTrip, name: name || autoName });
  };

  const handleDeleteConfirm = () => {
    if (!deletingTrip) return;
    deleteMutation.mutate(deletingTrip.id);
  };

  return (
    <>
      <div className="saved-trips-panel">
        <div className="saved-trips-panel__header">
          <h3>{t.savedTrips.title}</h3>
          <button onClick={onClose}>{UI_SYMBOLS.CLOSE}</button>
        </div>

        <div className="saved-trips-panel__body">
          {isLoading && <p className="saved-trips-panel__status">{t.search.loading}</p>}
          {isError && <p className="saved-trips-panel__status saved-trips-panel__status--error">{t.savedTrips.failed}</p>}

          {trips && trips.length === 0 && (
            <p className="saved-trips-panel__empty">{t.savedTrips.noTrips}</p>
          )}

          <ul className="saved-trips-panel__list">
            {trips?.map(trip => {
              const { countriesCount, dateRange } = getTripMeta(trip);
              return (
              <li key={trip.id} className="saved-trips-panel__item">
                <div className="saved-trips-panel__info">
                  <strong>{trip.name ?? t.savedTrips.tripId(trip.id)}</strong>
                  <small>
                    {countriesCount} {countriesCount === 1 ? t.savedTrips.country : t.savedTrips.countries}{dateRange ? ` • ${dateRange}` : ''}
                  </small>
                </div>
                <div className="saved-trips-panel__actions">
                  <button 
                    className="saved-trips-panel__btn saved-trips-panel__btn--load"
                    onClick={() => handleLoad(trip)}
                  >
                    {t.buttons.load}
                  </button>
                  <button 
                    className="saved-trips-panel__btn saved-trips-panel__btn--rename"
                    onClick={() => setRenamingTrip(trip)}
                  >
                    {t.buttons.rename}
                  </button>
                  <button 
                    className="saved-trips-panel__btn saved-trips-panel__btn--delete"
                    onClick={() => setDeletingTrip(trip)}
                  >
                    {UI_SYMBOLS.DELETE}
                  </button>
                </div>
              </li>
            )})}
          </ul>
        </div>
      </div>

      {renamingTrip && (
        <TripNameModal
          initialName={renamingTrip.name ?? ''}
          onConfirm={handleRenameConfirm}
          onCancel={() => setRenamingTrip(null)}
          title={t.savedTrips.rename}
        />
      )}

      {deletingTrip && (
        <ConfirmDeleteModal
          tripName={deletingTrip.name ?? t.savedTrips.tripId(deletingTrip.id)}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingTrip(null)}
        />
      )}
    </>
  );
};

export default SavedTripsPanel;
