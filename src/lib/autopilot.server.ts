/**
 * Autopilot: keeps every week moving without the Commissioner touching anything.
 * open (24h after auto-create) -> lock (at lock_at) -> resolve scores -> finalize (Tue 6:00 AM ET).
 */
import { computeWeekScores } from "./finalize";
import { fetchEspnScores, fetchFirstScoreWasTouchdown } from "./espn.server";
import { ensureNextWeek } from "./autofill.server";
import { DAY_MS, tuesdaySixAmEtAfter } from "./autopilot-schedule";

type Db = { from: (table: string) => any };

export type AutopilotAction = {
  household_id: string;
  week_id: string | null;
  action: string;
  detail: string;
  status: "ok" | "error";
};

type WeekRow = {
  id: string;
  household_id: string;
  season_year: number;
  week_number: number;
  status: string;
  lock_at: string | null;
  auto_created_at: string | null;
  commissioner_edited_at: string | null;
  autopilot_hold: boolean;
};

type GameRow = {
  id: string;
  espn_event_id: string | null;
  home_team: string;
  away_team: string;
  underdog_team: string | null;
  upset_size: number;
  home_score: number | null;
  away_score: number | null;
  upset_won: boolean | null;
};

/** Pull live/final scores and resolve every auto_score moment + upset outcome. */
export async function resolveWeekFromEspn(db: Db, week: WeekRow) {
  const scores = await fetchEspnScores(week.season_year, week.week_number);
  const byId = new Map(scores.map((s) => [s.espn_event_id, s]));
  const byTeams = new Map(scores.map((s) => [`${s.away_team}@${s.home_team}`, s]));

  const { data: games, error: gErr } = await db
    .from("games")
    .select(
      "id, espn_event_id, home_team, away_team, underdog_team, upset_size, home_score, away_score, upset_won",
    )
    .eq("week_id", week.id);
  if (gErr) throw gErr;

  const { data: events, error: eErr } = await db
    .from("events")
    .select("id, game_id, description, result, resolution_source")
    .eq("week_id", week.id)
    .eq("resolution_source", "auto_score")
    .is("result", null);
  if (eErr) throw eErr;

  let scoresUpdated = 0;
  let momentsResolved = 0;
  let upsetsSettled = 0;
  const now = new Date().toISOString();

  for (const game of ((games ?? []) as GameRow[])) {
    const live =
      (game.espn_event_id ? byId.get(game.espn_event_id) : undefined) ??
      byTeams.get(`${game.away_team}@${game.home_team}`);
    if (!live || live.state === "pre") continue;

    if (live.home_score !== game.home_score || live.away_score !== game.away_score) {
      await db
        .from("games")
        .update({ home_score: live.home_score, away_score: live.away_score })
        .eq("id", game.id);
      scoresUpdated++;
    }

    const home = live.home_score ?? 0;
    const away = live.away_score ?? 0;

    if (live.completed) {
      const underdog = game.underdog_team;
      const dogScore = underdog === game.home_team ? home : away;
      const favScore = underdog === game.home_team ? away : home;
      const won = dogScore > favScore;
      if (game.upset_won !== won) {
        await db.from("games").update({ upset_won: won }).eq("id", game.id);
        upsetsSettled++;
      }
    }

    for (const ev of ((events ?? []) as any[]).filter((e) => e.game_id === game.id)) {
      const desc = String(ev.description);
      let result: "hit" | "miss" | null = null;

      const winBy = desc.match(/^(.+?)\s+wins?\s+by\s+MORE\s+than\s+([\d.]+)/i);
      const total = desc.match(/combine\s+for\s+(\d+)\+\s+points/i);
      const firstScore = /first\s+score/i.test(desc) && /touchdown/i.test(desc);

      if (winBy && live.completed) {
        const team = winBy[1]!.trim();
        const margin = team === game.home_team ? home - away : away - home;
        result = margin > Number(winBy[2]) ? "hit" : "miss";
      } else if (total) {
        const target = Number(total[1]);
        if (home + away >= target) result = "hit";
        else if (live.completed) result = "miss";
      } else if (firstScore && game.espn_event_id) {
        const wasTd = await fetchFirstScoreWasTouchdown(game.espn_event_id);
        if (wasTd !== null) result = wasTd ? "hit" : "miss";
      }

      if (result) {
        await db.from("events").update({ result, resolved_at: now }).eq("id", ev.id);
        momentsResolved++;
      }
    }
  }

  await db.from("weeks").update({ autopilot_checked_at: now }).eq("id", week.id);
  return { scoresUpdated, momentsResolved, upsetsSettled };
}

async function logAction(db: Db, action: AutopilotAction) {
  await db.from("autopilot_log").insert({
    household_id: action.household_id,
    week_id: action.week_id,
    action: action.action,
    detail: action.detail,
    status: action.status,
  });
}

