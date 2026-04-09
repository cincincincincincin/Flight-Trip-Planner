import { createClient } from '@supabase/supabase-js';

/**
 * KONFIGURACJA KLIENTA SUPABASE (BaaS - Backend-as-a-Service)
 * 
 * Ten moduł stanowi bramę komunikacyjną z zewnętrzną platformą Supabase, 
 * która w architekturze projektu odpowiada za:
 * 1. Autentykację użytkowników (GoTrue).
 * 2. Persystencję danych strukturalnych (PostgreSQL/Realtime).
 * 3. Zarządzanie sesjami (LocalStorage sync).
 */

// Wykorzystanie zmiennych środowiskowych Vite (import.meta.env)
// Zgodnie z pryncypiami Twelve-Factor App, separacja konfiguracji od kodu
// zapewnia bezpieczeństwo i uniwersalność wdrożenia w różnych środowiskach (dev/prod).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Mechanizm Fail-Safe: zapobiega błędom krytycznym w przypadku braku kluczy API
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase configuration missing: Auth features will be disabled.');
}

/**
 * INSTANCJA KLIENTA
 * Skonfigurowana do pracy w trybie Client-Side (SPA).
 */
export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    // automatyczne wykrywanie tokenów w URL (niezbędne dla Google OAuth / Email Confirm)
    detectSessionInUrl: true,
  },
});
