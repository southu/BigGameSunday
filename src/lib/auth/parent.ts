import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Browser/parent auth client. Anon key only — never the service role. */
export function createParentAuthClient(): SupabaseClient {
  const url = (import.meta.env.VITE_SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL) as
    | string
    | undefined;
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY) as string | undefined;

  if (!url || !key) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(url, key);
}

export function googleRedirectTo(origin: string, next?: string | null): string {
  return next === "/ops" ? `${origin}/auth?next=/ops` : origin;
}

export async function signInWithPassword(
  client: SupabaseClient,
  email: string,
  password: string,
) {
  return client.auth.signInWithPassword({ email, password });
}

export async function signUpWithPassword(
  client: SupabaseClient,
  email: string,
  password: string,
  emailRedirectTo: string,
) {
  return client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo },
  });
}

export async function signInWithGoogle(client: SupabaseClient, redirectTo: string) {
  return client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}

export async function resetPasswordForEmail(
  client: SupabaseClient,
  email: string,
  redirectTo: string,
) {
  return client.auth.resetPasswordForEmail(email, { redirectTo });
}
