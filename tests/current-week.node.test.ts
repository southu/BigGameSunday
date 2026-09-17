import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  canSkipWeek,
  familyWeekChrome,
  leftoverDraftNextStep,
  nextWeekSlot,
  pickViewWeek,
  recency,
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

  it("never hides an in-play week behind a newer final", () => {
    assert.equal(selectActiveWeek([w(1, "open"), w(2, "final")])?.week_number, 1);
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "open")])?.week_number, 1);
    assert.equal(selectActiveWeek([w(1, "open"), w(2, "final")])?.status, "open");
    assert.equal(selectActiveWeek([w(1, "locked"), w(2, "final")])?.week_number, 1);
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "locked")])?.week_number, 1);
    assert.equal(selectActiveWeek([w(1, "locked"), w(2, "final")])?.status, "locked");
    assert.equal(selectActiveWeek([w(18, "locked", 2025), w(1, "final", 2026)])?.season_year, 2025);
    assert.equal(selectActiveWeek([w(1, "final", 2026), w(18, "locked", 2025)])?.status, "locked");
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
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    const forward = selectActiveWeek([leftover, premature]);
    const reverse = selectActiveWeek([premature, leftover]);
    assert.equal(forward?.week_number, 2);
    assert.equal(forward?.status, "final");
    assert.equal(reverse?.week_number, 2);
    assert.equal(reverse?.status, "final");
    const harperDraft = wr("3e3aeeeb", 1, "draft");
    const harperFinal = wr("52a42a9e", 2, "final");
    const harper = selectActiveWeek([harperDraft, harperFinal]);
    assert.equal(harper?.id, "52a42a9e");
    assert.equal(harper?.week_number, 2);
    assert.equal(harper?.status, "final");
    assert.equal(selectActiveWeek([harperFinal, harperDraft])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(harperDraft, harper), "Week 1");
    assert.notEqual(weekSwitcherLabel(harperDraft, harper), "This Sunday");
    assert.notEqual(weekSwitcherLabel(harperDraft, harper), "Next week");
    assert.equal(weekSwitcherLabel(harperFinal, harper), "Week 2");
    assert.equal(familyWeekChrome("The Harper House", harper), "The Harper House · Week 2");
    assert.notEqual(familyWeekChrome("The Harper House", harperDraft), "The Harper House · Week 2");
    assert.equal(pickViewWeek([harperDraft, harperFinal], harper, null)?.id, "52a42a9e");
    assert.equal(pickViewWeek([harperDraft, harperFinal], harper, "next")?.id, "52a42a9e");
    assert.equal(pickViewWeek([harperFinal, harperDraft], harper, "next")?.id, "52a42a9e");
    assert.notEqual(pickViewWeek([harperDraft, harperFinal], harper, "next")?.id, "3e3aeeeb");
    assert.equal(pickViewWeek([harperDraft, harperFinal], harper, "3e3aeeeb")?.id, "3e3aeeeb");
  });

  it("b: draft W1 + open W2 → active W2", () => {
    const leftover = w(1, "draft");
    const open = w(2, "open");
    assert.equal(selectActiveWeek([leftover, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover])?.week_number, 2);
    assert.equal(selectActiveWeek([leftover, open])?.status, "open");
    assert.equal(selectActiveWeek([leftover, w(2, "locked")])?.week_number, 2);
    const harperDraft = wr("3e3aeeeb", 1, "draft");
    const harperOpen = wr("52a42a9e", 2, "open");
    const harper = selectActiveWeek([harperDraft, harperOpen]);
    assert.equal(harper?.id, "52a42a9e");
    assert.equal(harper?.status, "open");
    assert.equal(weekSwitcherLabel(harperOpen, harper), "This Sunday");
    assert.equal(familyWeekChrome("The Harper House", harper), "The Harper House · Week 2");
    assert.equal(weekSwitcherLabel(harperDraft, harper), "Week 1");
    assert.notEqual(weekSwitcherLabel(harperDraft, harper), "This Sunday");
    assert.notEqual(weekSwitcherLabel(harperDraft, harper), "Next week");
    assert.equal(pickViewWeek([harperDraft, harperOpen], harper, null)?.id, "52a42a9e");
    assert.equal(pickViewWeek([harperDraft, harperOpen], harper, "next")?.id, "52a42a9e");
    assert.equal(pickViewWeek([harperOpen, harperDraft], harper, "next")?.id, "52a42a9e");
    assert.notEqual(pickViewWeek([harperDraft, harperOpen], harper, "next")?.id, "3e3aeeeb");
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
    const skipped = wr("w1", 1, "final");
    const open = wr("w2", 2, "open");
    const picked = selectActiveWeek([skipped, open]);
    assert.equal(picked?.week_number, 2);
    assert.equal(picked?.status, "open");
    assert.equal(picked?.id, "w2");
    assert.equal(selectActiveWeek([open, skipped])?.week_number, 2);
    assert.equal(weekSwitcherLabel(open, picked), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, picked), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, picked), "Next week");
    assert.equal(pickViewWeek([skipped, open], picked, null)?.id, "w2");
    assert.equal(pickViewWeek([skipped, open], picked, "next")?.id, "w2");
    const dirty = { ...open, finalized_at: "2026-09-15T19:04:43.880Z" };
    assert.equal(selectActiveWeek([skipped, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([skipped, dirty])?.status, "open");
    assert.equal(selectActiveWeek([dirty, skipped])?.week_number, 2);
    assert.equal(weekSwitcherLabel(dirty, selectActiveWeek([skipped, dirty])), "This Sunday");
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
    assert.equal(harper?.id, "52a42a9e");
    assert.equal(harper?.status, "open");
    assert.equal(weekSwitcherLabel(harperOpen, harper), "This Sunday");
    assert.equal(weekSwitcherLabel(harperSkipped, harper), "Week 1");
    assert.equal(pickViewWeek([harperSkipped, harperOpen], harper, null)?.id, "52a42a9e");
    assert.equal(pickViewWeek([harperSkipped, harperOpen], harper, "next")?.id, "52a42a9e");
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
      lock_at_override: false,
      featured_game_id: "d5ce1996-a969-4755-bc8f-899103fe341e",
      created_at: "2026-09-15T17:53:12.526397+00:00",
      auto_created_at: "2026-09-15T17:53:12.479+00:00",
      auto_opened_at: null,
      auto_locked_at: null,
      commissioner_edited_at: null,
      autopilot_hold: false,
      autopilot_checked_at: null,
    };
    const open = {
      id: "52a42a9e-fbce-4e06-a9b4-8a00b1d36994",
      household_id,
      season_year: 2026,
      week_number: 2,
      status: "open",
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      lock_at: "2026-09-18T00:15:00+00:00",
      lock_at_override: false,
      featured_game_id: "c08c9c12-78c2-4904-ae34-ffc1d38c81c2",
      created_at: "2026-09-15T18:00:32.412751+00:00",
      auto_created_at: "2026-09-15T18:00:32.128+00:00",
      auto_opened_at: null,
      auto_locked_at: null,
      commissioner_edited_at: "2026-09-15T19:04:30.621+00:00",
      autopilot_hold: false,
      autopilot_checked_at: null,
    };
    const weeks = [skipped, open];
    const active = selectActiveWeek(weeks);
    assert.equal(active?.id, "52a42a9e-fbce-4e06-a9b4-8a00b1d36994");
    assert.equal(active?.week_number, 2);
    assert.equal(active?.status, "open");
    assert.equal(selectActiveWeek([open, skipped])?.id, "52a42a9e-fbce-4e06-a9b4-8a00b1d36994");
    assert.equal(weekSwitcherLabel(open, active), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, active), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, active), "This Sunday");
    assert.notEqual(weekSwitcherLabel(skipped, active), "Next week");
    assert.equal(pickViewWeek(weeks, active, null)?.week_number, 2);
    assert.equal(pickViewWeek(weeks, active, "next")?.week_number, 2);
    assert.equal(`Week ${active?.week_number}`, "Week 2");
    const laterDraft = {
      id: "auto-w3",
      household_id,
      season_year: 2026,
      week_number: 3,
      status: "draft",
    };
    const withLater = [skipped, open, laterDraft];
    const stillW2 = selectActiveWeek(withLater);
    assert.equal(stillW2?.id, "52a42a9e-fbce-4e06-a9b4-8a00b1d36994");
    assert.equal(stillW2?.status, "open");
    assert.equal(weekSwitcherLabel(open, stillW2), "This Sunday");
    assert.equal(weekSwitcherLabel(laterDraft, stillW2), "Next week");
    assert.equal(pickViewWeek(withLater, stillW2, null)?.week_number, 2);
    assert.equal(pickViewWeek(withLater, stillW2, "next")?.id, "auto-w3");
    assert.equal(`Week ${stillW2?.week_number}`, "Week 2");
    assert.equal(open.auto_opened_at, null);
    assert.equal(skipped.auto_opened_at, null);
    assert.equal(open.finalized_at, "2026-09-15T19:04:43.88+00:00");
    assert.equal(skipped.lock_at_override, false);
    assert.equal(open.lock_at_override, false);
    assert.equal(skipped.featured_game_id, "d5ce1996-a969-4755-bc8f-899103fe341e");
    assert.equal(open.featured_game_id, "c08c9c12-78c2-4904-ae34-ffc1d38c81c2");
    assert.equal(skipped.created_at, "2026-09-15T17:53:12.526397+00:00");
    assert.equal(open.created_at, "2026-09-15T18:00:32.412751+00:00");
    assert.equal(skipped.household_id, household_id);
    assert.equal(open.household_id, household_id);
    assert.equal(skipped.commissioner_edited_at, null);
    assert.equal(open.commissioner_edited_at, "2026-09-15T19:04:30.621+00:00");
    assert.equal(skipped.autopilot_checked_at, null);
    assert.equal(open.autopilot_checked_at, null);
    assert.equal(familyWeekChrome("The Harper House", active), "The Harper House · Week 2");
    assert.equal(familyWeekChrome("The Harper House", stillW2), "The Harper House · Week 2");
    assert.equal(`The Harper House · Week ${active?.week_number}`, "The Harper House · Week 2");
    assert.equal(skipTargetWeek(weeks, open)?.id, "52a42a9e-fbce-4e06-a9b4-8a00b1d36994");
    assert.equal(skipTargetWeek(weeks, skipped)?.id, "52a42a9e-fbce-4e06-a9b4-8a00b1d36994");
    assert.equal(skipLandingWeek(weeks, open)?.week_number, 2);
    assert.equal(skipLandingWeek(weeks, open)?.status, "open");
    assert.equal(skipControlCopy(open, open, weeks).button, "Clear leftover marks / open this week");
    assert.equal(
      skipControlCopy(open, skipped, weeks).button,
      "Clear leftover marks / open Week 2",
    );
    const openedByAutopilot = { ...open, auto_opened_at: "2026-09-15T18:05:00+00:00" };
    assert.equal(selectActiveWeek([skipped, openedByAutopilot])?.week_number, 2);
    assert.equal(selectActiveWeek([skipped, openedByAutopilot])?.status, "open");
    assert.equal(familyWeekChrome("The Harper House", openedByAutopilot), "The Harper House · Week 2");
  });

  it("live Harper House chrome: The Harper House · Week 2 after skipped W1 + dirty-open W2", () => {
    const household = {
      id: "b03e87bd-2899-4e71-b6fb-54399eef3e6d",
      name: "The Harper House",
      owner_user_id: "5de58a82-3776-460d-94ea-2743fd7dc321",
      created_at: "2026-09-15T17:52:21.562645+00:00",
      auto_create_weeks: true,
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
      commissioner_edited_at: null,
      autopilot_checked_at: null,
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
      autopilot_checked_at: null,
    };
    const weeks = [skipped, dirtyOpen];
    const active = selectActiveWeek(weeks);
    assert.equal(household.name, "The Harper House");
    assert.equal(household.owner_user_id, "5de58a82-3776-460d-94ea-2743fd7dc321");
    assert.equal(household.created_at, "2026-09-15T17:52:21.562645+00:00");
    assert.equal(household.auto_create_weeks, true);
    assert.equal(active?.id, dirtyOpen.id);
    assert.equal(active?.week_number, 2);
    assert.equal(active?.status, "open");
    assert.equal(active?.auto_opened_at, null);
    assert.equal(active?.finalized_at, "2026-09-15T19:04:43.88+00:00");
    assert.equal(active?.autopilot_checked_at, null);
    assert.equal(active?.commissioner_edited_at, "2026-09-15T19:04:30.621+00:00");
    assert.equal(active?.household_id, household.id);
    assert.equal(weekSwitcherLabel(dirtyOpen, active), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, active), "Week 1");
    assert.equal(familyWeekChrome(household.name, active), "The Harper House · Week 2");
    assert.equal(familyWeekChrome(household.name, null), "The Harper House");
    assert.equal(familyWeekChrome(null, active), "Your household · Week 2");
    assert.equal(`Week ${active?.week_number}`, "Week 2");
    assert.notEqual(familyWeekChrome(household.name, skipped), "The Harper House · Week 2");
    assert.equal(familyWeekChrome(household.name, skipped), "The Harper House · Week 1");
    assert.doesNotMatch(familyWeekChrome(household.name, active), /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
  });

  it("live Harper House leftover-draft incident: draft W1 + premature-final W2 shows Week 2", () => {
    const household = {
      id: "b03e87bd-2899-4e71-b6fb-54399eef3e6d",
      name: "The Harper House",
      owner_user_id: "5de58a82-3776-460d-94ea-2743fd7dc321",
      created_at: "2026-09-15T17:52:21.562645+00:00",
      auto_create_weeks: true,
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
      commissioner_edited_at: null,
      autopilot_checked_at: null,
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
      autopilot_checked_at: null,
    };
    const weeks = [leftoverDraft, prematureFinal];
    const active = selectActiveWeek(weeks);
    assert.equal(household.auto_create_weeks, true);
    assert.equal(household.owner_user_id, "5de58a82-3776-460d-94ea-2743fd7dc321");
    assert.equal(active?.id, prematureFinal.id);
    assert.equal(active?.week_number, 2);
    assert.equal(active?.status, "final");
    assert.equal(active?.autopilot_checked_at, null);
    assert.equal(active?.household_id, household.id);
    assert.equal(selectActiveWeek([prematureFinal, leftoverDraft])?.id, prematureFinal.id);
    assert.equal(weekSwitcherLabel(leftoverDraft, active), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftoverDraft, active), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftoverDraft, active), "Next week");
    assert.equal(weekSwitcherLabel(prematureFinal, active), "Week 2");
    assert.equal(familyWeekChrome(household.name, active), "The Harper House · Week 2");
    assert.notEqual(familyWeekChrome(household.name, leftoverDraft), "The Harper House · Week 2");
    assert.equal(familyWeekChrome(household.name, leftoverDraft), "The Harper House · Week 1");
    assert.equal(`Week ${active?.week_number}`, "Week 2");
    assert.equal(pickViewWeek(weeks, active, null)?.id, prematureFinal.id);
    assert.equal(pickViewWeek(weeks, active, "next")?.id, prematureFinal.id);
    assert.notEqual(pickViewWeek(weeks, active, "next")?.id, leftoverDraft.id);
    assert.doesNotMatch(familyWeekChrome(household.name, active), /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
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
    assert.equal(oldRank([leftover, premature])?.id, "3e3aeeeb");
    assert.equal(oldRank([premature, leftover])?.id, "3e3aeeeb");
    assert.equal(selectActiveWeek([leftover, premature])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([premature, leftover])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([leftover, premature])?.week_number, 2);
    assert.equal(selectActiveWeek([leftover, premature])?.status, "final");
    assert.equal(`Week ${selectActiveWeek([leftover, premature])?.week_number}`, "Week 2");
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([leftover, premature])),
      "The Harper House · Week 2",
    );
    const open = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const inPlay = selectActiveWeek([open, nextDraft]);
    assert.equal(inPlay?.id, "w1");
    assert.equal(weekSwitcherLabel(open, inPlay), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, inPlay), "Next week");
    assert.equal(pickViewWeek([open, nextDraft], inPlay, "next")?.id, "w2");
  });

  it("draft week N + final/open week N+1 → returns week N+1 (not the old draft)", () => {
    for (const n of [1, 5, 12, 17]) {
      assert.equal(selectActiveWeek([w(n, "draft"), w(n + 1, "final")])?.week_number, n + 1);
      assert.equal(selectActiveWeek([w(n + 1, "final"), w(n, "draft")])?.week_number, n + 1);
      assert.equal(selectActiveWeek([w(n, "draft"), w(n + 1, "final")])?.status, "final");
      assert.equal(selectActiveWeek([w(n, "draft"), w(n + 1, "open")])?.week_number, n + 1);
      assert.equal(selectActiveWeek([w(n + 1, "open"), w(n, "draft")])?.week_number, n + 1);
      assert.equal(selectActiveWeek([w(n, "draft"), w(n + 1, "open")])?.status, "open");
      assert.equal(selectActiveWeek([w(n, "draft"), w(n + 1, "locked")])?.week_number, n + 1);
    }
    const wrapDraft = w(18, "draft", 2025);
    const wrapFinal = w(1, "final", 2026);
    assert.equal(selectActiveWeek([wrapDraft, wrapFinal])?.season_year, 2026);
    assert.equal(selectActiveWeek([wrapFinal, wrapDraft])?.week_number, 1);
    assert.equal(selectActiveWeek([wrapDraft, w(1, "open", 2026)])?.status, "open");
  });

  it("open week N + draft week N+1 → returns open week N (This Sunday); N+1 is Next week", () => {
    for (const n of [1, 5, 12, 17]) {
      const open = wr(`open-${n}`, n, "open");
      const draft = wr(`draft-${n + 1}`, n + 1, "draft");
      const active = selectActiveWeek([open, draft]);
      assert.equal(active?.id, `open-${n}`);
      assert.equal(active?.week_number, n);
      assert.equal(weekSwitcherLabel(open, active), "This Sunday");
      assert.equal(weekSwitcherLabel(draft, active), "Next week");
      assert.equal(pickViewWeek([open, draft], active, null)?.id, `open-${n}`);
      assert.equal(pickViewWeek([open, draft], active, "next")?.id, `draft-${n + 1}`);
      const locked = wr(`locked-${n}`, n, "locked");
      const lockedActive = selectActiveWeek([locked, draft]);
      assert.equal(lockedActive?.id, `locked-${n}`);
      assert.equal(weekSwitcherLabel(locked, lockedActive), "This Sunday");
      assert.equal(weekSwitcherLabel(draft, lockedActive), "Next week");
    }
  });

  it("autopilot does not auto-open leftover draft W1 behind newer W2", () => {
    const leftover = wr("3e3aeeeb", 1, "draft");
    const premature = wr("52a42a9e", 2, "final");
    assert.equal(shouldAutopilotOpenDraft(leftover, [leftover, premature]), false);
    assert.equal(shouldAutopilotOpenDraft(leftover, [premature, leftover]), false);
    assert.equal(shouldAutopilotOpenDraft(w(1, "draft"), [w(1, "draft"), w(2, "open")]), false);
    assert.equal(shouldAutopilotOpenDraft(w(1, "draft"), [w(1, "draft"), w(2, "locked")]), false);
    assert.equal(shouldAutopilotOpenDraft(w(1, "draft"), [w(1, "draft"), w(2, "draft")]), false);
    assert.equal(shouldAutopilotOpenDraft(w(2, "draft"), [w(1, "open"), w(2, "draft")]), true);
    assert.equal(shouldAutopilotOpenDraft(w(2, "draft"), [w(1, "final"), w(2, "draft")]), true);
    assert.equal(shouldAutopilotOpenDraft(w(1, "draft"), [w(1, "draft")]), true);
    assert.equal(shouldAutopilotOpenDraft(w(1, "open"), [w(1, "open"), w(2, "draft")]), false);
    assert.equal(
      shouldAutopilotOpenDraft(w(18, "draft", 2025), [w(18, "draft", 2025), w(1, "final", 2026)]),
      false,
    );
    assert.equal(
      shouldAutopilotOpenDraft(w(1, "draft", 2026), [w(18, "final", 2025), w(1, "draft", 2026)]),
      true,
    );
    assert.equal(selectActiveWeek([w(1, "open"), w(2, "final")])?.week_number, 1);
  });

  it("commissioner does not offer Open cards on leftover draft W1 behind newer W2", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    assert.equal(shouldOfferOpenCards(leftover, [leftover, premature]), false);
    assert.equal(shouldOfferOpenCards(leftover, [premature, leftover]), false);
    assert.equal(shouldOfferOpenCards(w(1, "draft"), [w(1, "draft"), w(2, "open")]), false);
    assert.equal(shouldOfferOpenCards(w(1, "draft"), [w(1, "draft"), w(2, "locked")]), false);
    assert.equal(shouldOfferOpenCards(w(1, "draft"), [w(1, "draft"), w(2, "draft")]), false);
    assert.equal(shouldOfferOpenCards(w(2, "draft"), [w(1, "open"), w(2, "draft")]), true);
    assert.equal(shouldOfferOpenCards(w(2, "draft"), [w(1, "final"), w(2, "draft")]), true);
    assert.equal(shouldOfferOpenCards(w(1, "draft"), [w(1, "draft")]), true);
    assert.equal(shouldOfferOpenCards(w(1, "open"), [w(1, "open"), w(2, "draft")]), true);
    assert.equal(shouldOfferOpenCards(w(1, "locked"), [w(1, "locked")]), true);
    assert.equal(shouldOfferOpenCards(w(1, "open"), [w(1, "open"), w(2, "final")]), false);
    assert.equal(shouldOfferOpenCards(w(1, "locked"), [w(1, "locked"), w(2, "final")]), false);
    assert.equal(shouldOfferOpenCards(w(1, "open"), [w(1, "open"), w(2, "open")]), false);
    assert.equal(shouldOfferOpenCards(w(2, "open"), [w(1, "open"), w(2, "open")]), true);
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const skipped = w(1, "final");
    assert.equal(shouldOfferOpenCards(dirtyOpen, [skipped, dirtyOpen]), false);
    assert.equal(shouldOfferOpenCards(dirtyOpen, [dirtyOpen, skipped]), false);
    assert.equal(shouldOfferOpenCards(w(2, "open"), [skipped, w(2, "open")]), true);
    assert.equal(
      shouldOfferOpenCards(
        { ...w(2, "final"), finalized_at: "2026-09-15T19:04:43.880Z", lock_at: "2026-09-18T00:15:00.000Z" },
        [skipped, { ...w(2, "final"), finalized_at: "2026-09-15T19:04:43.880Z", lock_at: "2026-09-18T00:15:00.000Z" }],
      ),
      false,
    );
    assert.equal(selectActiveWeek([leftover, premature])?.week_number, 2);
    assert.equal(selectActiveWeek([{ ...leftover, status: "open" }, premature])?.week_number, 1);
    assert.equal(selectActiveWeek([skipped, dirtyOpen])?.week_number, 2);
  });

  it("commissioner does not offer Finalize on leftover weeks skip should close", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    assert.equal(shouldOfferOpenCards(leftover, [leftover, premature]), false);
    assert.equal(shouldOfferOpenCards(leftover, [premature, leftover]), false);
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const skipped = w(1, "final");
    assert.equal(shouldOfferOpenCards(dirtyOpen, [skipped, dirtyOpen]), false);
    assert.equal(
      shouldOfferOpenCards(
        { ...w(2, "final"), finalized_at: "2026-09-15T19:04:43.880Z", lock_at: "2026-09-18T00:15:00.000Z" },
        [skipped, { ...w(2, "final"), finalized_at: "2026-09-15T19:04:43.880Z", lock_at: "2026-09-18T00:15:00.000Z" }],
      ),
      false,
    );
    assert.equal(shouldOfferOpenCards(w(1, "open"), [w(1, "open")]), true);
    assert.equal(shouldOfferOpenCards(w(1, "locked"), [w(1, "locked")]), true);
    assert.equal(shouldOfferOpenCards(w(2, "open"), [skipped, w(2, "open")]), true);
    assert.equal(shouldOfferOpenCards(w(1, "open"), [w(1, "open"), w(2, "draft")]), true);
    assert.equal(shouldOfferOpenCards(w(1, "open"), [w(1, "open"), w(2, "final")]), false);
    assert.equal(shouldOfferOpenCards(w(1, "locked"), [w(1, "locked"), w(2, "final")]), false);
    assert.equal(shouldOfferOpenCards(w(1, "open"), [w(1, "open"), w(2, "open")]), false);
    assert.equal(shouldOfferOpenCards(w(2, "open"), [w(1, "open"), w(2, "open")]), true);
    assert.equal(selectActiveWeek([w(1, "open"), w(2, "final")])?.week_number, 1);
    assert.equal(selectActiveWeek([w(1, "locked"), w(2, "final")])?.week_number, 1);
  });

  it("leftover draft next step does not promise Open cards behind a newer week", () => {
    const leftover = w(1, "draft");
    assert.equal(leftoverDraftNextStep(leftover, [leftover]), null);
    assert.equal(leftoverDraftNextStep(w(2, "draft"), [w(1, "open"), w(2, "draft")]), null);
    assert.equal(leftoverDraftNextStep(w(1, "open"), [w(1, "open"), w(2, "draft")]), null);
    const behindFinal = leftoverDraftNextStep(leftover, [leftover, w(2, "final")]);
    assert.match(behindFinal?.label ?? "", /will not auto-open/);
    assert.match(behindFinal?.label ?? "", /skip it to start next week/);
    assert.equal(behindFinal?.at, null);
    assert.doesNotMatch(behindFinal?.label ?? "", /Open cards/);
    assert.doesNotMatch(behindFinal?.label ?? "", /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const behindOpen = leftoverDraftNextStep(leftover, [leftover, w(2, "open")]);
    assert.match(behindOpen?.label ?? "", /without Reveal/);
    assert.doesNotMatch(behindOpen?.label ?? "", /start next week/);
    const behindNewerInPlay = leftoverDraftNextStep(leftover, [
      leftover,
      w(2, "final"),
      w(3, "open"),
    ]);
    assert.match(behindNewerInPlay?.label ?? "", /will not auto-open/);
    assert.match(behindNewerInPlay?.label ?? "", /without Reveal/);
    assert.doesNotMatch(behindNewerInPlay?.label ?? "", /start next week/);
    assert.doesNotMatch(behindNewerInPlay?.label ?? "", /Open cards/);
    assert.doesNotMatch(
      behindNewerInPlay?.label ?? "",
      /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i,
    );
    const behindNewerDraft = leftoverDraftNextStep(leftover, [
      leftover,
      w(2, "final"),
      w(3, "draft"),
    ]);
    assert.match(behindNewerDraft?.label ?? "", /will not auto-open/);
    assert.match(behindNewerDraft?.label ?? "", /without Reveal/);
    assert.doesNotMatch(behindNewerDraft?.label ?? "", /start next week/);
    assert.doesNotMatch(behindNewerDraft?.label ?? "", /Open cards/);
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const skipped = w(1, "final");
    const dirtyStep = leftoverDraftNextStep(dirtyOpen, [skipped, dirtyOpen]);
    assert.match(dirtyStep?.label ?? "", /leftover marks/);
    assert.match(dirtyStep?.label ?? "", /family can play/);
    assert.equal(dirtyStep?.at, null);
    assert.doesNotMatch(dirtyStep?.label ?? "", /Open cards/);
    assert.doesNotMatch(dirtyStep?.label ?? "", /Lock the cards/);
    assert.doesNotMatch(dirtyStep?.label ?? "", /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const premature = {
      ...w(2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    };
    const prematureStep = leftoverDraftNextStep(premature, [skipped, premature]);
    assert.match(prematureStep?.label ?? "", /leftover marks/);
    assert.doesNotMatch(prematureStep?.label ?? "", /Open cards/);
    assert.equal(leftoverDraftNextStep(w(2, "open"), [skipped, w(2, "open")]), null);
    const leftoverOpen = leftoverDraftNextStep(w(1, "open"), [w(1, "open"), w(2, "final")]);
    assert.match(leftoverOpen?.label ?? "", /behind a newer week/);
    assert.match(leftoverOpen?.label ?? "", /without Reveal/);
    assert.doesNotMatch(leftoverOpen?.label ?? "", /start next week/);
    assert.doesNotMatch(leftoverOpen?.label ?? "", /Lock the cards/);
    assert.doesNotMatch(leftoverOpen?.label ?? "", /Open cards/);
    assert.doesNotMatch(leftoverOpen?.label ?? "", /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const leftoverLocked = leftoverDraftNextStep(w(1, "locked"), [w(1, "locked"), w(2, "final")]);
    assert.match(leftoverLocked?.label ?? "", /behind a newer week/);
    assert.match(leftoverLocked?.label ?? "", /without Reveal/);
    assert.doesNotMatch(leftoverLocked?.label ?? "", /start next week/);
    assert.doesNotMatch(leftoverLocked?.label ?? "", /Finalize/);
    assert.match(
      leftoverDraftNextStep(w(1, "open"), [w(1, "open"), w(2, "open")])?.label ?? "",
      /behind a newer week/,
    );
    assert.match(
      leftoverDraftNextStep(w(1, "open"), [w(1, "open"), w(2, "open")])?.label ?? "",
      /without Reveal/,
    );
    assert.doesNotMatch(
      leftoverDraftNextStep(w(1, "open"), [w(1, "open"), w(2, "open")])?.label ?? "",
      /start next week/,
    );
  });

  it("autopilot does not lock a dirty-open leftover week", () => {
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    assert.equal(shouldAutopilotLockOpen(dirtyOpen), false);
    assert.equal(shouldAutopilotLockOpen(w(2, "open")), true);
    assert.equal(shouldAutopilotLockOpen(w(2, "draft")), false);
    assert.equal(shouldAutopilotLockOpen(w(2, "locked")), false);
    assert.equal(shouldAutopilotLockOpen(w(2, "final")), false);
    assert.equal(
      shouldAutopilotLockOpen({ ...w(2, "locked"), finalized_at: "2026-09-15T19:04:43.880Z" }),
      false,
    );
    assert.equal(selectActiveWeek([w(1, "final"), dirtyOpen])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "final"), dirtyOpen])?.status, "open");
  });

  it("autopilot does not lock leftover open W1 behind a newer week", () => {
    const leftover = w(1, "open");
    const premature = w(2, "final");
    assert.equal(shouldAutopilotLockOpen(leftover, [leftover, premature]), false);
    assert.equal(shouldAutopilotLockOpen(leftover, [premature, leftover]), false);
    assert.equal(shouldAutopilotLockOpen(leftover, [leftover, w(2, "open")]), false);
    assert.equal(shouldAutopilotLockOpen(leftover, [leftover, w(2, "locked")]), false);
    assert.equal(shouldAutopilotLockOpen(leftover, [leftover, w(2, "draft")]), true);
    assert.equal(shouldAutopilotLockOpen(leftover, [leftover]), true);
    assert.equal(shouldAutopilotLockOpen(w(2, "open"), [w(1, "final"), w(2, "open")]), true);
    assert.equal(shouldAutopilotLockOpen(w(1, "open"), [w(1, "open"), w(2, "draft")]), true);
    assert.equal(
      shouldAutopilotLockOpen(w(18, "open", 2025), [w(18, "open", 2025), w(1, "final", 2026)]),
      false,
    );
    assert.equal(selectActiveWeek([leftover, premature])?.week_number, 1);
    assert.equal(selectActiveWeek([leftover, w(2, "open")])?.week_number, 2);
  });

  it("autopilot does not finalize leftover locked W1 behind a newer week", () => {
    const leftover = w(1, "locked");
    const premature = w(2, "final");
    assert.equal(shouldAutopilotFinalize(leftover, [leftover, premature]), false);
    assert.equal(shouldAutopilotFinalize(leftover, [premature, leftover]), false);
    assert.equal(shouldAutopilotFinalize(leftover, [leftover, w(2, "open")]), false);
    assert.equal(shouldAutopilotFinalize(leftover, [leftover, w(2, "locked")]), false);
    assert.equal(shouldAutopilotFinalize(leftover, [leftover, w(2, "draft")]), true);
    assert.equal(shouldAutopilotFinalize(leftover, [leftover]), true);
    assert.equal(shouldAutopilotFinalize(w(1, "open"), [w(1, "open")]), false);
    assert.equal(shouldAutopilotFinalize(w(1, "draft"), [w(1, "draft")]), false);
    assert.equal(shouldAutopilotFinalize(w(2, "locked"), [w(1, "final"), w(2, "locked")]), true);
    assert.equal(shouldAutopilotFinalize(w(1, "locked"), [w(1, "locked"), w(2, "draft")]), true);
    assert.equal(
      shouldAutopilotFinalize(w(18, "locked", 2025), [w(18, "locked", 2025), w(1, "final", 2026)]),
      false,
    );
    assert.equal(selectActiveWeek([leftover, premature])?.week_number, 1);
    assert.equal(selectActiveWeek([leftover, w(2, "draft")])?.week_number, 1);
  });

  it("autopilot does not resolve leftover locked W1 behind a newer in-play week", () => {
    const leftover = w(1, "locked");
    const premature = w(2, "final");
    assert.equal(shouldAutopilotResolveScores(leftover, [leftover, premature]), true);
    assert.equal(shouldAutopilotResolveScores(leftover, [premature, leftover]), true);
    assert.equal(shouldAutopilotResolveScores(leftover, [leftover, w(2, "open")]), false);
    assert.equal(shouldAutopilotResolveScores(leftover, [leftover, w(2, "locked")]), false);
    assert.equal(shouldAutopilotResolveScores(leftover, [leftover, w(2, "draft")]), true);
    assert.equal(shouldAutopilotResolveScores(leftover, [leftover]), true);
    assert.equal(shouldAutopilotResolveScores(w(1, "open"), [w(1, "open")]), false);
    assert.equal(shouldAutopilotResolveScores(w(1, "draft"), [w(1, "draft")]), false);
    assert.equal(shouldAutopilotResolveScores(w(2, "locked"), [w(1, "final"), w(2, "locked")]), true);
    assert.equal(shouldAutopilotResolveScores(w(1, "locked"), [w(1, "locked"), w(2, "draft")]), true);
    assert.equal(
      shouldAutopilotResolveScores(w(18, "locked", 2025), [w(18, "locked", 2025), w(1, "open", 2026)]),
      false,
    );
    assert.equal(
      shouldAutopilotResolveScores(w(18, "locked", 2025), [w(18, "locked", 2025), w(1, "final", 2026)]),
      true,
    );
    assert.equal(selectActiveWeek([leftover, premature])?.week_number, 1);
    assert.equal(selectActiveWeek([leftover, w(2, "open")])?.week_number, 2);
    assert.equal(selectActiveWeek([leftover, w(2, "draft")])?.week_number, 1);
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
    assert.equal(active?.id, "52a42a9e");
    assert.equal(active?.week_number, 2);
    assert.equal(active?.status, "open");
    assert.equal(selectActiveWeek(reverse)?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(dirtyOpen, active), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, active), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, active), "Next week");
    assert.equal(pickViewWeek(weeks, active, null)?.id, "52a42a9e");
    assert.equal(pickViewWeek(weeks, active, "next")?.id, "52a42a9e");
    assert.equal(skipTargetWeek(weeks, dirtyOpen)?.week_number, 2);
    assert.equal(skipTargetWeek(weeks, skipped)?.week_number, 2);
    const leftover = skipTargetWeek(weeks, skipped);
    assert.equal(skipLandingWeek(weeks, leftover!)?.week_number, 2);
    assert.equal(skipLandingWeek(weeks, leftover!)?.status, "open");
    assert.equal(skipLandingWeek(weeks, dirtyOpen)?.week_number, 2);
    assert.equal(skipLandingWeek(weeks, dirtyOpen)?.status, "open");
    assert.equal(shouldOfferOpenCards(dirtyOpen, weeks), false);
    assert.equal(shouldAutopilotLockOpen(dirtyOpen), false);
    assert.match(leftoverDraftNextStep(dirtyOpen, weeks)?.label ?? "", /leftover marks/);
    assert.doesNotMatch(leftoverDraftNextStep(dirtyOpen, weeks)?.label ?? "", /Lock the cards/);
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
    assert.equal(selectActiveWeek([leftover, next])?.week_number, 2);
    assert.equal(selectActiveWeek([next, leftover])?.week_number, 2);
    assert.equal(selectActiveWeek([leftover, next])?.status, "final");
    assert.equal(selectActiveWeek([leftover, { ...w(2, "open"), finalized_at: next.finalized_at }])?.week_number, 2);
    const dirtyOpen = {
      ...w(2, "open"),
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      auto_opened_at: null,
    };
    assert.equal(selectActiveWeek([w(1, "final"), dirtyOpen])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "final"), dirtyOpen])?.status, "open");
    assert.equal(
      selectActiveWeek([{ ...leftover, auto_opened_at: "2026-09-10T00:00:00.000Z" }, next])?.week_number,
      2,
    );
  });

  it("ranking ignores lock_at_override, created_at, and featured_game_id", () => {
    const skipped = {
      ...wr("3e3aeeeb", 1, "final"),
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00+00:00",
      lock_at_override: false,
      featured_game_id: "d5ce1996-a969-4755-bc8f-899103fe341e",
      created_at: "2026-09-15T17:53:12.526397+00:00",
      commissioner_edited_at: null,
      auto_opened_at: null,
    };
    const dirtyOpen = {
      ...wr("52a42a9e", 2, "open"),
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      lock_at: "2026-09-18T00:15:00+00:00",
      lock_at_override: false,
      featured_game_id: "c08c9c12-78c2-4904-ae34-ffc1d38c81c2",
      created_at: "2026-09-15T18:00:32.412751+00:00",
      commissioner_edited_at: "2026-09-15T19:04:30.621+00:00",
      auto_opened_at: null,
    };
    const weeks = [skipped, dirtyOpen];
    const active = selectActiveWeek(weeks);
    assert.equal(active?.id, "52a42a9e");
    assert.equal(active?.week_number, 2);
    assert.equal(active?.status, "open");
    assert.equal(selectActiveWeek([dirtyOpen, skipped])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(dirtyOpen, active), "This Sunday");
    assert.equal(familyWeekChrome("The Harper House", active), "The Harper House · Week 2");
    const olderOverride = {
      ...skipped,
      lock_at_override: true,
      created_at: "2026-09-01T00:00:00+00:00",
    };
    const newerNoFeature = {
      ...dirtyOpen,
      featured_game_id: null,
      lock_at_override: false,
      created_at: "2026-09-16T00:00:00+00:00",
    };
    assert.equal(selectActiveWeek([olderOverride, newerNoFeature])?.week_number, 2);
    assert.equal(selectActiveWeek([newerNoFeature, olderOverride])?.week_number, 2);
    assert.equal(selectActiveWeek([olderOverride, newerNoFeature])?.status, "open");
    const leftoverDraft = { ...skipped, status: "draft", lock_at_override: true };
    const prematureFinal = { ...dirtyOpen, status: "final" };
    assert.equal(selectActiveWeek([leftoverDraft, prematureFinal])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverDraft, prematureFinal])?.status, "final");
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([leftoverDraft, prematureFinal])),
      "The Harper House · Week 2",
    );
    assert.equal(
      weekSwitcherLabel(leftoverDraft, selectActiveWeek([leftoverDraft, prematureFinal])),
      "Week 1",
    );
  });

  it("ranking ignores auto_created_at, auto_locked_at, and autopilot_hold", () => {
    const household_id = "b03e87bd-2899-4e71-b6fb-54399eef3e6d";
    const skipped = {
      ...wr("3e3aeeeb", 1, "final"),
      household_id,
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00+00:00",
      auto_created_at: "2026-09-15T17:53:12.479+00:00",
      auto_locked_at: null,
      autopilot_hold: false,
      autopilot_checked_at: null,
      auto_opened_at: null,
    };
    const dirtyOpen = {
      ...wr("52a42a9e", 2, "open"),
      household_id,
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      lock_at: "2026-09-18T00:15:00+00:00",
      auto_created_at: "2026-09-15T18:00:32.128+00:00",
      auto_locked_at: null,
      autopilot_hold: false,
      autopilot_checked_at: "2026-09-15T19:00:00+00:00",
      auto_opened_at: null,
    };
    const weeks = [skipped, dirtyOpen];
    const active = selectActiveWeek(weeks);
    assert.equal(active?.id, "52a42a9e");
    assert.equal(active?.week_number, 2);
    assert.equal(active?.status, "open");
    assert.equal(selectActiveWeek([dirtyOpen, skipped])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(dirtyOpen, active), "This Sunday");
    assert.equal(familyWeekChrome("The Harper House", active), "The Harper House · Week 2");
    const leftoverHeld = {
      ...skipped,
      status: "draft",
      autopilot_hold: true,
      auto_created_at: "2026-09-01T00:00:00+00:00",
      auto_locked_at: "2026-09-10T00:00:00+00:00",
    };
    const prematureFinal = { ...dirtyOpen, status: "final", autopilot_hold: false };
    assert.equal(selectActiveWeek([leftoverHeld, prematureFinal])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverHeld, prematureFinal])?.status, "final");
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([leftoverHeld, prematureFinal])),
      "The Harper House · Week 2",
    );
    const leftoverOpen = {
      ...skipped,
      status: "open",
      autopilot_hold: true,
      auto_locked_at: "2026-09-10T00:00:00+00:00",
    };
    assert.equal(selectActiveWeek([leftoverOpen, dirtyOpen])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverOpen, dirtyOpen])?.status, "open");
    assert.equal(selectActiveWeek([dirtyOpen, leftoverOpen])?.id, "52a42a9e");
    assert.equal(
      weekSwitcherLabel(dirtyOpen, selectActiveWeek([leftoverOpen, dirtyOpen])),
      "This Sunday",
    );
  });

  it("ranking ignores household_id, commissioner_edited_at, and autopilot_checked_at", () => {
    const household_id = "b03e87bd-2899-4e71-b6fb-54399eef3e6d";
    const skipped = {
      ...wr("3e3aeeeb", 1, "final"),
      household_id,
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00+00:00",
      commissioner_edited_at: null,
      autopilot_checked_at: null,
      auto_opened_at: null,
    };
    const dirtyOpen = {
      ...wr("52a42a9e", 2, "open"),
      household_id,
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      lock_at: "2026-09-18T00:15:00+00:00",
      commissioner_edited_at: "2026-09-15T19:04:30.621+00:00",
      autopilot_checked_at: null,
      auto_opened_at: null,
    };
    const weeks = [skipped, dirtyOpen];
    const active = selectActiveWeek(weeks);
    assert.equal(active?.id, "52a42a9e");
    assert.equal(active?.week_number, 2);
    assert.equal(active?.status, "open");
    assert.equal(active?.autopilot_checked_at, null);
    assert.equal(active?.household_id, household_id);
    assert.equal(active?.commissioner_edited_at, "2026-09-15T19:04:30.621+00:00");
    assert.equal(selectActiveWeek([dirtyOpen, skipped])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(dirtyOpen, active), "This Sunday");
    assert.equal(familyWeekChrome("The Harper House", active), "The Harper House · Week 2");
    const leftoverDraft = {
      ...skipped,
      status: "draft",
      household_id: "other-household",
      commissioner_edited_at: "2026-09-16T00:00:00+00:00",
      autopilot_checked_at: "2026-09-16T00:00:00+00:00",
    };
    const prematureFinal = {
      ...dirtyOpen,
      status: "final",
      autopilot_checked_at: null,
    };
    assert.equal(selectActiveWeek([leftoverDraft, prematureFinal])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverDraft, prematureFinal])?.status, "final");
    assert.equal(selectActiveWeek([leftoverDraft, prematureFinal])?.autopilot_checked_at, null);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([leftoverDraft, prematureFinal])),
      "The Harper House · Week 2",
    );
    assert.equal(
      weekSwitcherLabel(leftoverDraft, selectActiveWeek([leftoverDraft, prematureFinal])),
      "Week 1",
    );
    const leftoverOpen = {
      ...skipped,
      status: "open",
      commissioner_edited_at: "2026-09-16T12:00:00+00:00",
      autopilot_checked_at: "2026-09-16T12:00:00+00:00",
    };
    assert.equal(selectActiveWeek([leftoverOpen, dirtyOpen])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverOpen, dirtyOpen])?.status, "open");
    assert.equal(selectActiveWeek([dirtyOpen, leftoverOpen])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([leftoverOpen, dirtyOpen])?.autopilot_checked_at, null);
    assert.equal(
      weekSwitcherLabel(dirtyOpen, selectActiveWeek([leftoverOpen, dirtyOpen])),
      "This Sunday",
    );
  });

  it("ranking ignores UUID id (lexicographic id does not beat recency)", () => {
    const household_id = "b03e87bd-2899-4e71-b6fb-54399eef3e6d";
    const skipped = {
      ...wr("zzzzzzzz-ffff-4e06-a9b4-8a00b1d36994", 1, "final"),
      household_id,
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00+00:00",
      auto_opened_at: null,
    };
    const dirtyOpen = {
      ...wr("00000000-0000-4e06-a9b4-8a00b1d36994", 2, "open"),
      household_id,
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      lock_at: "2026-09-18T00:15:00+00:00",
      auto_opened_at: null,
    };
    const weeks = [skipped, dirtyOpen];
    const active = selectActiveWeek(weeks);
    assert.equal(active?.id, "00000000-0000-4e06-a9b4-8a00b1d36994");
    assert.equal(active?.week_number, 2);
    assert.equal(active?.status, "open");
    assert.equal(selectActiveWeek([dirtyOpen, skipped])?.id, "00000000-0000-4e06-a9b4-8a00b1d36994");
    assert.equal(weekSwitcherLabel(dirtyOpen, active), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, active), "Week 1");
    assert.equal(familyWeekChrome("The Harper House", active), "The Harper House · Week 2");
    const leftoverDraft = {
      ...wr("zzzzzzzz-ffff-445b-9297-aa6c20967433", 1, "draft"),
      household_id,
    };
    const prematureFinal = {
      ...wr("00000000-aaaa-4e06-a9b4-8a00b1d36994", 2, "final"),
      household_id,
    };
    assert.equal(selectActiveWeek([leftoverDraft, prematureFinal])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverDraft, prematureFinal])?.status, "final");
    assert.equal(
      selectActiveWeek([prematureFinal, leftoverDraft])?.id,
      "00000000-aaaa-4e06-a9b4-8a00b1d36994",
    );
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([leftoverDraft, prematureFinal])),
      "The Harper House · Week 2",
    );
    assert.equal(
      weekSwitcherLabel(leftoverDraft, selectActiveWeek([leftoverDraft, prematureFinal])),
      "Week 1",
    );
    const leftoverOpen = wr("ffffffff-ffff-445b-9297-aa6c20967433", 1, "open");
    const thisSunday = wr("00000000-0000-4e06-a9b4-8a00b1d36994", 2, "open");
    assert.equal(selectActiveWeek([leftoverOpen, thisSunday])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverOpen, thisSunday])?.status, "open");
    assert.equal(
      selectActiveWeek([thisSunday, leftoverOpen])?.id,
      "00000000-0000-4e06-a9b4-8a00b1d36994",
    );
    assert.equal(
      weekSwitcherLabel(thisSunday, selectActiveWeek([leftoverOpen, thisSunday])),
      "This Sunday",
    );
    const harperDraft = wr("3e3aeeeb-4dcb-445b-9297-aa6c20967433", 1, "draft");
    const harperFinal = wr("52a42a9e-fbce-4e06-a9b4-8a00b1d36994", 2, "final");
    assert.equal(selectActiveWeek([harperDraft, harperFinal])?.id, "52a42a9e-fbce-4e06-a9b4-8a00b1d36994");
    assert.equal(selectActiveWeek([harperFinal, harperDraft])?.week_number, 2);
  });

  it("recency is season_year then week_number, not extra select(\"*\") fields", () => {
    const household_id = "b03e87bd-2899-4e71-b6fb-54399eef3e6d";
    const leftoverDraft = {
      ...wr("3e3aeeeb-4dcb-445b-9297-aa6c20967433", 1, "draft"),
      household_id,
      updated_at: "2026-09-16T12:00:00+00:00",
      notes: "leftover skip",
    };
    const prematureFinal = {
      ...wr("52a42a9e-fbce-4e06-a9b4-8a00b1d36994", 2, "final"),
      household_id,
      updated_at: "2026-09-15T19:04:43.88+00:00",
      notes: null,
    };
    assert.equal(selectActiveWeek([leftoverDraft, prematureFinal])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverDraft, prematureFinal])?.status, "final");
    assert.equal(selectActiveWeek([prematureFinal, leftoverDraft])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([leftoverDraft, prematureFinal])),
      "The Harper House · Week 2",
    );
    assert.equal(
      weekSwitcherLabel(leftoverDraft, selectActiveWeek([leftoverDraft, prematureFinal])),
      "Week 1",
    );

    const leftoverOpen = {
      ...leftoverDraft,
      status: "open",
      updated_at: "2026-09-17T00:00:00+00:00",
    };
    const thisSunday = {
      ...prematureFinal,
      status: "open",
      updated_at: "2026-09-15T19:04:43.88+00:00",
      finalized_at: "2026-09-15T19:04:43.88+00:00",
    };
    const activeOpen = selectActiveWeek([leftoverOpen, thisSunday]);
    assert.equal(activeOpen?.week_number, 2);
    assert.equal(activeOpen?.status, "open");
    assert.equal(selectActiveWeek([thisSunday, leftoverOpen])?.id, thisSunday.id);
    assert.equal(weekSwitcherLabel(thisSunday, activeOpen), "This Sunday");
    assert.equal(weekSwitcherLabel(leftoverOpen, activeOpen), "Week 1");
    assert.equal(familyWeekChrome("The Harper House", activeOpen), "The Harper House · Week 2");

    const skipped = { ...leftoverDraft, status: "final", updated_at: "2026-09-16T16:00:00+00:00" };
    const dirtyOpen = {
      ...thisSunday,
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      updated_at: "2026-09-15T19:04:43.88+00:00",
    };
    const skipActive = selectActiveWeek([skipped, dirtyOpen]);
    assert.equal(skipActive?.week_number, 2);
    assert.equal(skipActive?.status, "open");
    assert.equal(weekSwitcherLabel(dirtyOpen, skipActive), "This Sunday");
    assert.equal(selectActiveWeek([w(1, "final")])?.week_number, 1);

    const wrapLeftover = {
      ...wr("w18", 18, "draft", 2025),
      updated_at: "2026-09-16T12:00:00+00:00",
    };
    const wrapNewer = {
      ...wr("w1", 1, "final", 2026),
      updated_at: "2026-09-10T00:00:00+00:00",
    };
    assert.equal(selectActiveWeek([wrapLeftover, wrapNewer])?.season_year, 2026);
    assert.equal(selectActiveWeek([wrapLeftover, wrapNewer])?.week_number, 1);
  });

  it("ranking ignores created_at insertion order and PostgREST row order", () => {
    const household_id = "b03e87bd-2899-4e71-b6fb-54399eef3e6d";
    const skipped = {
      ...wr("3e3aeeeb-4dcb-445b-9297-aa6c20967433", 1, "final"),
      household_id,
      created_at: "2026-09-15T17:53:12.526397+00:00",
      finalized_at: null,
      auto_opened_at: null,
    };
    const dirtyOpen = {
      ...wr("52a42a9e-fbce-4e06-a9b4-8a00b1d36994", 2, "open"),
      household_id,
      created_at: "2026-09-15T18:00:32.412751+00:00",
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      auto_opened_at: null,
    };
    const insertionOrder = [skipped, dirtyOpen];
    assert.equal(insertionOrder[0]?.week_number, 1);
    const active = selectActiveWeek(insertionOrder);
    assert.equal(active?.id, "52a42a9e-fbce-4e06-a9b4-8a00b1d36994");
    assert.equal(active?.week_number, 2);
    assert.equal(active?.status, "open");
    assert.equal(selectActiveWeek([dirtyOpen, skipped])?.week_number, 2);
    assert.equal(weekSwitcherLabel(dirtyOpen, active), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, active), "Week 1");
    assert.equal(familyWeekChrome("The Harper House", active), "The Harper House · Week 2");

    const leftoverDraft = {
      ...wr("3e3aeeeb-4dcb-445b-9297-aa6c20967433", 1, "draft"),
      household_id,
      created_at: "2026-09-16T12:00:00+00:00",
    };
    const prematureFinal = {
      ...wr("52a42a9e-fbce-4e06-a9b4-8a00b1d36994", 2, "final"),
      household_id,
      created_at: "2026-09-15T18:00:32.412751+00:00",
    };
    const laterDraftFirst = [leftoverDraft, prematureFinal];
    assert.equal(laterDraftFirst[0]?.status, "draft");
    assert.equal(selectActiveWeek(laterDraftFirst)?.week_number, 2);
    assert.equal(selectActiveWeek(laterDraftFirst)?.status, "final");
    assert.equal(selectActiveWeek([prematureFinal, leftoverDraft])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek(laterDraftFirst)),
      "The Harper House · Week 2",
    );
    assert.equal(
      weekSwitcherLabel(leftoverDraft, selectActiveWeek(laterDraftFirst)),
      "Week 1",
    );

    const open = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    assert.equal(selectActiveWeek([open, nextDraft])?.week_number, 1);
    assert.equal(weekSwitcherLabel(nextDraft, selectActiveWeek([open, nextDraft])), "Next week");
    assert.equal(selectActiveWeek([w(1, "final")])?.week_number, 1);
  });

  it("ranking ignores notes and updated_at extra select(\"*\") fields", () => {
    const household_id = "b03e87bd-2899-4e71-b6fb-54399eef3e6d";
    const leftoverDraft = {
      ...wr("3e3aeeeb-4dcb-445b-9297-aa6c20967433", 1, "draft"),
      household_id,
      updated_at: "2026-09-16T12:00:00+00:00",
      notes: "leftover skip",
    };
    const prematureFinal = {
      ...wr("52a42a9e-fbce-4e06-a9b4-8a00b1d36994", 2, "final"),
      household_id,
      updated_at: "2026-09-15T19:04:43.88+00:00",
      notes: null,
    };
    // a: draft W1 + final W2 → active W2 (later leftover stamps do not win)
    const a = selectActiveWeek([leftoverDraft, prematureFinal]);
    assert.equal(a?.week_number, 2);
    assert.equal(a?.status, "final");
    assert.equal(selectActiveWeek([prematureFinal, leftoverDraft])?.id, prematureFinal.id);
    assert.equal(familyWeekChrome("The Harper House", a), "The Harper House · Week 2");
    assert.equal(weekSwitcherLabel(leftoverDraft, a), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftoverDraft, a), "This Sunday");
    assert.equal(pickViewWeek([leftoverDraft, prematureFinal], a, "next")?.id, prematureFinal.id);

    // b: draft W1 + open W2 → active W2
    const openW2 = { ...prematureFinal, status: "open" };
    const b = selectActiveWeek([leftoverDraft, openW2]);
    assert.equal(b?.week_number, 2);
    assert.equal(b?.status, "open");
    assert.equal(weekSwitcherLabel(openW2, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftoverDraft, b), "Week 1");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");

    // c: open W1 + draft W2 (later updated_at) → active W1, W2 labeled Next week
    const openW1 = wr("w1", 1, "open");
    const laterDraft = {
      ...wr("w2", 2, "draft"),
      updated_at: "2026-09-17T00:00:00+00:00",
      notes: "auto-created next",
    };
    const c = selectActiveWeek([openW1, laterDraft]);
    assert.equal(c?.week_number, 1);
    assert.equal(c?.id, "w1");
    assert.equal(weekSwitcherLabel(openW1, c), "This Sunday");
    assert.equal(weekSwitcherLabel(laterDraft, c), "Next week");
    assert.equal(pickViewWeek([openW1, laterDraft], c, "next")?.id, "w2");

    // d: only final W1 → W1
    assert.equal(
      selectActiveWeek([{ ...w(1, "final"), notes: "season over", updated_at: "2026-09-16T00:00:00Z" }])
        ?.week_number,
      1,
    );

    // e: skip path: final/skipped W1 + open W2 → W2
    const skipped = {
      ...leftoverDraft,
      status: "final",
      updated_at: "2026-09-16T16:00:00+00:00",
    };
    const dirtyOpen = {
      ...openW2,
      finalized_at: "2026-09-15T19:04:43.88+00:00",
      updated_at: "2026-09-15T19:04:43.88+00:00",
    };
    const e = selectActiveWeek([skipped, dirtyOpen]);
    assert.equal(e?.week_number, 2);
    assert.equal(e?.status, "open");
    assert.equal(weekSwitcherLabel(dirtyOpen, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(skipTargetWeek([leftoverDraft, prematureFinal], prematureFinal)?.week_number, 1);
    const landed = skipLandingWeek([leftoverDraft, prematureFinal], leftoverDraft);
    assert.equal(landed?.week_number, 2);
    assert.equal(landed?.status, "open");
  });

  it("selectActiveWeek ranks only season_year, week_number, and in-play status", () => {
    const noise = { extra: "not a ranking key", row: 0, payload: { n: 1 } };
    // a: draft W1 + final W2 → active W2
    const leftover = { ...w(1, "draft"), ...noise, extra: "later" };
    const premature = { ...w(2, "final"), ...noise, extra: "earlier" };
    assert.equal(selectActiveWeek([leftover, premature])?.week_number, 2);
    assert.equal(selectActiveWeek([leftover, premature])?.status, "final");
    assert.equal(selectActiveWeek([premature, leftover])?.week_number, 2);

    // b: draft W1 + open W2 → active W2
    const openW2 = { ...w(2, "open"), ...noise };
    assert.equal(selectActiveWeek([leftover, openW2])?.week_number, 2);
    assert.equal(selectActiveWeek([leftover, openW2])?.status, "open");
    assert.equal(selectActiveWeek([leftover, { ...w(2, "locked"), ...noise }])?.week_number, 2);

    // c: open W1 + draft W2 → active W1, W2 labeled Next week
    const openW1 = { ...wr("w1", 1, "open"), ...noise };
    const nextDraft = { ...wr("w2", 2, "draft"), ...noise, extra: "auto-created" };
    const c = selectActiveWeek([openW1, nextDraft]);
    assert.equal(c?.week_number, 1);
    assert.equal(c?.id, "w1");
    assert.equal(weekSwitcherLabel(openW1, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([openW1, nextDraft], c, "next")?.id, "w2");

    // d: only final W1 → W1
    assert.equal(selectActiveWeek([{ ...w(1, "final"), ...noise }])?.week_number, 1);

    // e: skip path: final/skipped W1 + open W2 → W2
    const skipped = { ...wr("w1", 1, "final"), ...noise };
    const dirty = {
      ...wr("w2", 2, "open"),
      ...noise,
      finalized_at: "2026-09-15T19:04:43.880Z",
    };
    const e = selectActiveWeek([skipped, dirty]);
    assert.equal(e?.week_number, 2);
    assert.equal(e?.status, "open");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
  });

  it("recency coerces mixed string/number season_year and week_number", () => {
    const keyed = (
      week_number: number | string,
      status: string,
      season_year: number | string = 2026,
    ) => ({ season_year, week_number, status }) as ReturnType<typeof w>;
    const keyedRef = (
      id: string,
      week_number: number | string,
      status: string,
      season_year: number | string = 2026,
    ) => ({ id, season_year, week_number, status }) as ReturnType<typeof wr>;

    // a: draft W1 + final W2 → active W2
    const leftoverStr = keyed("1", "draft", "2026");
    const prematureNum = keyed(2, "final", 2026);
    assert.equal(selectActiveWeek([leftoverStr, prematureNum])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverStr, prematureNum])?.status, "final");
    assert.equal(selectActiveWeek([prematureNum, leftoverStr])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([leftoverStr, prematureNum])),
      "The Harper House · Week 2",
    );
    const leftoverNum = keyed(1, "draft", 2026);
    const prematureStr = keyed("2", "final", "2026");
    assert.equal(Number(selectActiveWeek([leftoverNum, prematureStr])?.week_number), 2);
    assert.equal(selectActiveWeek([leftoverNum, prematureStr])?.status, "final");
    assert.equal(Number(selectActiveWeek([prematureStr, leftoverNum])?.week_number), 2);

    // b: draft W1 + open W2 → active W2
    const draftNum = keyedRef("w1", 1, "draft", 2026);
    const openStr = keyedRef("w2", "2", "open", "2026");
    const b = selectActiveWeek([draftNum, openStr]);
    assert.equal(b?.id, "w2");
    assert.equal(Number(b?.week_number), 2);
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([openStr, draftNum])?.id, "w2");
    assert.equal(weekSwitcherLabel(openStr, b), "This Sunday");
    assert.equal(weekSwitcherLabel(draftNum, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(draftNum, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(draftNum, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([draftNum, openStr], b, "next")?.id, "w2");

    // c: open W1 + draft W2 → active W1, W2 labeled Next week
    const openW1 = keyedRef("open-1", "1", "open", "2026");
    const nextDraft = keyedRef("draft-2", 2, "draft", 2026);
    const c = selectActiveWeek([openW1, nextDraft]);
    assert.equal(c?.id, "open-1");
    assert.equal(Number(c?.week_number), 1);
    assert.equal(weekSwitcherLabel(openW1, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([openW1, nextDraft], c, null)?.id, "open-1");
    assert.equal(pickViewWeek([openW1, nextDraft], c, "next")?.id, "draft-2");

    // d: only final W1 → W1
    assert.equal(Number(selectActiveWeek([keyed("1", "final", "2026")])?.week_number), 1);

    // e: skip path: final/skipped W1 + open W2 → W2
    const skippedStr = keyedRef("w1", "1", "final", "2026");
    const dirtyOpen = {
      ...keyedRef("w2", 2, "open", 2026),
      finalized_at: "2026-09-15T19:04:43.880Z",
    };
    const e = selectActiveWeek([skippedStr, dirtyOpen]);
    assert.equal(e?.id, "w2");
    assert.equal(e?.week_number, 2);
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([dirtyOpen, skippedStr])?.id, "w2");
    assert.equal(weekSwitcherLabel(dirtyOpen, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skippedStr, e), "Week 1");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");

    const wrapDraft = keyed("18", "draft", "2025");
    const wrapFinal = keyed(1, "final", 2026);
    assert.equal(selectActiveWeek([wrapDraft, wrapFinal])?.season_year, 2026);
    assert.equal(selectActiveWeek([wrapDraft, wrapFinal])?.week_number, 1);
    assert.equal(selectActiveWeek([wrapFinal, wrapDraft])?.status, "final");

    assert.equal([leftoverStr, prematureNum].sort(recency)[0]?.week_number, 2);
    assert.equal([prematureNum, leftoverStr].sort(recency)[0]?.status, "final");
    assert.equal(Number([leftoverNum, prematureStr].sort(recency)[0]?.week_number), 2);
    assert.equal(Number([draftNum, openStr].sort(recency)[0]?.week_number), 2);
    assert.equal([openW1, nextDraft].sort(recency)[0]?.id, "draft-2");
    assert.equal(Number([skippedStr, dirtyOpen].sort(recency)[0]?.week_number), 2);

    assert.deepEqual(nextWeekSlot(keyed("1", "draft", "2026")), {
      season_year: 2026,
      week_number: 2,
    });
    assert.notEqual(nextWeekSlot(keyed("1", "draft", "2026")).week_number, "11");
    assert.deepEqual(nextWeekSlot(keyed("18", "final", "2026")), {
      season_year: 2027,
      week_number: 1,
    });
    assert.notEqual(nextWeekSlot(keyed("18", "final", "2026")).season_year, "20261");

    const leftoverDraft = keyedRef("3e3aeeeb", "1", "draft", "2026");
    const prematureFinal = keyedRef("52a42a9e", 2, "final", 2026);
    assert.equal(skipTargetWeek([leftoverDraft, prematureFinal], prematureFinal)?.id, "3e3aeeeb");
    const landed = skipLandingWeek([leftoverDraft, prematureFinal], leftoverDraft);
    assert.equal(landed?.id, "52a42a9e");
    assert.equal(landed?.status, "open");
    assert.equal(
      weekAtSlot([leftoverDraft, prematureFinal], nextWeekSlot(leftoverDraft))?.id,
      "52a42a9e",
    );
  });

  it("skip path: leftover draft behind playable W2 closes W1, not W2", () => {
    const leftover = w(1, "draft");
    const open = w(2, "open");
    const target = skipTargetWeek([leftover, open], open);
    assert.equal(target?.week_number, 1);
    assert.equal(target?.status, "draft");
    assert.equal(skipTargetWeek([leftover, w(2, "draft")], w(2, "draft"))?.week_number, 1);
    const after = [w(1, "final"), open];
    assert.equal(selectActiveWeek(after)?.week_number, 2);
    assert.equal(selectActiveWeek(after)?.status, "open");
  });

  it("skip path: leftover extra/empty/abandoned W1 behind playable W2 closes W1, not W2", () => {
    const thisSunday = wr("w2", 2, "open");
    for (const leftoverStatus of ["abandoned", "skipped", ""]) {
      const leftover = wr("w1", 1, leftoverStatus);
      const weeks = [leftover, thisSunday];
      const reverse = [thisSunday, leftover];
      const active = selectActiveWeek(weeks);
      assert.equal(active?.id, "w2");
      assert.equal(active?.status, "open");
      assert.equal(selectActiveWeek(reverse)?.id, "w2");
      assert.equal(weekSwitcherLabel(thisSunday, active), "This Sunday");
      assert.equal(weekSwitcherLabel(leftover, active), "Week 1");
      assert.notEqual(weekSwitcherLabel(leftover, active), "This Sunday");
      assert.notEqual(weekSwitcherLabel(leftover, active), "Next week");
      assert.equal(familyWeekChrome("The Harper House", active), "The Harper House · Week 2");
      assert.equal(skipTargetWeek(weeks, thisSunday)?.id, "w1");
      assert.equal(skipTargetWeek(weeks, thisSunday)?.status, leftoverStatus);
      assert.notEqual(skipTargetWeek(weeks, thisSunday)?.week_number, 2);
      assert.equal(skipTargetWeek(weeks, leftover)?.id, "w1");
      assert.equal(skipLandingWeek(weeks, leftover)?.id, "w2");
      assert.equal(skipLandingWeek(weeks, leftover)?.status, "open");
      const copy = skipControlCopy(leftover, thisSunday, weeks);
      assert.equal(copy.button, "Skip leftover Week 1");
      assert.doesNotMatch(copy.button, /open/);
      assert.doesNotMatch(copy.button, /start next week/);
      assert.match(copy.hint, /without Reveal/);
      assert.doesNotMatch(copy.hint, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
      assert.doesNotMatch(copy.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    }

    // a: leftover abandoned/empty W1 + final W2 → active W2
    assert.equal(selectActiveWeek([w(1, "abandoned"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, ""), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "skipped")])?.status, "final");

    // b: leftover extra W1 + open W2 → active W2
    assert.equal(selectActiveWeek([w(1, ""), w(2, "open")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "abandoned"), w(2, "locked")])?.week_number, 2);

    // c: open W1 + abandoned W2 → active W1; W2 is not Next week
    const open = wr("open-1", 1, "open");
    const extraNext = wr("extra-2", 2, "abandoned");
    const c = selectActiveWeek([open, extraNext]);
    assert.equal(c?.id, "open-1");
    assert.equal(weekSwitcherLabel(open, c), "This Sunday");
    assert.equal(weekSwitcherLabel(extraNext, c), "Week 2");
    assert.notEqual(weekSwitcherLabel(extraNext, c), "Next week");
    assert.equal(pickViewWeek([open, extraNext], c, "next")?.id, "open-1");

    // d: only abandoned/empty W1 → W1
    assert.equal(selectActiveWeek([w(1, "abandoned")])?.week_number, 1);
    assert.equal(selectActiveWeek([w(1, "")])?.week_number, 1);

    // e: skip path: leftover extra closed, family stays on open W2
    const leftoverAbandoned = wr("w1a", 1, "abandoned");
    assert.equal(skipTargetWeek([leftoverAbandoned, thisSunday], leftoverAbandoned)?.id, "w1a");
    assert.equal(selectActiveWeek([w(1, "final"), thisSunday])?.week_number, 2);

    const premature = {
      ...wr("w2f", 2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    };
    const extra = wr("w1e", 1, "abandoned");
    assert.equal(selectActiveWeek([extra, premature])?.id, "w2f");
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([extra, premature])),
      "The Harper House · Week 2",
    );
    assert.equal(skipTargetWeek([extra, premature], extra)?.id, "w1e");
    assert.equal(skipTargetWeek([extra, premature], premature)?.id, "w1e");
    const landed = skipLandingWeek([extra, premature], extra);
    assert.equal(landed?.id, "w2f");
    assert.equal(landed?.status, "open");
    assert.equal(
      skipControlCopy(extra, premature, [extra, premature]).button,
      "Skip leftover Week 1 / open this week",
    );
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

    assert.equal(selectActiveWeek([leftoverOpen, thisSunday])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverLocked, thisSunday])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverLocked, lockedSunday])?.week_number, 2);
    assert.equal(active?.id, "w2");
    assert.equal(weekSwitcherLabel(sundayRef, active), "This Sunday");
    assert.equal(weekSwitcherLabel(leftoverRef, active), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftoverRef, active), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftoverRef, active), "Next week");
    assert.equal(selectActiveWeek([leftoverLocked, nextDraft])?.week_number, 1);
    assert.equal(
      weekSwitcherLabel(wr("w2d", 2, "draft"), selectActiveWeek([leftoverRef, wr("w2d", 2, "draft")])),
      "Next week",
    );

    assert.equal(skipTargetWeek([leftoverOpen, thisSunday], thisSunday)?.week_number, 1);
    assert.equal(skipTargetWeek([leftoverLocked, thisSunday], thisSunday)?.week_number, 1);
    assert.equal(skipTargetWeek([leftoverOpen, lockedSunday], lockedSunday)?.week_number, 1);
    assert.equal(skipTargetWeek([leftoverLocked, lockedSunday], lockedSunday)?.week_number, 1);
    assert.equal(skipTargetWeek([leftoverLocked, thisSunday], leftoverLocked)?.week_number, 1);
    assert.equal(skipTargetWeek([leftoverLocked, nextDraft], leftoverLocked)?.week_number, 1);
    assert.equal(skipTargetWeek([leftoverLocked, nextDraft], nextDraft)?.week_number, 2);
    assert.equal(skipTargetWeek([leftoverOpen, w(2, "final")], w(2, "final")), null);
    assert.equal(skipTargetWeek([leftoverLocked, w(2, "final")], w(2, "final")), null);

    const dirtyLeftover = { ...leftoverOpen, finalized_at: "2026-09-15T19:04:43.880Z" };
    const dirtyWeeks = [dirtyLeftover, thisSunday];
    assert.equal(skipTargetWeek(dirtyWeeks, thisSunday)?.week_number, 1);
    assert.equal(skipScrubsViewedInPlace(dirtyLeftover, thisSunday, dirtyWeeks), false);
    assert.equal(skipScrubsViewedInPlace(dirtyLeftover, dirtyLeftover, dirtyWeeks), false);
    assert.equal(skipLandingWeek(dirtyWeeks, dirtyLeftover)?.week_number, 2);
    assert.equal(skipLandingWeek(dirtyWeeks, dirtyLeftover)?.status, "open");
    assert.equal(skipLandingWeek([leftoverLocked, thisSunday], leftoverLocked)?.week_number, 2);
    assert.equal(skipLandingWeek([leftoverLocked, thisSunday], leftoverLocked)?.status, "open");
    assert.equal(skipLandingWeek([leftoverLocked, lockedSunday], leftoverLocked)?.week_number, 2);
    assert.equal(skipLandingWeek([leftoverLocked, lockedSunday], leftoverLocked)?.status, "locked");
    assert.match(leftoverDraftNextStep(dirtyLeftover, dirtyWeeks)?.label ?? "", /behind a newer week/);
    assert.doesNotMatch(leftoverDraftNextStep(dirtyLeftover, dirtyWeeks)?.label ?? "", /leftover marks/);
    assert.doesNotMatch(leftoverDraftNextStep(dirtyLeftover, dirtyWeeks)?.label ?? "", /start next week/);
    assert.match(
      leftoverDraftNextStep(leftoverLocked, [leftoverLocked, thisSunday])?.label ?? "",
      /behind a newer week/,
    );
    assert.match(
      leftoverDraftNextStep(leftoverLocked, [leftoverLocked, thisSunday])?.label ?? "",
      /without Reveal/,
    );
    assert.doesNotMatch(
      leftoverDraftNextStep(leftoverLocked, [leftoverLocked, thisSunday])?.label ?? "",
      /start next week/,
    );

    const copy = skipControlCopy(leftoverLocked, thisSunday, [leftoverLocked, thisSunday]);
    assert.equal(copy.button, "Skip leftover Week 1");
    assert.doesNotMatch(copy.button, /open/);
    assert.match(copy.hint, /Week 1 is still leftover/);
    assert.doesNotMatch(copy.hint, /leftover draft/);
    assert.match(copy.hint, /without Reveal/);
    assert.doesNotMatch(copy.hint, /open this week/);
    assert.doesNotMatch(copy.hint, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.doesNotMatch(copy.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const draftCopy = skipControlCopy(w(1, "draft"), thisSunday, [w(1, "draft"), thisSunday]);
    assert.equal(draftCopy.button, "Skip leftover Week 1");
    assert.doesNotMatch(draftCopy.button, /open/);
    assert.match(draftCopy.hint, /Week 1 is still a leftover draft/);
    assert.doesNotMatch(draftCopy.hint, /open this week/);
  });

  it("never prefers an older leftover draft over a newer week of any status", () => {
    assert.equal(selectActiveWeek([w(1, "draft"), w(2, "final"), w(3, "draft")])?.week_number, 3);
    assert.equal(selectActiveWeek([w(3, "final"), w(1, "draft"), w(2, "draft")])?.week_number, 3);
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft")])?.status, "final");
  });

  it("selectActiveWeek does not rank draft above final as a class", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/current-week.ts"), "utf8");
    const start = src.indexOf("export function selectActiveWeek");
    const end = src.indexOf("export function nextWeekSlot");
    assert.ok(start >= 0 && end > start);
    const body = src.slice(start, end);
    assert.match(body, /return latestInPlay \?\? newest/);
    assert.match(body, /season_year: week\.season_year, week_number: week\.week_number/);
    assert.match(body, /recency\(slot, latestInPlay\)/);
    assert.match(body, /recency\(slot, newest\)/);
    assert.match(body, /for \(const week of weeks\)/);
    assert.match(body, /Walk every week/);
    assert.doesNotMatch(body, /weeks\[0\]/);
    assert.doesNotMatch(body, /status === ["']draft["']/);
    assert.doesNotMatch(body, /status === ["']final["']/);
    assert.doesNotMatch(body, /finalized_at/);
    assert.doesNotMatch(body, /lock_at/);
    assert.doesNotMatch(body, /auto_opened_at/);
    assert.doesNotMatch(body, /lock_at_override/);
    assert.doesNotMatch(body, /featured_game_id/);
    assert.doesNotMatch(body, /\bcreated_at\b/);
    assert.doesNotMatch(body, /commissioner_edited_at/);
    assert.doesNotMatch(body, /auto_created_at/);
    assert.doesNotMatch(body, /auto_locked_at/);
    assert.doesNotMatch(body, /autopilot_hold/);
    assert.doesNotMatch(body, /autopilot_checked_at/);
    assert.doesNotMatch(body, /household_id/);
    assert.doesNotMatch(body, /updated_at/);
    assert.doesNotMatch(body, /\bnotes\b/);
    const inPlayStart = src.indexOf("function isInPlay");
    const inPlayEnd = src.indexOf("export function isNewerDraft");
    assert.ok(inPlayStart >= 0 && inPlayEnd > inPlayStart);
    const inPlayBody = src.slice(inPlayStart, inPlayEnd);
    assert.match(inPlayBody, /status === "open" \|\| status === "locked"/);
    assert.doesNotMatch(inPlayBody, /auto_opened_at/);
    assert.doesNotMatch(inPlayBody, /finalized_at/);
    assert.doesNotMatch(inPlayBody, /lock_at_override/);
    assert.doesNotMatch(inPlayBody, /featured_game_id/);
    assert.doesNotMatch(inPlayBody, /\bcreated_at\b/);
    assert.doesNotMatch(inPlayBody, /auto_created_at/);
    assert.doesNotMatch(inPlayBody, /auto_locked_at/);
    assert.doesNotMatch(inPlayBody, /autopilot_hold/);
    assert.doesNotMatch(inPlayBody, /autopilot_checked_at/);
    assert.doesNotMatch(inPlayBody, /household_id/);
    assert.doesNotMatch(inPlayBody, /commissioner_edited_at/);
    assert.doesNotMatch(inPlayBody, /updated_at/);
    assert.doesNotMatch(inPlayBody, /\bnotes\b/);
    const chromeStart = src.indexOf("export function familyWeekChrome");
    const chromeEnd = src.indexOf("export function weekSwitcherLabel");
    assert.ok(chromeStart >= 0 && chromeEnd > chromeStart);
    const chromeBody = src.slice(chromeStart, chromeEnd);
    assert.match(chromeBody, /householdName \?\? "Your household"/);
    assert.match(chromeBody, /\$\{name\} · Week \$\{week\.week_number\}/);
    assert.match(chromeBody, /The Harper House · Week 2/);
    assert.match(chromeBody, /leftover draft W1 \+ premature-final W2/);
    assert.match(chromeBody, /lock_at_override, created_at, featured_game_id/);
    assert.match(chromeBody, /auto_created_at, auto_locked_at, autopilot_hold/);
    assert.match(chromeBody, /household_id, commissioner_edited_at, autopilot_checked_at/);
    assert.match(chromeBody, /ranking ignores id/);
    assert.match(chromeBody, /ranking ignores notes, updated_at/);
    assert.match(chromeBody, /recency is season_year then week_number/);
    assert.match(chromeBody, /not created_at insertion order/);
    assert.match(chromeBody, /ranking copies only season_year and week_number/);
    assert.match(chromeBody, /recency copies both operands before comparing/);
    assert.match(chromeBody, /recency coerces season_year and week_number to numbers/);
    assert.match(chromeBody, /fetchHouseholdWeeks sorts with recency/);
    assert.doesNotMatch(body, /\bid\b/);
    assert.doesNotMatch(inPlayBody, /\bid\b/);
    const recencyStart = src.indexOf("function recency");
    const recencyEnd = src.indexOf("function isNewerThan");
    assert.ok(recencyStart >= 0 && recencyEnd > recencyStart);
    const recencyImpl = src.slice(src.indexOf("{", recencyStart), recencyEnd);
    assert.match(recencyImpl, /season_year: a\.season_year, week_number: a\.week_number/);
    assert.match(recencyImpl, /season_year: b\.season_year, week_number: b\.week_number/);
    assert.match(recencyImpl, /a\.season_year !== b\.season_year/);
    assert.match(recencyImpl, /b\.season_year - a\.season_year/);
    assert.match(recencyImpl, /b\.week_number - a\.week_number/);
    assert.match(recencyImpl, /Number\(a\.season_year\)/);
    assert.match(recencyImpl, /Number\(a\.week_number\)/);
    assert.match(recencyImpl, /Number\(b\.season_year\)/);
    assert.match(recencyImpl, /Number\(b\.week_number\)/);
    assert.doesNotMatch(recencyImpl, /\bid\b/);
    assert.doesNotMatch(recencyImpl, /status/);
    assert.doesNotMatch(recencyImpl, /finalized_at/);
    assert.doesNotMatch(recencyImpl, /lock_at/);
    assert.doesNotMatch(recencyImpl, /auto_opened_at/);
    assert.doesNotMatch(recencyImpl, /created_at/);
    assert.doesNotMatch(recencyImpl, /household_id/);
    assert.doesNotMatch(recencyImpl, /updated_at/);
    assert.doesNotMatch(recencyImpl, /\bnotes\b/);
    assert.doesNotMatch(src, /ranked\.find\(\(w\) => w\.status === "draft"\)/);
    assert.doesNotMatch(src, /else latest draft/);
    assert.doesNotMatch(src, /open\/locked > draft > final/);
    assert.match(src, /function isNewerThan[\s\S]{0,80}return recency\(week, than\) < 0/);
    assert.match(src, /function isOlderThan[\s\S]{0,80}return recency\(week, than\) > 0/);
    assert.match(src, /function isSameSlot[\s\S]{0,80}return recency\(a, b\) === 0/);
    assert.match(src, /weeks\.find\(\(w\) => isSameSlot\(w, slot\)\)/);
    const labelStart = src.indexOf("export function weekSwitcherLabel");
    const labelEnd = src.indexOf("export function pickViewWeek");
    assert.ok(labelStart >= 0 && labelEnd > labelStart);
    const labelBody = src.slice(labelStart, labelEnd);
    assert.match(labelBody, /isInPlay\(active\.status\) && isSameSlot\(w, active\)/);
    assert.match(labelBody, /isInPlay\(active\.status\) && isNewerDraft\(w, active\)/);
    assert.doesNotMatch(labelBody, /w\.id === active\.id/);
    const pickStart = src.indexOf("export function pickViewWeek");
    const pickBody = src.slice(pickStart, pickStart + 900);
    assert.match(pickBody, /requested === "next"/);
    assert.match(pickBody, /weekAtSlot\(weeks, nextWeekSlot\(active\)\)/);
    assert.match(pickBody, /isNewerDraft\(slotDraft, active\)/);
    assert.match(pickBody, /return slotDraft;/);
    assert.match(pickBody, /return active;/);
    assert.ok(
      pickBody.indexOf("return slotDraft") < pickBody.indexOf("return active;"),
      "next must return the next-slot draft or stay on active — never fall through to a leftover id",
    );
    assert.doesNotMatch(pickBody, /if \(!slotDraft\)/);
  });

  it("does not label This Sunday when the active week is a newer final", () => {
    const leftover = wr("w1", 1, "draft");
    const premature = wr("w2", 2, "final");
    const active = selectActiveWeek([leftover, premature]);
    assert.equal(active?.id, "w2");
    assert.equal(weekSwitcherLabel(leftover, active), "Week 1");
    assert.equal(weekSwitcherLabel(premature, active), "Week 2");
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
    assert.deepEqual(
      nextWeekSlot({ season_year: "2026" as unknown as number, week_number: "1" as unknown as number }),
      { season_year: 2026, week_number: 2 },
    );
    assert.deepEqual(
      nextWeekSlot({ season_year: "2026" as unknown as number, week_number: "18" as unknown as number }),
      { season_year: 2027, week_number: 1 },
    );
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
    assert.equal(skipTargetWeek([leftover, w(2, "open")], w(2, "open"))?.week_number, 1);
    assert.equal(skipTargetWeek([leftover, w(2, "draft")], w(2, "draft"))?.week_number, 1);
    assert.equal(skipTargetWeek([leftover, w(2, "locked")], w(2, "locked"))?.week_number, 1);
    const next = weekAtSlot([leftover, premature], nextWeekSlot(leftover));
    assert.equal(next?.status, "final");
    assert.equal(shouldOpenExistingNextWeek(next), true);
    assert.equal(shouldOpenExistingNextWeek(w(2, "draft")), true);
    assert.equal(shouldOpenExistingNextWeek(w(2, "locked")), true);
    assert.equal(shouldOpenExistingNextWeek(w(2, "open")), false);
    assert.equal(shouldOpenExistingNextWeek(undefined), false);
    assert.equal(skipUnlocksCards(premature), true);
    assert.equal(skipUnlocksCards(w(2, "locked")), true);
    assert.equal(skipUnlocksCards(w(2, "draft")), false);
    assert.equal(skipUnlocksCards(w(2, "open")), false);
    assert.equal(skipClearsCalledMoments(premature), true);
    assert.equal(skipClearsCalledMoments(w(2, "locked")), false);
    assert.equal(skipClearsCalledMoments(w(2, "draft")), false);
    assert.equal(skipClearsCalledMoments(w(2, "open")), false);
    assert.equal(skipClearsGameOutcomes(premature), true);
    assert.equal(skipClearsGameOutcomes(w(2, "locked")), false);
    assert.equal(skipClearsGameOutcomes(w(2, "draft")), false);
    assert.equal(skipClearsGameOutcomes(w(2, "open")), false);
    const after = [w(1, "final"), w(2, "open")];
    assert.equal(selectActiveWeek(after)?.week_number, 2);
    assert.equal(selectActiveWeek(after)?.status, "open");
  });

  it("skip scrubs premature finalize leftovers on an already-open next week", () => {
    const leftover = w(1, "draft");
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const cleanOpen = w(2, "open");
    const lockedWithStamp = { ...w(2, "locked"), finalized_at: "2026-09-15T19:04:43.880Z" };

    assert.equal(shouldOpenExistingNextWeek(dirtyOpen), true);
    assert.equal(shouldOpenExistingNextWeek(cleanOpen), false);
    assert.equal(skipUnlocksCards(dirtyOpen), true);
    assert.equal(skipUnlocksCards(cleanOpen), false);
    assert.equal(skipClearsCalledMoments(dirtyOpen), true);
    assert.equal(skipClearsCalledMoments(cleanOpen), false);
    assert.equal(skipClearsCalledMoments(w(2, "locked")), false);
    assert.equal(skipClearsCalledMoments(lockedWithStamp), false);
    assert.equal(skipClearsGameOutcomes(dirtyOpen), true);
    assert.equal(skipClearsGameOutcomes(cleanOpen), false);
    assert.equal(skipClearsGameOutcomes(w(2, "locked")), false);
    assert.equal(skipClearsGameOutcomes(lockedWithStamp), false);

    assert.equal(skipTargetWeek([leftover, dirtyOpen], dirtyOpen)?.week_number, 1);
    const after = [w(1, "final"), dirtyOpen];
    assert.equal(selectActiveWeek(after)?.week_number, 2);
    assert.equal(selectActiveWeek(after)?.status, "open");
    assert.equal(skipScrubsViewedInPlace(leftover, leftover), false);
    assert.equal(skipScrubsViewedInPlace(leftover, dirtyOpen), false);
    assert.equal(skipScrubsViewedInPlace(dirtyOpen, dirtyOpen), true);
    assert.equal(skipScrubsViewedInPlace(cleanOpen, cleanOpen), false);
    assert.equal(skipTargetWeek([w(1, "final"), dirtyOpen], dirtyOpen)?.week_number, 2);
    assert.equal(
      skipScrubsViewedInPlace(skipTargetWeek([w(1, "final"), dirtyOpen], dirtyOpen)!, dirtyOpen),
      true,
    );
    const skipped = w(1, "final");
    assert.equal(skipTargetWeek([skipped, dirtyOpen], skipped)?.week_number, 2);
    assert.equal(skipScrubsViewedInPlace(dirtyOpen, skipped), true);
    assert.equal(skipTargetWeek([skipped, cleanOpen], skipped), null);
    assert.equal(skipLandingWeek([skipped, dirtyOpen], dirtyOpen)?.week_number, 2);
    assert.equal(skipLandingWeek([skipped, dirtyOpen], dirtyOpen)?.status, "open");
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

    assert.equal(skipTargetWeek(weeks, premature)?.week_number, 2);
    assert.equal(skipTargetWeek(weeks, skipped)?.week_number, 2);
    assert.equal(skipTargetWeek(weeks, premature)?.status, "final");
    assert.equal(skipScrubsViewedInPlace(premature, premature, weeks), true);
    assert.equal(skipScrubsViewedInPlace(premature, skipped, weeks), true);
    assert.equal(skipLandingWeek(weeks, premature)?.week_number, 2);
    assert.equal(skipLandingWeek(weeks, premature)?.status, "final");

    assert.equal(skipTargetWeek([skipped], skipped), null);
    assert.equal(skipTargetWeek([w(1, "open"), premature], premature), null);
    assert.equal(skipTargetWeek([w(1, "locked"), premature], premature), null);
    assert.equal(skipTargetWeek([skipped, premature, w(3, "open")], premature), null);

    const leftover = w(1, "draft");
    assert.equal(skipTargetWeek([leftover, premature], leftover)?.week_number, 1);
    assert.equal(skipTargetWeek([leftover, premature], premature)?.week_number, 1);
    assert.equal(skipScrubsViewedInPlace(leftover, leftover), false);

    assert.equal(skipTargetWeek([skipped, premature, draft3], draft3)?.week_number, 2);
    assert.equal(skipScrubsViewedInPlace(premature, draft3, [skipped, premature, draft3]), true);
    assert.equal(skipLandingWeek([skipped, premature, draft3], premature)?.week_number, 2);
    assert.equal(skipLandingWeek([skipped, premature, draft3], premature)?.status, "final");

    assert.equal(skipUnlocksCards(premature), true);
    assert.equal(skipClearsCalledMoments(premature), true);
    assert.equal(skipClearsGameOutcomes(premature), true);

    const copy = skipControlCopy(premature, premature, weeks);
    assert.equal(copy.button, "Clear leftover marks / open this week");
    assert.match(copy.hint, /marked finished too early/);
    assert.doesNotMatch(copy.hint, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const fromSkipped = skipControlCopy(premature, skipped, weeks);
    assert.equal(fromSkipped.button, "Clear leftover marks / open Week 2");
    assert.match(fromSkipped.hint, /Week 2 was marked finished too early/);
    const fromDraft3 = skipControlCopy(premature, draft3, [skipped, premature, draft3]);
    assert.equal(fromDraft3.button, "Clear leftover marks / open Week 2");
  });

  it("does not recover a legitimately completed newest week", () => {
    const played1 = { ...w(1, "final"), finalized_at: "2026-09-08T10:00:00.000Z" };
    const played2 = {
      ...w(2, "final"),
      finalized_at: "2026-09-15T10:00:00.000Z",
      lock_at: "2026-09-13T17:00:00.000Z",
    };
    const weeks = [played1, played2];

    assert.equal(skipTargetWeek(weeks, played2), null);
    assert.equal(skipTargetWeek(weeks, played1), null);
    assert.equal(skipTargetWeek([w(1, "final"), w(2, "final")], w(2, "final")), null);
    assert.equal(skipScrubsViewedInPlace(played2, played2, weeks), false);
    assert.equal(skipScrubsViewedInPlace(played2, played1, weeks), false);
    assert.equal(skipLandingWeek(weeks, played2)?.week_number, 2);
    assert.equal(skipLandingWeek(weeks, played2)?.status, "final");

    const outOfOrder = {
      ...w(2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
    };
    const skippedLater = { ...w(1, "final"), finalized_at: "2026-09-16T16:00:00.000Z" };
    assert.equal(skipTargetWeek([skippedLater, outOfOrder], outOfOrder)?.week_number, 2);
    assert.equal(skipScrubsViewedInPlace(outOfOrder, outOfOrder, [skippedLater, outOfOrder]), true);

    const beforeLock = {
      ...w(2, "final"),
      finalized_at: "2026-09-15T12:00:00.000Z",
      lock_at: "2026-09-17T00:15:00.000Z",
    };
    const skippedNoStamp = w(1, "final");
    assert.equal(skipTargetWeek([skippedNoStamp, beforeLock], beforeLock)?.week_number, 2);
  });

  it("skip copy names leftover draft when viewing a premature-final week", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    assert.equal(skipControlCopy(leftover, leftover).button, "Skip this week / start next week");
    assert.match(skipControlCopy(leftover, leftover).hint, /without Reveal/);
    const copy = skipControlCopy(leftover, premature);
    assert.equal(copy.button, "Skip leftover Week 1 / open this week");
    assert.match(copy.hint, /Week 1 is still a leftover draft/);
    assert.equal(skipControlCopy(leftover, w(2, "open")).button, "Skip leftover Week 1 / open this week");
    assert.match(copy.hint, /without Reveal/);
    assert.doesNotMatch(copy.hint, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.doesNotMatch(copy.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const scrub = skipControlCopy(dirtyOpen, dirtyOpen);
    assert.equal(scrub.button, "Clear leftover marks / open this week");
    assert.match(scrub.hint, /marked finished too early/);
    assert.doesNotMatch(scrub.hint, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.doesNotMatch(scrub.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const scrubFromSkipped = skipControlCopy(dirtyOpen, w(1, "final"));
    assert.equal(scrubFromSkipped.button, "Clear leftover marks / open Week 2");
    assert.match(scrubFromSkipped.hint, /Week 2 was marked finished too early/);
    assert.doesNotMatch(scrubFromSkipped.hint, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.doesNotMatch(scrubFromSkipped.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const ahead = skipControlCopy(leftover, w(3, "draft"));
    assert.equal(ahead.button, "Skip leftover Week 1 / open Week 2");
    assert.match(ahead.hint, /open Week 2/);
    assert.doesNotMatch(ahead.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const aheadWithDraft3 = skipControlCopy(leftover, w(3, "draft"), [
      leftover,
      premature,
      w(3, "draft"),
    ]);
    assert.equal(aheadWithDraft3.button, "Skip leftover Week 1");
    assert.doesNotMatch(aheadWithDraft3.button, /open/);
    assert.match(aheadWithDraft3.hint, /without Reveal/);
    assert.doesNotMatch(aheadWithDraft3.hint, /open Week 2/);
    const stay = skipControlCopy(leftover, w(3, "open"), [leftover, w(2, "final"), w(3, "open")]);
    assert.equal(stay.button, "Skip leftover Week 1");
    assert.doesNotMatch(stay.button, /open/);
    assert.match(stay.hint, /without Reveal/);
    assert.equal(skipControlCopy(leftover, leftover, [leftover, w(2, "open")]).button, "Skip this week");
    assert.doesNotMatch(
      skipControlCopy(leftover, leftover, [leftover, w(2, "open")]).button,
      /next week|open/i,
    );
  });

  it("skip copy does not promise next week when a newer week is already in play", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    const open3 = w(3, "open");
    const weeks = [leftover, premature, open3];

    const onLeftover = skipControlCopy(leftover, leftover, weeks);
    assert.equal(onLeftover.button, "Skip this week");
    assert.doesNotMatch(onLeftover.button, /next week|open/i);
    assert.match(onLeftover.hint, /without Reveal/);
    assert.doesNotMatch(onLeftover.hint, /open next/);
    assert.doesNotMatch(onLeftover.hint, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.doesNotMatch(onLeftover.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);

    const onNext = skipControlCopy(leftover, premature, weeks);
    assert.equal(onNext.button, "Skip leftover Week 1");
    assert.doesNotMatch(onNext.button, /open/);
    assert.match(onNext.hint, /without Reveal/);
    assert.doesNotMatch(onNext.hint, /open this week/);

    const onOpen3 = skipControlCopy(leftover, open3, weeks);
    assert.equal(onOpen3.button, "Skip leftover Week 1");
    assert.doesNotMatch(onOpen3.button, /open/);
    assert.equal(skipLandingWeek(weeks, leftover)?.week_number, 3);
  });

  it("skip does not reopen next when a newer week is already in play", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    const open3 = w(3, "open");
    const locked3 = w(3, "locked");
    const draft3 = w(3, "draft");
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };

    assert.equal(skipTouchesNextWeek(premature, [leftover, premature]), true);
    assert.equal(skipTouchesNextWeek(premature, [leftover, premature, draft3]), false);
    assert.equal(skipTouchesNextWeek(premature, [leftover, premature, open3]), false);
    assert.equal(skipTouchesNextWeek(premature, [leftover, premature, locked3]), false);
    assert.equal(skipTouchesNextWeek({ season_year: 2026, week_number: 2 }, [leftover, open3]), false);
    assert.equal(skipTouchesNextWeek(w(2, "open"), [leftover, w(2, "open")]), false);
    assert.equal(skipTouchesNextWeek(w(2, "locked"), [leftover, w(2, "locked")]), false);
    assert.equal(skipTouchesNextWeek(dirtyOpen, [leftover, dirtyOpen]), false);
    assert.equal(skipTouchesNextWeek(w(2, "draft"), [leftover, w(2, "draft")]), true);
    assert.equal(skipTouchesNextWeek(w(2, "final"), [leftover, w(2, "final")]), true);
    assert.equal(skipTouchesNextWeek(w(2, "locked"), []), true);
    assert.equal(skipTouchesNextWeek(w(2, "draft"), [leftover, w(2, "draft")], leftover), true);
    assert.equal(skipTouchesNextWeek(w(2, "final"), [leftover, w(2, "final")], leftover), true);

    assert.equal(shouldOpenExistingNextWeek(premature), true);
    assert.equal(shouldOpenExistingNextWeek(premature, [leftover, premature]), true);
    assert.equal(shouldOpenExistingNextWeek(premature, [leftover, premature, draft3]), false);
    assert.equal(shouldOpenExistingNextWeek(premature, [leftover, premature, open3]), false);
    assert.equal(shouldOpenExistingNextWeek(w(2, "draft"), [leftover, w(2, "draft"), open3]), false);
    assert.equal(shouldOpenExistingNextWeek(w(2, "locked")), true);
    assert.equal(shouldOpenExistingNextWeek(w(2, "locked"), [leftover, w(2, "locked")]), false);
    assert.equal(shouldOpenExistingNextWeek(w(2, "locked"), [leftover, w(2, "locked"), open3]), false);
    assert.equal(shouldOpenExistingNextWeek(dirtyOpen, [leftover, dirtyOpen]), false);
    assert.equal(shouldOpenExistingNextWeek(dirtyOpen, [leftover, dirtyOpen, open3]), false);

    assert.equal(selectActiveWeek([w(1, "final"), premature, open3])?.week_number, 3);
    assert.equal(selectActiveWeek([w(1, "final"), w(2, "open"), open3])?.week_number, 3);
    assert.equal(selectActiveWeek([leftover, premature, draft3])?.week_number, 3);
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

    assert.equal(selectActiveWeek(weeks)?.id, "w3");
    assert.equal(selectActiveWeek(reverse)?.id, "w3");
    assert.equal(selectActiveWeek([w(1, "final"), w(2, "open"), w(3, "final")])?.week_number, 2);

    assert.equal(skipTargetWeek(weeks, leftover1)?.id, "w1");
    assert.equal(skipTargetWeek(weeks, leftover2)?.id, "w1");
    assert.equal(skipTargetWeek(weeks, final3)?.id, "w2");
    assert.equal(skipTargetWeek(reverse, leftover2)?.id, "w1");

    assert.equal(skipTouchesNextWeek(leftover2, weeks, leftover1), false);
    assert.equal(skipTouchesNextWeek(leftover2, reverse, leftover1), false);
    assert.equal(skipTouchesNextWeek(final3, weeks, leftover2), true);
    assert.equal(skipTouchesNextWeek(final3, reverse, leftover2), true);
    assert.equal(skipTouchesNextWeek(w(2, "final"), [leftover1, w(2, "final")], leftover1), true);
    assert.equal(skipTouchesNextWeek(leftover2, [leftover1, leftover2, w(3, "open")], leftover1), false);
    assert.equal(skipTouchesNextWeek(wrapNext, wrapWeeks, wrapLeftover), false);
    assert.equal(skipTouchesNextWeek(wrapFinal, wrapWeeks, wrapNext), true);

    assert.equal(shouldOpenExistingNextWeek(leftover2, weeks, leftover1), false);
    assert.equal(shouldOpenExistingNextWeek(leftover2, reverse, leftover1), false);
    assert.equal(shouldOpenExistingNextWeek(final3, weeks, leftover2), true);
    assert.equal(shouldOpenExistingNextWeek(w(2, "final"), [leftover1, w(2, "final")], leftover1), true);

    const closeW1 = skipLandingWeek(weeks, leftover1);
    assert.equal(closeW1?.id, "w3");
    assert.equal(closeW1?.status, "final");
    assert.equal(skipLandingWeek(reverse, leftover1)?.id, "w3");
    assert.equal(skipLandingWeek(reverse, leftover1)?.status, "final");
    const reopenW3 = skipLandingWeek(weeks, leftover2);
    assert.equal(reopenW3?.id, "w3");
    assert.equal(reopenW3?.status, "open");
    assert.equal(skipLandingWeek([leftover1, w(2, "final")], leftover1)?.week_number, 2);
    assert.equal(skipLandingWeek([leftover1, w(2, "final")], leftover1)?.status, "open");
    assert.equal(skipLandingWeek(wrapWeeks, wrapLeftover)?.id, "w2");
    assert.equal(skipLandingWeek(wrapWeeks, wrapLeftover)?.status, "final");
    assert.equal(skipLandingWeek(wrapWeeks, wrapNext)?.id, "w2");
    assert.equal(skipLandingWeek(wrapWeeks, wrapNext)?.status, "open");

    const onW1 = skipControlCopy(leftover1, leftover1, weeks);
    assert.equal(onW1.button, "Skip this week");
    assert.doesNotMatch(onW1.button, /next week|open/i);
    assert.match(onW1.hint, /without Reveal/);
    assert.doesNotMatch(onW1.hint, /open next/);
    assert.doesNotMatch(onW1.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.doesNotMatch(onW1.hint, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const onW2 = skipControlCopy(leftover1, leftover2, weeks);
    assert.equal(onW2.button, "Skip leftover Week 1");
    assert.doesNotMatch(onW2.button, /open/);
    assert.match(onW2.hint, /without Reveal/);
    const onW3fromW2 = skipControlCopy(leftover2, final3, weeks);
    assert.equal(onW3fromW2.button, "Skip leftover Week 2 / open this week");
    assert.match(onW3fromW2.hint, /open this week/);
    assert.equal(
      skipControlCopy(leftover1, leftover1, [leftover1, w(2, "final")]).button,
      "Skip this week / start next week",
    );

    const stepW1 = leftoverDraftNextStep(leftover1, weeks);
    assert.match(stepW1?.label ?? "", /will not auto-open/);
    assert.match(stepW1?.label ?? "", /without Reveal/);
    assert.doesNotMatch(stepW1?.label ?? "", /start next week/);
    assert.doesNotMatch(stepW1?.label ?? "", /Open cards/);
    assert.doesNotMatch(stepW1?.label ?? "", /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const stepW2 = leftoverDraftNextStep(leftover2, weeks);
    assert.match(stepW2?.label ?? "", /will not auto-open/);
    assert.match(stepW2?.label ?? "", /skip it to start next week/);
    assert.match(
      leftoverDraftNextStep(leftover1, [leftover1, w(2, "final")])?.label ?? "",
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

    assert.equal(selectActiveWeek(leftoverWeeks)?.id, "w3");
    assert.equal(selectActiveWeek(prematureWeeks)?.id, "w3");
    assert.equal(selectActiveWeek(wrapWeeks)?.id, "w2");

    assert.equal(skipTouchesNextWeek(leftover2, leftoverWeeks, leftover1), false);
    assert.equal(skipTouchesNextWeek(premature, prematureWeeks, leftover1), false);
    assert.equal(skipTouchesNextWeek(draft3, leftoverWeeks, leftover2), true);
    assert.equal(skipTouchesNextWeek(wrapNext, wrapWeeks, wrapLeftover), false);
    assert.equal(skipTouchesNextWeek(wrapDraft, wrapWeeks, wrapNext), true);

    assert.equal(shouldOpenExistingNextWeek(leftover2, leftoverWeeks, leftover1), false);
    assert.equal(shouldOpenExistingNextWeek(premature, prematureWeeks, leftover1), false);
    assert.equal(shouldOpenExistingNextWeek(draft3, leftoverWeeks, leftover2), true);
    assert.equal(shouldOpenExistingNextWeek(wrapNext, wrapWeeks, wrapLeftover), false);

    const closeW1draft = skipLandingWeek(leftoverWeeks, leftover1);
    assert.equal(closeW1draft?.id, "w3");
    assert.equal(closeW1draft?.status, "draft");
    const closeW1premature = skipLandingWeek(prematureWeeks, leftover1);
    assert.equal(closeW1premature?.id, "w3");
    assert.equal(closeW1premature?.status, "draft");
    const openW3 = skipLandingWeek(leftoverWeeks, leftover2);
    assert.equal(openW3?.id, "w3");
    assert.equal(openW3?.status, "open");
    assert.equal(skipLandingWeek(wrapWeeks, wrapLeftover)?.id, "w2");
    assert.equal(skipLandingWeek(wrapWeeks, wrapLeftover)?.status, "draft");
    assert.equal(skipLandingWeek(wrapWeeks, wrapNext)?.id, "w2");
    assert.equal(skipLandingWeek(wrapWeeks, wrapNext)?.status, "open");

    const onW1 = skipControlCopy(leftover1, leftover1, leftoverWeeks);
    assert.equal(onW1.button, "Skip this week");
    assert.doesNotMatch(onW1.button, /next week|open/i);
    assert.match(onW1.hint, /without Reveal/);
    const onPremature = skipControlCopy(leftover1, leftover1, prematureWeeks);
    assert.equal(onPremature.button, "Skip this week");
    assert.doesNotMatch(onPremature.button, /next week|open/i);
    const onW3fromW2 = skipControlCopy(leftover2, draft3, leftoverWeeks);
    assert.equal(onW3fromW2.button, "Skip leftover Week 2 / open this week");
    assert.match(onW3fromW2.hint, /open this week/);

    const stepW1 = leftoverDraftNextStep(leftover1, leftoverWeeks);
    assert.match(stepW1?.label ?? "", /will not auto-open/);
    assert.match(stepW1?.label ?? "", /without Reveal/);
    assert.doesNotMatch(stepW1?.label ?? "", /start next week/);
    const stepPremature = leftoverDraftNextStep(leftover1, prematureWeeks);
    assert.match(stepPremature?.label ?? "", /without Reveal/);
    assert.doesNotMatch(stepPremature?.label ?? "", /start next week/);
    const stepW2 = leftoverDraftNextStep(leftover2, leftoverWeeks);
    assert.match(stepW2?.label ?? "", /will not auto-open/);
    assert.match(stepW2?.label ?? "", /skip it to start next week/);
  });

  it("skip landing jumps to the post-skip active week instead of staying on leftover", () => {
    const leftover = wr("w1", 1, "draft");
    const premature = wr("w2", 2, "final");
    const open3 = wr("w3", 3, "open");
    const locked3 = wr("w3", 3, "locked");
    const draft3 = wr("w3", 3, "draft");
    const open2 = wr("w2", 2, "open");

    assert.equal(skipLandingWeek([leftover, premature, open3], leftover)?.id, "w3");
    assert.equal(skipLandingWeek([leftover, premature, locked3], leftover)?.id, "w3");
    assert.equal(skipLandingWeek([leftover, premature, open3], leftover)?.status, "open");

    const reopen = skipLandingWeek([leftover, premature], leftover);
    assert.equal(reopen?.id, "w2");
    assert.equal(reopen?.status, "open");
    assert.equal(reopen?.finalized_at, null);

    assert.equal(skipLandingWeek([leftover, open2], leftover)?.id, "w2");
    assert.equal(skipLandingWeek([leftover, open2], leftover)?.status, "open");

    const reopenWithDraft3 = skipLandingWeek([leftover, premature, draft3], leftover);
    assert.equal(reopenWithDraft3?.id, "w3");
    assert.equal(reopenWithDraft3?.status, "draft");

    const only = skipLandingWeek([leftover], leftover);
    assert.equal(only?.id, "w1");
    assert.equal(only?.status, "final");
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

    assert.equal(selectActiveWeek(weeks)?.id, "w1");
    assert.equal(weekSwitcherLabel(thisSunday, selectActiveWeek(weeks)), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, selectActiveWeek(weeks)), "Next week");
    assert.equal(pickViewWeek(weeks, selectActiveWeek(weeks), "next")?.id, "w2");
    assert.equal(selectActiveWeek([thisSunday, nextDraft])?.status, "open");
    assert.equal(selectActiveWeek([lockedSunday, nextDraft])?.status, "locked");

    assert.equal(skipTouchesNextWeek(nextDraft, weeks, thisSunday), true);
    assert.equal(skipTouchesNextWeek(laterDraft, weeks, nextDraft), false);
    assert.equal(skipTouchesNextWeek(laterDraft, withLater, nextDraft), false);
    assert.equal(skipTouchesNextWeek(nextDraft, weeks), false);
    assert.equal(shouldOpenExistingNextWeek(nextDraft, weeks, thisSunday), true);
    assert.equal(shouldOpenExistingNextWeek(nextDraft, weeks), false);
    assert.equal(shouldOpenExistingNextWeek(laterDraft, withLater, nextDraft), false);

    const skipThisSunday = skipLandingWeek(weeks, thisSunday);
    assert.equal(skipThisSunday?.id, "w2");
    assert.equal(skipThisSunday?.status, "open");
    assert.equal(weekSwitcherLabel(nextDraft, skipThisSunday), "This Sunday");

    const skipNext = skipLandingWeek(weeks, nextDraft);
    assert.equal(skipNext?.id, "w1");
    assert.equal(skipNext?.status, "open");
    assert.equal(weekSwitcherLabel(thisSunday, skipNext), "This Sunday");
    assert.notEqual(skipLandingWeek(weeks, nextDraft)?.week_number, 3);
    assert.equal(skipLandingWeek(withLater, nextDraft)?.id, "w1");
    assert.equal(skipLandingWeek(withLater, nextDraft)?.status, "open");
    assert.equal(skipLandingWeek([lockedSunday, nextDraft], nextDraft)?.id, "w1l");
    assert.equal(skipLandingWeek([lockedSunday, nextDraft], nextDraft)?.status, "locked");
    assert.equal(skipLandingWeek([lockedSunday, nextDraft], lockedSunday)?.id, "w2");
    assert.equal(skipLandingWeek([lockedSunday, nextDraft], lockedSunday)?.status, "open");

    const onThisSunday = skipControlCopy(thisSunday, thisSunday, weeks);
    assert.equal(onThisSunday.button, "Skip this week / start next week");
    assert.match(onThisSunday.hint, /without Reveal/);
    assert.doesNotMatch(onThisSunday.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    const onNext = skipControlCopy(nextDraft, nextDraft, weeks);
    assert.equal(onNext.button, "Skip this week");
    assert.doesNotMatch(onNext.button, /next week|open/i);
    assert.match(onNext.hint, /without Reveal/);
    assert.doesNotMatch(onNext.hint, /open next/);
    const onLater = skipControlCopy(nextDraft, laterDraft, withLater);
    assert.equal(onLater.button, "Skip leftover Week 2");
    assert.doesNotMatch(onLater.button, /open/);
    assert.match(onLater.hint, /without Reveal/);
    const gapStep = leftoverDraftNextStep(nextDraft, withLater);
    assert.match(gapStep?.label ?? "", /will not auto-open/);
    assert.match(gapStep?.label ?? "", /without Reveal/);
    assert.doesNotMatch(gapStep?.label ?? "", /start next week/);
    assert.doesNotMatch(gapStep?.label ?? "", /Open cards/);

    const wrapWeeks = [wrapSunday, wrapNext];
    assert.equal(selectActiveWeek(wrapWeeks)?.id, "w18");
    assert.equal(weekSwitcherLabel(wrapSunday, selectActiveWeek(wrapWeeks)), "This Sunday");
    assert.equal(weekSwitcherLabel(wrapNext, selectActiveWeek(wrapWeeks)), "Next week");
    assert.equal(skipTouchesNextWeek(wrapNext, wrapWeeks, wrapSunday), true);
    assert.equal(
      skipTouchesNextWeek({ season_year: 2026, week_number: 2 }, wrapWeeks, wrapNext),
      false,
    );
    assert.equal(skipLandingWeek(wrapWeeks, wrapSunday)?.id, "w1");
    assert.equal(skipLandingWeek(wrapWeeks, wrapSunday)?.status, "open");
    assert.equal(skipLandingWeek(wrapWeeks, wrapNext)?.id, "w18");
    assert.equal(skipLandingWeek(wrapWeeks, wrapNext)?.status, "locked");
    assert.equal(skipControlCopy(wrapSunday, wrapSunday, wrapWeeks).button, "Skip this week / start next week");
    assert.equal(skipControlCopy(wrapNext, wrapNext, wrapWeeks).button, "Skip this week");
    assert.doesNotMatch(skipControlCopy(wrapNext, wrapNext, wrapWeeks).button, /next week|open/i);
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

    assert.equal(selectActiveWeek(weeks)?.id, "w1");
    assert.equal(weekSwitcherLabel(nextDraft, selectActiveWeek(weeks)), "Next week");
    assert.equal(weekSwitcherLabel(laterDraft, selectActiveWeek(weeks)), "Week 3");
    assert.equal(selectActiveWeek(lockedWeeks)?.id, "w1l");

    assert.equal(skipTouchesNextWeek(nextDraft, weeks, thisSunday), true);
    assert.equal(skipTouchesNextWeek(nextDraft, lockedWeeks, lockedSunday), true);
    assert.equal(skipTouchesNextWeek(wrapNext, wrapWeeks, wrapSunday), true);
    assert.equal(shouldOpenExistingNextWeek(nextDraft, weeks, thisSunday), true);
    assert.equal(shouldOpenExistingNextWeek(nextDraft, lockedWeeks, lockedSunday), true);
    assert.equal(shouldOpenExistingNextWeek(wrapNext, wrapWeeks, wrapSunday), true);

    const landing = skipLandingWeek(weeks, thisSunday);
    assert.equal(landing?.id, "w2");
    assert.equal(landing?.status, "open");
    assert.equal(weekSwitcherLabel(laterDraft, landing), "Next week");
    assert.equal(skipLandingWeek(lockedWeeks, lockedSunday)?.id, "w2");
    assert.equal(skipLandingWeek(lockedWeeks, lockedSunday)?.status, "open");
    assert.equal(skipLandingWeek(wrapWeeks, wrapSunday)?.id, "w1");
    assert.equal(skipLandingWeek(wrapWeeks, wrapSunday)?.status, "open");

    const onThisSunday = skipControlCopy(thisSunday, thisSunday, weeks);
    assert.equal(onThisSunday.button, "Skip this week / start next week");
    assert.match(onThisSunday.hint, /without Reveal/);
    assert.doesNotMatch(onThisSunday.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.equal(
      skipControlCopy(lockedSunday, lockedSunday, lockedWeeks).button,
      "Skip this week / start next week",
    );
    assert.equal(
      skipControlCopy(wrapSunday, wrapSunday, wrapWeeks).button,
      "Skip this week / start next week",
    );

    assert.equal(skipTouchesNextWeek(nextDraft, leftoverWeeks, leftoverDraft), false);
    assert.equal(shouldOpenExistingNextWeek(nextDraft, leftoverWeeks, leftoverDraft), false);
    assert.equal(skipLandingWeek(leftoverWeeks, leftoverDraft)?.id, "w3");
    assert.equal(skipLandingWeek(leftoverWeeks, leftoverDraft)?.status, "draft");
    assert.equal(skipControlCopy(leftoverDraft, leftoverDraft, leftoverWeeks).button, "Skip this week");
    assert.doesNotMatch(
      skipControlCopy(leftoverDraft, leftoverDraft, leftoverWeeks).button,
      /next week|open/i,
    );

    assert.equal(skipLandingWeek(weeks, nextDraft)?.id, "w1");
    assert.equal(skipLandingWeek(weeks, nextDraft)?.status, "open");
    assert.equal(skipTouchesNextWeek(laterDraft, weeks, nextDraft), false);
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

    assert.equal(selectActiveWeek(weeks)?.id, "w1");
    assert.equal(weekSwitcherLabel(thisSunday, selectActiveWeek(weeks)), "This Sunday");
    assert.equal(weekSwitcherLabel(prematureNext, selectActiveWeek(weeks)), "Week 2");
    assert.equal(weekSwitcherLabel(laterDraft, selectActiveWeek(weeks)), "Week 3");
    assert.equal(selectActiveWeek(lockedWeeks)?.id, "w1l");

    assert.equal(skipTouchesNextWeek(prematureNext, weeks, thisSunday), true);
    assert.equal(skipTouchesNextWeek(prematureNext, lockedWeeks, lockedSunday), true);
    assert.equal(skipTouchesNextWeek(wrapNext, wrapWeeks, wrapSunday), true);
    assert.equal(shouldOpenExistingNextWeek(prematureNext, weeks, thisSunday), true);
    assert.equal(shouldOpenExistingNextWeek(prematureNext, lockedWeeks, lockedSunday), true);
    assert.equal(shouldOpenExistingNextWeek(wrapNext, wrapWeeks, wrapSunday), true);

    const landing = skipLandingWeek(weeks, thisSunday);
    assert.equal(landing?.id, "w2");
    assert.equal(landing?.status, "open");
    assert.equal(landing?.finalized_at, null);
    assert.equal(weekSwitcherLabel(landing!, landing), "This Sunday");
    assert.equal(weekSwitcherLabel(laterDraft, landing), "Next week");

    const lockedLanding = skipLandingWeek(lockedWeeks, lockedSunday);
    assert.equal(lockedLanding?.id, "w2");
    assert.equal(lockedLanding?.status, "open");
    assert.equal(lockedLanding?.finalized_at, null);

    const wrapLanding = skipLandingWeek(wrapWeeks, wrapSunday);
    assert.equal(wrapLanding?.id, "w1");
    assert.equal(wrapLanding?.status, "open");
    assert.equal(wrapLanding?.season_year, 2026);
    assert.equal(wrapLanding?.finalized_at, null);

    const onThisSunday = skipControlCopy(thisSunday, thisSunday, weeks);
    assert.equal(onThisSunday.button, "Skip this week / start next week");
    assert.match(onThisSunday.hint, /without Reveal/);
    assert.match(onThisSunday.hint, /Tuesday/);
    assert.doesNotMatch(onThisSunday.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.doesNotMatch(onThisSunday.hint, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.equal(
      skipControlCopy(lockedSunday, lockedSunday, lockedWeeks).button,
      "Skip this week / start next week",
    );
    assert.equal(
      skipControlCopy(wrapSunday, wrapSunday, wrapWeeks).button,
      "Skip this week / start next week",
    );

    assert.equal(skipTouchesNextWeek(prematureNext, leftoverWeeks, leftoverDraft), false);
    assert.equal(shouldOpenExistingNextWeek(prematureNext, leftoverWeeks, leftoverDraft), false);
    assert.equal(skipLandingWeek(leftoverWeeks, leftoverDraft)?.id, "w3");
    assert.equal(skipLandingWeek(leftoverWeeks, leftoverDraft)?.status, "draft");
    assert.equal(skipControlCopy(leftoverDraft, leftoverDraft, leftoverWeeks).button, "Skip this week");
    assert.doesNotMatch(
      skipControlCopy(leftoverDraft, leftoverDraft, leftoverWeeks).button,
      /next week|open/i,
    );

    const noLater = [thisSunday, prematureNext];
    const noLaterLanding = skipLandingWeek(noLater, thisSunday);
    assert.equal(skipTouchesNextWeek(prematureNext, noLater, thisSunday), true);
    assert.equal(shouldOpenExistingNextWeek(prematureNext, noLater, thisSunday), true);
    assert.equal(noLaterLanding?.id, "w2");
    assert.equal(noLaterLanding?.status, "open");
    assert.equal(noLaterLanding?.finalized_at, null);

    const harperSunday = wr("3e3aeeeb", 1, "open");
    const harperPremature = {
      ...wr("52a42a9e", 2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    };
    const harperWeeks = [harperSunday, harperPremature];
    assert.equal(selectActiveWeek(harperWeeks)?.id, "3e3aeeeb");
    const harperLanding = skipLandingWeek(harperWeeks, harperSunday);
    assert.equal(harperLanding?.id, "52a42a9e");
    assert.equal(harperLanding?.status, "open");
    assert.equal(harperLanding?.finalized_at, null);
    assert.equal(weekSwitcherLabel(harperLanding!, harperLanding), "This Sunday");

    const skipped = wr("w1s", 1, "final");
    const inPlace = skipLandingWeek([skipped, prematureNext], prematureNext);
    assert.equal(inPlace?.id, "w2");
    assert.equal(inPlace?.status, "final");
    assert.equal(inPlace?.finalized_at, "2026-09-15T19:04:43.880Z");
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

    assert.equal(selectActiveWeek(weeks)?.id, "w1");
    assert.equal(selectActiveWeek(weeks)?.status, "open");
    assert.equal(weekSwitcherLabel(thisSunday, selectActiveWeek(weeks)), "This Sunday");
    assert.equal(weekSwitcherLabel(completedNext, selectActiveWeek(weeks)), "Week 2");
    assert.notEqual(weekSwitcherLabel(completedNext, selectActiveWeek(weeks)), "This Sunday");
    assert.notEqual(weekSwitcherLabel(completedNext, selectActiveWeek(weeks)), "Next week");
    assert.equal(selectActiveWeek(lockedWeeks)?.id, "w1l");
    assert.equal(selectActiveWeek(wrapWeeks)?.id, "w18");
    assert.equal(selectActiveWeek([harperSunday, harperCompleted])?.id, "3e3aeeeb");

    assert.equal(skipTargetWeek(weeks, thisSunday)?.id, "w1");
    assert.equal(skipTargetWeek(weeks, completedNext), null);
    assert.equal(skipTouchesNextWeek(completedNext, weeks, thisSunday), false);
    assert.equal(skipTouchesNextWeek(completedNext, lockedWeeks, lockedSunday), false);
    assert.equal(skipTouchesNextWeek(wrapCompleted, wrapWeeks, wrapSunday), false);
    assert.equal(shouldOpenExistingNextWeek(completedNext, weeks, thisSunday), false);
    assert.equal(shouldOpenExistingNextWeek(completedNext, lockedWeeks, lockedSunday), false);
    assert.equal(shouldOpenExistingNextWeek(wrapCompleted, wrapWeeks, wrapSunday), false);
    assert.equal(skipClearsCalledMoments(completedNext), true);

    const landing = skipLandingWeek(weeks, thisSunday);
    assert.equal(landing?.id, "w2");
    assert.equal(landing?.status, "final");
    assert.equal(landing?.finalized_at, "2026-09-16T16:00:00.000Z");
    assert.equal(weekSwitcherLabel(landing!, landing), "Week 2");
    assert.notEqual(weekSwitcherLabel(landing!, landing), "This Sunday");
    assert.equal(selectActiveWeek([w(1, "final"), completedNext])?.id, "w2");
    assert.equal(selectActiveWeek([w(1, "final"), completedNext])?.status, "final");

    const lockedLanding = skipLandingWeek(lockedWeeks, lockedSunday);
    assert.equal(lockedLanding?.id, "w2");
    assert.equal(lockedLanding?.status, "final");
    assert.equal(lockedLanding?.finalized_at, "2026-09-16T16:00:00.000Z");

    const wrapLanding = skipLandingWeek(wrapWeeks, wrapSunday);
    assert.equal(wrapLanding?.id, "w1");
    assert.equal(wrapLanding?.status, "final");
    assert.equal(wrapLanding?.season_year, 2026);
    assert.equal(wrapLanding?.finalized_at, "2026-09-16T16:00:00.000Z");

    const harperLanding = skipLandingWeek([harperSunday, harperCompleted], harperSunday);
    assert.equal(harperLanding?.id, "52a42a9e");
    assert.equal(harperLanding?.status, "final");
    assert.equal(harperLanding?.finalized_at, "2026-09-16T16:00:00.000Z");

    const onThisSunday = skipControlCopy(thisSunday, thisSunday, weeks);
    assert.equal(onThisSunday.button, "Skip this week");
    assert.doesNotMatch(onThisSunday.button, /next week|open/i);
    assert.match(onThisSunday.hint, /without Reveal/);
    assert.match(onThisSunday.hint, /Tuesday/);
    assert.doesNotMatch(onThisSunday.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.doesNotMatch(onThisSunday.hint, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.equal(skipControlCopy(lockedSunday, lockedSunday, lockedWeeks).button, "Skip this week");
    assert.equal(skipControlCopy(wrapSunday, wrapSunday, wrapWeeks).button, "Skip this week");

    const withLater = [thisSunday, completedNext, laterDraft];
    assert.equal(selectActiveWeek(withLater)?.id, "w1");
    assert.equal(skipTouchesNextWeek(completedNext, withLater, thisSunday), false);
    assert.equal(skipLandingWeek(withLater, thisSunday)?.id, "w3");
    assert.equal(skipLandingWeek(withLater, thisSunday)?.status, "draft");
    assert.equal(selectActiveWeek([w(1, "final"), completedNext, laterDraft])?.id, "w3");

    assert.equal(skipTouchesNextWeek(completedNext, [leftoverDraft, completedNext], leftoverDraft), false);
    const leftoverLanding = skipLandingWeek([leftoverDraft, completedNext], leftoverDraft);
    assert.equal(leftoverLanding?.id, "w2");
    assert.equal(leftoverLanding?.status, "final");
    assert.equal(leftoverLanding?.finalized_at, "2026-09-16T16:00:00.000Z");
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

    assert.equal(selectActiveWeek(weeks)?.id, "w2");
    assert.equal(selectActiveWeek(weeks)?.status, "final");
    assert.equal(weekSwitcherLabel(completedNext, selectActiveWeek(weeks)), "Week 2");
    assert.notEqual(weekSwitcherLabel(completedNext, selectActiveWeek(weeks)), "This Sunday");
    assert.notEqual(weekSwitcherLabel(completedNext, selectActiveWeek(weeks)), "Next week");
    assert.equal(weekSwitcherLabel(leftoverDraft, selectActiveWeek(weeks)), "Week 1");
    assert.equal(selectActiveWeek(wrapWeeks)?.id, "w1");
    assert.equal(selectActiveWeek(harperWeeks)?.id, "52a42a9e");

    assert.equal(skipTargetWeek(weeks, leftoverDraft)?.id, "w1d");
    assert.equal(skipTargetWeek(weeks, completedNext)?.id, "w1d");
    assert.equal(skipTouchesNextWeek(completedNext, weeks, leftoverDraft), false);
    assert.equal(skipTouchesNextWeek(completedNext, weeks), false);
    assert.equal(skipTouchesNextWeek(wrapCompleted, wrapWeeks, wrapLeftover), false);
    assert.equal(skipTouchesNextWeek(harperCompleted, harperWeeks, harperDraft), false);
    assert.equal(shouldOpenExistingNextWeek(completedNext, weeks, leftoverDraft), false);
    assert.equal(shouldOpenExistingNextWeek(wrapCompleted, wrapWeeks, wrapLeftover), false);
    assert.equal(shouldOpenExistingNextWeek(harperCompleted, harperWeeks, harperDraft), false);
    assert.equal(skipClearsCalledMoments(completedNext), true);

    const landing = skipLandingWeek(weeks, leftoverDraft);
    assert.equal(landing?.id, "w2");
    assert.equal(landing?.status, "final");
    assert.equal(landing?.finalized_at, "2026-09-16T16:00:00.000Z");
    assert.equal(weekSwitcherLabel(landing!, landing), "Week 2");
    assert.notEqual(weekSwitcherLabel(landing!, landing), "This Sunday");
    assert.equal(selectActiveWeek([w(1, "final"), completedNext])?.id, "w2");
    assert.equal(selectActiveWeek([w(1, "final"), completedNext])?.status, "final");

    const wrapLanding = skipLandingWeek(wrapWeeks, wrapLeftover);
    assert.equal(wrapLanding?.id, "w1");
    assert.equal(wrapLanding?.status, "final");
    assert.equal(wrapLanding?.season_year, 2026);
    assert.equal(wrapLanding?.finalized_at, "2026-09-16T16:00:00.000Z");

    const harperLanding = skipLandingWeek(harperWeeks, harperDraft);
    assert.equal(harperLanding?.id, "52a42a9e");
    assert.equal(harperLanding?.status, "final");
    assert.equal(harperLanding?.finalized_at, "2026-09-16T16:00:00.000Z");

    const onLeftover = skipControlCopy(leftoverDraft, leftoverDraft, weeks);
    assert.equal(onLeftover.button, "Skip this week");
    assert.doesNotMatch(onLeftover.button, /next week|open/i);
    assert.match(onLeftover.hint, /without Reveal/);
    assert.match(onLeftover.hint, /Tuesday/);
    assert.doesNotMatch(onLeftover.button, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.doesNotMatch(onLeftover.hint, /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i);
    assert.equal(skipControlCopy(leftoverDraft, completedNext, weeks).button, "Skip leftover Week 1");
    assert.doesNotMatch(
      skipControlCopy(leftoverDraft, completedNext, weeks).button,
      /open/i,
    );
    assert.equal(skipControlCopy(wrapLeftover, wrapLeftover, wrapWeeks).button, "Skip this week");
    const leftoverStep = leftoverDraftNextStep(leftoverDraft, weeks);
    assert.match(leftoverStep?.label ?? "", /will not auto-open/);
    assert.match(leftoverStep?.label ?? "", /without Reveal/);
    assert.doesNotMatch(leftoverStep?.label ?? "", /start next week/);
    assert.doesNotMatch(leftoverStep?.label ?? "", /Open cards/);

    const withLater = [leftoverDraft, completedNext, laterDraft];
    assert.equal(selectActiveWeek(withLater)?.id, "w3");
    assert.equal(skipTouchesNextWeek(completedNext, withLater, leftoverDraft), false);
    assert.equal(skipLandingWeek(withLater, leftoverDraft)?.id, "w3");
    assert.equal(skipLandingWeek(withLater, leftoverDraft)?.status, "draft");
    assert.equal(skipControlCopy(leftoverDraft, leftoverDraft, withLater).button, "Skip this week");
    assert.doesNotMatch(
      skipControlCopy(leftoverDraft, leftoverDraft, withLater).button,
      /next week|open/i,
    );

    const prematureWeeks = [leftoverDraft, prematureNext];
    assert.equal(skipTouchesNextWeek(prematureNext, prematureWeeks, leftoverDraft), true);
    assert.equal(shouldOpenExistingNextWeek(prematureNext, prematureWeeks, leftoverDraft), true);
    const prematureLanding = skipLandingWeek(prematureWeeks, leftoverDraft);
    assert.equal(prematureLanding?.id, "w2p");
    assert.equal(prematureLanding?.status, "open");
    assert.equal(prematureLanding?.finalized_at, null);
    assert.equal(
      skipControlCopy(leftoverDraft, leftoverDraft, prematureWeeks).button,
      "Skip this week / start next week",
    );
  });

  it("skip refreshes a past lock so Tuesday reopen stays playable", () => {
    const now = Date.parse("2026-09-15T16:00:00.000Z");
    assert.equal(skipLockNeedsRefresh("2026-09-13T17:00:00.000Z", now), true);
    assert.equal(skipLockNeedsRefresh("2026-09-20T17:00:00.000Z", now), false);
    assert.equal(skipLockNeedsRefresh(null, now), false);
  });

  it("skip keeps a future ESPN lock after autofill and only falls back to Sunday when the lock is past", () => {
    const now = Date.parse("2026-09-15T16:00:00.000Z");
    const sunday = "2026-09-20T17:00:00.000Z";
    const thursday = "2026-09-17T00:15:00.000Z";
    assert.equal(skipLockAfterAutofill(thursday, sunday, now), undefined);
    assert.equal(skipLockAfterAutofill(sunday, sunday, now), undefined);
    assert.equal(skipLockAfterAutofill("2026-09-13T17:00:00.000Z", sunday, now), sunday);
    assert.equal(skipLockAfterAutofill(null, sunday, now), undefined);
  });

  it("skip unlocks cards when a past lock is refreshed, not when ESPN kickoff is kept", () => {
    const now = Date.parse("2026-09-15T16:00:00.000Z");
    const sunday = "2026-09-20T17:00:00.000Z";
    const thursday = "2026-09-17T00:15:00.000Z";
    assert.equal(skipUnlocksCards(w(2, "open")), false);
    assert.equal(
      skipUnlocksCardsOnLockRefresh(skipLockAfterAutofill("2026-09-13T17:00:00.000Z", sunday, now)),
      true,
    );
    assert.equal(skipUnlocksCardsOnLockRefresh(skipLockAfterAutofill(thursday, sunday, now)), false);
    assert.equal(skipUnlocksCardsOnLockRefresh(undefined), false);
    assert.equal(skipUnlocksCardsOnLockRefresh(null), false);
    assert.equal(skipUnlocksCardsOnLockRefresh(""), false);
    assert.equal(skipUnlocksCardsOnLockRefresh(sunday), true);
  });

  it("returns null for an empty list", () => {
    assert.equal(selectActiveWeek([]), null);
  });

  it("an older-season locked week still beats a newer-season draft", () => {
    const picked = selectActiveWeek([w(18, "locked", 2025), w(1, "draft", 2026)]);
    assert.equal(picked?.season_year, 2025);
    assert.equal(picked?.status, "locked");
  });

  it("never prefers an older leftover draft over a newer week across seasons", () => {
    const leftover = w(18, "draft", 2025);
    const nextFinal = w(1, "final", 2026);
    assert.equal(selectActiveWeek([leftover, nextFinal])?.season_year, 2026);
    assert.equal(selectActiveWeek([nextFinal, leftover])?.season_year, 2026);
    assert.equal(selectActiveWeek([leftover, nextFinal])?.week_number, 1);
    assert.equal(selectActiveWeek([leftover, w(1, "open", 2026)])?.season_year, 2026);
    assert.equal(selectActiveWeek([leftover, w(1, "draft", 2026)])?.season_year, 2026);
    const newerDraft = w(1, "draft", 2026);
    const priorFinal = w(18, "final", 2025);
    assert.equal(selectActiveWeek([newerDraft, priorFinal])?.season_year, 2026);
    assert.equal(selectActiveWeek([priorFinal, newerDraft])?.season_year, 2026);
    assert.equal(selectActiveWeek([newerDraft, priorFinal])?.week_number, 1);
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

  it("labels This Sunday by recency slot so a leftover draft cannot steal it", () => {
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const sameSlotCopy = wr("other-w2", 2, "open");
    const active = selectActiveWeek([leftover, open]);
    assert.equal(active?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, active), "This Sunday");
    assert.equal(weekSwitcherLabel(sameSlotCopy, active), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, active), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, active), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, active), "Next week");
    assert.equal(weekSwitcherLabel(wr("copy-w1", 1, "open"), wr("w1", 1, "open")), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, leftover), "Week 1");
  });

  it("labels Next week across the season wrap", () => {
    const wrapLocked = wr("w18", 18, "locked", 2025);
    const wrapDraft = wr("w1", 1, "draft", 2026);
    const active = selectActiveWeek([wrapLocked, wrapDraft]);
    assert.equal(active?.id, "w18");
    assert.equal(weekSwitcherLabel(wrapLocked, active), "This Sunday");
    assert.equal(weekSwitcherLabel(wrapDraft, active), "Next week");
    assert.equal(pickViewWeek([wrapLocked, wrapDraft], active, "next")?.id, "w1");
  });

  it("defaults to the active week; next or an id reaches the newer draft", () => {
    const active = selectActiveWeek(weeks);
    assert.equal(active?.id, "w1");
    assert.equal(pickViewWeek(weeks, active, null)?.id, "w1");
    assert.equal(pickViewWeek(weeks, active, "next")?.id, "w2");
    assert.equal(pickViewWeek(weeks, active, "w2")?.id, "w2");
    assert.equal(selectActiveWeek(weeks)?.status, "locked");
  });

  it("labels Next week only on the next slot so a later draft cannot steal it", () => {
    const open = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const laterDraft = wr("w3", 3, "draft");
    const weeksWithLater = [open, nextDraft, laterDraft];
    const active = selectActiveWeek(weeksWithLater);
    assert.equal(active?.id, "w1");
    assert.equal(weekSwitcherLabel(open, active), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, active), "Next week");
    assert.equal(weekSwitcherLabel(laterDraft, active), "Week 3");
    assert.notEqual(weekSwitcherLabel(laterDraft, active), "Next week");
    assert.equal(pickViewWeek(weeksWithLater, active, "next")?.id, "w2");
    assert.equal(pickViewWeek([open, laterDraft], active, "next")?.id, "w1");
    assert.notEqual(pickViewWeek([open, laterDraft], active, "next")?.id, "w3");
    assert.equal(weekSwitcherLabel(laterDraft, selectActiveWeek([open, laterDraft])), "Week 3");
  });

  it("pickViewWeek next stays on the next slot so a later leftover cannot steal it", () => {
    const open = wr("w1", 1, "open");
    const premature = wr("w2", 2, "final");
    const lockedNext = wr("w2l", 2, "locked");
    const laterDraft = wr("w3", 3, "draft");
    const active = selectActiveWeek([open, premature, laterDraft]);
    assert.equal(active?.id, "w1");
    assert.equal(pickViewWeek([open, premature, laterDraft], active, "next")?.id, "w1");
    assert.notEqual(pickViewWeek([open, premature, laterDraft], active, "next")?.id, "w3");
    assert.equal(weekSwitcherLabel(laterDraft, active), "Week 3");
    assert.notEqual(weekSwitcherLabel(laterDraft, active), "Next week");
    assert.equal(weekSwitcherLabel(premature, active), "Week 2");
    assert.equal(pickViewWeek([open, wr("w2d", 2, "draft"), laterDraft], active, "next")?.id, "w2d");
    assert.equal(pickViewWeek([open, laterDraft], active, "next")?.id, "w1");
    assert.notEqual(pickViewWeek([open, laterDraft], active, "next")?.id, "w3");
    const fartherDraft = wr("w4", 4, "draft");
    assert.equal(pickViewWeek([open, laterDraft, fartherDraft], active, "next")?.id, "w1");
    assert.equal(pickViewWeek([open, fartherDraft, laterDraft], active, "next")?.id, "w1");
    assert.equal(pickViewWeek([open, fartherDraft], active, "next")?.id, "w1");
    assert.notEqual(pickViewWeek([open, fartherDraft], active, "next")?.id, "w4");
    assert.equal(selectActiveWeek([open, lockedNext, laterDraft])?.id, "w2l");
    assert.equal(
      pickViewWeek([open, lockedNext, laterDraft], selectActiveWeek([open, lockedNext, laterDraft]), "next")
        ?.id,
      "w3",
    );
  });

  it("pickViewWeek next stays on the in-play week when a nearer leftover sits in the gap", () => {
    const open = wr("w1", 1, "open");
    const gapFinal = wr("w3", 3, "final");
    const laterDraft = wr("w4", 4, "draft");
    const weeks = [open, gapFinal, laterDraft];
    const reverse = [laterDraft, gapFinal, open];
    const active = selectActiveWeek(weeks);
    assert.equal(active?.id, "w1");
    assert.equal(selectActiveWeek(reverse)?.id, "w1");
    assert.equal(pickViewWeek(weeks, active, "next")?.id, "w1");
    assert.equal(pickViewWeek(reverse, active, "next")?.id, "w1");
    assert.notEqual(pickViewWeek(weeks, active, "next")?.id, "w4");
    assert.equal(weekSwitcherLabel(gapFinal, active), "Week 3");
    assert.equal(weekSwitcherLabel(laterDraft, active), "Week 4");
    assert.notEqual(weekSwitcherLabel(laterDraft, active), "Next week");
    assert.equal(pickViewWeek([open, laterDraft], active, "next")?.id, "w1");
    assert.notEqual(pickViewWeek([open, laterDraft], active, "next")?.id, "w4");
    assert.equal(pickViewWeek([open, wr("w3d", 3, "draft"), laterDraft], active, "next")?.id, "w1");
    assert.notEqual(pickViewWeek([open, wr("w3d", 3, "draft"), laterDraft], active, "next")?.id, "w3d");
    const wrapLocked = wr("w18", 18, "locked", 2025);
    const wrapFinal = wr("w2", 2, "final", 2026);
    const wrapDraft = wr("w3", 3, "draft", 2026);
    const wrapActive = selectActiveWeek([wrapLocked, wrapFinal, wrapDraft]);
    assert.equal(wrapActive?.id, "w18");
    assert.equal(pickViewWeek([wrapLocked, wrapFinal, wrapDraft], wrapActive, "next")?.id, "w18");
    assert.notEqual(pickViewWeek([wrapLocked, wrapFinal, wrapDraft], wrapActive, "next")?.id, "w3");
    assert.equal(pickViewWeek([wrapLocked, wrapDraft], wrapActive, "next")?.id, "w18");
    assert.notEqual(pickViewWeek([wrapLocked, wrapDraft], wrapActive, "next")?.id, "w3");
  });

  it("pickViewWeek next stays on This Sunday when the next slot is missing", () => {
    const open = wr("w1", 1, "open");
    const laterDraft = wr("w3", 3, "draft");
    const fartherDraft = wr("w4", 4, "draft");
    const active = selectActiveWeek([open, laterDraft, fartherDraft]);
    assert.equal(active?.id, "w1");
    assert.equal(weekSwitcherLabel(open, active), "This Sunday");
    assert.equal(weekSwitcherLabel(laterDraft, active), "Week 3");
    assert.notEqual(weekSwitcherLabel(laterDraft, active), "Next week");
    assert.equal(pickViewWeek([open, laterDraft], active, "next")?.id, "w1");
    assert.equal(pickViewWeek([open, laterDraft, fartherDraft], active, "next")?.id, "w1");
    assert.equal(pickViewWeek([fartherDraft, laterDraft, open], active, "next")?.id, "w1");
    assert.equal(pickViewWeek([open, laterDraft], active, "w3")?.id, "w3");
    const wrapLocked = wr("w18", 18, "locked", 2025);
    const wrapDraft = wr("w2", 2, "draft", 2026);
    const wrapActive = selectActiveWeek([wrapLocked, wrapDraft]);
    assert.equal(wrapActive?.id, "w18");
    assert.equal(pickViewWeek([wrapLocked, wrapDraft], wrapActive, "next")?.id, "w18");
    assert.notEqual(pickViewWeek([wrapLocked, wrapDraft], wrapActive, "next")?.id, "w2");
    assert.equal(weekSwitcherLabel(wrapDraft, wrapActive), "Week 2");
    assert.notEqual(weekSwitcherLabel(wrapDraft, wrapActive), "Next week");
  });
});

describe("useCurrentWeek production wiring", () => {
  it("db.ts selects the active week through selectActiveWeek, not LIMIT 1", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/db.ts"), "utf8");
    const fn = src.slice(src.indexOf("export function useCurrentWeek"));
    assert.match(src, /import \{ recency, selectActiveWeek \} from "\.\/current-week"/);
    assert.match(fn, /select:\s*\(weeks\)\s*=>\s*selectActiveWeek\(weeks\)/);
    assert.match(src, /else newest week overall/);
    assert.doesNotMatch(src, /else latest draft/);
    assert.doesNotMatch(src, /open\/locked > draft > final/);
    assert.doesNotMatch(fn.slice(0, fn.indexOf("export function useWeekGames")), /\.limit\(1\)/);
    const fetchStart = src.indexOf("async function fetchHouseholdWeeks");
    const fetchEnd = src.indexOf("export function useHouseholdWeeks");
    assert.ok(fetchStart >= 0 && fetchEnd > fetchStart);
    const fetchBody = src.slice(fetchStart, fetchEnd);
    assert.match(fetchBody, /\.select\("\*"\)/);
    assert.match(fetchBody, /\.order\("season_year"/);
    assert.match(fetchBody, /\.order\("week_number"/);
    assert.match(fetchBody, /never created_at or id/);
    assert.match(fetchBody, /\.sort\(recency\)/);
    assert.match(fetchBody, /mixed string\/number keys cannot skip week_number/);
    assert.doesNotMatch(fetchBody, /\.limit\(/);
    assert.doesNotMatch(fetchBody, /\.order\("created_at"/);
    assert.doesNotMatch(fetchBody, /\.order\("id"/);
  });

  it("family chrome shows the active week number from useCurrentWeek", () => {
    const src = readFileSync(join(process.cwd(), "src/components/bgs/AppShell.tsx"), "utf8");
    assert.match(src, /useProfile/);
    assert.match(src, /familyWeekChrome\(household\?\.name, week\)/);
    assert.match(src, /from "@\/lib\/current-week"/);
    const lib = readFileSync(join(process.cwd(), "src/lib/current-week.ts"), "utf8");
    assert.match(lib, /export function familyWeekChrome/);
    assert.match(lib, /\$\{name\} · Week \$\{week\.week_number\}/);
    const week = readFileSync(join(process.cwd(), "src/routes/_authenticated/week.tsx"), "utf8");
    assert.match(week, /Week \$\{week\.week_number\}/);
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
    assert.match(src, /skipControlCopy/);
    assert.match(src, /skipCopy\.button/);
    assert.match(src, /canSkipWeek/);
    assert.match(src, /skipTargetWeek/);
    assert.match(src, /nextWeekSlot/);
    const lib = readFileSync(join(process.cwd(), "src/lib/current-week.ts"), "utf8");
    assert.match(lib, /Skip this week \/ start next week/);
    assert.match(lib, /Skip leftover Week/);
    assert.match(lib, /without Reveal/);
    assert.match(lib, /Clear leftover marks \/ open this week/);
    const copyFn = lib.slice(
      lib.indexOf("export function skipControlCopy"),
      lib.indexOf("function recoverableFinishedWeek"),
    );
    assert.ok(copyFn.indexOf("skipTouchesNextWeek") >= 0);
    assert.ok(
      copyFn.indexOf("skipTouchesNextWeek") < copyFn.indexOf("Skip this week / start next week"),
      "skip copy must check skipTouchesNextWeek before promising to start next week",
    );
    const touchFn = lib.slice(
      lib.indexOf("export function skipTouchesNextWeek"),
      lib.indexOf("function withStatus"),
    );
    assert.match(touchFn, /hasNewerThan\(next, weeks\)/);
    assert.doesNotMatch(touchFn, /hasNewerNonDraftThan\(next, weeks\)/);
    assert.doesNotMatch(touchFn, /hasNewerInPlayThan\(next, weeks\)/);
    assert.match(touchFn, /weekAtSlot\(weeks,\s*next\)/);
    assert.match(touchFn, /isInPlay\(existing\.status\)/);
    assert.match(touchFn, /leftover/);
    assert.match(touchFn, /hasOlderInPlayThan\(next, remaining\)/);
    assert.ok(
      touchFn.indexOf("hasNewerThan") < touchFn.indexOf("weekAtSlot(weeks, next)"),
      "skip must refuse a newer week before inspecting next itself",
    );
    assert.ok(
      touchFn.indexOf("weekAtSlot(weeks, next)") < touchFn.indexOf("isInPlay(existing.status)"),
      "skip must not reopen next when that slot is already This Sunday",
    );
    assert.ok(
      touchFn.indexOf("isInPlay(existing.status)") < touchFn.indexOf("hasOlderInPlayThan"),
      "skip must not open a farther week when This Sunday remains in play",
    );
    assert.match(touchFn, /isPrematureFinalWeek\(existing,\s*weeks\)/);
    assert.match(touchFn, /finalizedAfterLock\(existing\)/);
    assert.ok(
      touchFn.indexOf("isInPlay(existing.status)") < touchFn.indexOf("isPrematureFinalWeek"),
      "skip must not reopen a completed Next week when leftover is This Sunday",
    );
    assert.ok(
      touchFn.indexOf("isPrematureFinalWeek") < touchFn.indexOf("finalizedAfterLock"),
      "skip must not reopen a Revealed Next week behind leftover draft either",
    );
    assert.ok(
      touchFn.indexOf("finalizedAfterLock") < touchFn.indexOf("hasOlderInPlayThan"),
      "completed Next week must stay final before skip considers a farther week",
    );
    assert.match(copyFn, /button: "Skip this week"/);
    const recoverFn = lib.slice(
      lib.indexOf("function recoverableFinishedWeek"),
      lib.indexOf("export function skipTargetWeek"),
    );
    assert.match(recoverFn, /isPrematureFinalWeek\(target, weeks\)/);
    assert.match(recoverFn, /isUnplayedLeftover\(w\)/);
    assert.doesNotMatch(recoverFn, /w\.status === ["']draft["']/);
    const targetFn = lib.slice(
      lib.indexOf("export function skipTargetWeek"),
      lib.indexOf("function hasPrematureFinalizeLeftover"),
    );
    assert.match(targetFn, /isUnplayedLeftover\(w\)/);
    assert.match(targetFn, /hasNewerInPlayThan\(w, weeks\)/);
    assert.ok(
      targetFn.indexOf("isUnplayedLeftover") < targetFn.indexOf("hasNewerInPlayThan"),
      "leftover extra/empty/abandoned behind This Sunday must close before leftover in-play",
    );
    assert.ok(
      targetFn.indexOf("hasNewerInPlayThan") < targetFn.indexOf("canSkipWeek(viewed)"),
      "leftover in-play behind This Sunday must close before Skip can close the viewed week",
    );
    const unplayedStart = lib.indexOf("function isUnplayedLeftover");
    const unplayedEnd = lib.indexOf("export function shouldAutopilotOpenDraft");
    assert.ok(unplayedStart >= 0 && unplayedEnd > unplayedStart);
    const unplayedFn = lib.slice(unplayedStart, unplayedEnd);
    assert.match(unplayedFn, /!isInPlay\(week\.status\)/);
    assert.match(unplayedFn, /status !== "final"/);
    assert.match(unplayedFn, /empty, or abandoned/);
    const scrubFn = lib.slice(
      lib.indexOf("function skipScrubsLeftoverInPlace"),
      lib.indexOf("export function skipScrubsViewedInPlace"),
    );
    assert.doesNotMatch(scrubFn, /leftover\.status === ["']final["']/);
    assert.match(scrubFn, /isPrematureFinalWeek\(leftover, weeks\)/);
    assert.match(scrubFn, /hasNewerNonDraftThan\(leftover,\s*weeks\)/);
    assert.ok(
      scrubFn.indexOf("hasNewerNonDraftThan") < scrubFn.indexOf("isPrematureFinalWeek"),
      "leftover behind a newer week must close, not scrub in place",
    );
    const skipFn = src.slice(
      src.indexOf("const skipAndStartNext"),
      src.indexOf("const toggleHold"),
    );
    assert.match(skipFn, /skipTargetWeek/);
    assert.match(skipFn, /skipScrubsViewedInPlace\(leftover,\s*week,\s*weeks\)/);
    assert.ok(
      skipFn.indexOf("skipScrubsViewedInPlace") < skipFn.indexOf("canSkipWeek"),
      "scrub premature-final leftover before canSkipWeek so Skip can reopen it",
    );
    assert.match(skipFn, /status:\s*"final"/);
    assert.match(skipFn, /status:\s*"open"/);
    assert.match(skipFn, /skipTouchesNextWeek\(slot,\s*weeks,\s*leftover\)/);
    assert.match(skipFn, /skipLandingWeek\(weeks,\s*leftover\)/);
    assert.match(skipFn, /setViewWeekId\(landing\.id\)/);
    assert.match(skipFn, /shouldOpenExistingNextWeek\(next,\s*weeks,\s*leftover\)/);
    assert.match(skipFn, /finalized_at:\s*null/);
    assert.match(skipFn, /skipUnlocksCards/);
    assert.match(skipFn, /skipUnlocksCardsOnLockRefresh/);
    assert.match(skipFn, /locked_at:\s*null/);
    assert.match(skipFn, /auto_locked_at:\s*null/);
    assert.match(skipFn, /skipClearsCalledMoments/);
    assert.match(skipFn, /result:\s*null/);
    assert.match(skipFn, /weekly_scores/);
    assert.match(skipFn, /skipClearsGameOutcomes/);
    assert.match(skipFn, /home_score:\s*null/);
    assert.match(skipFn, /away_score:\s*null/);
    assert.match(skipFn, /upset_won:\s*null/);
    assert.ok(
      skipFn.indexOf("shouldOpenExistingNextWeek") < skipFn.lastIndexOf("leftover.id"),
      "open next before closing leftover so a leftover-close failure still leaves a playable week",
    );
    assert.match(skipFn, /skipLockAfterAutofill/);
    assert.match(skipFn, /select\("lock_at"\)/);
    assert.ok(
      skipFn.indexOf("runAutoFill") < skipFn.indexOf("lockAfterAutofill("),
      "autofill before Sunday lock fallback so ESPN earliest kickoff wins",
    );
    assert.doesNotMatch(skipFn, /skipLockNeedsRefresh\(next\.lock_at\)/);
    assert.doesNotMatch(skipFn, /next\?\.status === "draft"/);
    assert.doesNotMatch(skipFn, /finalize:\s*true/);
    assert.doesNotMatch(skipFn, /runRecompute/);
    assert.doesNotMatch(skipFn, /Head to the Reveal/);
  });

  it("commissioner hides Open cards on leftover drafts behind a newer week", () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"),
      "utf8",
    );
    assert.match(src, /shouldOfferOpenCards/);
    assert.match(src, /leftoverDraftNextStep/);
    const statusPanel = src.slice(
      src.indexOf('Panel title="Week status"'),
      src.indexOf('Panel title="Auto-pilot"'),
    );
    assert.match(statusPanel, /shouldOfferOpenCards\(week,\s*weeks\)/);
    assert.ok(
      statusPanel.indexOf("shouldOfferOpenCards") < statusPanel.indexOf("NEXT_LABEL"),
      "leftover-draft Open CTA must be gated before NEXT_LABEL",
    );
    assert.match(src, /leftoverDraftNextStep\(week,\s*weeks\)/);
    assert.match(src, /leftoverStep\s*\?\?/);
    assert.match(src, /!week\.autopilot_hold \? leftoverDraftNextStep/);
    const lib = readFileSync(join(process.cwd(), "src/lib/current-week.ts"), "utf8");
    const offerFn = lib.slice(
      lib.indexOf("export function shouldOfferOpenCards"),
      lib.indexOf("function hasNewerInPlayThan"),
    );
    assert.match(offerFn, /skipScrubsLeftoverInPlace\(week,\s*weeks\)/);
    assert.ok(
      offerFn.indexOf("skipScrubsLeftoverInPlace") < offerFn.indexOf("shouldAutopilotOpenDraft"),
      "leftover-marks guard must hide Lock before leftover-draft Open is considered",
    );
    assert.match(offerFn, /hasNewerNonDraftThan\(week,\s*weeks\)/);
    assert.ok(
      offerFn.indexOf("hasNewerNonDraftThan") < offerFn.indexOf("shouldAutopilotOpenDraft"),
      "leftover in-play behind a newer final must hide Lock/Finalize before leftover-draft Open",
    );
    assert.match(offerFn, /shouldAutopilotOpenDraft\(week,\s*weeks\)/);
    const stepFn = lib.slice(
      lib.indexOf("export function leftoverDraftNextStep"),
      lib.indexOf("function recoverableFinishedWeek"),
    );
    assert.match(stepFn, /skipScrubsLeftoverInPlace\(week,\s*weeks\)/);
    assert.match(stepFn, /leftover marks/);
    assert.match(stepFn, /will not auto-open/);
    assert.match(stepFn, /behind a newer week/);
    assert.doesNotMatch(stepFn, /Open cards for the family/);
    assert.doesNotMatch(stepFn, /Lock the cards/);
    assert.match(stepFn, /skipTouchesNextWeek/);
  });

  it("commissioner hides Finalize on leftover weeks skip should close", () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/commissioner.tsx"),
      "utf8",
    );
    const finalizeAt = src.indexOf('Panel title="Finalize the week"');
    assert.ok(finalizeAt > -1, "Finalize panel must still exist for in-play weeks");
    const wrap = src.slice(
      src.lastIndexOf("{shouldOfferOpenCards", finalizeAt),
      src.indexOf("</Panel>", finalizeAt) + "</Panel>".length,
    );
    assert.match(wrap, /shouldOfferOpenCards\(week,\s*weeks\)\s*&&/);
    assert.match(wrap, /Panel title="Finalize the week"/);
    assert.match(wrap, /onClick=\{finalize\}/);
    assert.doesNotMatch(wrap, /skipCopy/);
    assert.ok(
      wrap.indexOf("shouldOfferOpenCards") < wrap.indexOf('Panel title="Finalize the week"'),
      "leftover Finalize panel must be gated by shouldOfferOpenCards",
    );
    const lib = readFileSync(join(process.cwd(), "src/lib/current-week.ts"), "utf8");
    const offerComment = lib.slice(
      lib.indexOf("Draft→open is only safe"),
      lib.indexOf("export function shouldOfferOpenCards"),
    );
    assert.match(offerComment, /Finalize would freeze leftover misses/);
    assert.match(offerComment, /force Reveal/);
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
    assert.match(src, /shouldAutopilotOpenDraft/);
    assert.match(src, /shouldAutopilotLockOpen/);
    assert.match(src, /shouldAutopilotFinalize/);
    assert.match(src, /shouldAutopilotResolveScores/);
    assert.match(src, /finalized_at/);
    const openFn = src.slice(
      src.indexOf('if (week.status === "draft")'),
      src.indexOf("// 2. Auto-lock"),
    );
    assert.match(openFn, /shouldAutopilotOpenDraft\(week,/);
    assert.match(openFn, /select\("season_year, week_number, status"\)/);
    assert.doesNotMatch(openFn, /\.neq\("status", "final"\)/);
    assert.ok(
      openFn.indexOf("shouldAutopilotOpenDraft") < openFn.indexOf('status: "open"'),
      "leftover-draft guard must run before auto-open",
    );
    const lockFn = src.slice(
      src.indexOf("// 2. Auto-lock"),
      src.indexOf('if (week.status !== "locked")'),
    );
    assert.match(lockFn, /shouldAutopilotLockOpen\(week,/);
    assert.match(lockFn, /select\("season_year, week_number, status"\)/);
    assert.doesNotMatch(lockFn, /\.neq\("status", "final"\)/);
    assert.ok(
      lockFn.indexOf("shouldAutopilotLockOpen") < lockFn.indexOf('status: "locked"'),
      "leftover-open guard must run before auto-lock",
    );
    const resolveFn = src.slice(
      src.indexOf("// 3. Resolve"),
      src.indexOf("// 4. Finalize"),
    );
    assert.match(resolveFn, /shouldAutopilotResolveScores\(week,/);
    assert.match(resolveFn, /select\("season_year, week_number, status"\)/);
    assert.doesNotMatch(resolveFn, /\.neq\("status", "final"\)/);
    assert.ok(
      resolveFn.indexOf("shouldAutopilotResolveScores") < resolveFn.indexOf("resolveWeekFromEspn"),
      "leftover-locked resolve guard must run before calling leftover scores",
    );
    const finalizeFn = src.slice(
      src.indexOf("// 4. Finalize"),
      src.indexOf("const out = await computeWeekScores"),
    );
    assert.match(finalizeFn, /shouldAutopilotFinalize\(week,/);
    assert.match(finalizeFn, /select\("season_year, week_number, status"\)/);
    assert.doesNotMatch(finalizeFn, /\.neq\("status", "final"\)/);
    assert.ok(
      finalizeFn.indexOf("shouldAutopilotFinalize") < finalizeFn.lastIndexOf("return"),
      "leftover-locked guard must run before auto-finalize",
    );
    const autofill = readFileSync(join(process.cwd(), "src/lib/autofill.server.ts"), "utf8");
    assert.match(autofill, /auto_create_weeks/);
    assert.match(autofill, /import \{ nextWeekSlot \} from "\.\/current-week"/);
    const ensureFn = autofill.slice(
      autofill.indexOf("export async function ensureNextWeek"),
      autofill.indexOf("const espnGames = await fetchEspnWeek(seasonYear, weekNumber)"),
    );
    assert.match(ensureFn, /nextWeekSlot\(last\)/);
    assert.match(ensureFn, /Number\(last\.week_number\)/);
    assert.doesNotMatch(ensureFn, /\(last\?\.week_number \?\? 0\) \+ 1/);
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
