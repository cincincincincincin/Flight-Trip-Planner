import apiClient from './client';
import type { Schedule } from '../types';

/**
 * Pobiera rozkłady lotów odlatujących z konkretnego lotniska.
 * Zwraca odpowiedź kompatybilną ze strumieniami.
 */
export const getSchedules = (airportCode: string, params: Record<string, unknown>): Promise<Schedule> =>
  apiClient.get(`/schedules/${airportCode}`, { params }).then(r => r.data);
