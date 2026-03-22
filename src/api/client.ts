import { CONFIG } from '../constants/config';
import axios from 'axios';
import { supabase } from '../lib/supabaseClient';

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

export default apiClient;
