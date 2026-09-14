/** Ops allowlist + admin handlers. Server-only — do not import from client modules. */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { OpsHousehold, OpsSnapshot, OpsUser } from "./ops.functions";

const AUTH_REDIRECT = "https://biggamesunday.com/auth";
const PARENT_ACCESS_COOKIE = "sb-access-token";

export type OpsAdminLike = {
  auth: {
    resend: (params: {
      type: "signup";
      email: string;
      options?: { emailRedirectTo?: string };
    }) => Promise<{ error: { message?: string } | null }>;
    admin: {
      getUserById: (id: string) => Promise<{
        data: {
          user: {
            id?: string;
            email?: string | null;
            email_confirmed_at?: string | null;
            confirmation_sent_at?: string | null;
          } | null;
        };
        error: unknown;
      }>;
    };
  };
};

/** Comma-separated emails from OPS_ALLOWLIST. Trimmed, case-insensitive. */
export function parseOpsAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/** Comma-separated emails from OPS_ALLOWLIST. Server-only; never VITE_*. */
export function opsAllowlist(): Set<string> {
  const listed = new Set(parseOpsAllowlist(process.env["OPS_ALLOWLIST"]));
  // If the env var is missing on a deploy, keep the live operator on /ops.
  // This fallback lives in a .server.ts module and is not shipped to the client bundle.
  if (listed.size === 0) listed.add("jsnhrpr@gmail.com");
  return listed;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function assertOps(claims: { email?: unknown }) {
  const email = normalizeEmail(claims.email);
  if (!email || !opsAllowlist().has(email)) throw new Error("Not found");
}

export function isOpsEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  return Boolean(normalized) && opsAllowlist().has(normalized);
}

export function missingEnvNames(error: unknown): string[] | undefined {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (!msg.includes("Missing Supabase environment variable")) return undefined;
  const names = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"].filter((name) => msg.includes(name));
  return names.length > 0 ? names : ["SUPABASE_SERVICE_ROLE_KEY"];
}

function mapUser(user: User): OpsUser {
  return {
    id: user.id,
    email: user.email ?? null,
    email_confirmed_at: user.email_confirmed_at ?? null,
    confirmation_sent_at: user.confirmation_sent_at ?? null,
    created_at: user.created_at,
  };
}

export function confirmationSentAdvanced(
  before: string | null | undefined,
  after: string | null | undefined,
): boolean {
  if (!after) return false;
  if (!before) return true;
  const beforeMs = Date.parse(before);
  const afterMs = Date.parse(after);
  if (Number.isFinite(beforeMs) && Number.isFinite(afterMs)) return afterMs > beforeMs;
  return after !== before;
}

function tokenFromCookieValue(value: string): string | null {
  if (value.split(".").length === 3 && !value.startsWith("{") && !value.startsWith("[")) {
    return value;
  }
  try {
    const parsed = JSON.parse(value) as {
      access_token?: unknown;
      currentSession?: { access_token?: unknown };
    };
    if (typeof parsed.access_token === "string" && parsed.access_token.split(".").length === 3) {
      return parsed.access_token;
    }
    if (
      typeof parsed.currentSession?.access_token === "string" &&
      parsed.currentSession.access_token.split(".").length === 3
    ) {
      return parsed.currentSession.access_token;
    }
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && parsed[0].split(".").length === 3) {
      return parsed[0];
    }
  } catch {
    return null;
  }
  return null;
}

function decodeCookieValue(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Bearer header or parent session cookie. Used by the /ops document GET gate. */
export function extractAccessTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(\S+)/i)?.[1];
  if (bearer && bearer.split(".").length === 3) return bearer;

  const header = request.headers.get("cookie");
  if (!header) return null;

  const cookies = new Map<string, string>();
  for (const part of header.split(";")) {
    const cut = part.indexOf("=");
    if (cut < 0) continue;
    const name = part.slice(0, cut).trim();
    const value = decodeCookieValue(part.slice(cut + 1).trim());
    if (name) cookies.set(name, value);
  }

  const direct = cookies.get(PARENT_ACCESS_COOKIE);
  if (direct) {
    const token = tokenFromCookieValue(direct);
    if (token) return token;
  }

  for (const [name, value] of cookies) {
    if (!/^sb-.*-auth-token$/i.test(name)) continue;
    const token = tokenFromCookieValue(value);
    if (token) return token;
  }

  const chunks = [...cookies.entries()]
    .filter(([name]) => /^sb-.*-auth-token\.\d+$/i.test(name))
    .sort((a, b) => Number(a[0].split(".").pop()) - Number(b[0].split(".").pop()));
  if (chunks.length > 0) {
    const token = tokenFromCookieValue(chunks.map(([, value]) => value).join(""));
    if (token) return token;
  }

  return null;
}

