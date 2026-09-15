import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  canSkipWeek,
  nextWeekSlot,
  pickViewWeek,
  selectActiveWeek,
  shouldOpenExistingNextWeek,
  skipLockNeedsRefresh,
  skipTargetWeek,
  weekAtSlot,
  weekSwitcherLabel,
} from "../src/lib/current-week.ts";
import { WEEK_LONGSHOTS, insertMissingWeekLongshots, weekLongshotRows } from "../src/lib/nfl.ts";

function w(week_number: number, status: string, season_year = 2026) {
  return { season_year, week_number, status };
}

function wr(id: string, week_number: number, status: string, season_year = 2026) {
  return { id, season_year, week_number, status };
}

describe("selectActiveWeek", () => {
  it("prefers latest open or locked over any draft or final", () => {
    assert.equal(selectActiveWeek([w(1, "final"), w(2, "draft"), w(3, "locked")])?.week_number, 3);
    assert.equal(selectActiveWeek([w(1, "final"), w(2, "draft"), w(3, "open")])?.week_number, 3);
    assert.equal(selectActiveWeek([w(1, "final"), w(2, "draft")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "final"), w(2, "final")])?.week_number, 2);
  });

  it("never hides an open or locked week behind a newer draft", () => {
    assert.equal(selectActiveWeek([w(1, "locked"), w(2, "draft")])?.week_number, 1);
    assert.equal(selectActiveWeek([w(2, "draft"), w(1, "open")])?.week_number, 1);
  });

  it("never selects a draft when any open or locked week exists", () => {
    const picked = selectActiveWeek([w(1, "locked"), w(2, "draft"), w(3, "draft")]);
    assert.notEqual(picked?.status, "draft");
    assert.equal(picked?.week_number, 1);
  });

  it("picks the latest in-play week when more than one is open or locked", () => {
    assert.equal(selectActiveWeek([w(1, "locked"), w(2, "open")])?.week_number, 2);
  });

  it("falls back to the newest week overall when none are in play", () => {
    assert.equal(selectActiveWeek([w(1, "final"), w(2, "draft")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), w(2, "draft")])?.week_number, 2);
  });

  it("falls back to the latest final when there is no draft or in-play week", () => {
    assert.equal(selectActiveWeek([w(1, "final"), w(2, "final")])?.week_number, 2);
  });

  it("a: draft W1 + final W2 → active W2", () => {
    assert.equal(selectActiveWeek([w(1, "draft"), w(2, "final")])?.week_number, 2);
  });

  it("b: draft W1 + open W2 → active W2", () => {
    assert.equal(selectActiveWeek([w(1, "draft"), w(2, "open")])?.week_number, 2);
  });

  it("c: open W1 + draft W2 → active W1, W2 labeled Next week", () => {
    const open = wr("w1", 1, "open");
    const draft = wr("w2", 2, "draft");
    const active = selectActiveWeek([open, draft]);
    assert.equal(active?.week_number, 1);
    assert.equal(active?.id, "w1");
    assert.equal(weekSwitcherLabel(open, active), "This Sunday");
    assert.equal(weekSwitcherLabel(draft, active), "Next week");
    assert.equal(pickViewWeek([open, draft], active, null)?.id, "w1");
    assert.equal(pickViewWeek([open, draft], active, "next")?.id, "w2");
  });

  it("d: only final W1 → W1", () => {
    assert.equal(selectActiveWeek([w(1, "final")])?.week_number, 1);
  });

  it("e: skip path: final/skipped W1 + open W2 → W2", () => {
    assert.equal(selectActiveWeek([w(1, "final"), w(2, "open")])?.week_number, 2);
  });

  it("skip planner: leftover draft can close without Reveal and targets next week", () => {
    const draft = w(1, "draft");
    const nextDraft = w(2, "draft");
    assert.equal(canSkipWeek(draft), true);
    assert.equal(canSkipWeek(w(1, "open")), true);
    assert.equal(canSkipWeek(w(1, "locked")), true);
    assert.equal(canSkipWeek(w(1, "final")), false);
    assert.deepEqual(nextWeekSlot(draft), { season_year: 2026, week_number: 2 });
    assert.deepEqual(nextWeekSlot(w(18, "draft")), { season_year: 2027, week_number: 1 });
    assert.equal(weekAtSlot([draft, nextDraft], nextWeekSlot(draft))?.week_number, 2);
    assert.equal(weekAtSlot([draft], nextWeekSlot(draft)), undefined);
  });

  it("skip reopens a premature-final next week so the family can play it", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    assert.equal(canSkipWeek(leftover), true);
    assert.equal(skipTargetWeek([leftover, premature], leftover)?.week_number, 1);
    assert.equal(skipTargetWeek([leftover, premature], premature)?.week_number, 1);
    assert.equal(skipTargetWeek([w(1, "final"), w(2, "final")], w(2, "final")), null);
    assert.equal(skipTargetWeek([w(1, "open"), w(2, "final")], w(2, "final")), null);
    assert.equal(skipTargetWeek([w(1, "open"), w(2, "draft")], w(1, "open"))?.week_number, 1);
    const next = weekAtSlot([leftover, premature], nextWeekSlot(leftover));
    assert.equal(next?.status, "final");
    assert.equal(shouldOpenExistingNextWeek(next), true);
    assert.equal(shouldOpenExistingNextWeek(w(2, "draft")), true);
    assert.equal(shouldOpenExistingNextWeek(w(2, "locked")), true);
    assert.equal(shouldOpenExistingNextWeek(w(2, "open")), false);
    assert.equal(shouldOpenExistingNextWeek(undefined), false);
    const after = [w(1, "final"), w(2, "open")];
    assert.equal(selectActiveWeek(after)?.week_number, 2);
    assert.equal(selectActiveWeek(after)?.status, "open");
  });

  it("skip refreshes a past lock so Tuesday reopen stays playable", () => {
    const now = Date.parse("2026-09-15T16:00:00.000Z");
    assert.equal(skipLockNeedsRefresh("2026-09-13T17:00:00.000Z", now), true);
    assert.equal(skipLockNeedsRefresh("2026-09-20T17:00:00.000Z", now), false);
    assert.equal(skipLockNeedsRefresh(null, now), false);
  });

  it("returns null for an empty list", () => {
    assert.equal(selectActiveWeek([]), null);
  });

  it("an older-season locked week still beats a newer-season draft", () => {
    const picked = selectActiveWeek([w(18, "locked", 2025), w(1, "draft", 2026)]);
    assert.equal(picked?.season_year, 2025);
    assert.equal(picked?.status, "locked");
  });
});

