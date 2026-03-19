import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveTrip, updateTrip } from '../../api/trips';
import { useTripStore } from '../../stores/tripStore';
import TripNameModal from '../TripNameModal';
import './SaveTripButton.css';

const SaveTripButton: React.FC = () => {
  const { tripState, tripRoutes, savedTripId, savedTripStateJSON, setSavedTrip, editMode, isLoadedTrip } = useTripStore();
  const qc = useQueryClient();
  const [showNameModal, setShowNameModal] = useState(false);

  const currentStateJSON = useMemo(
    () => (tripState ? JSON.stringify(tripState) : null),
    [tripState]
  );

  // All hooks must come before any conditional return.
  // We pass stateJSON through mutation variables so onSuccess uses the exact client JSON
  // (server may reformat trip_state, causing a spurious mismatch if we used data.trip_state).
  const saveMutation = useMutation({
    mutationFn: ({ name, stateJSON }: { name: string; stateJSON: string }) => {
      void stateJSON; // carried via variables, not used here
      return saveTrip({ name, trip_state: tripState!, trip_routes: tripRoutes });
    },
    onSuccess: (data, { stateJSON }) => {
      qc.invalidateQueries({ queryKey: ['user-trips'] });
      setSavedTrip(data.id, stateJSON);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ stateJSON }: { stateJSON: string }) => {
      void stateJSON;
      return updateTrip(savedTripId!, { trip_state: tripState!, trip_routes: tripRoutes });
    },
    onSuccess: (data, { stateJSON }) => {
      qc.invalidateQueries({ queryKey: ['user-trips'] });
      setSavedTrip(data.id, stateJSON);
    },
  });

  const hasChanges = currentStateJSON !== null && currentStateJSON !== savedTripStateJSON;
  const isUpdate = savedTripId !== null && (editMode || !isLoadedTrip);

  // Hide the button entirely when there are no changes to save/update
  if (!tripState || !hasChanges) return null;

  const isPending = saveMutation.isPending || updateMutation.isPending;

  const handleClick = () => {
    if (isPending) return;
    if (isUpdate) {
      updateMutation.mutate({ stateJSON: currentStateJSON! });
    } else {
      setShowNameModal(true);
    }
  };

  const handleNameConfirm = (name: string) => {
    setShowNameModal(false);
    const autoName = `Trip ${new Date().toLocaleDateString()}`;
    saveMutation.mutate({ name: name || autoName, stateJSON: currentStateJSON! });
  };

  return (
    <>
      <button
        className="save-trip-btn"
        onClick={handleClick}
        disabled={isPending}
        title={isUpdate ? 'Update existing trip' : 'Save current trip'}
      >
        {isPending ? '💾 Saving...' : isUpdate ? '💾 Update Trip' : '💾 Save Trip'}
      </button>

      {showNameModal && (
        <TripNameModal
          initialName={`Trip ${new Date().toLocaleDateString()}`}
          title="Name your trip"
          confirmLabel="Save"
          onConfirm={handleNameConfirm}
          onCancel={() => setShowNameModal(false)}
        />
      )}
    </>
  );
};

export default SaveTripButton;
