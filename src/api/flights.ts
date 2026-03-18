import apiClient from './client';
import type { AirportInfo, FlightsResponse, FlightOffersResponse } from '../types';

export const getAirportInfo = (code: string): Promise<AirportInfo> =>
  apiClient.get(`/flights/airport/${code}/info`).then(r => r.data);

export const getFlights = (airportCode: string, params: Record<string, unknown>): Promise<FlightsResponse> =>
  apiClient.get(`/flights/airport/${airportCode}`, { params }).then(r => r.data);

export const getFlightOffers = (origin: string, destination: string, params: Record<string, unknown>): Promise<FlightOffersResponse> =>
  apiClient.get(`/flights/offers/${origin}/${destination}`, { params }).then(r => r.data);