/** One autopilot pass. Called from the scheduled hook and from the panel's "run now". */
export async function runAutopilot(
  db: Db,
  opts: { householdId?: string } = {},
): Promise<{ actions: AutopilotAction[] }> {
  const actions: AutopilotAction[] = [];
  const record = async (a: AutopilotAction) => {
    actions.push(a);
    try {
      await logAction(db, a);
    } catch {
      /* logging must never break the run */
    }
  };

  let householdsQuery = db.from("households").select("id, auto_create_weeks");
  if (opts.householdId) householdsQuery = householdsQuery.eq("id", opts.householdId);
  const { data: households, error: hErr } = await householdsQuery;
  if (hErr) throw hErr;

  for (const household of ((households ?? []) as any[])) {
    const hid = household.id as string;

    if (household.auto_create_weeks) {
      try {
        const res = await ensureNextWeek(db, hid);
        if (res.created) {
          await record({
            household_id: hid,
            week_id: null,
            action: "week_created",
            detail: `Week ${res.weekNumber} created in draft with the real NFL schedule filled in.`,
            status: "ok",
          });
        }
      } catch (e) {
        await record({
          household_id: hid,
          week_id: null,
          action: "week_created",
          detail: `Couldn't auto-create the next week: ${message(e)}`,
          status: "error",
        });
      }
    }

    const { data: weeks, error: wErr } = await db
      .from("weeks")
      .select(
        "id, household_id, season_year, week_number, status, lock_at, auto_created_at, commissioner_edited_at, autopilot_hold",
      )
      .eq("household_id", hid)
      .neq("status", "final");
    if (wErr) throw wErr;

    for (const week of ((weeks ?? []) as WeekRow[])) {
      if (week.autopilot_hold) continue;
      try {
        await advanceWeek(db, week, record);
      } catch (e) {
        await record({
          household_id: hid,
          week_id: week.id,
          action: "error",
          detail: `Week ${week.week_number}: ${message(e)} — autopilot will retry, and you can still do it by hand.`,
          status: "error",
        });
      }
    }
  }

  return { actions };
}

async function advanceWeek(
  db: Db,
  week: WeekRow,
  record: (a: AutopilotAction) => Promise<void>,
) {
  const now = Date.now();
  const base = { household_id: week.household_id, week_id: week.id, status: "ok" as const };

  // 1. Auto-open 24h after auto-creation, unless the Commissioner already touched it.
  if (week.status === "draft") {
    if (!week.auto_created_at || week.commissioner_edited_at) return;
    if (now - new Date(week.auto_created_at).getTime() < DAY_MS) return;
    const { error } = await db
      .from("weeks")
      .update({ status: "open", auto_opened_at: new Date().toISOString() })
      .eq("id", week.id);
    if (error) throw error;
    week.status = "open";
    await record({
      ...base,
      action: "week_opened",
      detail: `Week ${week.week_number} is open — the family can fill their cards.`,
    });
  }

  // 2. Auto-lock by timestamp, no button needed.
  if (week.status === "open" && week.lock_at && now >= new Date(week.lock_at).getTime()) {
    const stamp = new Date().toISOString();
    const { error } = await db
      .from("weeks")
      .update({ status: "locked", auto_locked_at: stamp })
      .eq("id", week.id);
    if (error) throw error;
    await db.from("cards").update({ locked_at: stamp }).eq("week_id", week.id).is("locked_at", null);
    week.status = "locked";
    await record({
      ...base,
      action: "week_locked",
      detail: `Week ${week.week_number} cards locked at kickoff.`,
    });
  }

  if (week.status !== "locked") return;

  // 3. Resolve scores while games are on (and after they end).
  const res = await resolveWeekFromEspn(db, week);
  if (res.momentsResolved || res.upsetsSettled) {
    await record({
      ...base,
      action: "scores_resolved",
      detail: `Week ${week.week_number}: called ${res.momentsResolved} moments and settled ${res.upsetsSettled} upset watches from the live scores.`,
    });
  }

  // 4. Finalize Tuesday 6:00 AM ET after lock.
  if (!week.lock_at) return;
  const finalizeAt = tuesdaySixAmEtAfter(new Date(week.lock_at));
  if (now < finalizeAt.getTime()) return;

  const out = await computeWeekScores(db, week.id, { finalize: true });
  await record({
    ...base,
    action: "week_finalized",
    detail: `Week ${week.week_number} finalized — ${out.rows.length} cards scored${
      out.missedManual ? `, ${out.missedManual} uncalled moments counted as misses` : ""
    }. Trophy awarded and standings updated.`,
  });
}

function message(e: unknown) {
  return e instanceof Error ? e.message : "unknown problem";
}
