import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveTrip } from '../../api/trips';
import { useTripStore } from '../../stores/tripStore';
import './SaveTripButton.css';

const SaveTripButton: React.FC = () => {
  const { tripState, tripRoutes } = useTripStore();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: () => saveTrip({
      name: `Trip ${new Date().toLocaleDateString()}`,
      trip_state: tripState!,
      trip_routes: tripRoutes,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-trips'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <button
      className="save-trip-btn"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending || !tripState}
      title="Save current trip"
    >
      {mutation.isPending ? '💾 Saving...' : saved ? '✅ Saved!' : '💾 Save Trip'}
    </button>
  );
};

export default SaveTripButton;