describe("weekSwitcherLabel and pickViewWeek", () => {
  const locked = wr("w1", 1, "locked");
  const draft = wr("w2", 2, "draft");
  const older = wr("w0", 18, "final", 2025);
  const weeks = [older, locked, draft];

  it("labels This Sunday and Next week without hiding the locked week", () => {
    assert.equal(weekSwitcherLabel(locked, locked), "This Sunday");
    assert.equal(weekSwitcherLabel(draft, locked), "Next week");
    assert.equal(weekSwitcherLabel(older, locked), "Week 18");
  });

  it("defaults to the active week; next or an id reaches the newer draft", () => {
    const active = selectActiveWeek(weeks);
    assert.equal(active?.id, "w1");
    assert.equal(pickViewWeek(weeks, active, null)?.id, "w1");
    assert.equal(pickViewWeek(weeks, active, "next")?.id, "w2");
    assert.equal(pickViewWeek(weeks, active, "w2")?.id, "w2");
    assert.equal(selectActiveWeek(weeks)?.status, "locked");
  });
});

describe("useCurrentWeek production wiring", () => {
  it("db.ts selects the active week through selectActiveWeek, not LIMIT 1", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/db.ts"), "utf8");
    const fn = src.slice(src.indexOf("export function useCurrentWeek"));
    assert.match(src, /import \{ selectActiveWeek \} from "\.\/current-week"/);
    assert.match(fn, /select:\s*\(weeks\)\s*=>\s*selectActiveWeek\(weeks\)/);
    assert.doesNotMatch(fn.slice(0, fn.indexOf("export function useWeekGames")), /\.limit\(1\)/);
  });

  it("profile and default week routes read the active week from useCurrentWeek", () => {
    const profile = readFileSync(join(process.cwd(), "src/lib/profile.tsx"), "utf8");
    assert.match(profile, /useCurrentWeek/);
    assert.match(profile, /week:\s*weekQ\.data/);
    for (const file of ["week.tsx", "card.tsx", "live.tsx", "results.tsx", "commissioner.tsx"]) {
      const route = readFileSync(join(process.cwd(), "src/routes/_authenticated", file), "utf8");
      assert.match(route, /useProfile/);
    }
  });

  it("commissioner can switch to a newer draft while the locked week stays the default", () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"),
      "utf8",
    );
    assert.match(src, /weekSwitcherLabel/);
    assert.match(src, /This Sunday/);
    assert.match(src, /Next week/);
    assert.match(src, /useHouseholdWeeks/);
    assert.match(src, /setViewWeekId/);
    assert.match(src, /pickViewWeek/);
    assert.match(src, /week:\s*"next"/);
  });

  it("commissioner skip closes a leftover week without Reveal and opens the next", () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"),
      "utf8",
    );
    assert.match(src, /skipAndStartNext/);
    assert.match(src, /Skip this week \/ start next week/);
    assert.match(src, /without Reveal/);
    assert.match(src, /canSkipWeek/);
    assert.match(src, /skipTargetWeek/);
    assert.match(src, /nextWeekSlot/);
    const skipFn = src.slice(
      src.indexOf("const skipAndStartNext"),
      src.indexOf("const toggleHold"),
    );
    assert.match(skipFn, /skipTargetWeek/);
    assert.match(skipFn, /status:\s*"final"/);
    assert.match(skipFn, /status:\s*"open"/);
    assert.match(skipFn, /shouldOpenExistingNextWeek/);
    assert.match(skipFn, /finalized_at:\s*null/);
    assert.match(skipFn, /skipLockNeedsRefresh/);
    assert.doesNotMatch(skipFn, /next\?\.status === "draft"/);
    assert.doesNotMatch(skipFn, /finalize:\s*true/);
    assert.doesNotMatch(skipFn, /runRecompute/);
    assert.doesNotMatch(skipFn, /Head to the Reveal/);
  });

  it("commissioner copy does not use gambling vocabulary", () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"),
      "utf8",
    );
    assert.doesNotMatch(src, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
  });

  it("autopilot still advances every non-final week and can create the next draft", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/autopilot.server.ts"), "utf8");
    assert.match(src, /ensureNextWeek/);
    assert.match(src, /\.neq\("status", "final"\)/);
    assert.match(src, /for \(const week of/);
    const autofill = readFileSync(join(process.cwd(), "src/lib/autofill.server.ts"), "utf8");
    assert.match(autofill, /auto_create_weeks/);
  });
});

