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
 * Server-to-client boundary. Route UI never imports the allowlist;
 * handlers live in ops.server.ts and are loaded only from server modules.
 */
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
