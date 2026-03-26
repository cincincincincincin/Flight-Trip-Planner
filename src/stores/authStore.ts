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
  initializeAuth: () => () => void;
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

  // kept for backwards compat – no-op, subscription is module-level
  initializeAuth: () => () => {},
}));

// Module-level subscription – registered before React mounts, immune to StrictMode.
supabase.auth.onAuthStateChange((event, session) => {
  useAuthStore.getState().setSession(session);
  // Clean up the URL hash after implicit OAuth redirect
  if (event === 'SIGNED_IN' && window.location.hash.includes('access_token')) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  if (event === 'SIGNED_IN') {
    loadPreferencesOnLogin();
  }
  if (event === 'SIGNED_OUT') {
    clearPreferencesOnLogout();
  }
});
