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

// Attach Supabase JWT to every request when the user is logged in
apiClient.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return config;
});

// On 401: attempt token refresh once, then retry the original request.
// The _retry flag prevents infinite loops if the refreshed token is also rejected.
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
        // refresh failed — reject with original 401
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
