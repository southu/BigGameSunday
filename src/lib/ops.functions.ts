import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export const loadOpsSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpsSnapshot> => {
    const { loadOpsSnapshotHandler } = await import("./ops.server");
    return loadOpsSnapshotHandler(context.claims);
  });

export const resendOpsConfirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId || typeof input.userId !== "string") throw new Error("Not found");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const { resendOpsConfirmHandler } = await import("./ops.server");
    return resendOpsConfirmHandler(context.claims, data.userId);
  });
