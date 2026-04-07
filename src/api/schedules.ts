import apiClient from './client';
import type { Schedule } from '../types';

/**
 * Fetches flight schedules departing from a specific airport.
 * Returns a stream-compatible response (usually handled as NDJSON).
 */
export const getSchedules = (airportCode: string, params: Record<string, unknown>): Promise<Schedule> =>
  apiClient.get(`/schedules/${airportCode}`, { params }).then(r => r.data);
