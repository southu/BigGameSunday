/** Auto-fill helpers: build a week's games + standard moments from the ESPN scoreboard. */
import { fetchEspnWeek } from "./espn.server";
import { standardEvents } from "./nfl";

type Db = { from: (table: string) => any };

export type FillResult = {
  gamesAdded: number;
  momentsAdded: number;
  skipped: number;
  needsReview: number;
};

export async function fillWeekFromEspn(
  db: Db,
  week: { id: string; household_id: string; season_year: number; week_number: number; featured_game_id: string | null; lock_at_override: boolean },
): Promise<FillResult> {
  const espnGames = await fetchEspnWeek(week.season_year, week.week_number);
  if (!espnGames.length) throw new Error("ESPN had no games for that week yet.");

  const { data: existing, error: exErr } = await db
    .from("games")
    .select("id, espn_event_id, kickoff_at")
    .eq("week_id", week.id);
  if (exErr) throw exErr;
  const taken = new Set(
    ((existing ?? []) as any[]).map((g) => g.espn_event_id).filter(Boolean) as string[],
  );

  const fresh = espnGames.filter((g) => g.espn_event_id && !taken.has(g.espn_event_id));
  const result: FillResult = {
    gamesAdded: 0,
    momentsAdded: 0,
    skipped: espnGames.length - fresh.length,
    needsReview: fresh.filter((g) => g.needs_review).length,
  };
  if (!fresh.length) return result;

  const { data: inserted, error } = await db
    .from("games")
    .insert(
      fresh.map((g) => ({
        week_id: week.id,
        household_id: week.household_id,
        home_team: g.home_team,
        away_team: g.away_team,
        kickoff_at: g.kickoff_at,
        underdog_team: g.underdog_team,
        upset_size: g.upset_size,
        needs_review: g.needs_review,
        espn_event_id: g.espn_event_id,
      })),
    )
    .select("id, home_team, away_team, underdog_team, upset_size, kickoff_at");
  if (error) throw error;

  const rows = (inserted ?? []) as any[];
  result.gamesAdded = rows.length;

  const moments = rows.flatMap((g) =>
    standardEvents({
      home_team: g.home_team,
      away_team: g.away_team,
      underdog_team: g.underdog_team,
      upset_size: Number(g.upset_size),
    }).map((description) => ({
      week_id: week.id,
      household_id: week.household_id,
      game_id: g.id,
      description,
      is_longshot: false,
      resolution_source: "auto_score" as const,
    })),
  );
  if (moments.length) {
    const { error: mErr } = await db.from("events").insert(moments);
    if (mErr) throw mErr;
    result.momentsAdded = moments.length;
  }

  const patch: Record<string, unknown> = {};
  if (!week.featured_game_id && rows[0]) patch["featured_game_id"] = rows[0].id;
  if (!week.lock_at_override) {
    const times = [...((existing ?? []) as any[]), ...rows]
      .map((g) => g.kickoff_at)
      .filter(Boolean)
      .map((k: string) => new Date(k).getTime());
    if (times.length) patch["lock_at"] = new Date(Math.min(...times)).toISOString();
  }
  if (Object.keys(patch).length) await db.from("weeks").update(patch).eq("id", week.id);

  return result;
}

const FOUR_DAYS_MS = 4 * 86400000;

/** Create + auto-fill the next week when its first kickoff is within 4 days. */
export async function ensureNextWeek(
  db: Db,
  householdId: string,
): Promise<{ created: boolean; weekNumber?: number; reason?: string }> {
  const { data: household, error: hErr } = await db
    .from("households")
    .select("id, auto_create_weeks")
    .eq("id", householdId)
    .maybeSingle();
  if (hErr) throw hErr;
  if (!household?.auto_create_weeks) return { created: false, reason: "off" };

  const { data: weeks, error: wErr } = await db
    .from("weeks")
    .select("id, season_year, week_number")
    .eq("household_id", householdId)
    .order("season_year", { ascending: false })
    .order("week_number", { ascending: false })
    .limit(1);
  if (wErr) throw wErr;

  const last = ((weeks ?? []) as any[])[0];
  const seasonYear: number = last?.season_year ?? new Date().getFullYear();
  const weekNumber: number = (last?.week_number ?? 0) + 1;
  if (weekNumber > 18) return { created: false, reason: "season-complete" };

  const espnGames = await fetchEspnWeek(seasonYear, weekNumber);
  const kickoffs = espnGames.map((g) => g.kickoff_at).filter(Boolean) as string[];
  if (!kickoffs.length) return { created: false, reason: "no-schedule" };
  const earliest = new Date(kickoffs.sort()[0]!).getTime();
  if (earliest - Date.now() > FOUR_DAYS_MS) return { created: false, reason: "too-early" };

  const { data: created, error: cErr } = await db
    .from("weeks")
    .insert({
      household_id: householdId,
      season_year: seasonYear,
      week_number: weekNumber,
      lock_at: new Date(earliest).toISOString(),
      status: "draft",
      auto_created_at: new Date().toISOString(),
    })
    .select("id, household_id, season_year, week_number, featured_game_id, lock_at_override")
    .single();
  if (cErr) throw cErr;

  await fillWeekFromEspn(db, created as any);
  return { created: true, weekNumber };
}
