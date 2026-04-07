import apiClient from './client';
import type { FlightOfferResponse } from '../types';

/**
 * Fetches flight price offer for a specific route and departure time.
 * Expects origin, destination, and departure_at in the params object.
 */
export const getOffers = (params: Record<string, unknown>): Promise<FlightOfferResponse> =>
  apiClient.get('/offers', { params }).then(r => r.data);
