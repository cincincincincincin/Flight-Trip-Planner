import { publicApiClient } from './client';
import type { FlightOffer } from '../types';

// Pobiera oferty cenowe dla trasy i konkretnego czasu wylotu.
// Używa publicApiClient (bez Authorization) żeby uniknąć CORS preflight OPTIONS.
export const getOffers = (params: Record<string, unknown>): Promise<FlightOffer> => {
  return publicApiClient.get('/offers', { params }).then(r => r.data);
};

