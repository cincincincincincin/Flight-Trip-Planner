import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTrips, deleteTrip, updateTrip } from '../../api/trips';
import type { SavedTrip } from '../../api/trips';
import { useTripStore } from '../../stores/tripStore';
import { useAirportsQuery } from '../../hooks/queries';
import TripNameModal from '../TripNameModal';
import ConfirmDeleteModal from '../ConfirmDeleteModal';
import './SavedTripsPanel.css';

interface SavedTripsPanelProps {
  onClose: () => void;
  onTripLoaded?: (trip: SavedTrip) => void;
}

const SavedTripsPanel: React.FC<SavedTripsPanelProps> = ({ onClose, onTripLoaded }) => {
  const qc = useQueryClient();
  const { setTripState, setTripRoutes, setLoadedTrip } = useTripStore();

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

  const getTripMeta = (trip: SavedTrip) => {
    const { trip_state } = trip;
    // Visited countries
    const countries = new Set<string>();
    if (trip_state.startAirport?.country_code) countries.add(trip_state.startAirport.country_code);
    trip_state.legs.forEach(leg => {
      const cc = airportCountryMap[leg.toAirportCode];
      if (cc) countries.add(cc);
    });
    // Date range
    let firstDep: string | null = null;
    let lastArr: string | null = null;
    for (const leg of trip_state.legs) {
      if ((leg as { type?: string }).type === 'manual' || !leg.flight) continue;
      if (!firstDep && leg.flight.scheduled_departure_utc) firstDep = leg.flight.scheduled_departure_utc;
      if (leg.flight.scheduled_arrival_utc) lastArr = leg.flight.scheduled_arrival_utc;
    }
    const fmt = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const dateRange = firstDep && lastArr ? `${fmt(firstDep)} – ${fmt(lastArr)}` : null;
    return { countriesCount: countries.size, dateRange };
  };

  const { data: trips, isLoading, isError } = useQuery({
    queryKey: ['user-trips'],
    queryFn: fetchTrips,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTrip(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-trips'] });
      setDeletingTrip(null);
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ trip, name }: { trip: SavedTrip; name: string }) =>
      updateTrip(trip.id, { name, trip_state: trip.trip_state, trip_routes: trip.trip_routes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-trips'] });
      setRenamingTrip(null);
    },
  });

  const handleLoad = (trip: SavedTrip) => {
    setTripState(trip.trip_state);
    setTripRoutes(trip.trip_routes);
    setLoadedTrip(trip.id, JSON.stringify(trip.trip_state));
    onTripLoaded?.(trip);
    onClose();
  };

  const handleRenameConfirm = (name: string) => {
    if (!renamingTrip) return;
    const autoName = `Trip #${renamingTrip.id}`;
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
          <h3>Saved Trips</h3>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="saved-trips-panel__body">
          {isLoading && <p className="saved-trips-panel__status">Loading...</p>}
          {isError && <p className="saved-trips-panel__status saved-trips-panel__status--error">Failed to load trips.</p>}

          {trips && trips.length === 0 && (
            <p className="saved-trips-panel__empty">No saved trips yet.</p>
          )}

          <ul className="saved-trips-panel__list">
            {trips?.map(trip => {
              const { countriesCount, dateRange } = getTripMeta(trip);
              return (
              <li key={trip.id} className="saved-trips-panel__item">
                <div className="saved-trips-panel__info">
                  <strong>{trip.name ?? `Trip #${trip.id}`}</strong>
                  <small>
                    {countriesCount} {countriesCount === 1 ? 'country' : 'countries'}
                    {dateRange && <> &bull; {dateRange}</>}
                  </small>
                </div>
                <div className="saved-trips-panel__actions">
                  <button onClick={() => handleLoad(trip)}>Load</button>
                  <button onClick={() => setRenamingTrip(trip)} disabled={renameMutation.isPending}>
                    Rename
                  </button>
                  <button
                    className="danger"
                    onClick={() => setDeletingTrip(trip)}
                    disabled={deleteMutation.isPending}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
            })}
          </ul>
        </div>
      </div>

      {renamingTrip && (
        <TripNameModal
          initialName={renamingTrip.name ?? ''}
          title={`Rename "${renamingTrip.name ?? `Trip #${renamingTrip.id}`}"`}
          confirmLabel="Rename"
          onConfirm={handleRenameConfirm}
          onCancel={() => setRenamingTrip(null)}
        />
      )}

      {deletingTrip && (
        <ConfirmDeleteModal
          tripName={deletingTrip.name ?? `Trip #${deletingTrip.id}`}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingTrip(null)}
        />
      )}
    </>
  );
};

export default SavedTripsPanel;
