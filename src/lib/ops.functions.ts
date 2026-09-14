export type OpsUser = {
  id: string;
  email: string | null;
  email_confirmed_at: string | null;
  confirmation_sent_at: string | null;
  created_at: string;
};

export type OpsHousehold = {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
};

export type OpsSnapshot = {
  users: OpsUser[];
  households: OpsHousehold[];
  missingEnv?: string[];
};

/**
 * Server-to-client boundary (Astro equivalent of createServerFn).
 * Route UI never imports the allowlist or service role; handlers live in
 * ops.server.ts and are loaded only from server modules / API routes.
 */
export async function gateOpsRequest(request: Request): Promise<{ email?: unknown }> {
  const { getOpsClaimsFromRequest, assertOps } = await import("./ops.server");
  const claims = await getOpsClaimsFromRequest(request);
  assertOps(claims);
  return claims;
}

export async function loadOpsSnapshot(claims: { email?: unknown }): Promise<OpsSnapshot> {
  const { loadOpsSnapshotHandler } = await import("./ops.server");
  return loadOpsSnapshotHandler(claims);
}

export async function resendOpsConfirm(
  claims: { email?: unknown },
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { resendOpsConfirmHandler } = await import("./ops.server");
  return resendOpsConfirmHandler(claims, userId);
}
