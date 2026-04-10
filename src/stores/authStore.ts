import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { loadPreferencesOnLogin, clearPreferencesOnLogout } from '../utils/preferencesSync';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  setSession: (session: Session | null) => void;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  loading: true,

  setSession: (session) => set({
    session,
    user: session?.user ?? null,
    loading: false,
  }),

  signInWithEmail: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },

  signUpWithEmail: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  },

  signInWithGoogle: async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    return { error: error?.message ?? null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null });
  },
}));

// lastUserId blokuje nadmiarowy sync przy odświeżaniu tokenów sesji.
let lastUserId: string | null = null;

// Globalny listener - poza Reactem, żeby uniknąć double-triggera w StrictMode 
// i mieć sesję gotową jeszcze przed mountowaniem mapy.
supabase.auth.onAuthStateChange((event, session) => {
  const userId = session?.user?.id ?? null;
  
  useAuthStore.getState().setSession(session);
  
  // Czyścimy access_token z URL po powrocie z OAuth (Google).
  if (event === 'SIGNED_IN' && window.location.hash.includes('access_token')) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  
  // Sync preferencji (kolory mapy itp.) odpalamy tylko jak faktycznie zmieni się ID usera.
  if (event === 'SIGNED_IN' && userId !== lastUserId) {
    lastUserId = userId;
    loadPreferencesOnLogin(session?.user ?? null);
  }
  
  if (event === 'SIGNED_OUT') {
    lastUserId = null;
    clearPreferencesOnLogout();
  }
});
