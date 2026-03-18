import apiClient from './client';
import type { TripState, TripRoute } from '../types';

export interface SavedTrip {
  id: number;
  user_id: string;
  name: string | null;
  trip_state: TripState;
  trip_routes: TripRoute[];
  created_at: string;
  updated_at: string;
}

export interface SaveTripPayload {
  name?: string;
  trip_state: TripState;
  trip_routes: TripRoute[];
}

export const fetchTrips = async (): Promise<SavedTrip[]> => {
  const { data } = await apiClient.get<SavedTrip[]>('/trips');
  return data;
};

export const saveTrip = async (payload: SaveTripPayload): Promise<SavedTrip> => {
  const { data } = await apiClient.post<SavedTrip>('/trips', payload);
  return data;
};

export const updateTrip = async (id: number, payload: SaveTripPayload): Promise<SavedTrip> => {
  const { data } = await apiClient.put<SavedTrip>(`/trips/${id}`, payload);
  return data;
};

export const deleteTrip = async (id: number): Promise<void> => {
  await apiClient.delete(`/trips/${id}`);
};