describe("week longshot set", () => {
  const GAMBLE = /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i;

  it("documents Sunday longshots with manual resolution so cards can lock", () => {
    const rows = weekLongshotRows({ id: "w", household_id: "h" });
    assert.ok(rows.length >= 4);
    assert.equal(rows.length, WEEK_LONGSHOTS.length);
    for (const row of rows) {
      assert.equal(row.is_longshot, true);
      assert.equal(row.resolution_source, "manual");
      assert.equal(row.game_id, null);
      assert.doesNotMatch(row.description, GAMBLE);
    }
    const blob = WEEK_LONGSHOTS.join(" ").toLowerCase();
    assert.match(blob, /safety/);
    assert.match(blob, /defensive/);
    assert.match(blob, /overtime/);
    assert.match(blob, /55/);
  });

  it("skips longshots that are already on the week", () => {
    const rows = weekLongshotRows({ id: "w", household_id: "h" }, [WEEK_LONGSHOTS[0]]);
    assert.equal(rows.length, WEEK_LONGSHOTS.length - 1);
    assert.equal(weekLongshotRows({ id: "w", household_id: "h" }, WEEK_LONGSHOTS).length, 0);
  });

  it("backfills longshots onto a week that already has only score moments", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  data: [{ description: "Chiefs win by MORE than 3?" }],
                  error: null,
                };
              },
            };
          },
          insert(rows: Record<string, unknown>[]) {
            inserted.push(...rows);
            return { error: null };
          },
        };
      },
    };
    const n = await insertMissingWeekLongshots(db, { id: "w", household_id: "h" });
    assert.equal(n, WEEK_LONGSHOTS.length);
    assert.equal(inserted.length, WEEK_LONGSHOTS.length);
    for (const row of inserted) {
      assert.equal(row.is_longshot, true);
      assert.equal(row.resolution_source, "manual");
      assert.equal(row.game_id, null);
      assert.doesNotMatch(String(row.description), GAMBLE);
    }
  });

  it("autofill and addGame insert the documented longshot set", () => {
    const autofill = readFileSync(join(process.cwd(), "src/lib/autofill.server.ts"), "utf8");
    assert.match(autofill, /insertMissingWeekLongshots/);
    const fillFn = autofill.slice(autofill.indexOf("export async function fillWeekFromEspn"));
    assert.match(fillFn, /insertMissingWeekLongshots/);
    assert.doesNotMatch(
      fillFn.slice(0, fillFn.indexOf("insertMissingWeekLongshots")),
      /if \(!fresh\.length\) return result/,
    );
    const commish = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"),
      "utf8",
    );
    assert.match(commish, /weekLongshotRows/);
    assert.doesNotMatch(commish, GAMBLE);
    const nfl = readFileSync(join(process.cwd(), "src/lib/nfl.ts"), "utf8");
    assert.match(nfl, /export async function insertMissingWeekLongshots/);
    assert.doesNotMatch(nfl, GAMBLE);
  });
});
