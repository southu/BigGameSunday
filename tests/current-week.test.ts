import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canSkipWeek,
  nextWeekSlot,
  pickViewWeek,
  selectActiveWeek,
  shouldOpenExistingNextWeek,
  skipClearsCalledMoments,
  skipClearsGameOutcomes,
  skipControlCopy,
  skipLockAfterAutofill,
  skipLockNeedsRefresh,
  skipTargetWeek,
  skipUnlocksCards,
  skipUnlocksCardsOnLockRefresh,
  weekAtSlot,
  weekSwitcherLabel,
} from "../src/lib/current-week";
import { WEEK_LONGSHOTS, insertMissingWeekLongshots, weekLongshotRows } from "../src/lib/nfl";

function w(week_number: number, status: string, season_year = 2026) {
  return { season_year, week_number, status };
}

function wr(id: string, week_number: number, status: string, season_year = 2026) {
  return { id, season_year, week_number, status };
}

describe("selectActiveWeek", () => {
  it("prefers latest open or locked over any draft or final", () => {
    expect(selectActiveWeek([w(1, "final"), w(2, "draft"), w(3, "locked")])?.week_number).toBe(3);
    expect(selectActiveWeek([w(1, "final"), w(2, "draft"), w(3, "open")])?.week_number).toBe(3);
    expect(selectActiveWeek([w(1, "final"), w(2, "draft")])?.week_number).toBe(2);
    expect(selectActiveWeek([w(1, "final"), w(2, "final")])?.week_number).toBe(2);
  });

  it("never hides an open or locked week behind a newer draft", () => {
    expect(selectActiveWeek([w(1, "locked"), w(2, "draft")])?.week_number).toBe(1);
    expect(selectActiveWeek([w(2, "draft"), w(1, "open")])?.week_number).toBe(1);
  });

  it("never selects a draft when any open or locked week exists", () => {
    const picked = selectActiveWeek([w(1, "locked"), w(2, "draft"), w(3, "draft")]);
    expect(picked?.status).not.toBe("draft");
    expect(picked?.week_number).toBe(1);
  });

  it("picks the latest in-play week when more than one is open or locked", () => {
    expect(selectActiveWeek([w(1, "locked"), w(2, "open")])?.week_number).toBe(2);
  });

  it("falls back to the newest week overall when none are in play", () => {
    expect(selectActiveWeek([w(1, "final"), w(2, "draft")])?.week_number).toBe(2);
    expect(selectActiveWeek([w(1, "draft"), w(2, "final")])?.week_number).toBe(2);
    expect(selectActiveWeek([w(1, "draft"), w(2, "draft")])?.week_number).toBe(2);
  });

  it("falls back to the latest final when there is no draft or in-play week", () => {
    expect(selectActiveWeek([w(1, "final"), w(2, "final")])?.week_number).toBe(2);
  });

  it("a: draft W1 + final W2 → active W2", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    const forward = selectActiveWeek([leftover, premature]);
    const reverse = selectActiveWeek([premature, leftover]);
    expect(forward?.week_number).toBe(2);
    expect(forward?.status).toBe("final");
    expect(reverse?.week_number).toBe(2);
    expect(reverse?.status).toBe("final");
  });

  it("b: draft W1 + open W2 → active W2", () => {
    const leftover = w(1, "draft");
    const open = w(2, "open");
    expect(selectActiveWeek([leftover, open])?.week_number).toBe(2);
    expect(selectActiveWeek([open, leftover])?.week_number).toBe(2);
    expect(selectActiveWeek([leftover, open])?.status).toBe("open");
    expect(selectActiveWeek([leftover, w(2, "locked")])?.week_number).toBe(2);
  });

  it("c: open W1 + draft W2 → active W1, W2 labeled Next week", () => {
    const open = wr("w1", 1, "open");
    const draft = wr("w2", 2, "draft");
    const active = selectActiveWeek([open, draft]);
    expect(active?.week_number).toBe(1);
    expect(active?.id).toBe("w1");
    expect(weekSwitcherLabel(open, active)).toBe("This Sunday");
    expect(weekSwitcherLabel(draft, active)).toBe("Next week");
    expect(pickViewWeek([open, draft], active, null)?.id).toBe("w1");
    expect(pickViewWeek([open, draft], active, "next")?.id).toBe("w2");
  });

  it("d: only final W1 → W1", () => {
    expect(selectActiveWeek([w(1, "final")])?.week_number).toBe(1);
  });

  it("e: skip path: final/skipped W1 + open W2 → W2", () => {
    const skipped = w(1, "final");
    const open = w(2, "open");
    const picked = selectActiveWeek([skipped, open]);
    expect(picked?.week_number).toBe(2);
    expect(picked?.status).toBe("open");
    expect(selectActiveWeek([open, skipped])?.week_number).toBe(2);
  });

  it("skip path: leftover draft behind playable W2 closes W1, not W2", () => {
    const leftover = w(1, "draft");
    const open = w(2, "open");
    const target = skipTargetWeek([leftover, open], open);
    expect(target?.week_number).toBe(1);
    expect(target?.status).toBe("draft");
    expect(skipTargetWeek([leftover, w(2, "draft")], w(2, "draft"))?.week_number).toBe(1);
    const after = [w(1, "final"), open];
    expect(selectActiveWeek(after)?.week_number).toBe(2);
    expect(selectActiveWeek(after)?.status).toBe("open");
  });

  it("never prefers an older leftover draft over a newer week of any status", () => {
    expect(selectActiveWeek([w(1, "draft"), w(2, "final"), w(3, "draft")])?.week_number).toBe(3);
    expect(selectActiveWeek([w(3, "final"), w(1, "draft"), w(2, "draft")])?.week_number).toBe(3);
    expect(selectActiveWeek([w(2, "final"), w(1, "draft")])?.status).toBe("final");
  });

  it("selectActiveWeek does not rank draft above final as a class", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/current-week.ts"), "utf8");
    const start = src.indexOf("function compareActiveWeek");
    const end = src.indexOf("export function nextWeekSlot");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).not.toMatch(/status === ["']draft["']/);
    expect(body).not.toMatch(/status === ["']final["']/);
    expect(src).not.toMatch(/ranked\.find\(\(w\) => w\.status === "draft"\)/);
    expect(src).not.toMatch(/else latest draft/);
  });

  it("does not label This Sunday when the active week is a newer final", () => {
    const leftover = wr("w1", 1, "draft");
    const premature = wr("w2", 2, "final");
    const active = selectActiveWeek([leftover, premature]);
    expect(active?.id).toBe("w2");
    expect(weekSwitcherLabel(leftover, active)).toBe("Week 1");
    expect(weekSwitcherLabel(premature, active)).toBe("Week 2");
  });

  it("skip planner: leftover draft can close without Reveal and targets next week", () => {
    const draft = w(1, "draft");
    const nextDraft = w(2, "draft");
    expect(canSkipWeek(draft)).toBe(true);
    expect(canSkipWeek(w(1, "open"))).toBe(true);
    expect(canSkipWeek(w(1, "locked"))).toBe(true);
    expect(canSkipWeek(w(1, "final"))).toBe(false);
    expect(nextWeekSlot(draft)).toEqual({ season_year: 2026, week_number: 2 });
    expect(nextWeekSlot(w(18, "draft"))).toEqual({ season_year: 2027, week_number: 1 });
    expect(weekAtSlot([draft, nextDraft], nextWeekSlot(draft))?.week_number).toBe(2);
    expect(weekAtSlot([draft], nextWeekSlot(draft))).toBeUndefined();
  });

  it("skip reopens a premature-final next week so the family can play it", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    expect(canSkipWeek(leftover)).toBe(true);
    expect(skipTargetWeek([leftover, premature], leftover)?.week_number).toBe(1);
    expect(skipTargetWeek([leftover, premature], premature)?.week_number).toBe(1);
    expect(skipTargetWeek([w(1, "final"), w(2, "final")], w(2, "final"))).toBeNull();
    expect(skipTargetWeek([w(1, "open"), w(2, "final")], w(2, "final"))).toBeNull();
    expect(skipTargetWeek([w(1, "open"), w(2, "draft")], w(1, "open"))?.week_number).toBe(1);
    expect(skipTargetWeek([leftover, w(2, "open")], w(2, "open"))?.week_number).toBe(1);
    expect(skipTargetWeek([leftover, w(2, "draft")], w(2, "draft"))?.week_number).toBe(1);
    expect(skipTargetWeek([leftover, w(2, "locked")], w(2, "locked"))?.week_number).toBe(1);
    const next = weekAtSlot([leftover, premature], nextWeekSlot(leftover));
    expect(next?.status).toBe("final");
    expect(shouldOpenExistingNextWeek(next)).toBe(true);
    expect(shouldOpenExistingNextWeek(w(2, "draft"))).toBe(true);
    expect(shouldOpenExistingNextWeek(w(2, "locked"))).toBe(true);
    expect(shouldOpenExistingNextWeek(w(2, "open"))).toBe(false);
    expect(shouldOpenExistingNextWeek(undefined)).toBe(false);
    expect(skipUnlocksCards(premature)).toBe(true);
    expect(skipUnlocksCards(w(2, "locked"))).toBe(true);
    expect(skipUnlocksCards(w(2, "draft"))).toBe(false);
    expect(skipUnlocksCards(w(2, "open"))).toBe(false);
    expect(skipClearsCalledMoments(premature)).toBe(true);
    expect(skipClearsCalledMoments(w(2, "locked"))).toBe(false);
    expect(skipClearsCalledMoments(w(2, "draft"))).toBe(false);
    expect(skipClearsCalledMoments(w(2, "open"))).toBe(false);
    expect(skipClearsGameOutcomes(premature)).toBe(true);
    expect(skipClearsGameOutcomes(w(2, "locked"))).toBe(false);
    expect(skipClearsGameOutcomes(w(2, "draft"))).toBe(false);
    expect(skipClearsGameOutcomes(w(2, "open"))).toBe(false);
    const after = [w(1, "final"), w(2, "open")];
    expect(selectActiveWeek(after)?.week_number).toBe(2);
    expect(selectActiveWeek(after)?.status).toBe("open");
  });

  it("skip scrubs premature finalize leftovers on an already-open next week", () => {
    const leftover = w(1, "draft");
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const cleanOpen = w(2, "open");
    const lockedWithStamp = { ...w(2, "locked"), finalized_at: "2026-09-15T19:04:43.880Z" };

    expect(shouldOpenExistingNextWeek(dirtyOpen)).toBe(true);
    expect(shouldOpenExistingNextWeek(cleanOpen)).toBe(false);
    expect(skipUnlocksCards(dirtyOpen)).toBe(true);
    expect(skipUnlocksCards(cleanOpen)).toBe(false);
    expect(skipClearsCalledMoments(dirtyOpen)).toBe(true);
    expect(skipClearsCalledMoments(cleanOpen)).toBe(false);
    expect(skipClearsCalledMoments(w(2, "locked"))).toBe(false);
    expect(skipClearsCalledMoments(lockedWithStamp)).toBe(false);
    expect(skipClearsGameOutcomes(dirtyOpen)).toBe(true);
    expect(skipClearsGameOutcomes(cleanOpen)).toBe(false);
    expect(skipClearsGameOutcomes(w(2, "locked"))).toBe(false);
    expect(skipClearsGameOutcomes(lockedWithStamp)).toBe(false);

    expect(skipTargetWeek([leftover, dirtyOpen], dirtyOpen)?.week_number).toBe(1);
    const after = [w(1, "final"), dirtyOpen];
    expect(selectActiveWeek(after)?.week_number).toBe(2);
    expect(selectActiveWeek(after)?.status).toBe("open");
  });

  it("skip copy names leftover draft when viewing a premature-final week", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    expect(skipControlCopy(leftover, leftover).button).toBe("Skip this week / start next week");
    expect(skipControlCopy(leftover, leftover).hint).toMatch(/without Reveal/);
    const copy = skipControlCopy(leftover, premature);
    expect(copy.button).toBe("Skip leftover Week 1 / open this week");
    expect(copy.hint).toMatch(/Week 1 is still a leftover draft/);
    expect(skipControlCopy(leftover, w(2, "open")).button).toBe("Skip leftover Week 1 / open this week");
    expect(copy.hint).toMatch(/without Reveal/);
    expect(copy.hint).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(copy.button).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
  });

  it("skip refreshes a past lock so Tuesday reopen stays playable", () => {
    const now = Date.parse("2026-09-15T16:00:00.000Z");
    expect(skipLockNeedsRefresh("2026-09-13T17:00:00.000Z", now)).toBe(true);
    expect(skipLockNeedsRefresh("2026-09-20T17:00:00.000Z", now)).toBe(false);
    expect(skipLockNeedsRefresh(null, now)).toBe(false);
  });

  it("skip keeps a future ESPN lock after autofill and only falls back to Sunday when the lock is past", () => {
    const now = Date.parse("2026-09-15T16:00:00.000Z");
    const sunday = "2026-09-20T17:00:00.000Z";
    const thursday = "2026-09-17T00:15:00.000Z";
    expect(skipLockAfterAutofill(thursday, sunday, now)).toBeUndefined();
    expect(skipLockAfterAutofill(sunday, sunday, now)).toBeUndefined();
    expect(skipLockAfterAutofill("2026-09-13T17:00:00.000Z", sunday, now)).toBe(sunday);
    expect(skipLockAfterAutofill(null, sunday, now)).toBeUndefined();
  });

  it("skip unlocks cards when a past lock is refreshed, not when ESPN kickoff is kept", () => {
    const now = Date.parse("2026-09-15T16:00:00.000Z");
    const sunday = "2026-09-20T17:00:00.000Z";
    const thursday = "2026-09-17T00:15:00.000Z";
    expect(skipUnlocksCards(w(2, "open"))).toBe(false);
    expect(skipUnlocksCardsOnLockRefresh(skipLockAfterAutofill("2026-09-13T17:00:00.000Z", sunday, now))).toBe(
      true,
    );
    expect(skipUnlocksCardsOnLockRefresh(skipLockAfterAutofill(thursday, sunday, now))).toBe(false);
    expect(skipUnlocksCardsOnLockRefresh(undefined)).toBe(false);
    expect(skipUnlocksCardsOnLockRefresh(null)).toBe(false);
    expect(skipUnlocksCardsOnLockRefresh("")).toBe(false);
    expect(skipUnlocksCardsOnLockRefresh(sunday)).toBe(true);
  });

  it("returns null for an empty list", () => {
    expect(selectActiveWeek([])).toBeNull();
  });

  it("an older-season locked week still beats a newer-season draft", () => {
    const picked = selectActiveWeek([w(18, "locked", 2025), w(1, "draft", 2026)]);
    expect(picked?.season_year).toBe(2025);
    expect(picked?.status).toBe("locked");
  });
});

