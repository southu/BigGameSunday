import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeWeekScores } from "./finalize";

/** Run an autopilot pass for the caller's own household, right now. */
export const runAutopilotNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { householdId: string }) => {
    if (!input?.householdId) throw new Error("Missing household.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as { from: (t: string) => any };
    const { data: owned, error } = await db
      .from("households")
      .select("id")
      .eq("id", data.householdId)
      .maybeSingle();
    if (error) throw error;
    if (!owned) throw new Error("That household isn't yours.");

    const { runAutopilot } = await import("./autopilot.server");
    return await runAutopilot(db, { householdId: data.householdId });
  });

/**
 * Persist first_line_at and four-key rank (grid_score, hits, upset_score, earliest first_line_at).
 * Commissioner Finalize and post-finalize recompute share this function — ranks are not rewritten
 * mid-season without an explicit recompute.
 */
export const recomputeWeekScores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { weekId: string; finalize?: boolean }) => {
    if (!input?.weekId) throw new Error("Missing week.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as { from: (t: string) => any };
    const out = await computeWeekScores(db, data.weekId, { finalize: !!data.finalize });
    return {
      cards: out.rows.length,
      missedManual: out.missedManual,
      winnerCardId: out.winnerCardId,
    };
  });

/** Alias kept so existing commissioner imports keep working. */
export const recomputeWeek = recomputeWeekScores;
