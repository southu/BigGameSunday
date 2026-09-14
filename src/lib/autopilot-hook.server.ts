/**
 * Public autopilot hook body. Server-only — dynamically imported from the route
 * so AUTOPILOT_CRON_SECRET never lands in the client bundle.
 */
import { autopilotHookAuthorized, providedAutopilotSecret } from "./autopilot-hook-auth";

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function publishableKeys(): string[] {
  return [
    process.env["SUPABASE_ANON_KEY"],
    process.env["SUPABASE_PUBLISHABLE_KEY"],
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
  ].filter((value): value is string => Boolean(value));
}

async function heartbeatIfQuiet(
  db: { from: (table: string) => any },
  actions: { household_id: string }[],
) {
  if (actions.length > 0) return;
  try {
    const { data: households } = await db.from("households").select("id");
    for (const household of (households ?? []) as { id: string }[]) {
      await db.from("autopilot_log").insert({
        household_id: household.id,
        week_id: null,
        action: "checked",
        detail: "Autopilot checked in — nothing to do just yet.",
        status: "ok",
      });
    }
  } catch {
    /* logging must never break the run */
  }
}

export async function handleAutopilotHook(request: Request): Promise<Response> {
  const cronSecret = process.env["AUTOPILOT_CRON_SECRET"] ?? "";
  const provided = providedAutopilotSecret(request.headers);
  if (!autopilotHookAuthorized({ provided, cronSecret, publishableKeys: publishableKeys() })) {
    return unauthorized();
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runAutopilot } = await import("@/lib/autopilot.server");
    const db = supabaseAdmin as unknown as { from: (t: string) => any };
    const { actions } = await runAutopilot(db);
    await heartbeatIfQuiet(db, actions);
    return Response.json({ ok: true, actions }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[autopilot]", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Autopilot failed" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
