import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canSkipWeek,
  familyWeekChrome,
  leftoverDraftNextStep,
  nextWeekSlot,
  pickViewWeek,
  selectActiveWeek,
  shouldAutopilotFinalize,
  shouldAutopilotLockOpen,
  shouldAutopilotOpenDraft,
  shouldAutopilotResolveScores,
  shouldOfferOpenCards,
  shouldOpenExistingNextWeek,
  skipClearsCalledMoments,
  skipClearsGameOutcomes,
  skipControlCopy,
  skipLandingWeek,
  skipLockAfterAutofill,
  skipLockNeedsRefresh,
  skipScrubsViewedInPlace,
  skipTargetWeek,
  skipTouchesNextWeek,
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

  it("never hides an in-play week behind a newer final", () => {
    expect(selectActiveWeek([w(1, "open"), w(2, "final")])?.week_number).toBe(1);
    expect(selectActiveWeek([w(2, "final"), w(1, "open")])?.week_number).toBe(1);
    expect(selectActiveWeek([w(1, "open"), w(2, "final")])?.status).toBe("open");
    expect(selectActiveWeek([w(1, "locked"), w(2, "final")])?.week_number).toBe(1);
    expect(selectActiveWeek([w(2, "final"), w(1, "locked")])?.week_number).toBe(1);
    expect(selectActiveWeek([w(1, "locked"), w(2, "final")])?.status).toBe("locked");
    expect(selectActiveWeek([w(18, "locked", 2025), w(1, "final", 2026)])?.season_year).toBe(2025);
    expect(selectActiveWeek([w(1, "final", 2026), w(18, "locked", 2025)])?.status).toBe("locked");
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
    const harperDraft = wr("3e3aeeeb", 1, "draft");
    const harperFinal = wr("52a42a9e", 2, "final");
    const harper = selectActiveWeek([harperDraft, harperFinal]);
    expect(harper?.id).toBe("52a42a9e");
    expect(harper?.week_number).toBe(2);
    expect(harper?.status).toBe("final");
    expect(selectActiveWeek([harperFinal, harperDraft])?.id).toBe("52a42a9e");
    expect(weekSwitcherLabel(harperDraft, harper)).toBe("Week 1");
    expect(weekSwitcherLabel(harperDraft, harper)).not.toBe("This Sunday");
    expect(weekSwitcherLabel(harperDraft, harper)).not.toBe("Next week");
    expect(weekSwitcherLabel(harperFinal, harper)).toBe("Week 2");
    expect(familyWeekChrome("The Harper House", harper)).toBe("The Harper House · Week 2");
    expect(familyWeekChrome("The Harper House", harperDraft)).not.toBe("The Harper House · Week 2");
    expect(pickViewWeek([harperDraft, harperFinal], harper, null)?.id).toBe("52a42a9e");
    expect(pickViewWeek([harperDraft, harperFinal], harper, "next")?.id).toBe("52a42a9e");
    expect(pickViewWeek([harperFinal, harperDraft], harper, "next")?.id).toBe("52a42a9e");
    expect(pickViewWeek([harperDraft, harperFinal], harper, "next")?.id).not.toBe("3e3aeeeb");
    expect(pickViewWeek([harperDraft, harperFinal], harper, "3e3aeeeb")?.id).toBe("3e3aeeeb");
  });

  it("b: draft W1 + open W2 → active W2", () => {
    const leftover = w(1, "draft");
    const open = w(2, "open");
    expect(selectActiveWeek([leftover, open])?.week_number).toBe(2);
    expect(selectActiveWeek([open, leftover])?.week_number).toBe(2);
    expect(selectActiveWeek([leftover, open])?.status).toBe("open");
    expect(selectActiveWeek([leftover, w(2, "locked")])?.week_number).toBe(2);
    const harperDraft = wr("3e3aeeeb", 1, "draft");
    const harperOpen = wr("52a42a9e", 2, "open");
    const harper = selectActiveWeek([harperDraft, harperOpen]);
    expect(harper?.id).toBe("52a42a9e");
    expect(harper?.status).toBe("open");
    expect(weekSwitcherLabel(harperOpen, harper)).toBe("This Sunday");
    expect(familyWeekChrome("The Harper House", harper)).toBe("The Harper House · Week 2");
    expect(weekSwitcherLabel(harperDraft, harper)).toBe("Week 1");
    expect(weekSwitcherLabel(harperDraft, harper)).not.toBe("This Sunday");
    expect(weekSwitcherLabel(harperDraft, harper)).not.toBe("Next week");
    expect(pickViewWeek([harperDraft, harperOpen], harper, null)?.id).toBe("52a42a9e");
    expect(pickViewWeek([harperDraft, harperOpen], harper, "next")?.id).toBe("52a42a9e");
    expect(pickViewWeek([harperOpen, harperDraft], harper, "next")?.id).toBe("52a42a9e");
    expect(pickViewWeek([harperDraft, harperOpen], harper, "next")?.id).not.toBe("3e3aeeeb");
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
    const skipped = wr("w1", 1, "final");
    const open = wr("w2", 2, "open");
    const picked = selectActiveWeek([skipped, open]);
    expect(picked?.week_number).toBe(2);
    expect(picked?.status).toBe("open");
    expect(picked?.id).toBe("w2");
    expect(selectActiveWeek([open, skipped])?.week_number).toBe(2);
    expect(weekSwitcherLabel(open, picked)).toBe("This Sunday");
    expect(weekSwitcherLabel(skipped, picked)).toBe("Week 1");
    expect(weekSwitcherLabel(skipped, picked)).not.toBe("Next week");
    expect(pickViewWeek([skipped, open], picked, null)?.id).toBe("w2");
    expect(pickViewWeek([skipped, open], picked, "next")?.id).toBe("w2");
    const dirty = { ...open, finalized_at: "2026-09-15T19:04:43.880Z" };
    expect(selectActiveWeek([skipped, dirty])?.week_number).toBe(2);
    expect(selectActiveWeek([skipped, dirty])?.status).toBe("open");
    expect(selectActiveWeek([dirty, skipped])?.week_number).toBe(2);
    expect(weekSwitcherLabel(dirty, selectActiveWeek([skipped, dirty]))).toBe("This Sunday");
    const harperSkipped = {
      ...wr("3e3aeeeb", 1, "final"),
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00.000Z",
    };
    const harperOpen = {
      ...wr("52a42a9e", 2, "open"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    };
    const harper = selectActiveWeek([harperSkipped, harperOpen]);
    expect(harper?.id).toBe("52a42a9e");
    expect(harper?.status).toBe("open");
    expect(weekSwitcherLabel(harperOpen, harper)).toBe("This Sunday");
    expect(weekSwitcherLabel(harperSkipped, harper)).toBe("Week 1");
    expect(pickViewWeek([harperSkipped, harperOpen], harper, null)?.id).toBe("52a42a9e");
    expect(pickViewWeek([harperSkipped, harperOpen], harper, "next")?.id).toBe("52a42a9e");
  });

  it("live Harper House: skipped W1 + open W2 shows Week 2 as active", () => {
    const household_id = "b03e87bd-2899-4e71-b6fb-54399eef3e6d";
    const skipped = {
      id: "3e3aeeeb-4dcb-445b-9297-aa6c20967433",
      household_id,
      season_year: 2026,
      week_number: 1,
      status: "final",
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00+00:00",
      auto_created_at: "2026-09-15T17:53:12.479+00:00",
      auto_opened_at: null,
      auto_locked_at: null,
      commissioner_edited_at: null,
      autopilot_hold: false,
    };
    const open = {
      id: "52a42a9e-fbce-4e06-a9b4-8a00b1d36994",
      household_id,
      season_year: 2026,
      week_number: 2,
      status: "open",
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      lock_at: "2026-09-18T00:15:00+00:00",
      auto_created_at: "2026-09-15T18:00:32.128+00:00",
      auto_opened_at: null,
      auto_locked_at: null,
      commissioner_edited_at: "2026-09-15T19:04:30.621+00:00",
      autopilot_hold: false,
    };
    const weeks = [skipped, open];
    const active = selectActiveWeek(weeks);
    expect(active?.id).toBe("52a42a9e-fbce-4e06-a9b4-8a00b1d36994");
    expect(active?.week_number).toBe(2);
    expect(active?.status).toBe("open");
    expect(selectActiveWeek([open, skipped])?.id).toBe("52a42a9e-fbce-4e06-a9b4-8a00b1d36994");
    expect(weekSwitcherLabel(open, active)).toBe("This Sunday");
    expect(weekSwitcherLabel(skipped, active)).toBe("Week 1");
    expect(weekSwitcherLabel(skipped, active)).not.toBe("This Sunday");
    expect(weekSwitcherLabel(skipped, active)).not.toBe("Next week");
    expect(pickViewWeek(weeks, active, null)?.week_number).toBe(2);
    expect(pickViewWeek(weeks, active, "next")?.week_number).toBe(2);
    expect(`Week ${active?.week_number}`).toBe("Week 2");
    const laterDraft = {
      id: "auto-w3",
      household_id,
      season_year: 2026,
      week_number: 3,
      status: "draft",
    };
    const withLater = [skipped, open, laterDraft];
    const stillW2 = selectActiveWeek(withLater);
    expect(stillW2?.id).toBe("52a42a9e-fbce-4e06-a9b4-8a00b1d36994");
    expect(stillW2?.status).toBe("open");
    expect(weekSwitcherLabel(open, stillW2)).toBe("This Sunday");
    expect(weekSwitcherLabel(laterDraft, stillW2)).toBe("Next week");
    expect(pickViewWeek(withLater, stillW2, null)?.week_number).toBe(2);
    expect(pickViewWeek(withLater, stillW2, "next")?.id).toBe("auto-w3");
    expect(`Week ${stillW2?.week_number}`).toBe("Week 2");
    expect(open.auto_opened_at).toBeNull();
    expect(skipped.auto_opened_at).toBeNull();
    expect(open.finalized_at).toBe("2026-09-15T19:04:43.88+00:00");
    expect(familyWeekChrome("The Harper House", active)).toBe("The Harper House · Week 2");
    expect(familyWeekChrome("The Harper House", stillW2)).toBe("The Harper House · Week 2");
    expect(`The Harper House · Week ${active?.week_number}`).toBe("The Harper House · Week 2");
    expect(skipTargetWeek(weeks, open)?.id).toBe("52a42a9e-fbce-4e06-a9b4-8a00b1d36994");
    expect(skipTargetWeek(weeks, skipped)?.id).toBe("52a42a9e-fbce-4e06-a9b4-8a00b1d36994");
    expect(skipLandingWeek(weeks, open)?.week_number).toBe(2);
    expect(skipLandingWeek(weeks, open)?.status).toBe("open");
    expect(skipControlCopy(open, open, weeks).button).toBe("Clear leftover marks / open this week");
    expect(skipControlCopy(open, skipped, weeks).button).toBe("Clear leftover marks / open Week 2");
    const openedByAutopilot = { ...open, auto_opened_at: "2026-09-15T18:05:00+00:00" };
    expect(selectActiveWeek([skipped, openedByAutopilot])?.week_number).toBe(2);
    expect(selectActiveWeek([skipped, openedByAutopilot])?.status).toBe("open");
    expect(familyWeekChrome("The Harper House", openedByAutopilot)).toBe("The Harper House · Week 2");
  });

  it("live Harper House chrome: The Harper House · Week 2 after skipped W1 + dirty-open W2", () => {
    const household = {
      id: "b03e87bd-2899-4e71-b6fb-54399eef3e6d",
      name: "The Harper House",
    };
    const skipped = {
      id: "3e3aeeeb-4dcb-445b-9297-aa6c20967433",
      household_id: household.id,
      season_year: 2026,
      week_number: 1,
      status: "final",
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00+00:00",
      auto_opened_at: null,
    };
    const dirtyOpen = {
      id: "52a42a9e-fbce-4e06-a9b4-8a00b1d36994",
      household_id: household.id,
      season_year: 2026,
      week_number: 2,
      status: "open",
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      lock_at: "2026-09-18T00:15:00+00:00",
      auto_opened_at: null,
      commissioner_edited_at: "2026-09-15T19:04:30.621+00:00",
    };
    const weeks = [skipped, dirtyOpen];
    const active = selectActiveWeek(weeks);
    expect(household.name).toBe("The Harper House");
    expect(active?.id).toBe(dirtyOpen.id);
    expect(active?.week_number).toBe(2);
    expect(active?.status).toBe("open");
    expect(active?.auto_opened_at).toBeNull();
    expect(active?.finalized_at).toBe("2026-09-15T19:04:43.88+00:00");
    expect(weekSwitcherLabel(dirtyOpen, active)).toBe("This Sunday");
    expect(weekSwitcherLabel(skipped, active)).toBe("Week 1");
    expect(familyWeekChrome(household.name, active)).toBe("The Harper House · Week 2");
    expect(familyWeekChrome(household.name, null)).toBe("The Harper House");
    expect(familyWeekChrome(null, active)).toBe("Your household · Week 2");
    expect(`Week ${active?.week_number}`).toBe("Week 2");
    expect(familyWeekChrome(household.name, skipped)).not.toBe("The Harper House · Week 2");
    expect(familyWeekChrome(household.name, skipped)).toBe("The Harper House · Week 1");
    expect(familyWeekChrome(household.name, active)).not.toMatch(
      /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i,
    );
  });

  it("live Harper House leftover-draft incident: draft W1 + premature-final W2 shows Week 2", () => {
    const household = {
      id: "b03e87bd-2899-4e71-b6fb-54399eef3e6d",
      name: "The Harper House",
    };
    const leftoverDraft = {
      id: "3e3aeeeb-4dcb-445b-9297-aa6c20967433",
      household_id: household.id,
      season_year: 2026,
      week_number: 1,
      status: "draft",
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00+00:00",
      auto_opened_at: null,
    };
    const prematureFinal = {
      id: "52a42a9e-fbce-4e06-a9b4-8a00b1d36994",
      household_id: household.id,
      season_year: 2026,
      week_number: 2,
      status: "final",
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      lock_at: "2026-09-18T00:15:00+00:00",
      auto_opened_at: null,
      commissioner_edited_at: "2026-09-15T19:04:30.621+00:00",
    };
    const weeks = [leftoverDraft, prematureFinal];
    const active = selectActiveWeek(weeks);
    expect(active?.id).toBe(prematureFinal.id);
    expect(active?.week_number).toBe(2);
    expect(active?.status).toBe("final");
    expect(selectActiveWeek([prematureFinal, leftoverDraft])?.id).toBe(prematureFinal.id);
    expect(weekSwitcherLabel(leftoverDraft, active)).toBe("Week 1");
    expect(weekSwitcherLabel(leftoverDraft, active)).not.toBe("This Sunday");
    expect(weekSwitcherLabel(leftoverDraft, active)).not.toBe("Next week");
    expect(weekSwitcherLabel(prematureFinal, active)).toBe("Week 2");
    expect(familyWeekChrome(household.name, active)).toBe("The Harper House · Week 2");
    expect(familyWeekChrome(household.name, leftoverDraft)).not.toBe("The Harper House · Week 2");
    expect(familyWeekChrome(household.name, leftoverDraft)).toBe("The Harper House · Week 1");
    expect(`Week ${active?.week_number}`).toBe("Week 2");
    expect(pickViewWeek(weeks, active, null)?.id).toBe(prematureFinal.id);
    expect(pickViewWeek(weeks, active, "next")?.id).toBe(prematureFinal.id);
    expect(pickViewWeek(weeks, active, "next")?.id).not.toBe(leftoverDraft.id);
    expect(familyWeekChrome(household.name, active)).not.toMatch(
      /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i,
    );
  });

  it("does not keep the leftover-draft trap from 2026-09-15 (any draft over any final)", () => {
    const leftover = wr("3e3aeeeb", 1, "draft");
    const premature = wr("52a42a9e", 2, "final");
    const recencySort = (a, b) =>
      a.season_year !== b.season_year ? b.season_year - a.season_year : b.week_number - a.week_number;
    const oldRank = (weeks: ReturnType<typeof wr>[]) => {
      const ranked = [...weeks].sort(recencySort);
      const inPlay = ranked.find((week) => week.status === "open" || week.status === "locked");
      if (inPlay) return inPlay;
      const draft = ranked.find((week) => week.status === "draft");
      if (draft) return draft;
      return ranked.find((week) => week.status === "final") ?? ranked[0] ?? null;
    };
    expect(oldRank([leftover, premature])?.id).toBe("3e3aeeeb");
    expect(oldRank([premature, leftover])?.id).toBe("3e3aeeeb");
    expect(selectActiveWeek([leftover, premature])?.id).toBe("52a42a9e");
    expect(selectActiveWeek([premature, leftover])?.id).toBe("52a42a9e");
    expect(selectActiveWeek([leftover, premature])?.week_number).toBe(2);
    expect(selectActiveWeek([leftover, premature])?.status).toBe("final");
    expect(`Week ${selectActiveWeek([leftover, premature])?.week_number}`).toBe("Week 2");
    expect(familyWeekChrome("The Harper House", selectActiveWeek([leftover, premature]))).toBe(
      "The Harper House · Week 2",
    );
    const open = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const inPlay = selectActiveWeek([open, nextDraft]);
    expect(inPlay?.id).toBe("w1");
    expect(weekSwitcherLabel(open, inPlay)).toBe("This Sunday");
    expect(weekSwitcherLabel(nextDraft, inPlay)).toBe("Next week");
    expect(pickViewWeek([open, nextDraft], inPlay, "next")?.id).toBe("w2");
  });

  it("draft week N + final/open week N+1 → returns week N+1 (not the old draft)", () => {
    for (const n of [1, 5, 12, 17]) {
      expect(selectActiveWeek([w(n, "draft"), w(n + 1, "final")])?.week_number).toBe(n + 1);
      expect(selectActiveWeek([w(n + 1, "final"), w(n, "draft")])?.week_number).toBe(n + 1);
      expect(selectActiveWeek([w(n, "draft"), w(n + 1, "final")])?.status).toBe("final");
      expect(selectActiveWeek([w(n, "draft"), w(n + 1, "open")])?.week_number).toBe(n + 1);
      expect(selectActiveWeek([w(n + 1, "open"), w(n, "draft")])?.week_number).toBe(n + 1);
      expect(selectActiveWeek([w(n, "draft"), w(n + 1, "open")])?.status).toBe("open");
      expect(selectActiveWeek([w(n, "draft"), w(n + 1, "locked")])?.week_number).toBe(n + 1);
    }
    const wrapDraft = w(18, "draft", 2025);
    const wrapFinal = w(1, "final", 2026);
    expect(selectActiveWeek([wrapDraft, wrapFinal])?.season_year).toBe(2026);
    expect(selectActiveWeek([wrapFinal, wrapDraft])?.week_number).toBe(1);
    expect(selectActiveWeek([wrapDraft, w(1, "open", 2026)])?.status).toBe("open");
  });

  it("open week N + draft week N+1 → returns open week N (This Sunday); N+1 is Next week", () => {
    for (const n of [1, 5, 12, 17]) {
      const open = wr(`open-${n}`, n, "open");
      const draft = wr(`draft-${n + 1}`, n + 1, "draft");
      const active = selectActiveWeek([open, draft]);
      expect(active?.id).toBe(`open-${n}`);
      expect(active?.week_number).toBe(n);
      expect(weekSwitcherLabel(open, active)).toBe("This Sunday");
      expect(weekSwitcherLabel(draft, active)).toBe("Next week");
      expect(pickViewWeek([open, draft], active, null)?.id).toBe(`open-${n}`);
      expect(pickViewWeek([open, draft], active, "next")?.id).toBe(`draft-${n + 1}`);
      const locked = wr(`locked-${n}`, n, "locked");
      const lockedActive = selectActiveWeek([locked, draft]);
      expect(lockedActive?.id).toBe(`locked-${n}`);
      expect(weekSwitcherLabel(locked, lockedActive)).toBe("This Sunday");
      expect(weekSwitcherLabel(draft, lockedActive)).toBe("Next week");
    }
  });

  it("autopilot does not auto-open leftover draft W1 behind newer W2", () => {
    const leftover = wr("3e3aeeeb", 1, "draft");
    const premature = wr("52a42a9e", 2, "final");
    expect(shouldAutopilotOpenDraft(leftover, [leftover, premature])).toBe(false);
    expect(shouldAutopilotOpenDraft(leftover, [premature, leftover])).toBe(false);
    expect(shouldAutopilotOpenDraft(w(1, "draft"), [w(1, "draft"), w(2, "open")])).toBe(false);
    expect(shouldAutopilotOpenDraft(w(1, "draft"), [w(1, "draft"), w(2, "locked")])).toBe(false);
    expect(shouldAutopilotOpenDraft(w(1, "draft"), [w(1, "draft"), w(2, "draft")])).toBe(false);
    expect(shouldAutopilotOpenDraft(w(2, "draft"), [w(1, "open"), w(2, "draft")])).toBe(true);
    expect(shouldAutopilotOpenDraft(w(2, "draft"), [w(1, "final"), w(2, "draft")])).toBe(true);
    expect(shouldAutopilotOpenDraft(w(1, "draft"), [w(1, "draft")])).toBe(true);
    expect(shouldAutopilotOpenDraft(w(1, "open"), [w(1, "open"), w(2, "draft")])).toBe(false);
    expect(
      shouldAutopilotOpenDraft(w(18, "draft", 2025), [w(18, "draft", 2025), w(1, "final", 2026)]),
    ).toBe(false);
    expect(
      shouldAutopilotOpenDraft(w(1, "draft", 2026), [w(18, "final", 2025), w(1, "draft", 2026)]),
    ).toBe(true);
    expect(selectActiveWeek([w(1, "open"), w(2, "final")])?.week_number).toBe(1);
  });

  it("commissioner does not offer Open cards on leftover draft W1 behind newer W2", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    expect(shouldOfferOpenCards(leftover, [leftover, premature])).toBe(false);
    expect(shouldOfferOpenCards(leftover, [premature, leftover])).toBe(false);
    expect(shouldOfferOpenCards(w(1, "draft"), [w(1, "draft"), w(2, "open")])).toBe(false);
    expect(shouldOfferOpenCards(w(1, "draft"), [w(1, "draft"), w(2, "locked")])).toBe(false);
    expect(shouldOfferOpenCards(w(1, "draft"), [w(1, "draft"), w(2, "draft")])).toBe(false);
    expect(shouldOfferOpenCards(w(2, "draft"), [w(1, "open"), w(2, "draft")])).toBe(true);
    expect(shouldOfferOpenCards(w(2, "draft"), [w(1, "final"), w(2, "draft")])).toBe(true);
    expect(shouldOfferOpenCards(w(1, "draft"), [w(1, "draft")])).toBe(true);
    expect(shouldOfferOpenCards(w(1, "open"), [w(1, "open"), w(2, "draft")])).toBe(true);
    expect(shouldOfferOpenCards(w(1, "locked"), [w(1, "locked")])).toBe(true);
    expect(shouldOfferOpenCards(w(1, "open"), [w(1, "open"), w(2, "final")])).toBe(false);
    expect(shouldOfferOpenCards(w(1, "locked"), [w(1, "locked"), w(2, "final")])).toBe(false);
    expect(shouldOfferOpenCards(w(1, "open"), [w(1, "open"), w(2, "open")])).toBe(false);
    expect(shouldOfferOpenCards(w(2, "open"), [w(1, "open"), w(2, "open")])).toBe(true);
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const skipped = w(1, "final");
    expect(shouldOfferOpenCards(dirtyOpen, [skipped, dirtyOpen])).toBe(false);
    expect(shouldOfferOpenCards(dirtyOpen, [dirtyOpen, skipped])).toBe(false);
    expect(shouldOfferOpenCards(w(2, "open"), [skipped, w(2, "open")])).toBe(true);
    expect(
      shouldOfferOpenCards(
        { ...w(2, "final"), finalized_at: "2026-09-15T19:04:43.880Z", lock_at: "2026-09-18T00:15:00.000Z" },
        [skipped, { ...w(2, "final"), finalized_at: "2026-09-15T19:04:43.880Z", lock_at: "2026-09-18T00:15:00.000Z" }],
      ),
    ).toBe(false);
    expect(selectActiveWeek([leftover, premature])?.week_number).toBe(2);
    expect(selectActiveWeek([{ ...leftover, status: "open" }, premature])?.week_number).toBe(1);
    expect(selectActiveWeek([skipped, dirtyOpen])?.week_number).toBe(2);
  });

  it("commissioner does not offer Finalize on leftover weeks skip should close", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    expect(shouldOfferOpenCards(leftover, [leftover, premature])).toBe(false);
    expect(shouldOfferOpenCards(leftover, [premature, leftover])).toBe(false);
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const skipped = w(1, "final");
    expect(shouldOfferOpenCards(dirtyOpen, [skipped, dirtyOpen])).toBe(false);
    expect(
      shouldOfferOpenCards(
        { ...w(2, "final"), finalized_at: "2026-09-15T19:04:43.880Z", lock_at: "2026-09-18T00:15:00.000Z" },
        [skipped, { ...w(2, "final"), finalized_at: "2026-09-15T19:04:43.880Z", lock_at: "2026-09-18T00:15:00.000Z" }],
      ),
    ).toBe(false);
    expect(shouldOfferOpenCards(w(1, "open"), [w(1, "open")])).toBe(true);
    expect(shouldOfferOpenCards(w(1, "locked"), [w(1, "locked")])).toBe(true);
    expect(shouldOfferOpenCards(w(2, "open"), [skipped, w(2, "open")])).toBe(true);
    expect(shouldOfferOpenCards(w(1, "open"), [w(1, "open"), w(2, "draft")])).toBe(true);
    expect(shouldOfferOpenCards(w(1, "open"), [w(1, "open"), w(2, "final")])).toBe(false);
    expect(shouldOfferOpenCards(w(1, "locked"), [w(1, "locked"), w(2, "final")])).toBe(false);
    expect(shouldOfferOpenCards(w(1, "open"), [w(1, "open"), w(2, "open")])).toBe(false);
    expect(shouldOfferOpenCards(w(2, "open"), [w(1, "open"), w(2, "open")])).toBe(true);
    expect(selectActiveWeek([w(1, "open"), w(2, "final")])?.week_number).toBe(1);
    expect(selectActiveWeek([w(1, "locked"), w(2, "final")])?.week_number).toBe(1);
  });

  it("leftover draft next step does not promise Open cards behind a newer week", () => {
    const leftover = w(1, "draft");
    expect(leftoverDraftNextStep(leftover, [leftover])).toBeNull();
    expect(leftoverDraftNextStep(w(2, "draft"), [w(1, "open"), w(2, "draft")])).toBeNull();
    expect(leftoverDraftNextStep(w(1, "open"), [w(1, "open"), w(2, "draft")])).toBeNull();
    const behindFinal = leftoverDraftNextStep(leftover, [leftover, w(2, "final")]);
    expect(behindFinal?.label).toMatch(/will not auto-open/);
    expect(behindFinal?.label).toMatch(/skip it to start next week/);
    expect(behindFinal?.at).toBeNull();
    expect(behindFinal?.label).not.toMatch(/Open cards/);
    expect(behindFinal?.label).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const behindOpen = leftoverDraftNextStep(leftover, [leftover, w(2, "open")]);
    expect(behindOpen?.label).toMatch(/without Reveal/);
    expect(behindOpen?.label).not.toMatch(/start next week/);
    const behindNewerInPlay = leftoverDraftNextStep(leftover, [
      leftover,
      w(2, "final"),
      w(3, "open"),
    ]);
    expect(behindNewerInPlay?.label).toMatch(/will not auto-open/);
    expect(behindNewerInPlay?.label).toMatch(/without Reveal/);
    expect(behindNewerInPlay?.label).not.toMatch(/start next week/);
    expect(behindNewerInPlay?.label).not.toMatch(/Open cards/);
    expect(behindNewerInPlay?.label).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const behindNewerDraft = leftoverDraftNextStep(leftover, [
      leftover,
      w(2, "final"),
      w(3, "draft"),
    ]);
    expect(behindNewerDraft?.label).toMatch(/will not auto-open/);
    expect(behindNewerDraft?.label).toMatch(/without Reveal/);
    expect(behindNewerDraft?.label).not.toMatch(/start next week/);
    expect(behindNewerDraft?.label).not.toMatch(/Open cards/);
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const skipped = w(1, "final");
    const dirtyStep = leftoverDraftNextStep(dirtyOpen, [skipped, dirtyOpen]);
    expect(dirtyStep?.label).toMatch(/leftover marks/);
    expect(dirtyStep?.label).toMatch(/family can play/);
    expect(dirtyStep?.at).toBeNull();
    expect(dirtyStep?.label).not.toMatch(/Open cards/);
    expect(dirtyStep?.label).not.toMatch(/Lock the cards/);
    expect(dirtyStep?.label).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const premature = {
      ...w(2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    };
    const prematureStep = leftoverDraftNextStep(premature, [skipped, premature]);
    expect(prematureStep?.label).toMatch(/leftover marks/);
    expect(prematureStep?.label).not.toMatch(/Open cards/);
    expect(leftoverDraftNextStep(w(2, "open"), [skipped, w(2, "open")])).toBeNull();
    const leftoverOpen = leftoverDraftNextStep(w(1, "open"), [w(1, "open"), w(2, "final")]);
    expect(leftoverOpen?.label).toMatch(/behind a newer week/);
    expect(leftoverOpen?.label).toMatch(/without Reveal/);
    expect(leftoverOpen?.label).not.toMatch(/start next week/);
    expect(leftoverOpen?.label).not.toMatch(/Lock the cards/);
    expect(leftoverOpen?.label).not.toMatch(/Open cards/);
    expect(leftoverOpen?.label).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const leftoverLocked = leftoverDraftNextStep(w(1, "locked"), [w(1, "locked"), w(2, "final")]);
    expect(leftoverLocked?.label).toMatch(/behind a newer week/);
    expect(leftoverLocked?.label).toMatch(/without Reveal/);
    expect(leftoverLocked?.label).not.toMatch(/start next week/);
    expect(leftoverLocked?.label).not.toMatch(/Finalize/);
    expect(leftoverDraftNextStep(w(1, "open"), [w(1, "open"), w(2, "open")])?.label).toMatch(
      /behind a newer week/,
    );
    expect(leftoverDraftNextStep(w(1, "open"), [w(1, "open"), w(2, "open")])?.label).toMatch(
      /without Reveal/,
    );
    expect(leftoverDraftNextStep(w(1, "open"), [w(1, "open"), w(2, "open")])?.label).not.toMatch(
      /start next week/,
    );
  });

  it("autopilot does not lock a dirty-open leftover week", () => {
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    expect(shouldAutopilotLockOpen(dirtyOpen)).toBe(false);
    expect(shouldAutopilotLockOpen(w(2, "open"))).toBe(true);
    expect(shouldAutopilotLockOpen(w(2, "draft"))).toBe(false);
    expect(shouldAutopilotLockOpen(w(2, "locked"))).toBe(false);
    expect(shouldAutopilotLockOpen(w(2, "final"))).toBe(false);
    expect(
      shouldAutopilotLockOpen({ ...w(2, "locked"), finalized_at: "2026-09-15T19:04:43.880Z" }),
    ).toBe(false);
    expect(selectActiveWeek([w(1, "final"), dirtyOpen])?.week_number).toBe(2);
    expect(selectActiveWeek([w(1, "final"), dirtyOpen])?.status).toBe("open");
  });

  it("autopilot does not lock leftover open W1 behind a newer week", () => {
    const leftover = w(1, "open");
    const premature = w(2, "final");
    expect(shouldAutopilotLockOpen(leftover, [leftover, premature])).toBe(false);
    expect(shouldAutopilotLockOpen(leftover, [premature, leftover])).toBe(false);
    expect(shouldAutopilotLockOpen(leftover, [leftover, w(2, "open")])).toBe(false);
    expect(shouldAutopilotLockOpen(leftover, [leftover, w(2, "locked")])).toBe(false);
    expect(shouldAutopilotLockOpen(leftover, [leftover, w(2, "draft")])).toBe(true);
    expect(shouldAutopilotLockOpen(leftover, [leftover])).toBe(true);
    expect(shouldAutopilotLockOpen(w(2, "open"), [w(1, "final"), w(2, "open")])).toBe(true);
    expect(shouldAutopilotLockOpen(w(1, "open"), [w(1, "open"), w(2, "draft")])).toBe(true);
    expect(
      shouldAutopilotLockOpen(w(18, "open", 2025), [w(18, "open", 2025), w(1, "final", 2026)]),
    ).toBe(false);
    expect(selectActiveWeek([leftover, premature])?.week_number).toBe(1);
    expect(selectActiveWeek([leftover, w(2, "open")])?.week_number).toBe(2);
  });

  it("autopilot does not finalize leftover locked W1 behind a newer week", () => {
    const leftover = w(1, "locked");
    const premature = w(2, "final");
    expect(shouldAutopilotFinalize(leftover, [leftover, premature])).toBe(false);
    expect(shouldAutopilotFinalize(leftover, [premature, leftover])).toBe(false);
    expect(shouldAutopilotFinalize(leftover, [leftover, w(2, "open")])).toBe(false);
    expect(shouldAutopilotFinalize(leftover, [leftover, w(2, "locked")])).toBe(false);
    expect(shouldAutopilotFinalize(leftover, [leftover, w(2, "draft")])).toBe(true);
    expect(shouldAutopilotFinalize(leftover, [leftover])).toBe(true);
    expect(shouldAutopilotFinalize(w(1, "open"), [w(1, "open")])).toBe(false);
    expect(shouldAutopilotFinalize(w(1, "draft"), [w(1, "draft")])).toBe(false);
    expect(shouldAutopilotFinalize(w(2, "locked"), [w(1, "final"), w(2, "locked")])).toBe(true);
    expect(shouldAutopilotFinalize(w(1, "locked"), [w(1, "locked"), w(2, "draft")])).toBe(true);
    expect(
      shouldAutopilotFinalize(w(18, "locked", 2025), [w(18, "locked", 2025), w(1, "final", 2026)]),
    ).toBe(false);
    expect(selectActiveWeek([leftover, premature])?.week_number).toBe(1);
    expect(selectActiveWeek([leftover, w(2, "draft")])?.week_number).toBe(1);
  });

  it("autopilot does not resolve leftover locked W1 behind a newer in-play week", () => {
    const leftover = w(1, "locked");
    const premature = w(2, "final");
    expect(shouldAutopilotResolveScores(leftover, [leftover, premature])).toBe(true);
    expect(shouldAutopilotResolveScores(leftover, [premature, leftover])).toBe(true);
    expect(shouldAutopilotResolveScores(leftover, [leftover, w(2, "open")])).toBe(false);
    expect(shouldAutopilotResolveScores(leftover, [leftover, w(2, "locked")])).toBe(false);
    expect(shouldAutopilotResolveScores(leftover, [leftover, w(2, "draft")])).toBe(true);
    expect(shouldAutopilotResolveScores(leftover, [leftover])).toBe(true);
    expect(shouldAutopilotResolveScores(w(1, "open"), [w(1, "open")])).toBe(false);
    expect(shouldAutopilotResolveScores(w(1, "draft"), [w(1, "draft")])).toBe(false);
    expect(shouldAutopilotResolveScores(w(2, "locked"), [w(1, "final"), w(2, "locked")])).toBe(true);
    expect(shouldAutopilotResolveScores(w(1, "locked"), [w(1, "locked"), w(2, "draft")])).toBe(true);
    expect(
      shouldAutopilotResolveScores(w(18, "locked", 2025), [w(18, "locked", 2025), w(1, "open", 2026)]),
    ).toBe(false);
    expect(
      shouldAutopilotResolveScores(w(18, "locked", 2025), [w(18, "locked", 2025), w(1, "final", 2026)]),
    ).toBe(true);
    expect(selectActiveWeek([leftover, premature])?.week_number).toBe(1);
    expect(selectActiveWeek([leftover, w(2, "open")])?.week_number).toBe(2);
    expect(selectActiveWeek([leftover, w(2, "draft")])?.week_number).toBe(1);
  });

  it("Harper House: skipped W1 + dirty-open W2 is This Sunday, not leftover W1", () => {
    const skipped = {
      ...wr("3e3aeeeb", 1, "final"),
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00.000Z",
    };
    const dirtyOpen = {
      ...wr("52a42a9e", 2, "open"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    };
    const weeks = [skipped, dirtyOpen];
    const reverse = [dirtyOpen, skipped];
    const active = selectActiveWeek(weeks);
    expect(active?.id).toBe("52a42a9e");
    expect(active?.week_number).toBe(2);
    expect(active?.status).toBe("open");
    expect(selectActiveWeek(reverse)?.id).toBe("52a42a9e");
    expect(weekSwitcherLabel(dirtyOpen, active)).toBe("This Sunday");
    expect(weekSwitcherLabel(skipped, active)).toBe("Week 1");
    expect(weekSwitcherLabel(skipped, active)).not.toBe("Next week");
    expect(pickViewWeek(weeks, active, null)?.id).toBe("52a42a9e");
    expect(pickViewWeek(weeks, active, "next")?.id).toBe("52a42a9e");
    expect(skipTargetWeek(weeks, dirtyOpen)?.week_number).toBe(2);
    expect(skipTargetWeek(weeks, skipped)?.week_number).toBe(2);
    const leftover = skipTargetWeek(weeks, skipped);
    expect(skipLandingWeek(weeks, leftover!)?.week_number).toBe(2);
    expect(skipLandingWeek(weeks, leftover!)?.status).toBe("open");
    expect(skipLandingWeek(weeks, dirtyOpen)?.week_number).toBe(2);
    expect(skipLandingWeek(weeks, dirtyOpen)?.status).toBe("open");
    expect(shouldOfferOpenCards(dirtyOpen, weeks)).toBe(false);
    expect(shouldAutopilotLockOpen(dirtyOpen)).toBe(false);
    expect(leftoverDraftNextStep(dirtyOpen, weeks)?.label).toMatch(/leftover marks/);
    expect(leftoverDraftNextStep(dirtyOpen, weeks)?.label).not.toMatch(/Lock the cards/);
  });

  it("ranking ignores leftover finalize and lock stamps", () => {
    const leftover = {
      ...w(1, "draft"),
      finalized_at: "2026-09-16T16:00:00.000Z",
      lock_at: "2026-09-10T00:00:00.000Z",
    };
    const next = {
      ...w(2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-17T00:15:00.000Z",
    };
    expect(selectActiveWeek([leftover, next])?.week_number).toBe(2);
    expect(selectActiveWeek([next, leftover])?.week_number).toBe(2);
    expect(selectActiveWeek([leftover, next])?.status).toBe("final");
    expect(selectActiveWeek([leftover, { ...w(2, "open"), finalized_at: next.finalized_at }])?.week_number).toBe(2);
    const dirtyOpen = {
      ...w(2, "open"),
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      auto_opened_at: null,
    };
    expect(selectActiveWeek([w(1, "final"), dirtyOpen])?.week_number).toBe(2);
    expect(selectActiveWeek([w(1, "final"), dirtyOpen])?.status).toBe("open");
    expect(
      selectActiveWeek([{ ...leftover, auto_opened_at: "2026-09-10T00:00:00.000Z" }, next])?.week_number,
    ).toBe(2);
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

  it("skip path: leftover in-play behind This Sunday closes W1, not W2", () => {
    const leftoverOpen = w(1, "open");
    const leftoverLocked = w(1, "locked");
    const thisSunday = w(2, "open");
    const lockedSunday = w(2, "locked");
    const nextDraft = w(2, "draft");
    const leftoverRef = wr("w1", 1, "locked");
    const sundayRef = wr("w2", 2, "open");
    const weeks = [leftoverRef, sundayRef];
    const active = selectActiveWeek(weeks);

    expect(selectActiveWeek([leftoverOpen, thisSunday])?.week_number).toBe(2);
    expect(selectActiveWeek([leftoverLocked, thisSunday])?.week_number).toBe(2);
    expect(selectActiveWeek([leftoverLocked, lockedSunday])?.week_number).toBe(2);
    expect(active?.id).toBe("w2");
    expect(weekSwitcherLabel(sundayRef, active)).toBe("This Sunday");
    expect(weekSwitcherLabel(leftoverRef, active)).toBe("Week 1");
    expect(weekSwitcherLabel(leftoverRef, active)).not.toBe("This Sunday");
    expect(weekSwitcherLabel(leftoverRef, active)).not.toBe("Next week");
    expect(selectActiveWeek([leftoverLocked, nextDraft])?.week_number).toBe(1);
    expect(weekSwitcherLabel(wr("w2d", 2, "draft"), selectActiveWeek([leftoverRef, wr("w2d", 2, "draft")]))).toBe(
      "Next week",
    );

    expect(skipTargetWeek([leftoverOpen, thisSunday], thisSunday)?.week_number).toBe(1);
    expect(skipTargetWeek([leftoverLocked, thisSunday], thisSunday)?.week_number).toBe(1);
    expect(skipTargetWeek([leftoverOpen, lockedSunday], lockedSunday)?.week_number).toBe(1);
    expect(skipTargetWeek([leftoverLocked, lockedSunday], lockedSunday)?.week_number).toBe(1);
    expect(skipTargetWeek([leftoverLocked, thisSunday], leftoverLocked)?.week_number).toBe(1);
    expect(skipTargetWeek([leftoverLocked, nextDraft], leftoverLocked)?.week_number).toBe(1);
    expect(skipTargetWeek([leftoverLocked, nextDraft], nextDraft)?.week_number).toBe(2);
    expect(skipTargetWeek([leftoverOpen, w(2, "final")], w(2, "final"))).toBeNull();
    expect(skipTargetWeek([leftoverLocked, w(2, "final")], w(2, "final"))).toBeNull();

    const dirtyLeftover = { ...leftoverOpen, finalized_at: "2026-09-15T19:04:43.880Z" };
    const dirtyWeeks = [dirtyLeftover, thisSunday];
    expect(skipTargetWeek(dirtyWeeks, thisSunday)?.week_number).toBe(1);
    expect(skipScrubsViewedInPlace(dirtyLeftover, thisSunday, dirtyWeeks)).toBe(false);
    expect(skipScrubsViewedInPlace(dirtyLeftover, dirtyLeftover, dirtyWeeks)).toBe(false);
    expect(skipLandingWeek(dirtyWeeks, dirtyLeftover)?.week_number).toBe(2);
    expect(skipLandingWeek(dirtyWeeks, dirtyLeftover)?.status).toBe("open");
    expect(skipLandingWeek([leftoverLocked, thisSunday], leftoverLocked)?.week_number).toBe(2);
    expect(skipLandingWeek([leftoverLocked, thisSunday], leftoverLocked)?.status).toBe("open");
    expect(skipLandingWeek([leftoverLocked, lockedSunday], leftoverLocked)?.week_number).toBe(2);
    expect(skipLandingWeek([leftoverLocked, lockedSunday], leftoverLocked)?.status).toBe("locked");
    expect(leftoverDraftNextStep(dirtyLeftover, dirtyWeeks)?.label).toMatch(/behind a newer week/);
    expect(leftoverDraftNextStep(dirtyLeftover, dirtyWeeks)?.label).not.toMatch(/leftover marks/);
    expect(leftoverDraftNextStep(dirtyLeftover, dirtyWeeks)?.label).not.toMatch(/start next week/);
    expect(leftoverDraftNextStep(leftoverLocked, [leftoverLocked, thisSunday])?.label).toMatch(
      /behind a newer week/,
    );
    expect(leftoverDraftNextStep(leftoverLocked, [leftoverLocked, thisSunday])?.label).toMatch(
      /without Reveal/,
    );
    expect(leftoverDraftNextStep(leftoverLocked, [leftoverLocked, thisSunday])?.label).not.toMatch(
      /start next week/,
    );

    const copy = skipControlCopy(leftoverLocked, thisSunday, [leftoverLocked, thisSunday]);
    expect(copy.button).toBe("Skip leftover Week 1");
    expect(copy.button).not.toMatch(/open/);
    expect(copy.hint).toMatch(/Week 1 is still leftover/);
    expect(copy.hint).not.toMatch(/leftover draft/);
    expect(copy.hint).toMatch(/without Reveal/);
    expect(copy.hint).not.toMatch(/open this week/);
    expect(copy.hint).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(copy.button).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const draftCopy = skipControlCopy(w(1, "draft"), thisSunday, [w(1, "draft"), thisSunday]);
    expect(draftCopy.button).toBe("Skip leftover Week 1");
    expect(draftCopy.button).not.toMatch(/open/);
    expect(draftCopy.hint).toMatch(/Week 1 is still a leftover draft/);
    expect(draftCopy.hint).not.toMatch(/open this week/);
  });

  it("never prefers an older leftover draft over a newer week of any status", () => {
    expect(selectActiveWeek([w(1, "draft"), w(2, "final"), w(3, "draft")])?.week_number).toBe(3);
    expect(selectActiveWeek([w(3, "final"), w(1, "draft"), w(2, "draft")])?.week_number).toBe(3);
    expect(selectActiveWeek([w(2, "final"), w(1, "draft")])?.status).toBe("final");
  });

  it("selectActiveWeek does not rank draft above final as a class", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/current-week.ts"), "utf8");
    const start = src.indexOf("export function selectActiveWeek");
    const end = src.indexOf("export function nextWeekSlot");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toMatch(/return latestInPlay \?\? newest/);
    expect(body).toMatch(/recency\(week, latestInPlay\)/);
    expect(body).toMatch(/recency\(week, newest\)/);
    expect(body).not.toMatch(/status === ["']draft["']/);
    expect(body).not.toMatch(/status === ["']final["']/);
    expect(body).not.toMatch(/finalized_at/);
    expect(body).not.toMatch(/lock_at/);
    expect(body).not.toMatch(/auto_opened_at/);
    const inPlayStart = src.indexOf("function isInPlay");
    const inPlayEnd = src.indexOf("export function isNewerDraft");
    expect(inPlayStart).toBeGreaterThanOrEqual(0);
    expect(inPlayEnd).toBeGreaterThan(inPlayStart);
    const inPlayBody = src.slice(inPlayStart, inPlayEnd);
    expect(inPlayBody).toMatch(/status === "open" \|\| status === "locked"/);
    expect(inPlayBody).not.toMatch(/auto_opened_at/);
    expect(inPlayBody).not.toMatch(/finalized_at/);
    const chromeStart = src.indexOf("export function familyWeekChrome");
    const chromeEnd = src.indexOf("export function weekSwitcherLabel");
    expect(chromeStart).toBeGreaterThanOrEqual(0);
    expect(chromeEnd).toBeGreaterThan(chromeStart);
    const chromeBody = src.slice(chromeStart, chromeEnd);
    expect(chromeBody).toMatch(/householdName \?\? "Your household"/);
    expect(chromeBody).toMatch(/\$\{name\} · Week \$\{week\.week_number\}/);
    expect(chromeBody).toMatch(/The Harper House · Week 2/);
    expect(chromeBody).toMatch(/leftover draft W1 \+ premature-final W2/);
    expect(src).not.toMatch(/ranked\.find\(\(w\) => w\.status === "draft"\)/);
    expect(src).not.toMatch(/else latest draft/);
    expect(src).not.toMatch(/open\/locked > draft > final/);
    expect(src).toMatch(/function isSameSlot[\s\S]{0,80}return recency\(a, b\) === 0/);
    expect(src).toMatch(/weeks\.find\(\(w\) => isSameSlot\(w, slot\)\)/);
    const labelStart = src.indexOf("export function weekSwitcherLabel");
    const labelEnd = src.indexOf("export function pickViewWeek");
    expect(labelStart).toBeGreaterThanOrEqual(0);
    expect(labelEnd).toBeGreaterThan(labelStart);
    const labelBody = src.slice(labelStart, labelEnd);
    expect(labelBody).toMatch(/isInPlay\(active\.status\) && isSameSlot\(w, active\)/);
    expect(labelBody).toMatch(/isInPlay\(active\.status\) && isNewerDraft\(w, active\)/);
    expect(labelBody).not.toMatch(/w\.id === active\.id/);
    const pickStart = src.indexOf("export function pickViewWeek");
    const pickBody = src.slice(pickStart, pickStart + 900);
    expect(pickBody).toMatch(/requested === "next"/);
    expect(pickBody).toMatch(/weekAtSlot\(weeks, nextWeekSlot\(active\)\)/);
    expect(pickBody).toMatch(/isNewerDraft\(slotDraft, active\)/);
    expect(pickBody).toMatch(/return slotDraft;/);
    expect(pickBody).toMatch(/return active;/);
    expect(pickBody.indexOf("return slotDraft")).toBeLessThan(pickBody.indexOf("return active;"));
    expect(pickBody).not.toMatch(/if \(!slotDraft\)/);
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
    expect(skipScrubsViewedInPlace(leftover, leftover)).toBe(false);
    expect(skipScrubsViewedInPlace(leftover, dirtyOpen)).toBe(false);
    expect(skipScrubsViewedInPlace(dirtyOpen, dirtyOpen)).toBe(true);
    expect(skipScrubsViewedInPlace(cleanOpen, cleanOpen)).toBe(false);
    expect(skipTargetWeek([w(1, "final"), dirtyOpen], dirtyOpen)?.week_number).toBe(2);
    expect(skipScrubsViewedInPlace(skipTargetWeek([w(1, "final"), dirtyOpen], dirtyOpen)!, dirtyOpen)).toBe(
      true,
    );
    const skipped = w(1, "final");
    expect(skipTargetWeek([skipped, dirtyOpen], skipped)?.week_number).toBe(2);
    expect(skipScrubsViewedInPlace(dirtyOpen, skipped)).toBe(true);
    expect(skipTargetWeek([skipped, cleanOpen], skipped)).toBeNull();
    expect(skipLandingWeek([skipped, dirtyOpen], dirtyOpen)?.week_number).toBe(2);
    expect(skipLandingWeek([skipped, dirtyOpen], dirtyOpen)?.status).toBe("open");
  });

  it("skip recovers a premature-final week after leftover is already skipped", () => {
    const skipped = { ...w(1, "final"), finalized_at: "2026-09-16T16:00:00.000Z" };
    const premature = {
      ...w(2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-17T00:15:00.000Z",
    };
    const weeks = [skipped, premature];
    const draft3 = w(3, "draft");

    expect(skipTargetWeek(weeks, premature)?.week_number).toBe(2);
    expect(skipTargetWeek(weeks, skipped)?.week_number).toBe(2);
    expect(skipTargetWeek(weeks, premature)?.status).toBe("final");
    expect(skipScrubsViewedInPlace(premature, premature, weeks)).toBe(true);
    expect(skipScrubsViewedInPlace(premature, skipped, weeks)).toBe(true);
    expect(skipLandingWeek(weeks, premature)?.week_number).toBe(2);
    expect(skipLandingWeek(weeks, premature)?.status).toBe("final");

    expect(skipTargetWeek([skipped], skipped)).toBeNull();
    expect(skipTargetWeek([w(1, "open"), premature], premature)).toBeNull();
    expect(skipTargetWeek([w(1, "locked"), premature], premature)).toBeNull();
    expect(skipTargetWeek([skipped, premature, w(3, "open")], premature)).toBeNull();

    const leftover = w(1, "draft");
    expect(skipTargetWeek([leftover, premature], leftover)?.week_number).toBe(1);
    expect(skipTargetWeek([leftover, premature], premature)?.week_number).toBe(1);
    expect(skipScrubsViewedInPlace(leftover, leftover)).toBe(false);

    expect(skipTargetWeek([skipped, premature, draft3], draft3)?.week_number).toBe(2);
    expect(skipScrubsViewedInPlace(premature, draft3, [skipped, premature, draft3])).toBe(true);
    expect(skipLandingWeek([skipped, premature, draft3], premature)?.week_number).toBe(2);
    expect(skipLandingWeek([skipped, premature, draft3], premature)?.status).toBe("final");

    expect(skipUnlocksCards(premature)).toBe(true);
    expect(skipClearsCalledMoments(premature)).toBe(true);
    expect(skipClearsGameOutcomes(premature)).toBe(true);

    const copy = skipControlCopy(premature, premature, weeks);
    expect(copy.button).toBe("Clear leftover marks / open this week");
    expect(copy.hint).toMatch(/marked finished too early/);
    expect(copy.hint).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const fromSkipped = skipControlCopy(premature, skipped, weeks);
    expect(fromSkipped.button).toBe("Clear leftover marks / open Week 2");
    expect(fromSkipped.hint).toMatch(/Week 2 was marked finished too early/);
    const fromDraft3 = skipControlCopy(premature, draft3, [skipped, premature, draft3]);
    expect(fromDraft3.button).toBe("Clear leftover marks / open Week 2");
  });

  it("does not recover a legitimately completed newest week", () => {
    const played1 = { ...w(1, "final"), finalized_at: "2026-09-08T10:00:00.000Z" };
    const played2 = {
      ...w(2, "final"),
      finalized_at: "2026-09-15T10:00:00.000Z",
      lock_at: "2026-09-13T17:00:00.000Z",
    };
    const weeks = [played1, played2];

    expect(skipTargetWeek(weeks, played2)).toBeNull();
    expect(skipTargetWeek(weeks, played1)).toBeNull();
    expect(skipTargetWeek([w(1, "final"), w(2, "final")], w(2, "final"))).toBeNull();
    expect(skipScrubsViewedInPlace(played2, played2, weeks)).toBe(false);
    expect(skipScrubsViewedInPlace(played2, played1, weeks)).toBe(false);
    expect(skipLandingWeek(weeks, played2)?.week_number).toBe(2);
    expect(skipLandingWeek(weeks, played2)?.status).toBe("final");

    const outOfOrder = {
      ...w(2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
    };
    const skippedLater = { ...w(1, "final"), finalized_at: "2026-09-16T16:00:00.000Z" };
    expect(skipTargetWeek([skippedLater, outOfOrder], outOfOrder)?.week_number).toBe(2);
    expect(skipScrubsViewedInPlace(outOfOrder, outOfOrder, [skippedLater, outOfOrder])).toBe(true);

    const beforeLock = {
      ...w(2, "final"),
      finalized_at: "2026-09-15T12:00:00.000Z",
      lock_at: "2026-09-17T00:15:00.000Z",
    };
    const skippedNoStamp = w(1, "final");
    expect(skipTargetWeek([skippedNoStamp, beforeLock], beforeLock)?.week_number).toBe(2);
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
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const scrub = skipControlCopy(dirtyOpen, dirtyOpen);
    expect(scrub.button).toBe("Clear leftover marks / open this week");
    expect(scrub.hint).toMatch(/marked finished too early/);
    expect(scrub.hint).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(scrub.button).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const scrubFromSkipped = skipControlCopy(dirtyOpen, w(1, "final"));
    expect(scrubFromSkipped.button).toBe("Clear leftover marks / open Week 2");
    expect(scrubFromSkipped.hint).toMatch(/Week 2 was marked finished too early/);
    expect(scrubFromSkipped.hint).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(scrubFromSkipped.button).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const ahead = skipControlCopy(leftover, w(3, "draft"));
    expect(ahead.button).toBe("Skip leftover Week 1 / open Week 2");
    expect(ahead.hint).toMatch(/open Week 2/);
    expect(ahead.button).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const aheadWithDraft3 = skipControlCopy(leftover, w(3, "draft"), [
      leftover,
      premature,
      w(3, "draft"),
    ]);
    expect(aheadWithDraft3.button).toBe("Skip leftover Week 1");
    expect(aheadWithDraft3.button).not.toMatch(/open/);
    expect(aheadWithDraft3.hint).toMatch(/without Reveal/);
    expect(aheadWithDraft3.hint).not.toMatch(/open Week 2/);
    const stay = skipControlCopy(leftover, w(3, "open"), [leftover, w(2, "final"), w(3, "open")]);
    expect(stay.button).toBe("Skip leftover Week 1");
    expect(stay.button).not.toMatch(/open/);
    expect(stay.hint).toMatch(/without Reveal/);
    expect(skipControlCopy(leftover, leftover, [leftover, w(2, "open")]).button).toBe("Skip this week");
    expect(skipControlCopy(leftover, leftover, [leftover, w(2, "open")]).button).not.toMatch(
      /next week|open/i,
    );
  });

  it("skip copy does not promise next week when a newer week is already in play", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    const open3 = w(3, "open");
    const weeks = [leftover, premature, open3];

    const onLeftover = skipControlCopy(leftover, leftover, weeks);
    expect(onLeftover.button).toBe("Skip this week");
    expect(onLeftover.button).not.toMatch(/next week|open/i);
    expect(onLeftover.hint).toMatch(/without Reveal/);
    expect(onLeftover.hint).not.toMatch(/open next/);
    expect(onLeftover.hint).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(onLeftover.button).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);

    const onNext = skipControlCopy(leftover, premature, weeks);
    expect(onNext.button).toBe("Skip leftover Week 1");
    expect(onNext.button).not.toMatch(/open/);
    expect(onNext.hint).toMatch(/without Reveal/);
    expect(onNext.hint).not.toMatch(/open this week/);

    const onOpen3 = skipControlCopy(leftover, open3, weeks);
    expect(onOpen3.button).toBe("Skip leftover Week 1");
    expect(onOpen3.button).not.toMatch(/open/);
    expect(skipLandingWeek(weeks, leftover)?.week_number).toBe(3);
  });

  it("skip does not reopen next when a newer week is already in play", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    const open3 = w(3, "open");
    const locked3 = w(3, "locked");
    const draft3 = w(3, "draft");
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };

    expect(skipTouchesNextWeek(premature, [leftover, premature])).toBe(true);
    expect(skipTouchesNextWeek(premature, [leftover, premature, draft3])).toBe(false);
    expect(skipTouchesNextWeek(premature, [leftover, premature, open3])).toBe(false);
    expect(skipTouchesNextWeek(premature, [leftover, premature, locked3])).toBe(false);
    expect(skipTouchesNextWeek({ season_year: 2026, week_number: 2 }, [leftover, open3])).toBe(false);
    expect(skipTouchesNextWeek(w(2, "open"), [leftover, w(2, "open")])).toBe(false);
    expect(skipTouchesNextWeek(w(2, "locked"), [leftover, w(2, "locked")])).toBe(false);
    expect(skipTouchesNextWeek(dirtyOpen, [leftover, dirtyOpen])).toBe(false);
    expect(skipTouchesNextWeek(w(2, "draft"), [leftover, w(2, "draft")])).toBe(true);
    expect(skipTouchesNextWeek(w(2, "final"), [leftover, w(2, "final")])).toBe(true);
    expect(skipTouchesNextWeek(w(2, "locked"), [])).toBe(true);
    expect(skipTouchesNextWeek(w(2, "draft"), [leftover, w(2, "draft")], leftover)).toBe(true);
    expect(skipTouchesNextWeek(w(2, "final"), [leftover, w(2, "final")], leftover)).toBe(true);

    expect(shouldOpenExistingNextWeek(premature)).toBe(true);
    expect(shouldOpenExistingNextWeek(premature, [leftover, premature])).toBe(true);
    expect(shouldOpenExistingNextWeek(premature, [leftover, premature, draft3])).toBe(false);
    expect(shouldOpenExistingNextWeek(premature, [leftover, premature, open3])).toBe(false);
    expect(shouldOpenExistingNextWeek(w(2, "draft"), [leftover, w(2, "draft"), open3])).toBe(false);
    expect(shouldOpenExistingNextWeek(w(2, "locked"))).toBe(true);
    expect(shouldOpenExistingNextWeek(w(2, "locked"), [leftover, w(2, "locked")])).toBe(false);
    expect(shouldOpenExistingNextWeek(w(2, "locked"), [leftover, w(2, "locked"), open3])).toBe(false);
    expect(shouldOpenExistingNextWeek(dirtyOpen, [leftover, dirtyOpen])).toBe(false);
    expect(shouldOpenExistingNextWeek(dirtyOpen, [leftover, dirtyOpen, open3])).toBe(false);

    expect(selectActiveWeek([w(1, "final"), premature, open3])?.week_number).toBe(3);
    expect(selectActiveWeek([w(1, "final"), w(2, "open"), open3])?.week_number).toBe(3);
    expect(selectActiveWeek([leftover, premature, draft3])?.week_number).toBe(3);
  });

  it("skip does not reopen leftover next draft behind a newer final", () => {
    const leftover1 = wr("w1", 1, "draft");
    const leftover2 = wr("w2", 2, "draft");
    const final3 = wr("w3", 3, "final");
    const weeks = [leftover1, leftover2, final3];
    const reverse = [final3, leftover2, leftover1];
    const wrapLeftover = wr("w18", 18, "draft", 2025);
    const wrapNext = wr("w1", 1, "draft", 2026);
    const wrapFinal = wr("w2", 2, "final", 2026);
    const wrapWeeks = [wrapLeftover, wrapNext, wrapFinal];

    expect(selectActiveWeek(weeks)?.id).toBe("w3");
    expect(selectActiveWeek(reverse)?.id).toBe("w3");
    expect(selectActiveWeek([w(1, "final"), w(2, "open"), w(3, "final")])?.week_number).toBe(2);

    expect(skipTargetWeek(weeks, leftover1)?.id).toBe("w1");
    expect(skipTargetWeek(weeks, leftover2)?.id).toBe("w1");
    expect(skipTargetWeek(weeks, final3)?.id).toBe("w2");
    expect(skipTargetWeek(reverse, leftover2)?.id).toBe("w1");

    expect(skipTouchesNextWeek(leftover2, weeks, leftover1)).toBe(false);
    expect(skipTouchesNextWeek(leftover2, reverse, leftover1)).toBe(false);
    expect(skipTouchesNextWeek(final3, weeks, leftover2)).toBe(true);
    expect(skipTouchesNextWeek(final3, reverse, leftover2)).toBe(true);
    expect(skipTouchesNextWeek(w(2, "final"), [leftover1, w(2, "final")], leftover1)).toBe(true);
    expect(skipTouchesNextWeek(leftover2, [leftover1, leftover2, w(3, "open")], leftover1)).toBe(false);
    expect(skipTouchesNextWeek(wrapNext, wrapWeeks, wrapLeftover)).toBe(false);
    expect(skipTouchesNextWeek(wrapFinal, wrapWeeks, wrapNext)).toBe(true);

    expect(shouldOpenExistingNextWeek(leftover2, weeks, leftover1)).toBe(false);
    expect(shouldOpenExistingNextWeek(leftover2, reverse, leftover1)).toBe(false);
    expect(shouldOpenExistingNextWeek(final3, weeks, leftover2)).toBe(true);
    expect(shouldOpenExistingNextWeek(w(2, "final"), [leftover1, w(2, "final")], leftover1)).toBe(true);

    const closeW1 = skipLandingWeek(weeks, leftover1);
    expect(closeW1?.id).toBe("w3");
    expect(closeW1?.status).toBe("final");
    expect(skipLandingWeek(reverse, leftover1)?.id).toBe("w3");
    expect(skipLandingWeek(reverse, leftover1)?.status).toBe("final");
    const reopenW3 = skipLandingWeek(weeks, leftover2);
    expect(reopenW3?.id).toBe("w3");
    expect(reopenW3?.status).toBe("open");
    expect(skipLandingWeek([leftover1, w(2, "final")], leftover1)?.week_number).toBe(2);
    expect(skipLandingWeek([leftover1, w(2, "final")], leftover1)?.status).toBe("open");
    expect(skipLandingWeek(wrapWeeks, wrapLeftover)?.id).toBe("w2");
    expect(skipLandingWeek(wrapWeeks, wrapLeftover)?.status).toBe("final");
    expect(skipLandingWeek(wrapWeeks, wrapNext)?.id).toBe("w2");
    expect(skipLandingWeek(wrapWeeks, wrapNext)?.status).toBe("open");

    const onW1 = skipControlCopy(leftover1, leftover1, weeks);
    expect(onW1.button).toBe("Skip this week");
    expect(onW1.button).not.toMatch(/next week|open/i);
    expect(onW1.hint).toMatch(/without Reveal/);
    expect(onW1.hint).not.toMatch(/open next/);
    expect(onW1.button).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(onW1.hint).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const onW2 = skipControlCopy(leftover1, leftover2, weeks);
    expect(onW2.button).toBe("Skip leftover Week 1");
    expect(onW2.button).not.toMatch(/open/);
    expect(onW2.hint).toMatch(/without Reveal/);
    const onW3fromW2 = skipControlCopy(leftover2, final3, weeks);
    expect(onW3fromW2.button).toBe("Skip leftover Week 2 / open this week");
    expect(onW3fromW2.hint).toMatch(/open this week/);
    expect(skipControlCopy(leftover1, leftover1, [leftover1, w(2, "final")]).button).toBe(
      "Skip this week / start next week",
    );

    const stepW1 = leftoverDraftNextStep(leftover1, weeks);
    expect(stepW1?.label).toMatch(/will not auto-open/);
    expect(stepW1?.label).toMatch(/without Reveal/);
    expect(stepW1?.label).not.toMatch(/start next week/);
    expect(stepW1?.label).not.toMatch(/Open cards/);
    expect(stepW1?.label).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const stepW2 = leftoverDraftNextStep(leftover2, weeks);
    expect(stepW2?.label).toMatch(/will not auto-open/);
    expect(stepW2?.label).toMatch(/skip it to start next week/);
    expect(leftoverDraftNextStep(leftover1, [leftover1, w(2, "final")])?.label).toMatch(
      /skip it to start next week/,
    );
  });

  it("skip does not reopen leftover next behind a newer draft week", () => {
    const leftover1 = wr("w1", 1, "draft");
    const leftover2 = wr("w2", 2, "draft");
    const premature = wr("w2f", 2, "final");
    const draft3 = wr("w3", 3, "draft");
    const leftoverWeeks = [leftover1, leftover2, draft3];
    const prematureWeeks = [leftover1, premature, draft3];
    const wrapLeftover = wr("w18", 18, "draft", 2025);
    const wrapNext = wr("w1", 1, "draft", 2026);
    const wrapDraft = wr("w2", 2, "draft", 2026);
    const wrapWeeks = [wrapLeftover, wrapNext, wrapDraft];

    expect(selectActiveWeek(leftoverWeeks)?.id).toBe("w3");
    expect(selectActiveWeek(prematureWeeks)?.id).toBe("w3");
    expect(selectActiveWeek(wrapWeeks)?.id).toBe("w2");

    expect(skipTouchesNextWeek(leftover2, leftoverWeeks, leftover1)).toBe(false);
    expect(skipTouchesNextWeek(premature, prematureWeeks, leftover1)).toBe(false);
    expect(skipTouchesNextWeek(draft3, leftoverWeeks, leftover2)).toBe(true);
    expect(skipTouchesNextWeek(wrapNext, wrapWeeks, wrapLeftover)).toBe(false);
    expect(skipTouchesNextWeek(wrapDraft, wrapWeeks, wrapNext)).toBe(true);

    expect(shouldOpenExistingNextWeek(leftover2, leftoverWeeks, leftover1)).toBe(false);
    expect(shouldOpenExistingNextWeek(premature, prematureWeeks, leftover1)).toBe(false);
    expect(shouldOpenExistingNextWeek(draft3, leftoverWeeks, leftover2)).toBe(true);
    expect(shouldOpenExistingNextWeek(wrapNext, wrapWeeks, wrapLeftover)).toBe(false);

    const closeW1draft = skipLandingWeek(leftoverWeeks, leftover1);
    expect(closeW1draft?.id).toBe("w3");
    expect(closeW1draft?.status).toBe("draft");
    const closeW1premature = skipLandingWeek(prematureWeeks, leftover1);
    expect(closeW1premature?.id).toBe("w3");
    expect(closeW1premature?.status).toBe("draft");
    const openW3 = skipLandingWeek(leftoverWeeks, leftover2);
    expect(openW3?.id).toBe("w3");
    expect(openW3?.status).toBe("open");
    expect(skipLandingWeek(wrapWeeks, wrapLeftover)?.id).toBe("w2");
    expect(skipLandingWeek(wrapWeeks, wrapLeftover)?.status).toBe("draft");
    expect(skipLandingWeek(wrapWeeks, wrapNext)?.id).toBe("w2");
    expect(skipLandingWeek(wrapWeeks, wrapNext)?.status).toBe("open");

    const onW1 = skipControlCopy(leftover1, leftover1, leftoverWeeks);
    expect(onW1.button).toBe("Skip this week");
    expect(onW1.button).not.toMatch(/next week|open/i);
    expect(onW1.hint).toMatch(/without Reveal/);
    const onPremature = skipControlCopy(leftover1, leftover1, prematureWeeks);
    expect(onPremature.button).toBe("Skip this week");
    expect(onPremature.button).not.toMatch(/next week|open/i);
    const onW3fromW2 = skipControlCopy(leftover2, draft3, leftoverWeeks);
    expect(onW3fromW2.button).toBe("Skip leftover Week 2 / open this week");
    expect(onW3fromW2.hint).toMatch(/open this week/);

    const stepW1 = leftoverDraftNextStep(leftover1, leftoverWeeks);
    expect(stepW1?.label).toMatch(/will not auto-open/);
    expect(stepW1?.label).toMatch(/without Reveal/);
    expect(stepW1?.label).not.toMatch(/start next week/);
    const stepPremature = leftoverDraftNextStep(leftover1, prematureWeeks);
    expect(stepPremature?.label).toMatch(/without Reveal/);
    expect(stepPremature?.label).not.toMatch(/start next week/);
    const stepW2 = leftoverDraftNextStep(leftover2, leftoverWeeks);
    expect(stepW2?.label).toMatch(/will not auto-open/);
    expect(stepW2?.label).toMatch(/skip it to start next week/);
  });

  it("skip landing jumps to the post-skip active week instead of staying on leftover", () => {
    const leftover = wr("w1", 1, "draft");
    const premature = wr("w2", 2, "final");
    const open3 = wr("w3", 3, "open");
    const locked3 = wr("w3", 3, "locked");
    const draft3 = wr("w3", 3, "draft");
    const open2 = wr("w2", 2, "open");

    expect(skipLandingWeek([leftover, premature, open3], leftover)?.id).toBe("w3");
    expect(skipLandingWeek([leftover, premature, locked3], leftover)?.id).toBe("w3");
    expect(skipLandingWeek([leftover, premature, open3], leftover)?.status).toBe("open");

    const reopen = skipLandingWeek([leftover, premature], leftover);
    expect(reopen?.id).toBe("w2");
    expect(reopen?.status).toBe("open");
    expect(reopen?.finalized_at).toBeNull();

    expect(skipLandingWeek([leftover, open2], leftover)?.id).toBe("w2");
    expect(skipLandingWeek([leftover, open2], leftover)?.status).toBe("open");

    const reopenWithDraft3 = skipLandingWeek([leftover, premature, draft3], leftover);
    expect(reopenWithDraft3?.id).toBe("w3");
    expect(reopenWithDraft3?.status).toBe("draft");

    const only = skipLandingWeek([leftover], leftover);
    expect(only?.id).toBe("w1");
    expect(only?.status).toBe("final");
  });

  it("skip does not steal This Sunday when skipping Next week", () => {
    const thisSunday = wr("w1", 1, "open");
    const lockedSunday = wr("w1l", 1, "locked");
    const nextDraft = wr("w2", 2, "draft");
    const laterDraft = wr("w3", 3, "draft");
    const weeks = [thisSunday, nextDraft];
    const withLater = [thisSunday, nextDraft, laterDraft];
    const wrapSunday = wr("w18", 18, "locked", 2025);
    const wrapNext = wr("w1", 1, "draft", 2026);

    expect(selectActiveWeek(weeks)?.id).toBe("w1");
    expect(weekSwitcherLabel(thisSunday, selectActiveWeek(weeks))).toBe("This Sunday");
    expect(weekSwitcherLabel(nextDraft, selectActiveWeek(weeks))).toBe("Next week");
    expect(pickViewWeek(weeks, selectActiveWeek(weeks), "next")?.id).toBe("w2");
    expect(selectActiveWeek([thisSunday, nextDraft])?.status).toBe("open");
    expect(selectActiveWeek([lockedSunday, nextDraft])?.status).toBe("locked");

    expect(skipTouchesNextWeek(nextDraft, weeks, thisSunday)).toBe(true);
    expect(skipTouchesNextWeek(laterDraft, weeks, nextDraft)).toBe(false);
    expect(skipTouchesNextWeek(laterDraft, withLater, nextDraft)).toBe(false);
    expect(skipTouchesNextWeek(nextDraft, weeks)).toBe(false);
    expect(shouldOpenExistingNextWeek(nextDraft, weeks, thisSunday)).toBe(true);
    expect(shouldOpenExistingNextWeek(nextDraft, weeks)).toBe(false);
    expect(shouldOpenExistingNextWeek(laterDraft, withLater, nextDraft)).toBe(false);

    const skipThisSunday = skipLandingWeek(weeks, thisSunday);
    expect(skipThisSunday?.id).toBe("w2");
    expect(skipThisSunday?.status).toBe("open");
    expect(weekSwitcherLabel(nextDraft, skipThisSunday)).toBe("This Sunday");

    const skipNext = skipLandingWeek(weeks, nextDraft);
    expect(skipNext?.id).toBe("w1");
    expect(skipNext?.status).toBe("open");
    expect(weekSwitcherLabel(thisSunday, skipNext)).toBe("This Sunday");
    expect(skipLandingWeek(weeks, nextDraft)?.week_number).not.toBe(3);
    expect(skipLandingWeek(withLater, nextDraft)?.id).toBe("w1");
    expect(skipLandingWeek(withLater, nextDraft)?.status).toBe("open");
    expect(skipLandingWeek([lockedSunday, nextDraft], nextDraft)?.id).toBe("w1l");
    expect(skipLandingWeek([lockedSunday, nextDraft], nextDraft)?.status).toBe("locked");
    expect(skipLandingWeek([lockedSunday, nextDraft], lockedSunday)?.id).toBe("w2");
    expect(skipLandingWeek([lockedSunday, nextDraft], lockedSunday)?.status).toBe("open");

    const onThisSunday = skipControlCopy(thisSunday, thisSunday, weeks);
    expect(onThisSunday.button).toBe("Skip this week / start next week");
    expect(onThisSunday.hint).toMatch(/without Reveal/);
    expect(onThisSunday.button).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const onNext = skipControlCopy(nextDraft, nextDraft, weeks);
    expect(onNext.button).toBe("Skip this week");
    expect(onNext.button).not.toMatch(/next week|open/i);
    expect(onNext.hint).toMatch(/without Reveal/);
    expect(onNext.hint).not.toMatch(/open next/);
    const onLater = skipControlCopy(nextDraft, laterDraft, withLater);
    expect(onLater.button).toBe("Skip leftover Week 2");
    expect(onLater.button).not.toMatch(/open/);
    expect(onLater.hint).toMatch(/without Reveal/);
    const gapStep = leftoverDraftNextStep(nextDraft, withLater);
    expect(gapStep?.label).toMatch(/will not auto-open/);
    expect(gapStep?.label).toMatch(/without Reveal/);
    expect(gapStep?.label).not.toMatch(/start next week/);
    expect(gapStep?.label).not.toMatch(/Open cards/);

    const wrapWeeks = [wrapSunday, wrapNext];
    expect(selectActiveWeek(wrapWeeks)?.id).toBe("w18");
    expect(weekSwitcherLabel(wrapSunday, selectActiveWeek(wrapWeeks))).toBe("This Sunday");
    expect(weekSwitcherLabel(wrapNext, selectActiveWeek(wrapWeeks))).toBe("Next week");
    expect(skipTouchesNextWeek(wrapNext, wrapWeeks, wrapSunday)).toBe(true);
    expect(skipTouchesNextWeek({ season_year: 2026, week_number: 2 }, wrapWeeks, wrapNext)).toBe(false);
    expect(skipLandingWeek(wrapWeeks, wrapSunday)?.id).toBe("w1");
    expect(skipLandingWeek(wrapWeeks, wrapSunday)?.status).toBe("open");
    expect(skipLandingWeek(wrapWeeks, wrapNext)?.id).toBe("w18");
    expect(skipLandingWeek(wrapWeeks, wrapNext)?.status).toBe("locked");
    expect(skipControlCopy(wrapSunday, wrapSunday, wrapWeeks).button).toBe("Skip this week / start next week");
    expect(skipControlCopy(wrapNext, wrapNext, wrapWeeks).button).toBe("Skip this week");
    expect(skipControlCopy(wrapNext, wrapNext, wrapWeeks).button).not.toMatch(/next week|open/i);
  });

  it("skip of This Sunday still opens Next week when a farther draft already exists", () => {
    const thisSunday = wr("w1", 1, "open");
    const lockedSunday = wr("w1l", 1, "locked");
    const nextDraft = wr("w2", 2, "draft");
    const laterDraft = wr("w3", 3, "draft");
    const leftoverDraft = wr("w1d", 1, "draft");
    const weeks = [thisSunday, nextDraft, laterDraft];
    const lockedWeeks = [lockedSunday, nextDraft, laterDraft];
    const leftoverWeeks = [leftoverDraft, nextDraft, laterDraft];
    const wrapSunday = wr("w18", 18, "locked", 2025);
    const wrapNext = wr("w1", 1, "draft", 2026);
    const wrapLater = wr("w2", 2, "draft", 2026);
    const wrapWeeks = [wrapSunday, wrapNext, wrapLater];

    expect(selectActiveWeek(weeks)?.id).toBe("w1");
    expect(weekSwitcherLabel(nextDraft, selectActiveWeek(weeks))).toBe("Next week");
    expect(weekSwitcherLabel(laterDraft, selectActiveWeek(weeks))).toBe("Week 3");
    expect(selectActiveWeek(lockedWeeks)?.id).toBe("w1l");

    expect(skipTouchesNextWeek(nextDraft, weeks, thisSunday)).toBe(true);
    expect(skipTouchesNextWeek(nextDraft, lockedWeeks, lockedSunday)).toBe(true);
    expect(skipTouchesNextWeek(wrapNext, wrapWeeks, wrapSunday)).toBe(true);
    expect(shouldOpenExistingNextWeek(nextDraft, weeks, thisSunday)).toBe(true);
    expect(shouldOpenExistingNextWeek(nextDraft, lockedWeeks, lockedSunday)).toBe(true);
    expect(shouldOpenExistingNextWeek(wrapNext, wrapWeeks, wrapSunday)).toBe(true);

    const landing = skipLandingWeek(weeks, thisSunday);
    expect(landing?.id).toBe("w2");
    expect(landing?.status).toBe("open");
    expect(weekSwitcherLabel(laterDraft, landing)).toBe("Next week");
    expect(skipLandingWeek(lockedWeeks, lockedSunday)?.id).toBe("w2");
    expect(skipLandingWeek(lockedWeeks, lockedSunday)?.status).toBe("open");
    expect(skipLandingWeek(wrapWeeks, wrapSunday)?.id).toBe("w1");
    expect(skipLandingWeek(wrapWeeks, wrapSunday)?.status).toBe("open");

    const onThisSunday = skipControlCopy(thisSunday, thisSunday, weeks);
    expect(onThisSunday.button).toBe("Skip this week / start next week");
    expect(onThisSunday.hint).toMatch(/without Reveal/);
    expect(onThisSunday.button).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(skipControlCopy(lockedSunday, lockedSunday, lockedWeeks).button).toBe(
      "Skip this week / start next week",
    );
    expect(skipControlCopy(wrapSunday, wrapSunday, wrapWeeks).button).toBe(
      "Skip this week / start next week",
    );

    expect(skipTouchesNextWeek(nextDraft, leftoverWeeks, leftoverDraft)).toBe(false);
    expect(shouldOpenExistingNextWeek(nextDraft, leftoverWeeks, leftoverDraft)).toBe(false);
    expect(skipLandingWeek(leftoverWeeks, leftoverDraft)?.id).toBe("w3");
    expect(skipLandingWeek(leftoverWeeks, leftoverDraft)?.status).toBe("draft");
    expect(skipControlCopy(leftoverDraft, leftoverDraft, leftoverWeeks).button).toBe("Skip this week");
    expect(skipControlCopy(leftoverDraft, leftoverDraft, leftoverWeeks).button).not.toMatch(/next week|open/i);

    expect(skipLandingWeek(weeks, nextDraft)?.id).toBe("w1");
    expect(skipLandingWeek(weeks, nextDraft)?.status).toBe("open");
    expect(skipTouchesNextWeek(laterDraft, weeks, nextDraft)).toBe(false);
  });

  it("skip of This Sunday still opens premature-final Next week when a farther draft already exists", () => {
    const thisSunday = wr("w1", 1, "open");
    const lockedSunday = wr("w1l", 1, "locked");
    const prematureNext = {
      ...wr("w2", 2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    };
    const laterDraft = wr("w3", 3, "draft");
    const leftoverDraft = wr("w1d", 1, "draft");
    const weeks = [thisSunday, prematureNext, laterDraft];
    const lockedWeeks = [lockedSunday, prematureNext, laterDraft];
    const leftoverWeeks = [leftoverDraft, prematureNext, laterDraft];
    const wrapSunday = wr("w18", 18, "locked", 2025);
    const wrapNext = {
      ...wr("w1", 1, "final", 2026),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    };
    const wrapLater = wr("w2", 2, "draft", 2026);
    const wrapWeeks = [wrapSunday, wrapNext, wrapLater];

    expect(selectActiveWeek(weeks)?.id).toBe("w1");
    expect(weekSwitcherLabel(thisSunday, selectActiveWeek(weeks))).toBe("This Sunday");
    expect(weekSwitcherLabel(prematureNext, selectActiveWeek(weeks))).toBe("Week 2");
    expect(weekSwitcherLabel(laterDraft, selectActiveWeek(weeks))).toBe("Week 3");
    expect(selectActiveWeek(lockedWeeks)?.id).toBe("w1l");

    expect(skipTouchesNextWeek(prematureNext, weeks, thisSunday)).toBe(true);
    expect(skipTouchesNextWeek(prematureNext, lockedWeeks, lockedSunday)).toBe(true);
    expect(skipTouchesNextWeek(wrapNext, wrapWeeks, wrapSunday)).toBe(true);
    expect(shouldOpenExistingNextWeek(prematureNext, weeks, thisSunday)).toBe(true);
    expect(shouldOpenExistingNextWeek(prematureNext, lockedWeeks, lockedSunday)).toBe(true);
    expect(shouldOpenExistingNextWeek(wrapNext, wrapWeeks, wrapSunday)).toBe(true);

    const landing = skipLandingWeek(weeks, thisSunday);
    expect(landing?.id).toBe("w2");
    expect(landing?.status).toBe("open");
    expect(landing?.finalized_at).toBeNull();
    expect(weekSwitcherLabel(landing!, landing)).toBe("This Sunday");
    expect(weekSwitcherLabel(laterDraft, landing)).toBe("Next week");

    const lockedLanding = skipLandingWeek(lockedWeeks, lockedSunday);
    expect(lockedLanding?.id).toBe("w2");
    expect(lockedLanding?.status).toBe("open");
    expect(lockedLanding?.finalized_at).toBeNull();

    const wrapLanding = skipLandingWeek(wrapWeeks, wrapSunday);
    expect(wrapLanding?.id).toBe("w1");
    expect(wrapLanding?.status).toBe("open");
    expect(wrapLanding?.season_year).toBe(2026);
    expect(wrapLanding?.finalized_at).toBeNull();

    const onThisSunday = skipControlCopy(thisSunday, thisSunday, weeks);
    expect(onThisSunday.button).toBe("Skip this week / start next week");
    expect(onThisSunday.hint).toMatch(/without Reveal/);
    expect(onThisSunday.hint).toMatch(/Tuesday/);
    expect(onThisSunday.button).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(onThisSunday.hint).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(skipControlCopy(lockedSunday, lockedSunday, lockedWeeks).button).toBe(
      "Skip this week / start next week",
    );
    expect(skipControlCopy(wrapSunday, wrapSunday, wrapWeeks).button).toBe(
      "Skip this week / start next week",
    );

    expect(skipTouchesNextWeek(prematureNext, leftoverWeeks, leftoverDraft)).toBe(false);
    expect(shouldOpenExistingNextWeek(prematureNext, leftoverWeeks, leftoverDraft)).toBe(false);
    expect(skipLandingWeek(leftoverWeeks, leftoverDraft)?.id).toBe("w3");
    expect(skipLandingWeek(leftoverWeeks, leftoverDraft)?.status).toBe("draft");
    expect(skipControlCopy(leftoverDraft, leftoverDraft, leftoverWeeks).button).toBe("Skip this week");
    expect(skipControlCopy(leftoverDraft, leftoverDraft, leftoverWeeks).button).not.toMatch(/next week|open/i);

    const noLater = [thisSunday, prematureNext];
    const noLaterLanding = skipLandingWeek(noLater, thisSunday);
    expect(skipTouchesNextWeek(prematureNext, noLater, thisSunday)).toBe(true);
    expect(shouldOpenExistingNextWeek(prematureNext, noLater, thisSunday)).toBe(true);
    expect(noLaterLanding?.id).toBe("w2");
    expect(noLaterLanding?.status).toBe("open");
    expect(noLaterLanding?.finalized_at).toBeNull();

    const harperSunday = wr("3e3aeeeb", 1, "open");
    const harperPremature = {
      ...wr("52a42a9e", 2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    };
    const harperWeeks = [harperSunday, harperPremature];
    expect(selectActiveWeek(harperWeeks)?.id).toBe("3e3aeeeb");
    const harperLanding = skipLandingWeek(harperWeeks, harperSunday);
    expect(harperLanding?.id).toBe("52a42a9e");
    expect(harperLanding?.status).toBe("open");
    expect(harperLanding?.finalized_at).toBeNull();
    expect(weekSwitcherLabel(harperLanding!, harperLanding)).toBe("This Sunday");

    const skipped = wr("w1s", 1, "final");
    const inPlace = skipLandingWeek([skipped, prematureNext], prematureNext);
    expect(inPlace?.id).toBe("w2");
    expect(inPlace?.status).toBe("final");
    expect(inPlace?.finalized_at).toBe("2026-09-15T19:04:43.880Z");
  });

  it("skip of This Sunday does not reopen a completed Next week", () => {
    const thisSunday = wr("w1", 1, "open");
    const lockedSunday = wr("w1l", 1, "locked");
    const completedNext = {
      ...wr("w2", 2, "final"),
      finalized_at: "2026-09-16T16:00:00.000Z",
      lock_at: "2026-09-13T17:00:00.000Z",
    };
    const leftoverDraft = wr("w1d", 1, "draft");
    const laterDraft = wr("w3", 3, "draft");
    const weeks = [thisSunday, completedNext];
    const lockedWeeks = [lockedSunday, completedNext];
    const wrapSunday = wr("w18", 18, "locked", 2025);
    const wrapCompleted = {
      ...wr("w1", 1, "final", 2026),
      finalized_at: "2026-09-16T16:00:00.000Z",
      lock_at: "2026-09-13T17:00:00.000Z",
    };
    const wrapWeeks = [wrapSunday, wrapCompleted];
    const harperSunday = wr("3e3aeeeb", 1, "open");
    const harperCompleted = {
      ...wr("52a42a9e", 2, "final"),
      finalized_at: "2026-09-16T16:00:00.000Z",
      lock_at: "2026-09-13T17:00:00.000Z",
    };

    expect(selectActiveWeek(weeks)?.id).toBe("w1");
    expect(selectActiveWeek(weeks)?.status).toBe("open");
    expect(weekSwitcherLabel(thisSunday, selectActiveWeek(weeks))).toBe("This Sunday");
    expect(weekSwitcherLabel(completedNext, selectActiveWeek(weeks))).toBe("Week 2");
    expect(weekSwitcherLabel(completedNext, selectActiveWeek(weeks))).not.toBe("This Sunday");
    expect(weekSwitcherLabel(completedNext, selectActiveWeek(weeks))).not.toBe("Next week");
    expect(selectActiveWeek(lockedWeeks)?.id).toBe("w1l");
    expect(selectActiveWeek(wrapWeeks)?.id).toBe("w18");
    expect(selectActiveWeek([harperSunday, harperCompleted])?.id).toBe("3e3aeeeb");

    expect(skipTargetWeek(weeks, thisSunday)?.id).toBe("w1");
    expect(skipTargetWeek(weeks, completedNext)).toBeNull();
    expect(skipTouchesNextWeek(completedNext, weeks, thisSunday)).toBe(false);
    expect(skipTouchesNextWeek(completedNext, lockedWeeks, lockedSunday)).toBe(false);
    expect(skipTouchesNextWeek(wrapCompleted, wrapWeeks, wrapSunday)).toBe(false);
    expect(shouldOpenExistingNextWeek(completedNext, weeks, thisSunday)).toBe(false);
    expect(shouldOpenExistingNextWeek(completedNext, lockedWeeks, lockedSunday)).toBe(false);
    expect(shouldOpenExistingNextWeek(wrapCompleted, wrapWeeks, wrapSunday)).toBe(false);
    expect(skipClearsCalledMoments(completedNext)).toBe(true);

    const landing = skipLandingWeek(weeks, thisSunday);
    expect(landing?.id).toBe("w2");
    expect(landing?.status).toBe("final");
    expect(landing?.finalized_at).toBe("2026-09-16T16:00:00.000Z");
    expect(weekSwitcherLabel(landing!, landing)).toBe("Week 2");
    expect(weekSwitcherLabel(landing!, landing)).not.toBe("This Sunday");
    expect(selectActiveWeek([w(1, "final"), completedNext])?.id).toBe("w2");
    expect(selectActiveWeek([w(1, "final"), completedNext])?.status).toBe("final");

    const lockedLanding = skipLandingWeek(lockedWeeks, lockedSunday);
    expect(lockedLanding?.id).toBe("w2");
    expect(lockedLanding?.status).toBe("final");
    expect(lockedLanding?.finalized_at).toBe("2026-09-16T16:00:00.000Z");

    const wrapLanding = skipLandingWeek(wrapWeeks, wrapSunday);
    expect(wrapLanding?.id).toBe("w1");
    expect(wrapLanding?.status).toBe("final");
    expect(wrapLanding?.season_year).toBe(2026);
    expect(wrapLanding?.finalized_at).toBe("2026-09-16T16:00:00.000Z");

    const harperLanding = skipLandingWeek([harperSunday, harperCompleted], harperSunday);
    expect(harperLanding?.id).toBe("52a42a9e");
    expect(harperLanding?.status).toBe("final");
    expect(harperLanding?.finalized_at).toBe("2026-09-16T16:00:00.000Z");

    const onThisSunday = skipControlCopy(thisSunday, thisSunday, weeks);
    expect(onThisSunday.button).toBe("Skip this week");
    expect(onThisSunday.button).not.toMatch(/next week|open/i);
    expect(onThisSunday.hint).toMatch(/without Reveal/);
    expect(onThisSunday.hint).toMatch(/Tuesday/);
    expect(onThisSunday.button).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(onThisSunday.hint).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(skipControlCopy(lockedSunday, lockedSunday, lockedWeeks).button).toBe("Skip this week");
    expect(skipControlCopy(wrapSunday, wrapSunday, wrapWeeks).button).toBe("Skip this week");

    const withLater = [thisSunday, completedNext, laterDraft];
    expect(selectActiveWeek(withLater)?.id).toBe("w1");
    expect(skipTouchesNextWeek(completedNext, withLater, thisSunday)).toBe(false);
    expect(skipLandingWeek(withLater, thisSunday)?.id).toBe("w3");
    expect(skipLandingWeek(withLater, thisSunday)?.status).toBe("draft");
    expect(selectActiveWeek([w(1, "final"), completedNext, laterDraft])?.id).toBe("w3");

    expect(skipTouchesNextWeek(completedNext, [leftoverDraft, completedNext], leftoverDraft)).toBe(false);
    const leftoverLanding = skipLandingWeek([leftoverDraft, completedNext], leftoverDraft);
    expect(leftoverLanding?.id).toBe("w2");
    expect(leftoverLanding?.status).toBe("final");
    expect(leftoverLanding?.finalized_at).toBe("2026-09-16T16:00:00.000Z");
  });

  it("skip of leftover draft does not reopen a completed Next week", () => {
    const leftoverDraft = wr("w1d", 1, "draft");
    const completedNext = {
      ...wr("w2", 2, "final"),
      finalized_at: "2026-09-16T16:00:00.000Z",
      lock_at: "2026-09-13T17:00:00.000Z",
    };
    const prematureNext = {
      ...wr("w2p", 2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    };
    const laterDraft = wr("w3", 3, "draft");
    const weeks = [leftoverDraft, completedNext];
    const wrapLeftover = wr("w18d", 18, "draft", 2025);
    const wrapCompleted = {
      ...wr("w1", 1, "final", 2026),
      finalized_at: "2026-09-16T16:00:00.000Z",
      lock_at: "2026-09-13T17:00:00.000Z",
    };
    const wrapWeeks = [wrapLeftover, wrapCompleted];
    const harperDraft = wr("3e3aeeeb", 1, "draft");
    const harperCompleted = {
      ...wr("52a42a9e", 2, "final"),
      finalized_at: "2026-09-16T16:00:00.000Z",
      lock_at: "2026-09-13T17:00:00.000Z",
    };
    const harperWeeks = [harperDraft, harperCompleted];

    expect(selectActiveWeek(weeks)?.id).toBe("w2");
    expect(selectActiveWeek(weeks)?.status).toBe("final");
    expect(weekSwitcherLabel(completedNext, selectActiveWeek(weeks))).toBe("Week 2");
    expect(weekSwitcherLabel(completedNext, selectActiveWeek(weeks))).not.toBe("This Sunday");
    expect(weekSwitcherLabel(completedNext, selectActiveWeek(weeks))).not.toBe("Next week");
    expect(weekSwitcherLabel(leftoverDraft, selectActiveWeek(weeks))).toBe("Week 1");
    expect(selectActiveWeek(wrapWeeks)?.id).toBe("w1");
    expect(selectActiveWeek(harperWeeks)?.id).toBe("52a42a9e");

    expect(skipTargetWeek(weeks, leftoverDraft)?.id).toBe("w1d");
    expect(skipTargetWeek(weeks, completedNext)?.id).toBe("w1d");
    expect(skipTouchesNextWeek(completedNext, weeks, leftoverDraft)).toBe(false);
    expect(skipTouchesNextWeek(completedNext, weeks)).toBe(false);
    expect(skipTouchesNextWeek(wrapCompleted, wrapWeeks, wrapLeftover)).toBe(false);
    expect(skipTouchesNextWeek(harperCompleted, harperWeeks, harperDraft)).toBe(false);
    expect(shouldOpenExistingNextWeek(completedNext, weeks, leftoverDraft)).toBe(false);
    expect(shouldOpenExistingNextWeek(wrapCompleted, wrapWeeks, wrapLeftover)).toBe(false);
    expect(shouldOpenExistingNextWeek(harperCompleted, harperWeeks, harperDraft)).toBe(false);
    expect(skipClearsCalledMoments(completedNext)).toBe(true);

    const landing = skipLandingWeek(weeks, leftoverDraft);
    expect(landing?.id).toBe("w2");
    expect(landing?.status).toBe("final");
    expect(landing?.finalized_at).toBe("2026-09-16T16:00:00.000Z");
    expect(weekSwitcherLabel(landing!, landing)).toBe("Week 2");
    expect(weekSwitcherLabel(landing!, landing)).not.toBe("This Sunday");
    expect(selectActiveWeek([w(1, "final"), completedNext])?.id).toBe("w2");
    expect(selectActiveWeek([w(1, "final"), completedNext])?.status).toBe("final");

    const wrapLanding = skipLandingWeek(wrapWeeks, wrapLeftover);
    expect(wrapLanding?.id).toBe("w1");
    expect(wrapLanding?.status).toBe("final");
    expect(wrapLanding?.season_year).toBe(2026);
    expect(wrapLanding?.finalized_at).toBe("2026-09-16T16:00:00.000Z");

    const harperLanding = skipLandingWeek(harperWeeks, harperDraft);
    expect(harperLanding?.id).toBe("52a42a9e");
    expect(harperLanding?.status).toBe("final");
    expect(harperLanding?.finalized_at).toBe("2026-09-16T16:00:00.000Z");

    const onLeftover = skipControlCopy(leftoverDraft, leftoverDraft, weeks);
    expect(onLeftover.button).toBe("Skip this week");
    expect(onLeftover.button).not.toMatch(/next week|open/i);
    expect(onLeftover.hint).toMatch(/without Reveal/);
    expect(onLeftover.hint).toMatch(/Tuesday/);
    expect(onLeftover.button).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(onLeftover.hint).not.toMatch(/\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    expect(skipControlCopy(leftoverDraft, completedNext, weeks).button).toBe("Skip leftover Week 1");
    expect(skipControlCopy(leftoverDraft, completedNext, weeks).button).not.toMatch(/open/i);
    expect(skipControlCopy(wrapLeftover, wrapLeftover, wrapWeeks).button).toBe("Skip this week");
    const leftoverStep = leftoverDraftNextStep(leftoverDraft, weeks);
    expect(leftoverStep?.label ?? "").toMatch(/will not auto-open/);
    expect(leftoverStep?.label ?? "").toMatch(/without Reveal/);
    expect(leftoverStep?.label ?? "").not.toMatch(/start next week/);
    expect(leftoverStep?.label ?? "").not.toMatch(/Open cards/);

    const withLater = [leftoverDraft, completedNext, laterDraft];
    expect(selectActiveWeek(withLater)?.id).toBe("w3");
    expect(skipTouchesNextWeek(completedNext, withLater, leftoverDraft)).toBe(false);
    expect(skipLandingWeek(withLater, leftoverDraft)?.id).toBe("w3");
    expect(skipLandingWeek(withLater, leftoverDraft)?.status).toBe("draft");
    expect(skipControlCopy(leftoverDraft, leftoverDraft, withLater).button).toBe("Skip this week");
    expect(skipControlCopy(leftoverDraft, leftoverDraft, withLater).button).not.toMatch(/next week|open/i);

    const prematureWeeks = [leftoverDraft, prematureNext];
    expect(skipTouchesNextWeek(prematureNext, prematureWeeks, leftoverDraft)).toBe(true);
    expect(shouldOpenExistingNextWeek(prematureNext, prematureWeeks, leftoverDraft)).toBe(true);
    const prematureLanding = skipLandingWeek(prematureWeeks, leftoverDraft);
    expect(prematureLanding?.id).toBe("w2p");
    expect(prematureLanding?.status).toBe("open");
    expect(prematureLanding?.finalized_at).toBeNull();
    expect(skipControlCopy(leftoverDraft, leftoverDraft, prematureWeeks).button).toBe(
      "Skip this week / start next week",
    );
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

  it("never prefers an older leftover draft over a newer week across seasons", () => {
    const leftover = w(18, "draft", 2025);
    const nextFinal = w(1, "final", 2026);
    expect(selectActiveWeek([leftover, nextFinal])?.season_year).toBe(2026);
    expect(selectActiveWeek([nextFinal, leftover])?.season_year).toBe(2026);
    expect(selectActiveWeek([leftover, nextFinal])?.week_number).toBe(1);
    expect(selectActiveWeek([leftover, w(1, "open", 2026)])?.season_year).toBe(2026);
    expect(selectActiveWeek([leftover, w(1, "draft", 2026)])?.season_year).toBe(2026);
    const newerDraft = w(1, "draft", 2026);
    const priorFinal = w(18, "final", 2025);
    expect(selectActiveWeek([newerDraft, priorFinal])?.season_year).toBe(2026);
    expect(selectActiveWeek([priorFinal, newerDraft])?.season_year).toBe(2026);
    expect(selectActiveWeek([newerDraft, priorFinal])?.week_number).toBe(1);
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

  it("labels This Sunday by recency slot so a leftover draft cannot steal it", () => {
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const sameSlotCopy = wr("other-w2", 2, "open");
    const active = selectActiveWeek([leftover, open]);
    expect(active?.id).toBe("52a42a9e");
    expect(weekSwitcherLabel(open, active)).toBe("This Sunday");
    expect(weekSwitcherLabel(sameSlotCopy, active)).toBe("This Sunday");
    expect(weekSwitcherLabel(leftover, active)).toBe("Week 1");
    expect(weekSwitcherLabel(leftover, active)).not.toBe("This Sunday");
    expect(weekSwitcherLabel(leftover, active)).not.toBe("Next week");
    expect(weekSwitcherLabel(wr("copy-w1", 1, "open"), wr("w1", 1, "open"))).toBe("This Sunday");
    expect(weekSwitcherLabel(leftover, leftover)).toBe("Week 1");
  });

  it("labels Next week across the season wrap", () => {
    const wrapLocked = wr("w18", 18, "locked", 2025);
    const wrapDraft = wr("w1", 1, "draft", 2026);
    const active = selectActiveWeek([wrapLocked, wrapDraft]);
    expect(active?.id).toBe("w18");
    expect(weekSwitcherLabel(wrapLocked, active)).toBe("This Sunday");
    expect(weekSwitcherLabel(wrapDraft, active)).toBe("Next week");
    expect(pickViewWeek([wrapLocked, wrapDraft], active, "next")?.id).toBe("w1");
  });

  it("defaults to the active week; next or an id reaches the newer draft", () => {
    const active = selectActiveWeek(weeks);
    expect(active?.id).toBe("w1");
    expect(pickViewWeek(weeks, active, null)?.id).toBe("w1");
    expect(pickViewWeek(weeks, active, "next")?.id).toBe("w2");
    expect(pickViewWeek(weeks, active, "w2")?.id).toBe("w2");
    expect(selectActiveWeek(weeks)?.status).toBe("locked");
  });

  it("labels Next week only on the next slot so a later draft cannot steal it", () => {
    const open = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const laterDraft = wr("w3", 3, "draft");
    const weeksWithLater = [open, nextDraft, laterDraft];
    const active = selectActiveWeek(weeksWithLater);
    expect(active?.id).toBe("w1");
    expect(weekSwitcherLabel(open, active)).toBe("This Sunday");
    expect(weekSwitcherLabel(nextDraft, active)).toBe("Next week");
    expect(weekSwitcherLabel(laterDraft, active)).toBe("Week 3");
    expect(weekSwitcherLabel(laterDraft, active)).not.toBe("Next week");
    expect(pickViewWeek(weeksWithLater, active, "next")?.id).toBe("w2");
    expect(pickViewWeek([open, laterDraft], active, "next")?.id).toBe("w1");
    expect(pickViewWeek([open, laterDraft], active, "next")?.id).not.toBe("w3");
    expect(weekSwitcherLabel(laterDraft, selectActiveWeek([open, laterDraft]))).toBe("Week 3");
  });

  it("pickViewWeek next stays on the next slot so a later leftover cannot steal it", () => {
    const open = wr("w1", 1, "open");
    const premature = wr("w2", 2, "final");
    const lockedNext = wr("w2l", 2, "locked");
    const laterDraft = wr("w3", 3, "draft");
    const active = selectActiveWeek([open, premature, laterDraft]);
    expect(active?.id).toBe("w1");
    expect(pickViewWeek([open, premature, laterDraft], active, "next")?.id).toBe("w1");
    expect(pickViewWeek([open, premature, laterDraft], active, "next")?.id).not.toBe("w3");
    expect(weekSwitcherLabel(laterDraft, active)).toBe("Week 3");
    expect(weekSwitcherLabel(laterDraft, active)).not.toBe("Next week");
    expect(weekSwitcherLabel(premature, active)).toBe("Week 2");
    expect(pickViewWeek([open, wr("w2d", 2, "draft"), laterDraft], active, "next")?.id).toBe("w2d");
    expect(pickViewWeek([open, laterDraft], active, "next")?.id).toBe("w1");
    expect(pickViewWeek([open, laterDraft], active, "next")?.id).not.toBe("w3");
    const fartherDraft = wr("w4", 4, "draft");
    expect(pickViewWeek([open, laterDraft, fartherDraft], active, "next")?.id).toBe("w1");
    expect(pickViewWeek([open, fartherDraft, laterDraft], active, "next")?.id).toBe("w1");
    expect(pickViewWeek([open, fartherDraft], active, "next")?.id).toBe("w1");
    expect(pickViewWeek([open, fartherDraft], active, "next")?.id).not.toBe("w4");
    expect(selectActiveWeek([open, lockedNext, laterDraft])?.id).toBe("w2l");
    expect(
      pickViewWeek([open, lockedNext, laterDraft], selectActiveWeek([open, lockedNext, laterDraft]), "next")
        ?.id,
    ).toBe("w3");
  });

  it("pickViewWeek next stays on the in-play week when a nearer leftover sits in the gap", () => {
    const open = wr("w1", 1, "open");
    const gapFinal = wr("w3", 3, "final");
    const laterDraft = wr("w4", 4, "draft");
    const weeks = [open, gapFinal, laterDraft];
    const reverse = [laterDraft, gapFinal, open];
    const active = selectActiveWeek(weeks);
    expect(active?.id).toBe("w1");
    expect(selectActiveWeek(reverse)?.id).toBe("w1");
    expect(pickViewWeek(weeks, active, "next")?.id).toBe("w1");
    expect(pickViewWeek(reverse, active, "next")?.id).toBe("w1");
    expect(pickViewWeek(weeks, active, "next")?.id).not.toBe("w4");
    expect(weekSwitcherLabel(gapFinal, active)).toBe("Week 3");
    expect(weekSwitcherLabel(laterDraft, active)).toBe("Week 4");
    expect(weekSwitcherLabel(laterDraft, active)).not.toBe("Next week");
    expect(pickViewWeek([open, laterDraft], active, "next")?.id).toBe("w1");
    expect(pickViewWeek([open, laterDraft], active, "next")?.id).not.toBe("w4");
    expect(pickViewWeek([open, wr("w3d", 3, "draft"), laterDraft], active, "next")?.id).toBe("w1");
    expect(pickViewWeek([open, wr("w3d", 3, "draft"), laterDraft], active, "next")?.id).not.toBe("w3d");
    const wrapLocked = wr("w18", 18, "locked", 2025);
    const wrapFinal = wr("w2", 2, "final", 2026);
    const wrapDraft = wr("w3", 3, "draft", 2026);
    const wrapActive = selectActiveWeek([wrapLocked, wrapFinal, wrapDraft]);
    expect(wrapActive?.id).toBe("w18");
    expect(pickViewWeek([wrapLocked, wrapFinal, wrapDraft], wrapActive, "next")?.id).toBe("w18");
    expect(pickViewWeek([wrapLocked, wrapFinal, wrapDraft], wrapActive, "next")?.id).not.toBe("w3");
    expect(pickViewWeek([wrapLocked, wrapDraft], wrapActive, "next")?.id).toBe("w18");
    expect(pickViewWeek([wrapLocked, wrapDraft], wrapActive, "next")?.id).not.toBe("w3");
  });

  it("pickViewWeek next stays on This Sunday when the next slot is missing", () => {
    const open = wr("w1", 1, "open");
    const laterDraft = wr("w3", 3, "draft");
    const fartherDraft = wr("w4", 4, "draft");
    const active = selectActiveWeek([open, laterDraft, fartherDraft]);
    expect(active?.id).toBe("w1");
    expect(weekSwitcherLabel(open, active)).toBe("This Sunday");
    expect(weekSwitcherLabel(laterDraft, active)).toBe("Week 3");
    expect(weekSwitcherLabel(laterDraft, active)).not.toBe("Next week");
    expect(pickViewWeek([open, laterDraft], active, "next")?.id).toBe("w1");
    expect(pickViewWeek([open, laterDraft, fartherDraft], active, "next")?.id).toBe("w1");
    expect(pickViewWeek([fartherDraft, laterDraft, open], active, "next")?.id).toBe("w1");
    expect(pickViewWeek([open, laterDraft], active, "w3")?.id).toBe("w3");
    const wrapLocked = wr("w18", 18, "locked", 2025);
    const wrapDraft = wr("w2", 2, "draft", 2026);
    const wrapActive = selectActiveWeek([wrapLocked, wrapDraft]);
    expect(wrapActive?.id).toBe("w18");
    expect(pickViewWeek([wrapLocked, wrapDraft], wrapActive, "next")?.id).toBe("w18");
    expect(pickViewWeek([wrapLocked, wrapDraft], wrapActive, "next")?.id).not.toBe("w2");
    expect(weekSwitcherLabel(wrapDraft, wrapActive)).toBe("Week 2");
    expect(weekSwitcherLabel(wrapDraft, wrapActive)).not.toBe("Next week");
  });
});

describe("useCurrentWeek production wiring", () => {
  it("db.ts selects the active week through selectActiveWeek, not LIMIT 1", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/db.ts"), "utf8");
    const fn = src.slice(src.indexOf("export function useCurrentWeek"));
    expect(src).toMatch(/import \{ selectActiveWeek \} from "\.\/current-week"/);
    expect(fn).toMatch(/select:\s*\(weeks\)\s*=>\s*selectActiveWeek\(weeks\)/);
    expect(src).toMatch(/else newest week overall/);
    expect(src).not.toMatch(/else latest draft/);
    expect(src).not.toMatch(/open\/locked > draft > final/);
    expect(fn.slice(0, fn.indexOf("export function useWeekGames"))).not.toMatch(/\.limit\(1\)/);
  });

  it("family chrome shows the active week number from useCurrentWeek", () => {
    const src = readFileSync(join(process.cwd(), "src/components/bgs/AppShell.tsx"), "utf8");
    expect(src).toMatch(/useProfile/);
    expect(src).toMatch(/familyWeekChrome\(household\?\.name, week\)/);
    expect(src).toMatch(/from "@\/lib\/current-week"/);
    const lib = readFileSync(join(process.cwd(), "src/lib/current-week.ts"), "utf8");
    expect(lib).toMatch(/export function familyWeekChrome/);
    expect(lib).toMatch(/\$\{name\} · Week \$\{week\.week_number\}/);
    const week = readFileSync(join(process.cwd(), "src/routes/_authenticated/week.tsx"), "utf8");
    expect(week).toMatch(/Week \$\{week\.week_number\}/);
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
    expect(lib).toMatch(/Clear leftover marks \/ open this week/);
    const copyFn = lib.slice(
      lib.indexOf("export function skipControlCopy"),
      lib.indexOf("function recoverableFinishedWeek"),
    );
    expect(copyFn.indexOf("skipTouchesNextWeek")).toBeGreaterThanOrEqual(0);
    expect(copyFn.indexOf("skipTouchesNextWeek")).toBeLessThan(
      copyFn.indexOf("Skip this week / start next week"),
    );
    expect(copyFn).toMatch(/button: "Skip this week"/);
    const touchFn = lib.slice(
      lib.indexOf("export function skipTouchesNextWeek"),
      lib.indexOf("function withStatus"),
    );
    expect(touchFn).toMatch(/hasNewerThan\(next, weeks\)/);
    expect(touchFn).not.toMatch(/hasNewerNonDraftThan\(next, weeks\)/);
    expect(touchFn).not.toMatch(/hasNewerInPlayThan\(next, weeks\)/);
    expect(touchFn).toMatch(/weekAtSlot\(weeks,\s*next\)/);
    expect(touchFn).toMatch(/isInPlay\(existing\.status\)/);
    expect(touchFn).toMatch(/leftover/);
    expect(touchFn).toMatch(/hasOlderInPlayThan\(next, remaining\)/);
    expect(touchFn.indexOf("hasNewerThan")).toBeLessThan(touchFn.indexOf("weekAtSlot(weeks, next)"));
    expect(touchFn.indexOf("weekAtSlot(weeks, next)")).toBeLessThan(touchFn.indexOf("isInPlay(existing.status)"));
    expect(touchFn.indexOf("isInPlay(existing.status)")).toBeLessThan(touchFn.indexOf("hasOlderInPlayThan"));
    expect(touchFn).toMatch(/isPrematureFinalWeek\(existing,\s*weeks\)/);
    expect(touchFn).toMatch(/finalizedAfterLock\(existing\)/);
    expect(touchFn.indexOf("isInPlay(existing.status)")).toBeLessThan(touchFn.indexOf("isPrematureFinalWeek"));
    expect(touchFn.indexOf("isPrematureFinalWeek")).toBeLessThan(touchFn.indexOf("finalizedAfterLock"));
    expect(touchFn.indexOf("finalizedAfterLock")).toBeLessThan(touchFn.indexOf("hasOlderInPlayThan"));
    const recoverFn = lib.slice(
      lib.indexOf("function recoverableFinishedWeek"),
      lib.indexOf("export function skipTargetWeek"),
    );
    expect(recoverFn).toMatch(/isPrematureFinalWeek\(target, weeks\)/);
    const targetFn = lib.slice(
      lib.indexOf("export function skipTargetWeek"),
      lib.indexOf("function hasPrematureFinalizeLeftover"),
    );
    expect(targetFn).toMatch(/hasNewerInPlayThan\(w, weeks\)/);
    expect(targetFn.indexOf("hasNewerInPlayThan")).toBeLessThan(targetFn.indexOf("canSkipWeek(viewed)"));
    const scrubFn = lib.slice(
      lib.indexOf("function skipScrubsLeftoverInPlace"),
      lib.indexOf("export function skipScrubsViewedInPlace"),
    );
    expect(scrubFn).not.toMatch(/leftover\.status === ["']final["']/);
    expect(scrubFn).toMatch(/isPrematureFinalWeek\(leftover, weeks\)/);
    expect(scrubFn).toMatch(/hasNewerNonDraftThan\(leftover,\s*weeks\)/);
    expect(scrubFn.indexOf("hasNewerNonDraftThan")).toBeLessThan(scrubFn.indexOf("isPrematureFinalWeek"));
    const skipFn = src.slice(
      src.indexOf("const skipAndStartNext"),
      src.indexOf("const toggleHold"),
    );
    expect(skipFn).toMatch(/skipTargetWeek/);
    expect(skipFn).toMatch(/skipScrubsViewedInPlace\(leftover,\s*week,\s*weeks\)/);
    expect(skipFn.indexOf("skipScrubsViewedInPlace")).toBeLessThan(skipFn.indexOf("canSkipWeek"));
    expect(skipFn).toMatch(/status:\s*"final"/);
    expect(skipFn).toMatch(/status:\s*"open"/);
    expect(skipFn).toMatch(/skipTouchesNextWeek\(slot,\s*weeks,\s*leftover\)/);
    expect(skipFn).toMatch(/skipLandingWeek\(weeks,\s*leftover\)/);
    expect(skipFn).toMatch(/setViewWeekId\(landing\.id\)/);
    expect(skipFn).toMatch(/shouldOpenExistingNextWeek\(next,\s*weeks,\s*leftover\)/);
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

  it("commissioner hides Open cards on leftover drafts behind a newer week", () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"),
      "utf8",
    );
    expect(src).toMatch(/shouldOfferOpenCards/);
    expect(src).toMatch(/leftoverDraftNextStep/);
    const statusPanel = src.slice(
      src.indexOf('Panel title="Week status"'),
      src.indexOf('Panel title="Auto-pilot"'),
    );
    expect(statusPanel).toMatch(/shouldOfferOpenCards\(week,\s*weeks\)/);
    expect(statusPanel.indexOf("shouldOfferOpenCards")).toBeLessThan(statusPanel.indexOf("NEXT_LABEL"));
    expect(src).toMatch(/leftoverDraftNextStep\(week,\s*weeks\)/);
    expect(src).toMatch(/leftoverStep\s*\?\?/);
    expect(src).toMatch(/!week\.autopilot_hold \? leftoverDraftNextStep/);
    const lib = readFileSync(join(process.cwd(), "src/lib/current-week.ts"), "utf8");
    const offerFn = lib.slice(
      lib.indexOf("export function shouldOfferOpenCards"),
      lib.indexOf("function hasNewerInPlayThan"),
    );
    expect(offerFn).toMatch(/skipScrubsLeftoverInPlace\(week,\s*weeks\)/);
    expect(offerFn.indexOf("skipScrubsLeftoverInPlace")).toBeLessThan(
      offerFn.indexOf("shouldAutopilotOpenDraft"),
    );
    expect(offerFn).toMatch(/hasNewerNonDraftThan\(week,\s*weeks\)/);
    expect(offerFn.indexOf("hasNewerNonDraftThan")).toBeLessThan(
      offerFn.indexOf("shouldAutopilotOpenDraft"),
    );
    expect(offerFn).toMatch(/shouldAutopilotOpenDraft\(week,\s*weeks\)/);
    const stepFn = lib.slice(
      lib.indexOf("export function leftoverDraftNextStep"),
      lib.indexOf("function recoverableFinishedWeek"),
    );
    expect(stepFn).toMatch(/skipScrubsLeftoverInPlace\(week,\s*weeks\)/);
    expect(stepFn).toMatch(/leftover marks/);
    expect(stepFn).toMatch(/will not auto-open/);
    expect(stepFn).toMatch(/behind a newer week/);
    expect(stepFn).not.toMatch(/Open cards for the family/);
    expect(stepFn).not.toMatch(/Lock the cards/);
    expect(stepFn).toMatch(/skipTouchesNextWeek/);
  });

  it("commissioner hides Finalize on leftover weeks skip should close", () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"),
      "utf8",
    );
    const finalizeAt = src.indexOf('Panel title="Finalize the week"');
    expect(finalizeAt).toBeGreaterThan(-1);
    const wrap = src.slice(
      src.lastIndexOf("{shouldOfferOpenCards", finalizeAt),
      src.indexOf("</Panel>", finalizeAt) + "</Panel>".length,
    );
    expect(wrap).toMatch(/shouldOfferOpenCards\(week,\s*weeks\)\s*&&/);
    expect(wrap).toMatch(/Panel title="Finalize the week"/);
    expect(wrap).toMatch(/onClick=\{finalize\}/);
    expect(wrap).not.toMatch(/skipCopy/);
    expect(wrap.indexOf("shouldOfferOpenCards")).toBeLessThan(
      wrap.indexOf('Panel title="Finalize the week"'),
    );
    const lib = readFileSync(join(process.cwd(), "src/lib/current-week.ts"), "utf8");
    const offerComment = lib.slice(
      lib.indexOf("Draft→open is only safe"),
      lib.indexOf("export function shouldOfferOpenCards"),
    );
    expect(offerComment).toMatch(/Finalize would freeze leftover misses/);
    expect(offerComment).toMatch(/force Reveal/);
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
    expect(src).toMatch(/shouldAutopilotOpenDraft/);
    expect(src).toMatch(/shouldAutopilotLockOpen/);
    expect(src).toMatch(/shouldAutopilotFinalize/);
    expect(src).toMatch(/shouldAutopilotResolveScores/);
    expect(src).toMatch(/finalized_at/);
    const openFn = src.slice(
      src.indexOf('if (week.status === "draft")'),
      src.indexOf("// 2. Auto-lock"),
    );
    expect(openFn).toMatch(/shouldAutopilotOpenDraft\(week,/);
    expect(openFn).toMatch(/select\("season_year, week_number, status"\)/);
    expect(openFn).not.toMatch(/\.neq\("status", "final"\)/);
    expect(openFn.indexOf("shouldAutopilotOpenDraft")).toBeLessThan(openFn.indexOf('status: "open"'));
    const lockFn = src.slice(
      src.indexOf("// 2. Auto-lock"),
      src.indexOf('if (week.status !== "locked")'),
    );
    expect(lockFn).toMatch(/shouldAutopilotLockOpen\(week,/);
    expect(lockFn).toMatch(/select\("season_year, week_number, status"\)/);
    expect(lockFn).not.toMatch(/\.neq\("status", "final"\)/);
    expect(lockFn.indexOf("shouldAutopilotLockOpen")).toBeLessThan(lockFn.indexOf('status: "locked"'));
    const resolveFn = src.slice(
      src.indexOf("// 3. Resolve"),
      src.indexOf("// 4. Finalize"),
    );
    expect(resolveFn).toMatch(/shouldAutopilotResolveScores\(week,/);
    expect(resolveFn).toMatch(/select\("season_year, week_number, status"\)/);
    expect(resolveFn).not.toMatch(/\.neq\("status", "final"\)/);
    expect(resolveFn.indexOf("shouldAutopilotResolveScores")).toBeLessThan(
      resolveFn.indexOf("resolveWeekFromEspn"),
    );
    const finalizeFn = src.slice(
      src.indexOf("// 4. Finalize"),
      src.indexOf("const out = await computeWeekScores"),
    );
    expect(finalizeFn).toMatch(/shouldAutopilotFinalize\(week,/);
    expect(finalizeFn).toMatch(/select\("season_year, week_number, status"\)/);
    expect(finalizeFn).not.toMatch(/\.neq\("status", "final"\)/);
    expect(finalizeFn.indexOf("shouldAutopilotFinalize")).toBeLessThan(
      finalizeFn.lastIndexOf("return"),
    );
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
