import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveTrip, updateTrip } from '../../api/trips';
import type { SavedTrip } from '../../api/trips';
import { useTripStore } from '../../stores/tripStore';
import TripNameModal from '../TripNameModal';
import './SaveTripButton.css';
import { useTexts } from '../../hooks/useTexts';
import dayjs from '../../lib/dayjs';

const SaveTripButton: React.FC = () => {
  const t = useTexts();
  const { tripState, savedTripId, savedTripStateJSON, updateTrip: updateTripStore, editMode, isLoadedTrip } = useTripStore();
  const qc = useQueryClient();
  const [showNameModal, setShowNameModal] = useState(false);

  const currentStateJSON = useMemo(
    () => (tripState ? JSON.stringify(tripState) : null),
    [tripState]
  );

  // All hooks must come before any conditional return.
  // We pass stateJSON through mutation variables so onSuccess uses the exact client JSON
  // (server may reformat trip_state, causing a spurious mismatch if we used data.trip_state).
  const saveMutation = useMutation<SavedTrip, Error, { name: string; stateJSON: string }>({
    mutationFn: ({ name, stateJSON }: { name: string; stateJSON: string }) => {
      void stateJSON; // carried via variables, not used here
      return saveTrip({ name, trip_state: tripState! });
    },
    onSuccess: (data, { stateJSON }) => {
      qc.invalidateQueries({ queryKey: ['user-trips'] });
      updateTripStore({ savedTripId: data.id, savedTripStateJSON: stateJSON });
    },
  });

  const updateMutation = useMutation<SavedTrip, Error, { stateJSON: string }>({
    mutationFn: ({ stateJSON }: { stateJSON: string }) => {
      void stateJSON;
      return updateTrip(savedTripId!, { trip_state: tripState! });
    },
    onSuccess: (data, { stateJSON }) => {
      qc.invalidateQueries({ queryKey: ['user-trips'] });
      updateTripStore({ savedTripId: data.id, savedTripStateJSON: stateJSON });
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
    const autoName = `${t.auth.autoNamePrefix}${dayjs().format('L')}`;
    saveMutation.mutate({ name: name || autoName, stateJSON: currentStateJSON! });
  };

  return (
    <>
      <button
        className="save-trip-btn"
        onClick={handleClick}
        disabled={isPending}
        title={isUpdate ? t.auth.updateTripTitle : t.auth.saveTripTitle}
      >
        {isPending ? t.auth.saving : isUpdate ? t.auth.updateTrip : t.auth.saveTrip}
      </button>

      {showNameModal && createPortal(
        <TripNameModal
          initialName={`${t.auth.autoNamePrefix}${dayjs().format('L')}`}
          title={t.auth.nameYourTrip}
          confirmLabel={t.buttons.save}
          onConfirm={handleNameConfirm}
          onCancel={() => setShowNameModal(false)}
        />,
        document.body
      )}
    </>
  );
};

export default SaveTripButton;
