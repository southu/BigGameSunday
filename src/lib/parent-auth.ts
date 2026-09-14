export type AuthMode = "signin" | "signup";

/** Default tab is Sign in. Signup is explicit (`?mode=signup`). */
export function authModeFromSearch(search: { mode?: unknown } | URLSearchParams | string): AuthMode {
  if (typeof search === "string") {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    return params.get("mode") === "signup" ? "signup" : "signin";
  }
  if (search instanceof URLSearchParams) {
    return search.get("mode") === "signup" ? "signup" : "signin";
  }
  return search.mode === "signup" ? "signup" : "signin";
}

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

export const CANONICAL_HOST = "biggamesunday.com";
export const WWW_HOST = "www.biggamesunday.com";

export function canonicalRedirectLocation(host: string, url: URL): string | null {
  const hostname = (host.split(":")[0] ?? host).toLowerCase();
  if (hostname !== WWW_HOST) return null;
  const next = new URL(url.toString());
  next.hostname = CANONICAL_HOST;
  next.protocol = "https:";
  next.port = "";
  return next.toString();
}
