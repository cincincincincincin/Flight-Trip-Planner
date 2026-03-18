import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTrips, deleteTrip } from '../../api/trips';
import type { SavedTrip } from '../../api/trips';
import { useTripStore } from '../../stores/tripStore';
import './SavedTripsPanel.css';

interface SavedTripsPanelProps {
  onClose: () => void;
}

const SavedTripsPanel: React.FC<SavedTripsPanelProps> = ({ onClose }) => {
  const qc = useQueryClient();
  const { setTripState, setTripRoutes, clearHistory } = useTripStore();

  const { data: trips, isLoading, isError } = useQuery({
    queryKey: ['user-trips'],
    queryFn: fetchTrips,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTrip(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-trips'] }),
  });

  const handleLoad = (trip: SavedTrip) => {
    clearHistory();
    setTripState(trip.trip_state);
    setTripRoutes(trip.trip_routes);
    onClose();
  };

  return (
    <div className="saved-trips-panel">
      <div className="saved-trips-panel__header">
        <h3>Saved Trips</h3>
        <button onClick={onClose}>✕</button>
      </div>

      <div className="saved-trips-panel__body">
        {isLoading && <p className="saved-trips-panel__status">Loading...</p>}
        {isError  && <p className="saved-trips-panel__status saved-trips-panel__status--error">Failed to load trips.</p>}

        {trips && trips.length === 0 && (
          <p className="saved-trips-panel__empty">No saved trips yet.</p>
        )}

        <ul className="saved-trips-panel__list">
          {trips?.map(trip => (
            <li key={trip.id} className="saved-trips-panel__item">
              <div className="saved-trips-panel__info">
                <strong>{trip.name ?? `Trip #${trip.id}`}</strong>
                <small>
                  {trip.trip_state.legs.length} leg(s) &bull; {new Date(trip.updated_at).toLocaleDateString()}
                </small>
              </div>
              <div className="saved-trips-panel__actions">
                <button onClick={() => handleLoad(trip)}>Load</button>
                <button
                  className="danger"
                  onClick={() => deleteMutation.mutate(trip.id)}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default SavedTripsPanel;
