import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Readable by the /ops document GET so the server can redirect unauthenticated requests. */
export const PARENT_ACCESS_COOKIE = "sb-access-token";

function tokenFromStoredSession(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as {
      access_token?: unknown;
      currentSession?: { access_token?: unknown };
    };
    if (typeof parsed.access_token === "string") return parsed.access_token;
    if (typeof parsed.currentSession?.access_token === "string") {
      return parsed.currentSession.access_token;
    }
  } catch {
    return null;
  }
  return null;
}

function writeParentAccessCookie(token: string | null) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  if (token) {
    document.cookie = `${PARENT_ACCESS_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=604800${secure}`;
  } else {
    document.cookie = `${PARENT_ACCESS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  }
}

function parentAuthStorage(): Storage {
  return {
    get length() {
      return window.localStorage.length;
    },
    clear() {
      window.localStorage.clear();
      writeParentAccessCookie(null);
    },
    key(index: number) {
      return window.localStorage.key(index);
    },
    getItem(key: string) {
      const value = window.localStorage.getItem(key);
      const token = value ? tokenFromStoredSession(value) : null;
      if (token) writeParentAccessCookie(token);
      return value;
    },
    setItem(key: string, value: string) {
      window.localStorage.setItem(key, value);
      const token = tokenFromStoredSession(value);
      if (token) writeParentAccessCookie(token);
    },
    removeItem(key: string) {
      window.localStorage.removeItem(key);
      writeParentAccessCookie(null);
    },
  };
}

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

  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: typeof window === "undefined" ? undefined : parentAuthStorage(),
    },
  });
}

export type AuthMode = "signin" | "signup";

/** Default tab is Sign in. Signup is explicit (`?mode=signup`). */
export function authModeFromSearch(search: string | URLSearchParams): AuthMode {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  return params.get("mode") === "signup" ? "signup" : "signin";
}

export function googleRedirectTo(origin: string, next?: string | null): string {
  return next === "/ops" ? `${origin}/auth?next=/ops` : origin;
}

/** Recovery / confirm emails must return to the current origin's /auth. */
export function passwordResetRedirectTo(origin: string): string {
  return `${origin.replace(/\/$/, "")}/auth`;
}

export function isPasswordRecoveryHash(hash: string): boolean {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return false;
  return new URLSearchParams(raw).get("type") === "recovery";
}

export const AUTH_ERROR_COPY = {
  unconfirmed:
    "This email is not confirmed yet. Check your inbox, or resend the confirmation below.",
  invalidCredentials: "That email or password doesn't match. Try again, or reset your password.",
  alreadyRegistered: "That email already has an account. Sign in, or reset your password.",
} as const;

export function mapAuthError(
  error: { message?: string; code?: string } | string | null | undefined,
): string {
  const message = typeof error === "string" ? error : (error?.message ?? "");
  const code = typeof error === "object" && error ? error.code ?? "" : "";
  const lower = `${code} ${message}`.toLowerCase();
  if (
    lower.includes("email_not_confirmed") ||
    lower.includes("email not confirmed") ||
    lower.includes("not confirmed")
  ) {
    return AUTH_ERROR_COPY.unconfirmed;
  }
  if (
    lower.includes("invalid_credentials") ||
    lower.includes("invalid login credentials") ||
    lower.includes("invalid credentials") ||
    lower.includes("invalid email or password")
  ) {
    return AUTH_ERROR_COPY.invalidCredentials;
  }
  if (
    lower.includes("user_already_exists") ||
    lower.includes("already registered") ||
    lower.includes("already been registered") ||
    lower.includes("user already registered")
  ) {
    return AUTH_ERROR_COPY.alreadyRegistered;
  }
  return message || "Something went wrong.";
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

export async function resendSignupConfirmation(
  client: SupabaseClient,
  email: string,
  emailRedirectTo: string,
) {
  return client.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo },
  });
}

export async function updateUserPassword(client: SupabaseClient, password: string) {
  return client.auth.updateUser({ password });
}
