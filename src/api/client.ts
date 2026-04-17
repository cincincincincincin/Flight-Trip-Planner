import { CONFIG } from '../constants/config';
import axios from 'axios';
import { supabase } from '../lib/supabaseClient';

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: CONFIG.API_TIMEOUT_MS,
});

// Dołączenie tokena Supabase JWT do każdego zapytania dla zalogowanych użytkowników
apiClient.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return config;
});

// Przy błędzie 401: jedna próba odświeżenia tokena i ponowienie zapytania.
// Flaga _retry zapobiega nieskończonym pętlom w przypadku ponownego odrzucenia odświeżonego tokena.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (!originalRequest) return Promise.reject(error);
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const { data: { session } } = await supabase.auth.refreshSession();
        if (session?.access_token) {
          originalRequest.headers['Authorization'] = `Bearer ${session.access_token}`;
          return apiClient(originalRequest);
        }
      } catch {
        // Odświeżenie nie powiodło się – odrzuć pierwotnym błędem 401
      }
    }
    return Promise.reject(error);
  }
);

// Klient dla publicznych endpointów (bez Authorization) — eliminuje CORS preflight OPTIONS
export const publicApiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: CONFIG.API_TIMEOUT_MS,
});

export default apiClient;
