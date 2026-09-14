import { describe, expect, it } from "vitest";
import { selectActiveWeek } from "../src/lib/current-week";

function w(week_number: number, status: string, season_year = 2026) {
  return { season_year, week_number, status };
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
