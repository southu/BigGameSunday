import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const autoFillWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { weekId: string }) => {
    if (!input?.weekId) throw new Error("Missing week.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { fillWeekFromEspn } = await import("./autofill.server");
    const db = context.supabase as unknown as { from: (t: string) => any };
    const { data: week, error } = await db
      .from("weeks")
      .select("id, household_id, season_year, week_number, featured_game_id, lock_at_override")
      .eq("id", data.weekId)
      .maybeSingle();
    if (error) throw error;
    if (!week) throw new Error("Week not found.");
    return await fillWeekFromEspn(db, week as any);
  });

export const ensureAutoWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { householdId: string }) => {
    if (!input?.householdId) throw new Error("Missing household.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { ensureNextWeek } = await import("./autofill.server");
    const db = context.supabase as unknown as { from: (t: string) => any };
    return await ensureNextWeek(db, data.householdId);
  });
