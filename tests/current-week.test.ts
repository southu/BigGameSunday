import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pickViewWeek, selectActiveWeek, weekSwitcherLabel } from "../src/lib/current-week";
import { WEEK_LONGSHOTS, weekLongshotRows } from "../src/lib/nfl";

function w(week_number: number, status: string, season_year = 2026) {
  return { season_year, week_number, status };
}

function wr(id: string, week_number: number, status: string, season_year = 2026) {
  return { id, season_year, week_number, status };
}

describe("selectActiveWeek", () => {
  it("priority is open/locked > draft > final", () => {
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

  it("falls back to the latest draft when none are in play", () => {
    expect(selectActiveWeek([w(1, "final"), w(2, "draft")])?.week_number).toBe(2);
  });

  it("falls back to the latest final when there is no draft or in-play week", () => {
    expect(selectActiveWeek([w(1, "final"), w(2, "final")])?.week_number).toBe(2);
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
    const src = readFileSync(join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"), "utf8");
    expect(src).toMatch(/weekSwitcherLabel/);
    expect(src).toMatch(/This Sunday/);
    expect(src).toMatch(/Next week/);
    expect(src).toMatch(/useHouseholdWeeks/);
    expect(src).toMatch(/setViewWeekId/);
    expect(src).toMatch(/pickViewWeek/);
    expect(src).toMatch(/week:\s*"next"/);
  });

  it("commissioner copy does not use gambling vocabulary", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"), "utf8");
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

  it("autofill and addGame insert the documented longshot set", () => {
    const autofill = readFileSync(join(process.cwd(), "src/lib/autofill.server.ts"), "utf8");
    expect(autofill).toMatch(/weekLongshotRows/);
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
    expect(nfl).not.toMatch(GAMBLE);
  });
});