describe("weekSwitcherLabel and pickViewWeek", () => {
  const locked = wr("w1", 1, "locked");
  const draft = wr("w2", 2, "draft");
  const older = wr("w0", 18, "final", 2025);
  const weeks = [older, locked, draft];

  it("labels This Sunday and Next week without hiding the locked week", () => {
    expect(weekSwitcherLabel(locked, locked)).toBe("This Sunday");
    expect(weekSwitcherLabel(draft, locked)).toBe("Next week");
    expect(weekSwitcherLabel(older, locked)).toBe("Week 18");
  });

  it("defaults to the active week; next or an id reaches the newer draft", () => {
    const active = selectActiveWeek(weeks);
    expect(active?.id).toBe("w1");
    expect(pickViewWeek(weeks, active, null)?.id).toBe("w1");
    expect(pickViewWeek(weeks, active, "next")?.id).toBe("w2");
    expect(pickViewWeek(weeks, active, "w2")?.id).toBe("w2");
    expect(selectActiveWeek(weeks)?.status).toBe("locked");
  });
});

describe("useCurrentWeek production wiring", () => {
  it("db.ts selects the active week through selectActiveWeek, not LIMIT 1", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/db.ts"), "utf8");
    const fn = src.slice(src.indexOf("export function useCurrentWeek"));
    expect(src).toMatch(/import \{ selectActiveWeek \} from "\.\/current-week"/);
    expect(fn).toMatch(/select:\s*\(weeks\)\s*=>\s*selectActiveWeek\(weeks\)/);
    expect(fn.slice(0, fn.indexOf("export function useWeekGames"))).not.toMatch(/\.limit\(1\)/);
  });

  it("profile and default week routes read the active week from useCurrentWeek", () => {
    const profile = readFileSync(join(process.cwd(), "src/lib/profile.tsx"), "utf8");
    expect(profile).toMatch(/useCurrentWeek/);
    expect(profile).toMatch(/week:\s*weekQ\.data/);
    for (const file of ["week.tsx", "card.tsx", "live.tsx", "results.tsx", "commissioner.tsx"]) {
      const route = readFileSync(join(process.cwd(), "src/routes/_authenticated", file), "utf8");
      expect(route).toMatch(/useProfile/);
    }
  });

  it("commissioner can switch to a newer draft while the locked week stays the default", () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"),
      "utf8",
    );
    expect(src).toMatch(/weekSwitcherLabel/);
    expect(src).toMatch(/This Sunday/);
    expect(src).toMatch(/Next week/);
    expect(src).toMatch(/useHouseholdWeeks/);
    expect(src).toMatch(/setViewWeekId/);
    expect(src).toMatch(/pickViewWeek/);
    expect(src).toMatch(/week:\s*"next"/);
  });

  it("commissioner skip closes a leftover week without Reveal and opens the next", () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"),
      "utf8",
    );
    expect(src).toMatch(/skipAndStartNext/);
    expect(src).toMatch(/skipControlCopy/);
    expect(src).toMatch(/skipCopy\.button/);
    expect(src).toMatch(/canSkipWeek/);
    expect(src).toMatch(/skipTargetWeek/);
    expect(src).toMatch(/nextWeekSlot/);
    const lib = readFileSync(join(process.cwd(), "src/lib/current-week.ts"), "utf8");
    expect(lib).toMatch(/Skip this week \/ start next week/);
    expect(lib).toMatch(/Skip leftover Week/);
    expect(lib).toMatch(/without Reveal/);
    const skipFn = src.slice(
      src.indexOf("const skipAndStartNext"),
      src.indexOf("const toggleHold"),
    );
    expect(skipFn).toMatch(/skipTargetWeek/);
    expect(skipFn).toMatch(/status:\s*"final"/);
    expect(skipFn).toMatch(/status:\s*"open"/);
    expect(skipFn).toMatch(/shouldOpenExistingNextWeek/);
    expect(skipFn).toMatch(/finalized_at:\s*null/);
    expect(skipFn).toMatch(/skipUnlocksCards/);
    expect(skipFn).toMatch(/skipUnlocksCardsOnLockRefresh/);
    expect(skipFn).toMatch(/locked_at:\s*null/);
    expect(skipFn).toMatch(/auto_locked_at:\s*null/);
    expect(skipFn).toMatch(/skipClearsCalledMoments/);
    expect(skipFn).toMatch(/result:\s*null/);
    expect(skipFn).toMatch(/weekly_scores/);
    expect(skipFn).toMatch(/skipClearsGameOutcomes/);
    expect(skipFn).toMatch(/home_score:\s*null/);
    expect(skipFn).toMatch(/away_score:\s*null/);
    expect(skipFn).toMatch(/upset_won:\s*null/);
    expect(skipFn.indexOf("shouldOpenExistingNextWeek")).toBeLessThan(
      skipFn.lastIndexOf("leftover.id"),
    );
    expect(skipFn).toMatch(/skipLockAfterAutofill/);
    expect(skipFn).toMatch(/select\("lock_at"\)/);
    expect(skipFn.indexOf("runAutoFill")).toBeLessThan(skipFn.indexOf("lockAfterAutofill("));
    expect(skipFn).not.toMatch(/skipLockNeedsRefresh\(next\.lock_at\)/);
    expect(skipFn).not.toMatch(/next\?\.status === "draft"/);
    expect(skipFn).not.toMatch(/finalize:\s*true/);
    expect(skipFn).not.toMatch(/runRecompute/);
    expect(skipFn).not.toMatch(/Head to the Reveal/);
  });

  it("commissioner copy does not use gambling vocabulary", () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
  });

  it("autopilot still advances every non-final week and can create the next draft", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/autopilot.server.ts"), "utf8");
    expect(src).toMatch(/ensureNextWeek/);
    expect(src).toMatch(/\.neq\("status", "final"\)/);
    expect(src).toMatch(/for \(const week of/);
    const autofill = readFileSync(join(process.cwd(), "src/lib/autofill.server.ts"), "utf8");
    expect(autofill).toMatch(/auto_create_weeks/);
  });
});

