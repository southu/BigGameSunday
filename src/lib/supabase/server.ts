import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';

let serverClient: SupabaseClient<Database> | null = null;

export function getServerClient(): SupabaseClient<Database> {
  if (serverClient) {
    return serverClient;
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables for server client');
  }

  serverClient = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return serverClient;
}
