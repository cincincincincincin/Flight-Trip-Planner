import apiClient from './client';
import type { FlightOffer } from '../types';

// Pobiera oferty cenowe dla trasy i konkretnego czasu wylotu.
// Parametry (origin, destination, departure_at) siedzą w obiekcie params.
export const getOffers = (params: Record<string, unknown>): Promise<FlightOffer> => {
  // console.log('Fetching offers for:', params.origin, '->', params.destination);
  return apiClient.get('/offers', { params }).then(r => r.data);
};

