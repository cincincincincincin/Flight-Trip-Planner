import apiClient from './client';
import type { FlightOffersResponse } from '../types';

/**
 * Fetches flight price offers for a specific route and departure time.
 * Expects origin, destination, and departure_at in the params object.
 */
export const getOffers = (params: Record<string, unknown>): Promise<FlightOffersResponse> =>
  apiClient.get('/offers', { params }).then(r => r.data);
