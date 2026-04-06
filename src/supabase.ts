import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let _supabase: SupabaseClient | null = null;

/**
 * Lazily initializes and returns the Supabase client.
 * Throws a clear error if environment variables are missing.
 */
export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Supabase configuration is missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables. ' +
        'You can find these in your Supabase project settings.'
      );
    }
    _supabase = createClient(supabaseUrl, supabaseAnonKey);
  }
  return _supabase;
}

/**
 * Exported Supabase client proxy.
 * This allows using `supabase` as before, but it will only initialize (and potentially throw)
 * when a property or method is accessed.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(target, prop) {
    const client = getSupabase();
    const value = (client as any)[prop];
    
    // Bind functions to the client instance to maintain 'this' context
    if (typeof value === 'function') {
      return value.bind(client);
    }
    
    return value;
  }
});