describe("week longshot set", () => {
  const GAMBLE = /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i;

  it("documents Sunday longshots with manual resolution so cards can lock", () => {
    const rows = weekLongshotRows({ id: "w", household_id: "h" });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows).toHaveLength(WEEK_LONGSHOTS.length);
    for (const row of rows) {
      expect(row.is_longshot).toBe(true);
      expect(row.resolution_source).toBe("manual");
      expect(row.game_id).toBeNull();
      expect(row.description).not.toMatch(GAMBLE);
    }
    const blob = WEEK_LONGSHOTS.join(" ").toLowerCase();
    expect(blob).toMatch(/safety/);
    expect(blob).toMatch(/defensive/);
    expect(blob).toMatch(/overtime/);
    expect(blob).toMatch(/55/);
  });

  it("skips longshots that are already on the week", () => {
    const rows = weekLongshotRows({ id: "w", household_id: "h" }, [WEEK_LONGSHOTS[0]]);
    expect(rows).toHaveLength(WEEK_LONGSHOTS.length - 1);
    expect(weekLongshotRows({ id: "w", household_id: "h" }, WEEK_LONGSHOTS)).toHaveLength(0);
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
    expect(n).toBe(WEEK_LONGSHOTS.length);
    expect(inserted).toHaveLength(WEEK_LONGSHOTS.length);
    for (const row of inserted) {
      expect(row.is_longshot).toBe(true);
      expect(row.resolution_source).toBe("manual");
      expect(row.game_id).toBeNull();
      expect(String(row.description)).not.toMatch(GAMBLE);
    }
  });

  it("autofill and addGame insert the documented longshot set", () => {
    const autofill = readFileSync(join(process.cwd(), "src/lib/autofill.server.ts"), "utf8");
    expect(autofill).toMatch(/insertMissingWeekLongshots/);
    const fillFn = autofill.slice(autofill.indexOf("export async function fillWeekFromEspn"));
    expect(fillFn).toMatch(/insertMissingWeekLongshots/);
    expect(fillFn.slice(0, fillFn.indexOf("insertMissingWeekLongshots"))).not.toMatch(
      /if \(!fresh\.length\) return result/,
    );
    const commish = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"),
      "utf8",
    );
    expect(commish).toMatch(/weekLongshotRows/);
    expect(commish).not.toMatch(GAMBLE);
    const nfl = readFileSync(join(process.cwd(), "src/lib/nfl.ts"), "utf8");
    expect(nfl).toMatch(/export async function insertMissingWeekLongshots/);
    expect(nfl).not.toMatch(GAMBLE);
  });
});