let opsAdmin: SupabaseClient | null = null;

export function resetOpsAdminForTests() {
  opsAdmin = null;
}

export function getOpsAdmin(): SupabaseClient {
  if (opsAdmin) return opsAdmin;

  const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    const missing = [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!key ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];
    throw new Error(`Missing Supabase environment variable(s): ${missing.join(", ")}`);
  }

  opsAdmin = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return opsAdmin;
}

export async function getOpsClaimsFromBearer(
  authorization: string | null | undefined,
): Promise<{ email?: unknown }> {
  if (!authorization) throw new Error("Unauthorized");
  const match = authorization.match(/^Bearer\s+(\S+)/i);
  if (!match) throw new Error("Unauthorized");

  const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const anon =
    process.env["VITE_SUPABASE_ANON_KEY"] ||
    process.env["SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !anon) {
    throw new Error("Missing Supabase environment variable(s): SUPABASE_URL");
  }

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(match[1]);
  if (error || !data.user) throw new Error("Unauthorized");
  return { email: data.user.email };
}

export async function getOpsClaimsFromRequest(request: Request): Promise<{ email?: unknown }> {
  const token = extractAccessTokenFromRequest(request);
  if (!token) throw new Error("Unauthorized");
  return getOpsClaimsFromBearer(`Bearer ${token}`);
}

export async function loadOpsSnapshotHandler(claims: { email?: unknown }): Promise<OpsSnapshot> {
  assertOps(claims);
  try {
    const admin = getOpsAdmin();
    const [usersRes, householdsRes] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from("households").select("id, name, owner_user_id, created_at"),
    ]);
    if (usersRes.error) throw usersRes.error;
    if (householdsRes.error) throw householdsRes.error;
    const users = usersRes.data.users ?? [];
    const households: OpsHousehold[] = (householdsRes.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      owner_user_id: row.owner_user_id as string,
      created_at: row.created_at as string,
    }));
    return { users: users.map(mapUser), households };
  } catch (error) {
    const missingEnv = missingEnvNames(error);
    if (missingEnv) return { users: [], households: [], missingEnv };
    throw error;
  }
}

export async function resendOpsConfirmHandler(
  claims: { email?: unknown },
  userId: string,
  admin?: OpsAdminLike,
): Promise<{ ok: true } | { ok: false; error: string }> {
  assertOps(claims);
  if (!userId) throw new Error("Not found");
  try {
    const opsAdminClient = admin ?? (getOpsAdmin() as unknown as OpsAdminLike);
    const got = await opsAdminClient.auth.admin.getUserById(userId);
    const user = got.data.user;
    if (got.error || !user) throw new Error("Not found");
    if (isOpsEmail(user.email)) return { ok: false, error: "Cannot resend" };
    if (user.email_confirmed_at) return { ok: false, error: "Cannot resend" };
    if (!user.email) throw new Error("Not found");

    const before = user.confirmation_sent_at ?? null;
    const sent = await opsAdminClient.auth.resend({
      type: "signup",
      email: user.email,
      options: { emailRedirectTo: AUTH_REDIRECT },
    });
    if (sent.error) return { ok: false, error: "Could not send" };

    const after = await opsAdminClient.auth.admin.getUserById(userId);
    const sentAt = after.data.user?.confirmation_sent_at ?? null;
    if (!confirmationSentAdvanced(before, sentAt)) {
      return { ok: false, error: "Could not send" };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message === "Not found") throw error;
    const missingEnv = missingEnvNames(error);
    if (missingEnv) return { ok: false, error: missingEnv.join(", ") };
    throw error;
  }
}
