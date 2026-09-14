/** Ops allowlist + admin handlers. Server-only — do not import from client modules. */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { OpsHousehold, OpsSnapshot, OpsUser } from "./ops.functions";

export const OPS_RELINK_IDENTITIES_RPC = "ops_relink_auth_identities";
const AUTH_REDIRECT = "https://biggamesunday.com/auth";

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
      updateUserById: (
        id: string,
        attributes: {
          email?: string;
          email_confirm?: boolean;
          ban_duration?: string;
          app_metadata?: Record<string, unknown>;
        },
      ) => Promise<{ error?: unknown } | unknown>;
      deleteUser: (id: string) => Promise<{ error?: unknown } | unknown>;
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
  schema?: (name: string) => {
    from: (table: string) => {
      update: (values: { user_id: string }) => {
        eq: (column: string, value: string) => {
          not: (
            column: string,
            operator: string,
            value: string,
          ) => PromiseLike<{ error: { message?: string } | null }>;
        };
      };
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

function resultError(result: unknown): unknown {
  if (result && typeof result === "object" && "error" in result) {
    return (result as { error: unknown }).error;
  }
  return null;
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
 * Move OAuth identities (Google, etc.) from an extra auth.users row onto the
 * household owner. Email/phone identities stay put so unique (provider,
 * provider_id) does not collide; deleteUser then drops the extra row.
 */
export async function relinkAuthIdentitiesToOwner(
  admin: OpsAdminLike,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  const rpcResult = await admin.rpc(OPS_RELINK_IDENTITIES_RPC, {
    from_user_id: fromUserId,
    to_user_id: toUserId,
  });
  if (!rpcResult?.error) return;

  if (typeof admin.schema === "function") {
    const moved = await admin
      .schema("auth")
      .from("identities")
      .update({ user_id: toUserId })
      .eq("user_id", fromUserId)
      .not("provider", "in", "(email,phone)");
    if (!moved.error) return;
  }

  throw new Error(
    `Could not relink auth identities from ${fromUserId} to ${toUserId}`,
  );
}

async function deleteOrDisableExtraUser(
  admin: OpsAdminLike,
  extraId: string,
  ownerId: string,
): Promise<void> {
  try {
    const deleted = await admin.auth.admin.deleteUser(extraId);
    if (!resultError(deleted)) return;
  } catch {
    // Extra may still be referenced; scramble so Google/email cannot resolve to it.
  }

  const scrambled = await admin.auth.admin.updateUserById(extraId, {
    email: `merged-${extraId.replace(/-/g, "")}@invalid.invalid`,
    ban_duration: "876000h",
    app_metadata: { merged_into: ownerId },
  });
  if (resultError(scrambled)) {
    throw new Error(`Could not remove extra auth user ${extraId}`);
  }
}

/**
 * Collapse extras onto households.owner_user_id:
 * - relink extra OAuth identities (Google) onto the owner via
 *   ops_relink_auth_identities (auth.identities.user_id)
 * - copy extra providers onto the owner app_metadata.providers
 * - confirm the owner email when an extra is already confirmed
 * - delete the extra auth.users row so Google sign-in cannot resolve to it
 *
 * Does not rewrite household RLS or owner_user_id. Does not succeed on
 * app_metadata-only stamps that leave the extra identity in place.
 */
export async function collapseDuplicateIdentitiesToHouseholdOwner(
  users: CollapseUser[],
  households: OpsHousehold[],
  admin?: OpsAdminLike,
): Promise<IdentityCollapsePlan[]> {
  const plans = planIdentityCollapse(users, households);
  if (plans.length === 0) return plans;

  const client = admin ?? (getOpsAdmin() as unknown as OpsAdminLike);
  const byId = new Map(users.map((user) => [user.id, user]));

  for (const plan of plans) {
    const owner = byId.get(plan.ownerId);
    if (!owner) continue;

    for (const extraId of plan.extraIds) {
      await relinkAuthIdentitiesToOwner(client, extraId, plan.ownerId);
    }

    const ownerProviders = [...new Set([...providersOf(owner), ...plan.extraProviders])];
    const ownerMeta: Record<string, unknown> = { ...(owner.app_metadata ?? {}) };
    ownerMeta["providers"] = ownerProviders;

    await client.auth.admin.updateUserById(plan.ownerId, {
      ...(plan.confirmOwnerEmail ? { email_confirm: true } : {}),
      app_metadata: ownerMeta,
    });

    for (const extraId of plan.extraIds) {
      await deleteOrDisableExtraUser(client, extraId, plan.ownerId);
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
    await collapseDuplicateIdentitiesToHouseholdOwner(
      users,
      households,
      admin as unknown as OpsAdminLike,
    );
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
    const sent = await opsAdminClient.auth.resend({ type: "signup", email: user.email, options: { emailRedirectTo: AUTH_REDIRECT } });
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
