import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

/**
 * KONFIGURACJA KLIENTA SUPABASE (BaaS - Backend-as-a-Service)
 * 
 * Ten moduł stanowi bramę komunikacyjną z zewnętrzną platformą Supabase, 
 * która w architekturze projektu odpowiada za:
 * 1. Autentykację użytkowników.
 * 2. Persystencję danych strukturalnych (PostgreSQL).
 * 3. Zarządzanie sesjami.
 */

// Wykorzystanie zmiennych środowiskowych Vite (import.meta.env)
// Zgodnie z pryncypiami Twelve-Factor App, separacja konfiguracji od kodu
// zapewnia bezpieczeństwo i uniwersalność wdrożenia w różnych środowiskach (dev/prod).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Mechanizm Fail-Safe: zapobiega błędom krytycznym w przypadku braku kluczy API
if (!supabaseUrl || !supabaseAnonKey) {
  logger.warn('Brak konfiguracji Supabase: Funkcje autoryzacji będą wyłączone.');
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
