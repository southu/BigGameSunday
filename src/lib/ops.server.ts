/** Ops allowlist + admin handlers. Server-only — do not import from client modules. */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { OpsHousehold, OpsSnapshot, OpsUser } from "./ops.functions";

export type CollapseUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
  identities?: Array<{ provider?: string | null }> | null;
};

export type IdentityCollapsePlan = {
  email: string;
  ownerId: string;
  extraIds: string[];
  extraProviders: string[];
  confirmOwnerEmail: boolean;
};

export type OpsAdminLike = {
  auth: {
    admin: {
      updateUserById: (
        id: string,
        attributes: {
          email_confirm?: boolean;
          app_metadata?: Record<string, unknown>;
        },
      ) => Promise<unknown>;
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

function missingEnvNames(error: unknown): string[] | undefined {
  const msg = error instanceof Error ? error.message : "";
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

function providersOf(user: CollapseUser): string[] {
  const out = new Set<string>();
  const meta = user.app_metadata ?? {};
  const provider = meta["provider"];
  if (typeof provider === "string" && provider) out.add(provider);
  const listed = meta["providers"];
  if (Array.isArray(listed)) {
    for (const item of listed) {
      if (typeof item === "string" && item) out.add(item);
    }
  }
  for (const identity of user.identities ?? []) {
    if (identity?.provider) out.add(identity.provider);
  }
  return [...out];
}

/**
 * Plan a collapse of duplicate email/Google auth.users onto the household
 * owner_user_id. Does not invent a household or rewrite owner_user_id / RLS.
 */
export function planIdentityCollapse(
  users: CollapseUser[],
  households: OpsHousehold[],
): IdentityCollapsePlan[] {
  if (households.length === 0) return [];

  const byEmail = new Map<string, CollapseUser[]>();
  for (const user of users) {
    const email = normalizeEmail(user.email);
    if (!email) continue;
    const group = byEmail.get(email) ?? [];
    group.push(user);
    byEmail.set(email, group);
  }

  const ownerIds = new Set(households.map((row) => row.owner_user_id));
  const plans: IdentityCollapsePlan[] = [];

  for (const [email, group] of byEmail) {
    if (group.length < 2) continue;
    const owner = group.find((user) => ownerIds.has(user.id));
    if (!owner) continue;
    const extras = group.filter((user) => user.id !== owner.id);
    if (extras.length === 0) continue;

    const extraProviders = [...new Set(extras.flatMap((user) => providersOf(user)))];
    const confirmOwnerEmail = !owner.email_confirmed_at && extras.some((user) => Boolean(user.email_confirmed_at));

    plans.push({
      email,
      ownerId: owner.id,
      extraIds: extras.map((user) => user.id),
      extraProviders,
      confirmOwnerEmail,
    });
  }

  return plans;
}

/**
 * Collapse extras onto households.owner_user_id:
 * - copy extra providers onto the owner app_metadata.providers
 * - confirm the owner email when an extra is already confirmed
 * - stamp extras with app_metadata.merged_into = owner id
 *
 * Does not delete extra auth.users rows (that would drop an identity we
 * cannot reattach). Does not rewrite household RLS or owner_user_id.
 */
export async function collapseDuplicateIdentitiesToHouseholdOwner(
  users: CollapseUser[],
  households: OpsHousehold[],
  admin?: OpsAdminLike,
): Promise<IdentityCollapsePlan[]> {
  const plans = planIdentityCollapse(users, households);
  if (plans.length === 0) return plans;

  const client = admin ?? getOpsAdmin();
  const byId = new Map(users.map((user) => [user.id, user]));

  for (const plan of plans) {
    const owner = byId.get(plan.ownerId);
    if (!owner) continue;

    const ownerProviders = [...new Set([...providersOf(owner), ...plan.extraProviders])];
    const ownerMeta: Record<string, unknown> = { ...(owner.app_metadata ?? {}) };
    ownerMeta["providers"] = ownerProviders;

    await client.auth.admin.updateUserById(plan.ownerId, {
      ...(plan.confirmOwnerEmail ? { email_confirm: true } : {}),
      app_metadata: ownerMeta,
    });

    for (const extraId of plan.extraIds) {
      const extra = byId.get(extraId);
      const extraMeta: Record<string, unknown> = { ...(extra?.app_metadata ?? {}) };
      extraMeta["merged_into"] = plan.ownerId;
      await client.auth.admin.updateUserById(extraId, {
        app_metadata: extraMeta,
      });
    }
  }

  return plans;
}

let opsAdmin: SupabaseClient | null = null;

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
    await collapseDuplicateIdentitiesToHouseholdOwner(users, households, admin);
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  assertOps(claims);
  if (!userId) throw new Error("Not found");
  try {
    const admin = getOpsAdmin();
    const got = await admin.auth.admin.getUserById(userId);
    const user = got.data.user;
    if (got.error || !user) throw new Error("Not found");
    if (isOpsEmail(user.email)) return { ok: false, error: "Cannot resend" };
    if (user.email_confirmed_at) return { ok: false, error: "Cannot resend" };
    if (!user.email) throw new Error("Not found");

    const link = await admin.auth.admin.generateLink({
      type: "invite",
      email: user.email,
      options: { redirectTo: "https://biggamesunday.com/auth" },
    });
    if (!link.error) return { ok: true };

    const sent = await admin.auth.resend({ type: "signup", email: user.email });
    if (sent.error) return { ok: false, error: "Could not send" };
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message === "Not found") throw error;
    const missingEnv = missingEnvNames(error);
    if (missingEnv) return { ok: false, error: missingEnv.join(", ") };
    throw error;
  }
}
