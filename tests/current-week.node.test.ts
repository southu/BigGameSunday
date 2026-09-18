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
  shouldAutopilotEnsureNextWeek,
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

  it("autopilot does not auto-create a farther week while leftover skip is still the Tuesday path", () => {
    const leftover = wr("3e3aeeeb", 1, "draft");
    const premature = wr("52a42a9e", 2, "final");
    assert.equal(shouldAutopilotEnsureNextWeek([leftover, premature]), false);
    assert.equal(shouldAutopilotEnsureNextWeek([premature, leftover]), false);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "abandoned"), w(2, "final")]), false);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, ""), w(2, "final")]), false);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "skipped"), w(2, "final")]), false);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "draft"), w(2, "draft")]), false);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "draft")]), false);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "abandoned")]), false);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "")]), false);

    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "abandoned"), w(2, "open")]), true);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "draft"), w(2, "open")]), true);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "draft"), w(2, "locked")]), true);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "open"), w(2, "draft")]), true);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "locked"), w(2, "draft")]), true);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "locked")]), true);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "open")]), true);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "final")]), true);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "final"), w(2, "open")]), true);
    assert.equal(shouldAutopilotEnsureNextWeek([]), true);

    const leftoverStr = {
      season_year: "2026",
      week_number: "1",
      status: "draft",
    } as ReturnType<typeof w>;
    const prematureNum = w(2, "final");
    assert.equal(shouldAutopilotEnsureNextWeek([leftoverStr, prematureNum]), false);
    const openStr = {
      season_year: "2026",
      week_number: "2",
      status: "open",
    } as ReturnType<typeof w>;
    assert.equal(shouldAutopilotEnsureNextWeek([leftoverStr, openStr]), true);

    const autoW3 = w(3, "draft");
    assert.equal(selectActiveWeek([leftover, premature])?.week_number, 2);
    assert.equal(selectActiveWeek([leftover, premature, autoW3])?.week_number, 3);
    assert.equal(selectActiveWeek([leftover, premature, autoW3])?.status, "draft");
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([leftover, premature])),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", selectActiveWeek([leftover, premature, autoW3])),
      "The Harper House · Week 2",
    );

    const skippedClosed = {
      ...wr("3e3aeeeb", 1, "final"),
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00+00:00",
    };
    const prematureFinal = {
      ...wr("52a42a9e", 2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    };
    assert.equal(shouldAutopilotEnsureNextWeek([skippedClosed, prematureFinal]), false);
    assert.equal(shouldAutopilotEnsureNextWeek([prematureFinal, skippedClosed]), false);
    assert.equal(selectActiveWeek([skippedClosed, prematureFinal])?.week_number, 2);
    assert.equal(selectActiveWeek([skippedClosed, prematureFinal])?.status, "final");
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([skippedClosed, prematureFinal])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([skippedClosed, prematureFinal, autoW3])?.week_number, 3);
    assert.equal(selectActiveWeek([skippedClosed, prematureFinal, autoW3])?.status, "draft");
    assert.notEqual(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([skippedClosed, prematureFinal, autoW3]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(skipTargetWeek([skippedClosed, prematureFinal], skippedClosed)?.week_number, 2);
    assert.equal(
      skipScrubsViewedInPlace(prematureFinal, skippedClosed, [skippedClosed, prematureFinal]),
      true,
    );

    const skippedStrClosed = {
      season_year: "2026",
      week_number: "1",
      status: "final",
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00+00:00",
    } as ReturnType<typeof w> & { finalized_at: null; lock_at: string };
    const prematureStr = {
      season_year: "2026",
      week_number: "2",
      status: "final",
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    } as ReturnType<typeof w> & { finalized_at: string; lock_at: string };
    assert.equal(shouldAutopilotEnsureNextWeek([skippedStrClosed, prematureFinal]), false);
    assert.equal(shouldAutopilotEnsureNextWeek([skippedClosed, prematureStr]), false);
    assert.equal(shouldAutopilotEnsureNextWeek([skippedStrClosed, prematureStr]), false);

    const skippedLater = { ...w(1, "final"), finalized_at: "2026-09-16T16:00:00.000Z" };
    const outOfOrder = { ...w(2, "final"), finalized_at: "2026-09-15T19:04:43.880Z" };
    assert.equal(shouldAutopilotEnsureNextWeek([skippedLater, outOfOrder]), false);

    const played1 = {
      ...w(1, "final"),
      finalized_at: "2026-09-08T10:00:00.000Z",
      lock_at: "2026-09-07T17:00:00.000Z",
    };
    const played2 = {
      ...w(2, "final"),
      finalized_at: "2026-09-15T10:00:00.000Z",
      lock_at: "2026-09-13T17:00:00.000Z",
    };
    assert.equal(shouldAutopilotEnsureNextWeek([played1, played2]), true);
    assert.equal(shouldAutopilotEnsureNextWeek([w(1, "final"), w(2, "final")]), true);
    assert.equal(shouldAutopilotEnsureNextWeek([prematureFinal]), true);
    assert.equal(shouldAutopilotEnsureNextWeek([skippedClosed, w(2, "open")]), true);
  });

  it("autopilot does not auto-open a farther draft while premature-final next is still the Tuesday path", () => {
    const leftoverDraft = wr("3e3aeeeb", 1, "draft");
    const skippedClosed = {
      ...wr("3e3aeeeb", 1, "final"),
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00+00:00",
    };
    const prematureFinal = {
      ...wr("52a42a9e", 2, "final"),
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    };
    const autoW3 = wr("auto-w3", 3, "draft");
    const weeks = [skippedClosed, prematureFinal, autoW3];
    assert.equal(shouldAutopilotOpenDraft(autoW3, weeks), false);
    assert.equal(shouldAutopilotOpenDraft(autoW3, [autoW3, prematureFinal, skippedClosed]), false);
    assert.equal(shouldOfferOpenCards(autoW3, weeks), false);
    assert.equal(skipTargetWeek(weeks, autoW3)?.week_number, 2);
    assert.equal(skipScrubsViewedInPlace(prematureFinal, autoW3, weeks), true);
    assert.equal(selectActiveWeek(weeks)?.week_number, 3);
    assert.equal(selectActiveWeek(weeks)?.status, "draft");
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([skippedClosed, prematureFinal])),
      "The Harper House · Week 2",
    );

    const leftoverStillOpen = [leftoverDraft, prematureFinal, autoW3];
    assert.equal(shouldAutopilotOpenDraft(autoW3, leftoverStillOpen), false);
    assert.equal(shouldOfferOpenCards(autoW3, leftoverStillOpen), false);
    assert.equal(shouldAutopilotOpenDraft(leftoverDraft, leftoverStillOpen), false);

    const leftoverOpenW1 = wr("open-w1", 1, "open");
    assert.equal(
      shouldAutopilotOpenDraft(autoW3, [leftoverOpenW1, prematureFinal, autoW3]),
      false,
    );
    assert.equal(selectActiveWeek([leftoverOpenW1, prematureFinal, autoW3])?.week_number, 1);
    assert.notEqual(weekSwitcherLabel(autoW3, leftoverOpenW1), "Next week");

    const skippedStr = {
      season_year: "2026",
      week_number: "1",
      status: "final",
      finalized_at: null,
      lock_at: "2026-09-10T00:20:00+00:00",
    } as ReturnType<typeof w> & { finalized_at: null; lock_at: string };
    const prematureStr = {
      season_year: "2026",
      week_number: "2",
      status: "final",
      finalized_at: "2026-09-15T19:04:43.880Z",
      lock_at: "2026-09-18T00:15:00.000Z",
    } as ReturnType<typeof w> & { finalized_at: string; lock_at: string };
    const autoW3Str = {
      season_year: "2026",
      week_number: "3",
      status: "draft",
    } as ReturnType<typeof w>;
    assert.equal(shouldAutopilotOpenDraft(autoW3Str, [skippedStr, prematureStr, autoW3Str]), false);
    assert.equal(shouldAutopilotOpenDraft(autoW3, [skippedClosed, prematureStr, autoW3]), false);

    const played1 = {
      ...w(1, "final"),
      finalized_at: "2026-09-08T10:00:00.000Z",
      lock_at: "2026-09-07T17:00:00.000Z",
    };
    const played2 = {
      ...w(2, "final"),
      finalized_at: "2026-09-15T10:00:00.000Z",
      lock_at: "2026-09-13T17:00:00.000Z",
    };
    assert.equal(shouldAutopilotOpenDraft(autoW3, [played1, played2, autoW3]), true);
    assert.equal(shouldOfferOpenCards(autoW3, [played1, played2, autoW3]), true);
    assert.equal(shouldAutopilotOpenDraft(w(2, "draft"), [w(1, "final"), w(2, "draft")]), true);
    assert.equal(shouldAutopilotOpenDraft(w(2, "draft"), [w(1, "open"), w(2, "draft")]), true);
    assert.equal(selectActiveWeek([w(1, "open"), w(2, "draft")])?.week_number, 1);
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

  it("recency treats non-finite season_year and week_number as 0 so leftover drafts cannot hide newer weeks", () => {
    const keyed = (
      week_number: number | string | undefined,
      status: string,
      season_year: number | string | undefined = 2026,
    ) => ({ season_year, week_number, status }) as ReturnType<typeof w>;
    const keyedRef = (
      id: string,
      week_number: number | string | undefined,
      status: string,
      season_year: number | string | undefined = 2026,
    ) => ({ id, season_year, week_number, status }) as ReturnType<typeof wr>;

    // a: leftover draft with missing/unparseable year + final W2 → active W2
    const leftoverMissing = keyed(1, "draft", Number.NaN);
    const leftoverJunk = keyed("week-1", "draft", "not-a-year");
    const leftoverInf = keyed(1, "draft", Number.POSITIVE_INFINITY);
    const premature = keyed(2, "final", 2026);
    assert.equal(selectActiveWeek([leftoverMissing, premature])?.week_number, 2);
    assert.equal(selectActiveWeek([premature, leftoverMissing])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverMissing, premature])?.status, "final");
    assert.equal(selectActiveWeek([leftoverJunk, premature])?.week_number, 2);
    assert.equal(selectActiveWeek([leftoverInf, premature])?.week_number, 2);
    assert.equal(selectActiveWeek([premature, leftoverInf])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([leftoverInf, premature])),
      "The Harper House · Week 2",
    );

    // b: leftover draft NaN year + open W2 → active W2
    const leftoverDraft = keyedRef("w1", 1, "draft", Number.NaN);
    const openW2 = keyedRef("w2", 2, "open", 2026);
    const b = selectActiveWeek([leftoverDraft, openW2]);
    assert.equal(b?.id, "w2");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([openW2, leftoverDraft])?.id, "w2");
    assert.equal(weekSwitcherLabel(openW2, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftoverDraft, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftoverDraft, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftoverDraft, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftoverDraft, openW2], b, "next")?.id, "w2");

    // c: open W1 + draft W2 → active W1, W2 labeled Next week
    const openW1 = keyedRef("open-1", 1, "open", 2026);
    const nextDraft = keyedRef("draft-2", 2, "draft", 2026);
    const c = selectActiveWeek([openW1, nextDraft]);
    assert.equal(c?.id, "open-1");
    assert.equal(weekSwitcherLabel(openW1, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([openW1, nextDraft], c, "next")?.id, "draft-2");

    // d: only final W1 → W1
    assert.equal(selectActiveWeek([keyed(1, "final", 2026)])?.status, "final");
    // leftover undefined keys cannot hide a newer week — skip own undefined
    assert.equal(selectActiveWeek([keyed(undefined, "final", 2026)]), null);
    assert.equal(
      selectActiveWeek([{ season_year: undefined, week_number: 1, status: "final" } as never]),
      null,
    );
    // leftover accessor keys cannot hide a newer week — skip own getters
    assert.equal(
      selectActiveWeek([
        {
          get season_year() {
            return 2026;
          },
          get week_number() {
            return 11;
          },
          status: "final",
        } as never,
      ]),
      null,
    );
    // leftover boolean keys cannot hide a newer week — skip own booleans
    assert.equal(
      selectActiveWeek([{ season_year: true, week_number: true, status: "final" } as never]),
      null,
    );
    assert.equal(
      selectActiveWeek([{ season_year: false, week_number: false, status: "final" } as never]),
      null,
    );
    // leftover symbol keys cannot hide a newer week — skip own symbols
    assert.equal(
      selectActiveWeek([{ season_year: Symbol("y"), week_number: Symbol("w"), status: "final" } as never]),
      null,
    );
    assert.equal(
      selectActiveWeek([{ season_year: Symbol.for("year"), week_number: Symbol.for("week"), status: "final" } as never]),
      null,
    );
    // leftover function keys cannot hide a newer week — skip own functions
    assert.equal(
      selectActiveWeek([{ season_year: () => 2026, week_number: () => 2, status: "final" } as never]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: Function("return 2026"),
          week_number: Function("return 2"),
          status: "final",
        } as never,
      ]),
      null,
    );
    // leftover array keys cannot hide a newer week — skip own arrays
    assert.equal(
      selectActiveWeek([{ season_year: [2026], week_number: [2], status: "final" } as never]),
      null,
    );
    assert.equal(
      selectActiveWeek([{ season_year: [], week_number: [], status: "final" } as never]),
      null,
    );
    // leftover date keys cannot hide a newer week — skip own dates
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Date("2026-01-01T00:00:00Z"),
          week_number: new Date("2026-01-02T00:00:00Z"),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Date("not-a-date"),
          week_number: new Date("not-a-date"),
          status: "final",
        } as never,
      ]),
      null,
    );
    // leftover map keys cannot hide a newer week — skip own maps
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Map([["y", 2026]]),
          week_number: new Map([["w", 2]]),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([{ season_year: new Map(), week_number: new Map(), status: "final" } as never]),
      null,
    );
    // leftover set keys cannot hide a newer week — skip own sets
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Set([2026]),
          week_number: new Set([2]),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([{ season_year: new Set(), week_number: new Set(), status: "final" } as never]),
      null,
    );
    // leftover weakmap keys cannot hide a newer week — skip own weakmaps
    assert.equal(
      selectActiveWeek([
        {
          season_year: new WeakMap([[{}, 2026]]),
          week_number: new WeakMap([[{}, 2]]),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([{ season_year: new WeakMap(), week_number: new WeakMap(), status: "final" } as never]),
      null,
    );
    // leftover weakset keys cannot hide a newer week — skip own weaksets
    assert.equal(
      selectActiveWeek([
        {
          season_year: new WeakSet([{}]),
          week_number: new WeakSet([{}]),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([{ season_year: new WeakSet(), week_number: new WeakSet(), status: "final" } as never]),
      null,
    );
    // leftover promise keys cannot hide a newer week — skip own promises
    assert.equal(
      selectActiveWeek([
        {
          season_year: Promise.resolve(2026),
          week_number: Promise.resolve(2026),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        { season_year: new Promise(() => {}), week_number: new Promise(() => {}), status: "final" } as never,
      ]),
      null,
    );
    // leftover error keys cannot hide a newer week — skip own errors
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Error("2026"),
          week_number: new Error("2026"),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        { season_year: new Error(), week_number: new TypeError(), status: "final" } as never,
      ]),
      null,
    );
    // leftover regexp keys cannot hide a newer week — skip own regexps
    assert.equal(
      selectActiveWeek([
        {
          season_year: new RegExp("2026"),
          week_number: new RegExp("2026"),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        { season_year: new RegExp(""), week_number: /2026/i, status: "final" } as never,
      ]),
      null,
    );
    // leftover arraybuffer keys cannot hide a newer week — skip own arraybuffers
    assert.equal(
      selectActiveWeek([
        {
          season_year: new ArrayBuffer(8),
          week_number: new ArrayBuffer(8),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        { season_year: new ArrayBuffer(0), week_number: new ArrayBuffer(0), status: "final" } as never,
      ]),
      null,
    );
    // leftover sharedarraybuffer keys cannot hide a newer week — skip own sharedarraybuffers
    assert.equal(
      selectActiveWeek([
        {
          season_year: new SharedArrayBuffer(8),
          week_number: new SharedArrayBuffer(8),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new SharedArrayBuffer(0),
          week_number: new SharedArrayBuffer(0),
          status: "final",
        } as never,
      ]),
      null,
    );
    // leftover dataview keys cannot hide a newer week — skip own dataviews
    assert.equal(
      selectActiveWeek([
        {
          season_year: new DataView(new ArrayBuffer(8)),
          week_number: new DataView(new ArrayBuffer(8)),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new DataView(new ArrayBuffer(0)),
          week_number: new DataView(new ArrayBuffer(0)),
          status: "final",
        } as never,
      ]),
      null,
    );
    // leftover typedarray keys cannot hide a newer week — skip own typedarrays
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Uint32Array([2026]),
          week_number: new Uint8Array([2]),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Uint32Array(),
          week_number: new Uint8Array(),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Int32Array([2026]),
          week_number: new Int32Array([2]),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Float64Array([2026]),
          week_number: new Float32Array([2]),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new BigInt64Array([2026n]),
          week_number: new BigInt64Array([2n]),
          status: "final",
        } as never,
      ]),
      null,
    );
    // leftover blob keys cannot hide a newer week — skip own blobs
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Blob(["2026"]),
          week_number: new Blob(["2"]),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Blob(),
          week_number: new Blob(),
          status: "final",
        } as never,
      ]),
      null,
    );
    // leftover file keys cannot hide a newer week — skip own files
    assert.equal(
      selectActiveWeek([
        {
          season_year: new File(["2026"], "year"),
          week_number: new File(["2"], "week"),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new File([], "empty-year"),
          week_number: new File([], "empty-week"),
          status: "final",
        } as never,
      ]),
      null,
    );
    // leftover url keys cannot hide a newer week — skip own urls
    assert.equal(
      selectActiveWeek([
        {
          season_year: new URL("https://example.com/2026"),
          week_number: new URL("https://example.com/2"),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new URL("https://example.com/"),
          week_number: new URL("https://example.com/"),
          status: "final",
        } as never,
      ]),
      null,
    );
    // leftover urlsearchparams keys cannot hide a newer week — skip own urlsearchparams
    assert.equal(
      selectActiveWeek([
        {
          season_year: new URLSearchParams("year=2026"),
          week_number: new URLSearchParams("week=2"),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new URLSearchParams(),
          week_number: new URLSearchParams(),
          status: "final",
        } as never,
      ]),
      null,
    );
    // leftover formdata keys cannot hide a newer week — skip own formdata
    assert.equal(
      selectActiveWeek([
        {
          season_year: (() => {
            const fd = new FormData();
            fd.append("year", "2026");
            return fd;
          })(),
          week_number: (() => {
            const fd = new FormData();
            fd.append("week", "2");
            return fd;
          })(),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new FormData(),
          week_number: new FormData(),
          status: "final",
        } as never,
      ]),
      null,
    );

    // leftover headers keys cannot hide a newer week — skip own headers
    assert.equal(
      selectActiveWeek([
        {
          season_year: (() => {
            const h = new Headers();
            h.append("year", "2026");
            return h;
          })(),
          week_number: (() => {
            const h = new Headers();
            h.append("week", "2");
            return h;
          })(),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Headers(),
          week_number: new Headers(),
          status: "final",
        } as never,
      ]),
      null,
    );

    // leftover request keys cannot hide a newer week — skip own request
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Request("https://example.com/2026"),
          week_number: new Request("https://example.com/2"),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Request("https://example.com/"),
          week_number: new Request("https://example.com/"),
          status: "final",
        } as never,
      ]),
      null,
    );

    // leftover response keys cannot hide a newer week — skip own response
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Response("2026"),
          week_number: new Response("2"),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Response(),
          week_number: new Response(),
          status: "final",
        } as never,
      ]),
      null,
    );

    // leftover readable stream keys cannot hide a newer week — skip own readable stream
    assert.equal(
      selectActiveWeek([
        {
          season_year: new Blob(["2026"]).stream(),
          week_number: new Blob(["2"]).stream(),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new ReadableStream(),
          week_number: new ReadableStream(),
          status: "final",
        } as never,
      ]),
      null,
    );

    // leftover writable stream keys cannot hide a newer week — skip own writable stream
    assert.equal(
      selectActiveWeek([
        {
          season_year: new WritableStream({ write() {} }),
          week_number: new WritableStream({ write() {} }),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new WritableStream(),
          week_number: new WritableStream(),
          status: "final",
        } as never,
      ]),
      null,
    );

    // leftover transform stream keys cannot hide a newer week — skip own transform stream
    assert.equal(
      selectActiveWeek([
        {
          season_year: new TransformStream({
            transform(chunk, controller) {
              controller.enqueue(chunk);
            },
          }),
          week_number: new TransformStream({
            transform(chunk, controller) {
              controller.enqueue(chunk);
            },
          }),
          status: "final",
        } as never,
      ]),
      null,
    );
    assert.equal(
      selectActiveWeek([
        {
          season_year: new TransformStream(),
          week_number: new TransformStream(),
          status: "final",
        } as never,
      ]),
      null,
    );

    // e: skip path: final/skipped W1 with missing year + open W2 → W2
    const skipped = keyedRef("w1s", 1, "final", Number.NaN);
    const dirty = {
      ...keyedRef("w2d", 2, "open", 2026),
      finalized_at: "2026-09-15T19:04:43.880Z",
    };
    const e = selectActiveWeek([skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([dirty, skipped])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");

    assert.equal([leftoverMissing, premature].sort(recency)[0]?.week_number, 2);
    assert.equal([leftoverInf, premature].sort(recency)[0]?.week_number, 2);
    assert.ok(recency(leftoverMissing, premature) > 0);
    assert.deepEqual(nextWeekSlot(keyed(Number.NaN, "draft", Number.NaN)), {
      season_year: 0,
      week_number: 1,
    });
    assert.ok(Number.isFinite(nextWeekSlot(keyed(Number.NaN, "draft", Number.NaN)).week_number));
    assert.deepEqual(nextWeekSlot(keyed("1", "draft", "2026")), {
      season_year: 2026,
      week_number: 2,
    });
    assert.notEqual(nextWeekSlot(keyed("1", "draft", "2026")).week_number, "11");

    // leftover missing rows rank as 0,0 — they cannot hide a newer week
    assert.ok(recency(null, premature) > 0);
    assert.ok(recency(undefined, premature) > 0);
    assert.equal(recency(null, null), 0);
    assert.equal([null as never, leftoverMissing, premature].sort(recency)[0]?.week_number, 2);

    // leftover nan keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyNaN = keyed(Number.NaN, "final", Number.NaN);
    assert.equal(selectActiveWeek([onlyNaN]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyNaN), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlyNaN), "The Harper House · Week NaN");
    assert.equal(
      weekSwitcherLabel({ id: "nan", ...onlyNaN } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover null keys cannot caption Week 0 — skip the row, chrome is household name only
    const onlyNull = { season_year: null, week_number: null, status: "final" } as never;
    assert.equal(selectActiveWeek([onlyNull]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyNull), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlyNull), "The Harper House · Week 0");
    assert.equal(
      weekSwitcherLabel({ id: "null", ...onlyNull } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover undefined keys cannot caption Week 0 — skip the row, chrome is household name only
    const onlyUndefined = {
      season_year: undefined,
      week_number: undefined,
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyUndefined]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyUndefined), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyUndefined),
      "The Harper House · Week 0",
    );
    assert.equal(
      weekSwitcherLabel({ id: "undefined", ...onlyUndefined } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover accessor keys cannot caption Week 11 — skip the row, chrome is household name only
    const onlyAccessor = {
      get season_year() {
        return 2026;
      },
      get week_number() {
        return 11;
      },
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyAccessor]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyAccessor), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyAccessor),
      "The Harper House · Week 11",
    );
    const accessorRef = {
      id: "accessor",
      get season_year() {
        return 2026;
      },
      get week_number() {
        return 11;
      },
      status: "final",
    } as ReturnType<typeof wr>;
    assert.equal(weekSwitcherLabel(accessorRef, null), "Week 0");

    // leftover boolean keys cannot caption Week 1 — skip the row, chrome is household name only
    const onlyTrue = { season_year: true, week_number: true, status: "final" } as never;
    const onlyFalse = { season_year: false, week_number: false, status: "final" } as never;
    assert.equal(selectActiveWeek([onlyTrue]), null);
    assert.equal(selectActiveWeek([onlyFalse]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyTrue), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyFalse), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlyTrue), "The Harper House · Week 1");
    assert.notEqual(familyWeekChrome("The Harper House", onlyFalse), "The Harper House · Week 0");
    assert.equal(
      weekSwitcherLabel({ id: "true", ...onlyTrue } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel({ id: "false", ...onlyFalse } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover symbol keys cannot caption Week 0 — skip the row, chrome is household name only
    const onlySymbol = { season_year: Symbol("y"), week_number: Symbol("w"), status: "final" } as never;
    const onlyWellKnown = {
      season_year: Symbol.for("year"),
      week_number: Symbol.for("week"),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlySymbol]), null);
    assert.equal(selectActiveWeek([onlyWellKnown]), null);
    assert.equal(familyWeekChrome("The Harper House", onlySymbol), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyWellKnown), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlySymbol), "The Harper House · Week 0");
    assert.equal(
      weekSwitcherLabel({ id: "symbol", ...onlySymbol } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel({ id: "wellknown", ...onlyWellKnown } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover function keys cannot caption Week 0 — skip the row, chrome is household name only
    const onlyFn = { season_year: () => 2026, week_number: () => 2, status: "final" } as never;
    const onlyCtor = {
      season_year: Function("return 2026"),
      week_number: Function("return 2"),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyFn]), null);
    assert.equal(selectActiveWeek([onlyCtor]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyFn), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyCtor), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlyFn), "The Harper House · Week 0");
    assert.equal(
      weekSwitcherLabel({ id: "fn", ...onlyFn } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel({ id: "ctor", ...onlyCtor } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover array keys cannot caption Week 2 — skip the row, chrome is household name only
    const onlyArray = { season_year: [2026], week_number: [2], status: "final" } as never;
    const onlyEmpty = { season_year: [], week_number: [], status: "final" } as never;
    assert.equal(selectActiveWeek([onlyArray]), null);
    assert.equal(selectActiveWeek([onlyEmpty]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyArray), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmpty), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlyArray), "The Harper House · Week 2");
    assert.notEqual(familyWeekChrome("The Harper House", onlyEmpty), "The Harper House · Week 0");
    assert.equal(
      weekSwitcherLabel({ id: "array", ...onlyArray } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel({ id: "empty", ...onlyEmpty } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover date keys cannot caption Week timestamp — skip the row, chrome is household name only
    const onlyDate = {
      season_year: new Date("2026-01-01T00:00:00Z"),
      week_number: new Date("2026-01-02T00:00:00Z"),
      status: "final",
    } as never;
    const onlyInvalidDate = {
      season_year: new Date("not-a-date"),
      week_number: new Date("not-a-date"),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyDate]), null);
    assert.equal(selectActiveWeek([onlyInvalidDate]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyDate), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyInvalidDate), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyDate),
      `The Harper House · Week ${Number(new Date("2026-01-02T00:00:00Z"))}`,
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyInvalidDate),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "date", ...onlyDate } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel({ id: "invalid-date", ...onlyInvalidDate } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover map keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyMap = {
      season_year: new Map([["y", 2026]]),
      week_number: new Map([["w", 2]]),
      status: "final",
    } as never;
    const onlyEmptyMap = { season_year: new Map(), week_number: new Map(), status: "final" } as never;
    assert.equal(selectActiveWeek([onlyMap]), null);
    assert.equal(selectActiveWeek([onlyEmptyMap]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyMap), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyMap), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlyMap), "The Harper House · Week NaN");
    assert.notEqual(familyWeekChrome("The Harper House", onlyEmptyMap), "The Harper House · Week NaN");
    assert.equal(weekSwitcherLabel({ id: "map", ...onlyMap } as ReturnType<typeof wr>, null), "Week 0");
    assert.equal(
      weekSwitcherLabel({ id: "empty-map", ...onlyEmptyMap } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover set keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlySet = {
      season_year: new Set([2026]),
      week_number: new Set([2]),
      status: "final",
    } as never;
    const onlyEmptySet = { season_year: new Set(), week_number: new Set(), status: "final" } as never;
    assert.equal(selectActiveWeek([onlySet]), null);
    assert.equal(selectActiveWeek([onlyEmptySet]), null);
    assert.equal(familyWeekChrome("The Harper House", onlySet), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptySet), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlySet), "The Harper House · Week NaN");
    assert.notEqual(familyWeekChrome("The Harper House", onlyEmptySet), "The Harper House · Week NaN");
    assert.equal(weekSwitcherLabel({ id: "set", ...onlySet } as ReturnType<typeof wr>, null), "Week 0");
    assert.equal(
      weekSwitcherLabel({ id: "empty-set", ...onlyEmptySet } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover weakmap keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyWeakMap = {
      season_year: new WeakMap([[{}, 2026]]),
      week_number: new WeakMap([[{}, 2]]),
      status: "final",
    } as never;
    const onlyEmptyWeakMap = {
      season_year: new WeakMap(),
      week_number: new WeakMap(),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyWeakMap]), null);
    assert.equal(selectActiveWeek([onlyEmptyWeakMap]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyWeakMap), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyWeakMap), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlyWeakMap), "The Harper House · Week NaN");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyWeakMap),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "weakmap", ...onlyWeakMap } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel({ id: "empty-weakmap", ...onlyEmptyWeakMap } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover weakset keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyWeakSet = {
      season_year: new WeakSet([{}]),
      week_number: new WeakSet([{}]),
      status: "final",
    } as never;
    const onlyEmptyWeakSet = {
      season_year: new WeakSet(),
      week_number: new WeakSet(),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyWeakSet]), null);
    assert.equal(selectActiveWeek([onlyEmptyWeakSet]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyWeakSet), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyWeakSet), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlyWeakSet), "The Harper House · Week NaN");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyWeakSet),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "weakset", ...onlyWeakSet } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel({ id: "empty-weakset", ...onlyEmptyWeakSet } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover promise keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyPromise = {
      season_year: Promise.resolve(2026),
      week_number: Promise.resolve(2026),
      status: "final",
    } as never;
    const onlyEmptyPromise = {
      season_year: new Promise(() => {}),
      week_number: new Promise(() => {}),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyPromise]), null);
    assert.equal(selectActiveWeek([onlyEmptyPromise]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyPromise), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyPromise), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlyPromise), "The Harper House · Week NaN");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyPromise),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "promise", ...onlyPromise } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel({ id: "empty-promise", ...onlyEmptyPromise } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover error keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyError = {
      season_year: new Error("2026"),
      week_number: new Error("2026"),
      status: "final",
    } as never;
    const onlyEmptyError = {
      season_year: new Error(),
      week_number: new TypeError(),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyError]), null);
    assert.equal(selectActiveWeek([onlyEmptyError]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyError), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyError), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlyError), "The Harper House · Week NaN");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyError),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "error", ...onlyError } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel({ id: "empty-error", ...onlyEmptyError } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover regexp keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyRegexp = {
      season_year: new RegExp("2026"),
      week_number: new RegExp("2026"),
      status: "final",
    } as never;
    const onlyEmptyRegexp = {
      season_year: new RegExp(""),
      week_number: /2026/i,
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyRegexp]), null);
    assert.equal(selectActiveWeek([onlyEmptyRegexp]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyRegexp), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyRegexp), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", onlyRegexp), "The Harper House · Week NaN");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyRegexp),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "regexp", ...onlyRegexp } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel({ id: "empty-regexp", ...onlyEmptyRegexp } as ReturnType<typeof wr>, null),
      "Week 0",
    );

    // leftover arraybuffer keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyArrayBuffer = {
      season_year: new ArrayBuffer(8),
      week_number: new ArrayBuffer(8),
      status: "final",
    } as never;
    const onlyEmptyArrayBuffer = {
      season_year: new ArrayBuffer(0),
      week_number: new ArrayBuffer(0),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyArrayBuffer]), null);
    assert.equal(selectActiveWeek([onlyEmptyArrayBuffer]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyArrayBuffer), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyArrayBuffer), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyArrayBuffer),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyArrayBuffer),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "arraybuffer", ...onlyArrayBuffer } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-arraybuffer", ...onlyEmptyArrayBuffer } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover sharedarraybuffer keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlySharedArrayBuffer = {
      season_year: new SharedArrayBuffer(8),
      week_number: new SharedArrayBuffer(8),
      status: "final",
    } as never;
    const onlyEmptySharedArrayBuffer = {
      season_year: new SharedArrayBuffer(0),
      week_number: new SharedArrayBuffer(0),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlySharedArrayBuffer]), null);
    assert.equal(selectActiveWeek([onlyEmptySharedArrayBuffer]), null);
    assert.equal(familyWeekChrome("The Harper House", onlySharedArrayBuffer), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptySharedArrayBuffer), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlySharedArrayBuffer),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptySharedArrayBuffer),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "sharedarraybuffer", ...onlySharedArrayBuffer } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-sharedarraybuffer", ...onlyEmptySharedArrayBuffer } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover dataview keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyDataView = {
      season_year: new DataView(new ArrayBuffer(8)),
      week_number: new DataView(new ArrayBuffer(8)),
      status: "final",
    } as never;
    const onlyEmptyDataView = {
      season_year: new DataView(new ArrayBuffer(0)),
      week_number: new DataView(new ArrayBuffer(0)),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyDataView]), null);
    assert.equal(selectActiveWeek([onlyEmptyDataView]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyDataView), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyDataView), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyDataView),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyDataView),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "dataview", ...onlyDataView } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-dataview", ...onlyEmptyDataView } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover typedarray keys cannot caption Week 2 — skip the row, chrome is household name only
    const onlyTypedArray = {
      season_year: new Uint32Array([2026]),
      week_number: new Uint8Array([2]),
      status: "final",
    } as never;
    const onlyEmptyTypedArray = {
      season_year: new Uint32Array(),
      week_number: new Uint8Array(),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyTypedArray]), null);
    assert.equal(selectActiveWeek([onlyEmptyTypedArray]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyTypedArray), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyTypedArray), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyTypedArray),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyTypedArray),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyTypedArray),
      "The Harper House · Week 0",
    );
    assert.equal(
      weekSwitcherLabel({ id: "typedarray", ...onlyTypedArray } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-typedarray", ...onlyEmptyTypedArray } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover blob keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyBlob = {
      season_year: new Blob(["2026"]),
      week_number: new Blob(["2"]),
      status: "final",
    } as never;
    const onlyEmptyBlob = {
      season_year: new Blob(),
      week_number: new Blob(),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyBlob]), null);
    assert.equal(selectActiveWeek([onlyEmptyBlob]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyBlob), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyBlob), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyBlob),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyBlob),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyBlob),
      "The Harper House · Week 0",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyBlob),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "blob", ...onlyBlob } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-blob", ...onlyEmptyBlob } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover file keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyFile = {
      season_year: new File(["2026"], "year"),
      week_number: new File(["2"], "week"),
      status: "final",
    } as never;
    const onlyEmptyFile = {
      season_year: new File([], "empty-year"),
      week_number: new File([], "empty-week"),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyFile]), null);
    assert.equal(selectActiveWeek([onlyEmptyFile]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyFile), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyFile), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyFile),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyFile),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyFile),
      "The Harper House · Week 0",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyFile),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "file", ...onlyFile } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-file", ...onlyEmptyFile } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover url keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyUrl = {
      season_year: new URL("https://example.com/2026"),
      week_number: new URL("https://example.com/2"),
      status: "final",
    } as never;
    const onlyEmptyUrl = {
      season_year: new URL("https://example.com/"),
      week_number: new URL("https://example.com/"),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyUrl]), null);
    assert.equal(selectActiveWeek([onlyEmptyUrl]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyUrl), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyUrl), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyUrl),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyUrl),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyUrl),
      "The Harper House · Week 0",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyUrl),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "url", ...onlyUrl } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-url", ...onlyEmptyUrl } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover urlsearchparams keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyUrlSearchParams = {
      season_year: new URLSearchParams("year=2026"),
      week_number: new URLSearchParams("week=2"),
      status: "final",
    } as never;
    const onlyEmptyUrlSearchParams = {
      season_year: new URLSearchParams(),
      week_number: new URLSearchParams(),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyUrlSearchParams]), null);
    assert.equal(selectActiveWeek([onlyEmptyUrlSearchParams]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyUrlSearchParams), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyUrlSearchParams), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyUrlSearchParams),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyUrlSearchParams),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyUrlSearchParams),
      "The Harper House · Week 0",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyUrlSearchParams),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "urlsearchparams", ...onlyUrlSearchParams } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-urlsearchparams", ...onlyEmptyUrlSearchParams } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover formdata keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyFormData = {
      season_year: (() => {
        const fd = new FormData();
        fd.append("year", "2026");
        return fd;
      })(),
      week_number: (() => {
        const fd = new FormData();
        fd.append("week", "2");
        return fd;
      })(),
      status: "final",
    } as never;
    const onlyEmptyFormData = {
      season_year: new FormData(),
      week_number: new FormData(),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyFormData]), null);
    assert.equal(selectActiveWeek([onlyEmptyFormData]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyFormData), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyFormData), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyFormData),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyFormData),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyFormData),
      "The Harper House · Week 0",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyFormData),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "formdata", ...onlyFormData } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-formdata", ...onlyEmptyFormData } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover headers keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyHeaders = {
      season_year: (() => {
        const h = new Headers();
        h.append("year", "2026");
        return h;
      })(),
      week_number: (() => {
        const h = new Headers();
        h.append("week", "2");
        return h;
      })(),
      status: "final",
    } as never;
    const onlyEmptyHeaders = {
      season_year: new Headers(),
      week_number: new Headers(),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyHeaders]), null);
    assert.equal(selectActiveWeek([onlyEmptyHeaders]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyHeaders), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyHeaders), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyHeaders),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyHeaders),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyHeaders),
      "The Harper House · Week 0",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyHeaders),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "headers", ...onlyHeaders } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-headers", ...onlyEmptyHeaders } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover request keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyRequest = {
      season_year: new Request("https://example.com/2026"),
      week_number: new Request("https://example.com/2"),
      status: "final",
    } as never;
    const onlyEmptyRequest = {
      season_year: new Request("https://example.com/"),
      week_number: new Request("https://example.com/"),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyRequest]), null);
    assert.equal(selectActiveWeek([onlyEmptyRequest]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyRequest), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyRequest), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyRequest),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyRequest),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyRequest),
      "The Harper House · Week 0",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyRequest),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "request", ...onlyRequest } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-request", ...onlyEmptyRequest } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover response keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyResponse = {
      season_year: new Response("2026"),
      week_number: new Response("2"),
      status: "final",
    } as never;
    const onlyEmptyResponse = {
      season_year: new Response(),
      week_number: new Response(),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyResponse]), null);
    assert.equal(selectActiveWeek([onlyEmptyResponse]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyResponse), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyResponse), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyResponse),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyResponse),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyResponse),
      "The Harper House · Week 0",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyResponse),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "response", ...onlyResponse } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-response", ...onlyEmptyResponse } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover readable stream keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyStream = {
      season_year: new Blob(["2026"]).stream(),
      week_number: new Blob(["2"]).stream(),
      status: "final",
    } as never;
    const onlyEmptyStream = {
      season_year: new ReadableStream(),
      week_number: new ReadableStream(),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyStream]), null);
    assert.equal(selectActiveWeek([onlyEmptyStream]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyStream), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyStream), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyStream),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyStream),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyStream),
      "The Harper House · Week 0",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyStream),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "stream", ...onlyStream } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-stream", ...onlyEmptyStream } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover writable stream keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyWritable = {
      season_year: new WritableStream({ write() {} }),
      week_number: new WritableStream({ write() {} }),
      status: "final",
    } as never;
    const onlyEmptyWritable = {
      season_year: new WritableStream(),
      week_number: new WritableStream(),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyWritable]), null);
    assert.equal(selectActiveWeek([onlyEmptyWritable]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyWritable), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyWritable), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyWritable),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyWritable),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyWritable),
      "The Harper House · Week 0",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyWritable),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "writable", ...onlyWritable } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-writable", ...onlyEmptyWritable } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );

    // leftover transform stream keys cannot caption Week NaN — skip the row, chrome is household name only
    const onlyTransform = {
      season_year: new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      }),
      week_number: new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      }),
      status: "final",
    } as never;
    const onlyEmptyTransform = {
      season_year: new TransformStream(),
      week_number: new TransformStream(),
      status: "final",
    } as never;
    assert.equal(selectActiveWeek([onlyTransform]), null);
    assert.equal(selectActiveWeek([onlyEmptyTransform]), null);
    assert.equal(familyWeekChrome("The Harper House", onlyTransform), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", onlyEmptyTransform), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyTransform),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyTransform),
      "The Harper House · Week NaN",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyTransform),
      "The Harper House · Week 0",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", onlyEmptyTransform),
      "The Harper House · Week NaN",
    );
    assert.equal(
      weekSwitcherLabel({ id: "transform", ...onlyTransform } as ReturnType<typeof wr>, null),
      "Week 0",
    );
    assert.equal(
      weekSwitcherLabel(
        { id: "empty-transform", ...onlyEmptyTransform } as ReturnType<typeof wr>,
        null,
      ),
      "Week 0",
    );
  });

  it("leftover holes cannot hide a newer week (a–e)", () => {
    const hole = null as never;
    // a: draft W1 + final W2 + hole → active W2
    assert.equal(selectActiveWeek([hole, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), hole, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), hole])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([hole, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    // b: draft W1 + open W2 + hole → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([hole, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, hole, open])?.week_number, 2);
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    // c: open W1 + draft W2 + hole → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, hole, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    // d: only final W1 + holes → W1
    assert.equal(selectActiveWeek([hole, w(1, "final"), hole])?.week_number, 1);
    assert.equal(selectActiveWeek([hole, hole]) , null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + hole → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([hole, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, hole, dirty])?.week_number, 2);
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
  });

  it("leftover non-object rows cannot hide a newer week (a–e)", () => {
    const junk = true as never;
    const num = 1 as never;
    const str = "x" as never;
    // a: draft W1 + final W2 + leftover non-object row → active W2
    assert.equal(selectActiveWeek([junk, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), num, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), str])?.week_number, 2);
    assert.equal(selectActiveWeek([junk, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([junk, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([junk]), null);
    assert.equal(selectActiveWeek([num, str, junk]), null);
    // leftover non-object row must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([junk, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, junk])?.status, "draft");
    assert.ok(recency(junk, w(2, "final")) > 0);
    assert.ok(recency(num, w(2, "final")) > 0);
    assert.ok(recency(str, w(2, "final")) > 0);
    // b: draft W1 + open W2 + leftover non-object row → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([junk, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, num, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, str])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([junk, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover non-object row → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, junk, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([junk, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover non-object rows → W1
    assert.equal(selectActiveWeek([junk, w(1, "final"), num])?.week_number, 1);
    assert.equal(selectActiveWeek([str, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([junk, num]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover non-object row → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([junk, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, num, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, str])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([junk, skipped, dirty].sort(recency)[0]?.week_number, 2);
  });

  it("leftover array rows cannot hide a newer week (a–e)", () => {
    const empty = [] as never;
    const nested = [[]] as never;
    const nums = [1] as never;
    // a: draft W1 + final W2 + leftover array row → active W2
    assert.equal(selectActiveWeek([empty, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), nested, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), nums])?.week_number, 2);
    assert.equal(selectActiveWeek([empty, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([empty, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([empty]), null);
    assert.equal(selectActiveWeek([nested, nums, empty]), null);
    // leftover array row must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([empty, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, empty])?.status, "draft");
    assert.ok(recency(empty, w(2, "final")) > 0);
    assert.ok(recency(nested, w(2, "final")) > 0);
    assert.ok(recency(nums, w(2, "final")) > 0);
    const keyed = Object.assign([], { season_year: 2026, week_number: 11, status: "open" }) as never;
    assert.equal(selectActiveWeek([keyed, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([keyed]), null);
    assert.ok(recency(keyed, w(2, "final")) > 0);
    // b: draft W1 + open W2 + leftover array row → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([empty, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, nested, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, nums])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([empty, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover array row → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, empty, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([empty, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover array rows → W1
    assert.equal(selectActiveWeek([empty, w(1, "final"), nested])?.week_number, 1);
    assert.equal(selectActiveWeek([nums, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([empty, nested]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover array row → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([empty, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, nested, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, nums])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([empty, skipped, dirty].sort(recency)[0]?.week_number, 2);
  });

  it("leftover host objects cannot hide a newer week (a–e)", () => {
    const when = new Date("2026-09-15T19:04:43.880Z") as never;
    const bytes = new Uint8Array(2) as never;
    const bag = new Map() as never;
    const boxed = new String("x") as never;
    // a: draft W1 + final W2 + leftover host object → active W2
    assert.equal(selectActiveWeek([when, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), bytes, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), bag])?.week_number, 2);
    assert.equal(selectActiveWeek([boxed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([when, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([when]), null);
    assert.equal(selectActiveWeek([bytes, bag, boxed]), null);
    // leftover host object must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([when, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, when])?.status, "draft");
    assert.ok(recency(when, w(2, "final")) > 0);
    assert.ok(recency(bytes, w(2, "final")) > 0);
    assert.ok(recency(bag, w(2, "final")) > 0);
    assert.ok(recency(boxed, w(2, "final")) > 0);
    const keyedDate = Object.assign(new Date("2026-09-15"), {
      season_year: 2026,
      week_number: 11,
      status: "open",
    }) as never;
    const keyedBytes = Object.assign(new Uint8Array(2), {
      season_year: 2026,
      week_number: 11,
      status: "open",
    }) as never;
    assert.equal(selectActiveWeek([keyedDate, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([keyedBytes, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([keyedDate]), null);
    assert.equal(selectActiveWeek([keyedBytes]), null);
    assert.ok(recency(keyedDate, w(2, "final")) > 0);
    assert.ok(recency(keyedBytes, w(2, "final")) > 0);
    // plain Object.create(null) week rows still rank
    const nullProto = Object.assign(Object.create(null), {
      season_year: 2026,
      week_number: 2,
      status: "final",
    });
    assert.equal(selectActiveWeek([w(1, "draft"), nullProto])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), nullProto])?.status, "final");
    // b: draft W1 + open W2 + leftover host object → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([when, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, bytes, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, bag])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([keyedDate, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([when, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover host object → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, when, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([when, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([keyedDate, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover host objects → W1
    assert.equal(selectActiveWeek([when, w(1, "final"), bytes])?.week_number, 1);
    assert.equal(selectActiveWeek([bag, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([when, bytes]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover host object → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([when, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, bytes, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, bag])?.id, "w2d");
    assert.equal(selectActiveWeek([keyedDate, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([when, skipped, dirty].sort(recency)[0]?.week_number, 2);
  });

  it("leftover throwing rows cannot hide a newer week (a–e)", () => {
    const boom = {
      get season_year() {
        throw new Error("leftover");
      },
      get week_number() {
        throw new Error("leftover");
      },
      get status() {
        throw new Error("leftover");
      },
    } as never;
    const { proxy, revoke } = Proxy.revocable(
      { season_year: 2026, week_number: 11, status: "open" },
      {},
    );
    revoke();
    const revoked = proxy as never;
    const trap = new Proxy(
      { season_year: 2026, week_number: 11, status: "open" },
      {
        get() {
          throw new Error("leftover");
        },
      },
    ) as never;
    // a: draft W1 + final W2 + leftover throwing row → active W2
    assert.equal(selectActiveWeek([boom, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), revoked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), trap])?.week_number, 2);
    assert.equal(selectActiveWeek([revoked, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([boom, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([boom]), null);
    assert.equal(selectActiveWeek([revoked, trap, boom]), null);
    assert.doesNotThrow(() => selectActiveWeek([boom, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([revoked, w(2, "final")]));
    assert.doesNotThrow(() => recency(boom, w(2, "final")));
    assert.doesNotThrow(() => recency(revoked, w(2, "final")));
    // leftover throwing row must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([boom, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, revoked])?.status, "draft");
    assert.ok(recency(boom, w(2, "final")) > 0);
    assert.ok(recency(revoked, w(2, "final")) > 0);
    assert.ok(recency(trap, w(2, "final")) > 0);
    // b: draft W1 + open W2 + leftover throwing row → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([boom, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, revoked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, trap])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([boom, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover throwing row → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, boom, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([revoked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([trap, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover throwing rows → W1
    assert.equal(selectActiveWeek([boom, w(1, "final"), revoked])?.week_number, 1);
    assert.equal(selectActiveWeek([trap, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([boom, revoked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover throwing row → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([boom, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, revoked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, trap])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([boom, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", boom), "The Harper House");
  });

  it("leftover unconvertible keys cannot hide a newer week (a–e)", () => {
    const nullKeys = {
      season_year: Object.create(null),
      week_number: Object.create(null),
      status: "open",
    } as never;
    const symbols = {
      season_year: Symbol("y"),
      week_number: Symbol("w"),
      status: "open",
    } as never;
    const throwVal = {
      season_year: {
        valueOf() {
          throw new Error("leftover");
        },
      },
      week_number: {
        valueOf() {
          throw new Error("leftover");
        },
      },
      status: "open",
    } as never;
    const throwPrim = {
      season_year: {
        [Symbol.toPrimitive]() {
          throw new Error("leftover");
        },
      },
      week_number: {
        [Symbol.toPrimitive]() {
          throw new Error("leftover");
        },
      },
      status: "open",
    } as never;
    const mixed = {
      season_year: Symbol("y"),
      week_number: 2,
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover unconvertible keys → active W2
    assert.equal(selectActiveWeek([nullKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), symbols, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), throwVal])?.week_number, 2);
    assert.equal(selectActiveWeek([throwPrim, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([nullKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([nullKeys]), null);
    assert.equal(selectActiveWeek([symbols, throwVal, throwPrim]), null);
    assert.doesNotThrow(() => selectActiveWeek([nullKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([symbols, w(2, "final")]));
    assert.doesNotThrow(() => recency(nullKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(symbols, w(2, "final")));
    assert.doesNotThrow(() => recency(throwVal, w(2, "final")));
    assert.doesNotThrow(() => recency(throwPrim, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(nullKeys));
    assert.doesNotThrow(() => nextWeekSlot(symbols));
    assert.deepEqual(nextWeekSlot(nullKeys), { season_year: 0, week_number: 1 });
    // leftover unconvertible keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([nullKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, symbols])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(nullKeys, w(2, "final")) > 0);
    assert.ok(recency(symbols, w(2, "final")) > 0);
    assert.ok(recency(throwVal, w(2, "final")) > 0);
    assert.ok(recency(throwPrim, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    // b: draft W1 + open W2 + leftover unconvertible keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([nullKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, symbols, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, throwVal])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([throwPrim, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([nullKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([symbols, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover unconvertible keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, nullKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([symbols, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([throwVal, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover unconvertible keys → W1
    assert.equal(selectActiveWeek([nullKeys, w(1, "final"), symbols])?.week_number, 1);
    assert.equal(selectActiveWeek([throwVal, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([nullKeys, symbols]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover unconvertible keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([nullKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, symbols, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, throwVal])?.id, "w2d");
    assert.equal(selectActiveWeek([throwPrim, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([nullKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", symbols), "The Harper House");
    assert.doesNotThrow(() => weekSwitcherLabel(symbols, e));
  });

  it("leftover object keys cannot hide a newer week (a–e)", () => {
    const arrayKeys = {
      season_year: [2026],
      week_number: [2],
      status: "open",
    } as never;
    const valueOfKeys = {
      season_year: {
        valueOf() {
          return 9999;
        },
      },
      week_number: {
        valueOf() {
          return 99;
        },
      },
      status: "open",
    } as never;
    const dateKeys = {
      season_year: new Date("2026-01-01T00:00:00Z"),
      week_number: new Date("2026-01-02T00:00:00Z"),
      status: "open",
    } as never;
    const boolKeys = {
      season_year: true,
      week_number: true,
      status: "open",
    } as never;
    const mixed = {
      season_year: [2026],
      week_number: 2,
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover object keys → active W2
    assert.equal(selectActiveWeek([arrayKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), valueOfKeys, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), dateKeys])?.week_number, 2);
    assert.equal(selectActiveWeek([boolKeys, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([arrayKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([arrayKeys]), null);
    assert.equal(selectActiveWeek([valueOfKeys, dateKeys, boolKeys]), null);
    assert.doesNotThrow(() => selectActiveWeek([arrayKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([valueOfKeys, w(2, "final")]));
    assert.doesNotThrow(() => recency(arrayKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(valueOfKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(dateKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(boolKeys, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(arrayKeys));
    assert.doesNotThrow(() => nextWeekSlot(valueOfKeys));
    assert.deepEqual(nextWeekSlot(arrayKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(dateKeys), { season_year: 0, week_number: 1 });
    // leftover object keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([arrayKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, valueOfKeys])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(arrayKeys, w(2, "final")) > 0);
    assert.ok(recency(valueOfKeys, w(2, "final")) > 0);
    assert.ok(recency(dateKeys, w(2, "final")) > 0);
    assert.ok(recency(boolKeys, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    // b: draft W1 + open W2 + leftover object keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([arrayKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, valueOfKeys, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, dateKeys])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([boolKeys, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([arrayKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([valueOfKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover object keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, arrayKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([valueOfKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([dateKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover object keys → W1
    assert.equal(selectActiveWeek([arrayKeys, w(1, "final"), valueOfKeys])?.week_number, 1);
    assert.equal(selectActiveWeek([dateKeys, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([arrayKeys, valueOfKeys]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover object keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([arrayKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, valueOfKeys, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, dateKeys])?.id, "w2d");
    assert.equal(selectActiveWeek([boolKeys, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([arrayKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", arrayKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", dateKeys), "The Harper House");
    assert.doesNotThrow(() => weekSwitcherLabel(arrayKeys, e));
  });

  it("leftover non-numeric string keys cannot hide a newer week (a–e)", () => {
    const blankKeys = {
      season_year: "",
      week_number: "",
      status: "open",
    } as never;
    const whitespaceKeys = {
      season_year: "  ",
      week_number: "\t",
      status: "open",
    } as never;
    const junkKeys = {
      season_year: "not-a-year",
      week_number: "week-1",
      status: "open",
    } as never;
    const infStringKeys = {
      season_year: "Infinity",
      week_number: "NaN",
      status: "open",
    } as never;
    const mixed = {
      season_year: "foo",
      week_number: 2,
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover non-numeric string keys → active W2
    assert.equal(selectActiveWeek([blankKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), whitespaceKeys, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), junkKeys])?.week_number, 2);
    assert.equal(selectActiveWeek([infStringKeys, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([blankKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([blankKeys]), null);
    assert.equal(selectActiveWeek([whitespaceKeys, junkKeys, infStringKeys]), null);
    assert.doesNotThrow(() => selectActiveWeek([blankKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([junkKeys, w(2, "final")]));
    assert.doesNotThrow(() => recency(blankKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(whitespaceKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(junkKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(infStringKeys, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(blankKeys));
    assert.doesNotThrow(() => nextWeekSlot(junkKeys));
    assert.deepEqual(nextWeekSlot(blankKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(whitespaceKeys), { season_year: 0, week_number: 1 });
    // leftover non-numeric string keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([blankKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, junkKeys])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(blankKeys, w(2, "final")) > 0);
    assert.ok(recency(whitespaceKeys, w(2, "final")) > 0);
    assert.ok(recency(junkKeys, w(2, "final")) > 0);
    assert.ok(recency(infStringKeys, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    // numeric strings still rank — leftover skip is blank/unparseable only
    assert.equal(selectActiveWeek([{ ...w(1, "open"), season_year: "2026", week_number: "1" }])?.status, "open");
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // b: draft W1 + open W2 + leftover non-numeric string keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([blankKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, whitespaceKeys, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, junkKeys])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([infStringKeys, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([blankKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([junkKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover non-numeric string keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, blankKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([whitespaceKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([junkKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover non-numeric string keys → W1
    assert.equal(selectActiveWeek([blankKeys, w(1, "final"), junkKeys])?.week_number, 1);
    assert.equal(selectActiveWeek([whitespaceKeys, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([blankKeys, junkKeys]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover non-numeric string keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([blankKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, junkKeys, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, whitespaceKeys])?.id, "w2d");
    assert.equal(selectActiveWeek([infStringKeys, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([blankKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", blankKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", junkKeys), "The Harper House");
    assert.doesNotThrow(() => weekSwitcherLabel(blankKeys, e));
  });

  it("leftover non-decimal string keys cannot hide a newer week (a–e)", () => {
    const hexKeys = {
      season_year: "0xA",
      week_number: "0xA",
      status: "open",
    } as never;
    const binKeys = {
      season_year: "0b10",
      week_number: "0b1010",
      status: "open",
    } as never;
    const octKeys = {
      season_year: "0o12",
      week_number: "0o12",
      status: "open",
    } as never;
    const sciKeys = {
      season_year: "1e1",
      week_number: "1e1",
      status: "open",
    } as never;
    const mixed = {
      season_year: "0x7EA",
      week_number: 2,
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover non-decimal string keys → active W2
    assert.equal(selectActiveWeek([hexKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), binKeys, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), octKeys])?.week_number, 2);
    assert.equal(selectActiveWeek([sciKeys, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([hexKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([hexKeys]), null);
    assert.equal(selectActiveWeek([binKeys, octKeys, sciKeys]), null);
    assert.doesNotThrow(() => selectActiveWeek([hexKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([octKeys, w(2, "final")]));
    assert.doesNotThrow(() => recency(hexKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(binKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(octKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(sciKeys, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(hexKeys));
    assert.doesNotThrow(() => nextWeekSlot(octKeys));
    assert.deepEqual(nextWeekSlot(hexKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(binKeys), { season_year: 0, week_number: 1 });
    // leftover non-decimal string keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([hexKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, octKeys])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(hexKeys, w(2, "final")) > 0);
    assert.ok(recency(binKeys, w(2, "final")) > 0);
    assert.ok(recency(octKeys, w(2, "final")) > 0);
    assert.ok(recency(sciKeys, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    // numeric decimal strings still rank — leftover skip is hex/bin/oct/exponent only
    assert.equal(selectActiveWeek([{ ...w(1, "open"), season_year: "2026", week_number: "1" }])?.status, "open");
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // b: draft W1 + open W2 + leftover non-decimal string keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([hexKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, binKeys, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, octKeys])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([sciKeys, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([hexKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([octKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover non-decimal string keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, hexKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([binKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([octKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover non-decimal string keys → W1
    assert.equal(selectActiveWeek([hexKeys, w(1, "final"), octKeys])?.week_number, 1);
    assert.equal(selectActiveWeek([binKeys, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([hexKeys, octKeys]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover non-decimal string keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([hexKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, octKeys, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, binKeys])?.id, "w2d");
    assert.equal(selectActiveWeek([sciKeys, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([hexKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", hexKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", octKeys), "The Harper House");
    assert.doesNotThrow(() => weekSwitcherLabel(hexKeys, e));
  });

  it("leftover bigint keys cannot hide a newer week (a–e)", () => {
    const yearKeys = {
      season_year: 2026n,
      week_number: 1n,
      status: "open",
    } as never;
    const tenKeys = {
      season_year: 2026n,
      week_number: 10n,
      status: "open",
    } as never;
    const zeroKeys = {
      season_year: 0n,
      week_number: 0n,
      status: "open",
    } as never;
    const mixed = {
      season_year: 2026n,
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: 2n,
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover bigint keys → active W2
    assert.equal(selectActiveWeek([yearKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), tenKeys, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), zeroKeys])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([yearKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([yearKeys]), null);
    assert.equal(selectActiveWeek([tenKeys, zeroKeys, mixed]), null);
    assert.doesNotThrow(() => selectActiveWeek([yearKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([tenKeys, w(2, "final")]));
    assert.doesNotThrow(() => recency(yearKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(tenKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(zeroKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(yearKeys));
    assert.doesNotThrow(() => nextWeekSlot(tenKeys));
    assert.deepEqual(nextWeekSlot(yearKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(tenKeys), { season_year: 0, week_number: 1 });
    // leftover bigint keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([yearKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, tenKeys])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(yearKeys, w(2, "final")) > 0);
    assert.ok(recency(tenKeys, w(2, "final")) > 0);
    assert.ok(recency(zeroKeys, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // numeric keys still rank — leftover skip is bigint only
    assert.equal(selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status, "open");
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // b: draft W1 + open W2 + leftover bigint keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([yearKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, tenKeys, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, zeroKeys])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([yearKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([tenKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover bigint keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, yearKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([tenKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([zeroKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover bigint keys → W1
    assert.equal(selectActiveWeek([yearKeys, w(1, "final"), tenKeys])?.week_number, 1);
    assert.equal(selectActiveWeek([zeroKeys, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([yearKeys, tenKeys]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover bigint keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([yearKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, tenKeys, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, zeroKeys])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([yearKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", yearKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", tenKeys), "The Harper House");
    assert.doesNotThrow(() => weekSwitcherLabel(yearKeys, e));
  });

  it("leftover non-integer keys cannot hide a newer week (a–e)", () => {
    const halfKeys = {
      season_year: 2026.5,
      week_number: 2.5,
      status: "open",
    } as never;
    const stringKeys = {
      season_year: "2026.5",
      week_number: "2.5",
      status: "open",
    } as never;
    const tenthKeys = {
      season_year: 0.5,
      week_number: 0.5,
      status: "open",
    } as never;
    const mixed = {
      season_year: 2026.5,
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: "2.5",
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover non-integer keys → active W2
    assert.equal(selectActiveWeek([halfKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), stringKeys, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), tenthKeys])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([halfKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([halfKeys]), null);
    assert.equal(selectActiveWeek([stringKeys, tenthKeys, mixed]), null);
    assert.doesNotThrow(() => selectActiveWeek([halfKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([stringKeys, w(2, "final")]));
    assert.doesNotThrow(() => recency(halfKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(stringKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(tenthKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(halfKeys));
    assert.doesNotThrow(() => nextWeekSlot(stringKeys));
    assert.deepEqual(nextWeekSlot(halfKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(stringKeys), { season_year: 0, week_number: 1 });
    // leftover non-integer keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([halfKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, stringKeys])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(halfKeys, w(2, "final")) > 0);
    assert.ok(recency(stringKeys, w(2, "final")) > 0);
    assert.ok(recency(tenthKeys, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // integer keys still rank — leftover skip is fractional only
    assert.equal(selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status, "open");
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // b: draft W1 + open W2 + leftover non-integer keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([halfKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, stringKeys, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, tenthKeys])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([halfKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([stringKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover non-integer keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, halfKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([stringKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([tenthKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover non-integer keys → W1
    assert.equal(selectActiveWeek([halfKeys, w(1, "final"), stringKeys])?.week_number, 1);
    assert.equal(selectActiveWeek([tenthKeys, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([halfKeys, stringKeys]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover non-integer keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([halfKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, stringKeys, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, tenthKeys])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([halfKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", halfKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", stringKeys), "The Harper House");
    assert.doesNotThrow(() => weekSwitcherLabel(halfKeys, e));
  });

  it("leftover non-positive keys cannot hide a newer week (a–e)", () => {
    const zeroKeys = {
      season_year: 0,
      week_number: 0,
      status: "open",
    } as never;
    const negativeKeys = {
      season_year: -2026,
      week_number: -1,
      status: "open",
    } as never;
    const stringKeys = {
      season_year: "0",
      week_number: "0",
      status: "open",
    } as never;
    const mixed = {
      season_year: 2026,
      week_number: 0,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: "-1",
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover non-positive keys → active W2
    assert.equal(selectActiveWeek([zeroKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), stringKeys, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), negativeKeys])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([zeroKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([zeroKeys]), null);
    assert.equal(selectActiveWeek([stringKeys, negativeKeys, mixed]), null);
    assert.doesNotThrow(() => selectActiveWeek([zeroKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([stringKeys, w(2, "final")]));
    assert.doesNotThrow(() => recency(zeroKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(stringKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(negativeKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(zeroKeys));
    assert.doesNotThrow(() => nextWeekSlot(stringKeys));
    assert.deepEqual(nextWeekSlot(zeroKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(stringKeys), { season_year: 0, week_number: 1 });
    // leftover non-positive keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([zeroKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, stringKeys])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(zeroKeys, w(2, "final")) > 0);
    assert.ok(recency(stringKeys, w(2, "final")) > 0);
    assert.ok(recency(negativeKeys, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // positive integer keys still rank — leftover skip is non-positive only
    assert.equal(selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status, "open");
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // b: draft W1 + open W2 + leftover non-positive keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([zeroKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, stringKeys, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, negativeKeys])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([zeroKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([stringKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover non-positive keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, zeroKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([stringKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([negativeKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover non-positive keys → W1
    assert.equal(selectActiveWeek([zeroKeys, w(1, "final"), stringKeys])?.week_number, 1);
    assert.equal(selectActiveWeek([negativeKeys, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([zeroKeys, stringKeys]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover non-positive keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([zeroKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, stringKeys, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, negativeKeys])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([zeroKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", zeroKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", stringKeys), "The Harper House");
    assert.doesNotThrow(() => weekSwitcherLabel(zeroKeys, e));
  });

  it("leftover infinity keys cannot hide a newer week (a–e)", () => {
    const infKeys = {
      season_year: Number.POSITIVE_INFINITY,
      week_number: Number.POSITIVE_INFINITY,
      status: "open",
    } as never;
    const negInfKeys = {
      season_year: Number.NEGATIVE_INFINITY,
      week_number: Number.NEGATIVE_INFINITY,
      status: "open",
    } as never;
    const mixed = {
      season_year: 2026,
      week_number: Number.POSITIVE_INFINITY,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: Number.POSITIVE_INFINITY,
      week_number: 2,
      status: "open",
    } as never;
    const mixedNeg = {
      season_year: 2026,
      week_number: Number.NEGATIVE_INFINITY,
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover infinity keys → active W2
    assert.equal(selectActiveWeek([infKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), negInfKeys, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), mixed])?.week_number, 2);
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedNeg, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([infKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([infKeys]), null);
    assert.equal(selectActiveWeek([negInfKeys, mixed, mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([infKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([negInfKeys, w(2, "final")]));
    assert.doesNotThrow(() => recency(infKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(negInfKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(infKeys));
    assert.doesNotThrow(() => nextWeekSlot(negInfKeys));
    assert.deepEqual(nextWeekSlot(infKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(negInfKeys), { season_year: 0, week_number: 1 });
    // leftover infinity keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([infKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, negInfKeys])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(infKeys, w(2, "final")) > 0);
    assert.ok(recency(negInfKeys, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    assert.ok(recency(mixedNeg, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is infinity only
    assert.equal(selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status, "open");
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is infinity only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover infinity keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([infKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, negInfKeys, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, mixed])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedNeg, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([infKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([negInfKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover infinity keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, infKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([negInfKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover infinity keys → W1
    assert.equal(selectActiveWeek([infKeys, w(1, "final"), negInfKeys])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([infKeys, negInfKeys]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover infinity keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([infKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, negInfKeys, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, mixed])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedNeg, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([infKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", infKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", negInfKeys), "The Harper House");
    assert.doesNotThrow(() => weekSwitcherLabel(infKeys, e));
  });

  it("leftover nan keys cannot hide a newer week (a–e)", () => {
    const nanKeys = {
      season_year: Number.NaN,
      week_number: Number.NaN,
      status: "open",
    } as never;
    const nanLocked = {
      season_year: Number.NaN,
      week_number: Number.NaN,
      status: "locked",
    } as never;
    const mixed = {
      season_year: 2026,
      week_number: Number.NaN,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: Number.NaN,
      week_number: 2,
      status: "open",
    } as never;
    const zeroOverZero = {
      season_year: 0 / 0,
      week_number: 0 / 0,
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover nan keys → active W2
    assert.equal(selectActiveWeek([nanKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), nanLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), mixed])?.week_number, 2);
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([zeroOverZero, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([nanKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([nanKeys]), null);
    assert.equal(selectActiveWeek([nanLocked, mixed, mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([nanKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([nanLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(nanKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(nanLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(nanKeys));
    assert.doesNotThrow(() => nextWeekSlot(nanLocked));
    assert.deepEqual(nextWeekSlot(nanKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(nanLocked), { season_year: 0, week_number: 1 });
    // leftover nan keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([nanKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, nanLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(nanKeys, w(2, "final")) > 0);
    assert.ok(recency(nanLocked, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    assert.ok(recency(zeroOverZero, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is nan only
    assert.equal(selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status, "open");
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is nan only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover nan keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([nanKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, nanLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, mixed])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([zeroOverZero, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([nanKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([nanLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover nan keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, nanKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([nanLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover nan keys → W1
    assert.equal(selectActiveWeek([nanKeys, w(1, "final"), nanLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([nanKeys, nanLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover nan keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([nanKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, nanLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, mixed])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([zeroOverZero, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([nanKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", nanKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", nanLocked), "The Harper House");
    assert.doesNotThrow(() => weekSwitcherLabel(nanKeys, e));
  });

  it("leftover null keys cannot hide a newer week (a–e)", () => {
    const nullKeys = {
      season_year: null,
      week_number: null,
      status: "open",
    } as never;
    const nullLocked = {
      season_year: null,
      week_number: null,
      status: "locked",
    } as never;
    const mixed = {
      season_year: 2026,
      week_number: null,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: null,
      week_number: 2,
      status: "open",
    } as never;
    const jsonNull = JSON.parse(
      '{"season_year":null,"week_number":null,"status":"open"}',
    ) as never;
    // a: draft W1 + final W2 + leftover null keys → active W2
    assert.equal(selectActiveWeek([nullKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), nullLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), mixed])?.week_number, 2);
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([jsonNull, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([nullKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([nullKeys]), null);
    assert.equal(selectActiveWeek([nullLocked, mixed, mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([nullKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([nullLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(nullKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(nullLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(nullKeys));
    assert.doesNotThrow(() => nextWeekSlot(nullLocked));
    assert.deepEqual(nextWeekSlot(nullKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(nullLocked), { season_year: 0, week_number: 1 });
    // leftover null keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([nullKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, nullLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(nullKeys, w(2, "final")) > 0);
    assert.ok(recency(nullLocked, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    assert.ok(recency(jsonNull, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is null only
    assert.equal(selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status, "open");
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is null only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover null keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([nullKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, nullLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, mixed])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([jsonNull, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([nullKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([nullLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover null keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, nullKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([nullLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover null keys → W1
    assert.equal(selectActiveWeek([nullKeys, w(1, "final"), nullLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([nullKeys, nullLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover null keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([nullKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, nullLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, mixed])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([jsonNull, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([nullKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", nullKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", nullLocked), "The Harper House");
    assert.doesNotThrow(() => weekSwitcherLabel(nullKeys, e));
  });

  it("leftover undefined keys cannot hide a newer week (a–e)", () => {
    const undefinedKeys = {
      season_year: undefined,
      week_number: undefined,
      status: "open",
    } as never;
    const undefinedLocked = {
      season_year: undefined,
      week_number: undefined,
      status: "locked",
    } as never;
    const mixed = {
      season_year: 2026,
      week_number: undefined,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: undefined,
      week_number: 2,
      status: "open",
    } as never;
    const voidKeys = {
      season_year: void 0,
      week_number: void 0,
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover undefined keys → active W2
    assert.equal(selectActiveWeek([undefinedKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), undefinedLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), mixed])?.week_number, 2);
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([voidKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([undefinedKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([undefinedKeys]), null);
    assert.equal(selectActiveWeek([undefinedLocked, mixed, mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([undefinedKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([undefinedLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(undefinedKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(undefinedLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(undefinedKeys));
    assert.doesNotThrow(() => nextWeekSlot(undefinedLocked));
    assert.deepEqual(nextWeekSlot(undefinedKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(undefinedLocked), { season_year: 0, week_number: 1 });
    // leftover undefined keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([undefinedKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, undefinedLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(undefinedKeys, w(2, "final")) > 0);
    assert.ok(recency(undefinedLocked, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    assert.ok(recency(voidKeys, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is undefined only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is undefined only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover undefined keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([undefinedKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, undefinedLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, mixed])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([voidKeys, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([undefinedKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([undefinedLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover undefined keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, undefinedKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([undefinedLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover undefined keys → W1
    assert.equal(selectActiveWeek([undefinedKeys, w(1, "final"), undefinedLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([undefinedKeys, undefinedLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover undefined keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([undefinedKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, undefinedLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, mixed])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([voidKeys, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([undefinedKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", undefinedKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", undefinedLocked), "The Harper House");
    assert.doesNotThrow(() => weekSwitcherLabel(undefinedKeys, e));
  });

  it("leftover accessor keys cannot hide a newer week (a–e)", () => {
    const accessorKeys = {
      get season_year() {
        return 2026;
      },
      get week_number() {
        return 11;
      },
      status: "open",
    } as never;
    const accessorLocked = {
      get season_year() {
        return 2026;
      },
      get week_number() {
        return 11;
      },
      status: "locked",
    } as never;
    const mixed = {
      season_year: 2026,
      get week_number() {
        return 11;
      },
      status: "open",
    } as never;
    const mixedWeek = {
      get season_year() {
        return 2026;
      },
      week_number: 2,
      status: "open",
    } as never;
    const proxyKeys = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "season_year") return 2026;
          if (prop === "week_number") return 11;
          if (prop === "status") return "open";
          return undefined;
        },
      },
    ) as never;
    // a: draft W1 + final W2 + leftover accessor keys → active W2
    assert.equal(selectActiveWeek([accessorKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), accessorLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), mixed])?.week_number, 2);
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([proxyKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([accessorKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([accessorKeys]), null);
    assert.equal(selectActiveWeek([accessorLocked, mixed, mixedWeek]), null);
    assert.equal(selectActiveWeek([proxyKeys]), null);
    assert.doesNotThrow(() => selectActiveWeek([accessorKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([accessorLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(accessorKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(accessorLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => recency(proxyKeys, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(accessorKeys));
    assert.doesNotThrow(() => nextWeekSlot(accessorLocked));
    assert.deepEqual(nextWeekSlot(accessorKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(accessorLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(proxyKeys), { season_year: 0, week_number: 1 });
    // leftover accessor keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([accessorKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, accessorLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([proxyKeys, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(accessorKeys, w(2, "final")) > 0);
    assert.ok(recency(accessorLocked, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    assert.ok(recency(proxyKeys, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is accessor only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is accessor only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover accessor keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([accessorKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, accessorLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, mixed])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([proxyKeys, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([accessorKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([accessorLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([proxyKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover accessor keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, accessorKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([accessorLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([proxyKeys, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover accessor keys → W1
    assert.equal(selectActiveWeek([accessorKeys, w(1, "final"), accessorLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([accessorKeys, accessorLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover accessor keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([accessorKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, accessorLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, mixed])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([proxyKeys, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([accessorKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", accessorKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", accessorLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", proxyKeys), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", accessorKeys), "The Harper House · Week 11");
    assert.doesNotThrow(() => weekSwitcherLabel(accessorKeys, e));
  });

  it("leftover boolean keys cannot hide a newer week (a–e)", () => {
    const trueKeys = {
      season_year: true,
      week_number: true,
      status: "open",
    } as never;
    const trueLocked = {
      season_year: true,
      week_number: true,
      status: "locked",
    } as never;
    const falseKeys = {
      season_year: false,
      week_number: false,
      status: "open",
    } as never;
    const mixed = {
      season_year: true,
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: true,
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover boolean keys → active W2
    assert.equal(selectActiveWeek([trueKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), trueLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), falseKeys])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([trueKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([trueKeys]), null);
    assert.equal(selectActiveWeek([trueLocked, falseKeys, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([trueKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([trueLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(trueKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(trueLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(falseKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(trueKeys));
    assert.doesNotThrow(() => nextWeekSlot(trueLocked));
    assert.deepEqual(nextWeekSlot(trueKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(trueLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(falseKeys), { season_year: 0, week_number: 1 });
    // leftover boolean keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([trueKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, trueLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([falseKeys, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(trueKeys, w(2, "final")) > 0);
    assert.ok(recency(trueLocked, w(2, "final")) > 0);
    assert.ok(recency(falseKeys, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is boolean only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is boolean only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover boolean keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([trueKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, trueLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, falseKeys])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([trueKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([trueLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([falseKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover boolean keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, trueKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([trueLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([falseKeys, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover boolean keys → W1
    assert.equal(selectActiveWeek([trueKeys, w(1, "final"), trueLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([trueKeys, trueLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover boolean keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([trueKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, trueLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, falseKeys])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([trueKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", trueKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", trueLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", falseKeys), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", trueKeys), "The Harper House · Week 1");
    assert.notEqual(familyWeekChrome("The Harper House", falseKeys), "The Harper House · Week 0");
    assert.doesNotThrow(() => weekSwitcherLabel(trueKeys, e));
  });

  it("leftover symbol keys cannot hide a newer week (a–e)", () => {
    const symbolKeys = {
      season_year: Symbol("y"),
      week_number: Symbol("w"),
      status: "open",
    } as never;
    const symbolLocked = {
      season_year: Symbol("y"),
      week_number: Symbol("w"),
      status: "locked",
    } as never;
    const wellKnown = {
      season_year: Symbol.for("year"),
      week_number: Symbol.for("week"),
      status: "open",
    } as never;
    const mixed = {
      season_year: Symbol("y"),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: Symbol("w"),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover symbol keys → active W2
    assert.equal(selectActiveWeek([symbolKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), symbolLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), wellKnown])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([symbolKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([symbolKeys]), null);
    assert.equal(selectActiveWeek([symbolLocked, wellKnown, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([symbolKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([symbolLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(symbolKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(symbolLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(wellKnown, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(symbolKeys));
    assert.doesNotThrow(() => nextWeekSlot(symbolLocked));
    assert.deepEqual(nextWeekSlot(symbolKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(symbolLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(wellKnown), { season_year: 0, week_number: 1 });
    // leftover symbol keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([symbolKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, symbolLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([wellKnown, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(symbolKeys, w(2, "final")) > 0);
    assert.ok(recency(symbolLocked, w(2, "final")) > 0);
    assert.ok(recency(wellKnown, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is symbol only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is symbol only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover symbol keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([symbolKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, symbolLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, wellKnown])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([symbolKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([symbolLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([wellKnown, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover symbol keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, symbolKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([symbolLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([wellKnown, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover symbol keys → W1
    assert.equal(selectActiveWeek([symbolKeys, w(1, "final"), symbolLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([symbolKeys, symbolLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover symbol keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([symbolKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, symbolLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, wellKnown])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([symbolKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", symbolKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", symbolLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", wellKnown), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", symbolKeys), "The Harper House · Week 0");
    assert.doesNotThrow(() => weekSwitcherLabel(symbolKeys, e));
  });

  it("leftover function keys cannot hide a newer week (a–e)", () => {
    const fnKeys = {
      season_year: () => 2026,
      week_number: () => 2,
      status: "open",
    } as never;
    const fnLocked = {
      season_year: () => 2026,
      week_number: () => 2,
      status: "locked",
    } as never;
    const ctorFn = {
      season_year: Function("return 2026"),
      week_number: Function("return 2"),
      status: "open",
    } as never;
    const mixed = {
      season_year: () => 2026,
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: () => 2,
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover function keys → active W2
    assert.equal(selectActiveWeek([fnKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), fnLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), ctorFn])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([fnKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([fnKeys]), null);
    assert.equal(selectActiveWeek([fnLocked, ctorFn, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([fnKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([fnLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(fnKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(fnLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(ctorFn, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(fnKeys));
    assert.doesNotThrow(() => nextWeekSlot(fnLocked));
    assert.deepEqual(nextWeekSlot(fnKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(fnLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(ctorFn), { season_year: 0, week_number: 1 });
    // leftover function keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([fnKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, fnLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([ctorFn, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(fnKeys, w(2, "final")) > 0);
    assert.ok(recency(fnLocked, w(2, "final")) > 0);
    assert.ok(recency(ctorFn, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is function only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is function only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover function keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([fnKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, fnLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, ctorFn])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([fnKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([fnLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([ctorFn, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover function keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, fnKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([fnLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([ctorFn, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover function keys → W1
    assert.equal(selectActiveWeek([fnKeys, w(1, "final"), fnLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([fnKeys, fnLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover function keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([fnKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, fnLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, ctorFn])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([fnKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", fnKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", fnLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", ctorFn), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", fnKeys), "The Harper House · Week 0");
    assert.doesNotThrow(() => weekSwitcherLabel(fnKeys, e));
  });

  it("leftover array keys cannot hide a newer week (a–e)", () => {
    const arrayKeys = {
      season_year: [2026],
      week_number: [2],
      status: "open",
    } as never;
    const arrayLocked = {
      season_year: [2026],
      week_number: [2],
      status: "locked",
    } as never;
    const emptyArray = {
      season_year: [],
      week_number: [],
      status: "open",
    } as never;
    const mixed = {
      season_year: [2026],
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: [2],
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover array keys → active W2
    assert.equal(selectActiveWeek([arrayKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), arrayLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), emptyArray])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([arrayKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([arrayKeys]), null);
    assert.equal(selectActiveWeek([arrayLocked, emptyArray, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([arrayKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([arrayLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(arrayKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(arrayLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyArray, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(arrayKeys));
    assert.doesNotThrow(() => nextWeekSlot(arrayLocked));
    assert.deepEqual(nextWeekSlot(arrayKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(arrayLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyArray), { season_year: 0, week_number: 1 });
    // leftover array keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([arrayKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, arrayLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyArray, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(arrayKeys, w(2, "final")) > 0);
    assert.ok(recency(arrayLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyArray, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is array only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is array only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover array keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([arrayKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, arrayLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyArray])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([arrayKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([arrayLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyArray, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover array keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, arrayKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([arrayLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyArray, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover array keys → W1
    assert.equal(selectActiveWeek([arrayKeys, w(1, "final"), arrayLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([arrayKeys, arrayLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover array keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([arrayKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, arrayLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyArray])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([arrayKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", arrayKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", arrayLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyArray), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", arrayKeys), "The Harper House · Week 2");
    assert.doesNotThrow(() => weekSwitcherLabel(arrayKeys, e));
  });

  it("leftover date keys cannot hide a newer week (a–e)", () => {
    const dateKeys = {
      season_year: new Date("2026-01-01T00:00:00Z"),
      week_number: new Date("2026-01-02T00:00:00Z"),
      status: "open",
    } as never;
    const dateLocked = {
      season_year: new Date("2026-01-01T00:00:00Z"),
      week_number: new Date("2026-01-02T00:00:00Z"),
      status: "locked",
    } as never;
    const invalidDate = {
      season_year: new Date("not-a-date"),
      week_number: new Date("not-a-date"),
      status: "open",
    } as never;
    const mixed = {
      season_year: new Date("2026-01-01T00:00:00Z"),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new Date("2026-01-02T00:00:00Z"),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover date keys → active W2
    assert.equal(selectActiveWeek([dateKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), dateLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), invalidDate])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([dateKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([dateKeys]), null);
    assert.equal(selectActiveWeek([dateLocked, invalidDate, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([dateKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([dateLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(dateKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(dateLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(invalidDate, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(dateKeys));
    assert.doesNotThrow(() => nextWeekSlot(dateLocked));
    assert.deepEqual(nextWeekSlot(dateKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(dateLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(invalidDate), { season_year: 0, week_number: 1 });
    // leftover date keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([dateKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, dateLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([invalidDate, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(dateKeys, w(2, "final")) > 0);
    assert.ok(recency(dateLocked, w(2, "final")) > 0);
    assert.ok(recency(invalidDate, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is date only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is date only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover date keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([dateKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, dateLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, invalidDate])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([dateKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([dateLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([invalidDate, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover date keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, dateKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([dateLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([invalidDate, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover date keys → W1
    assert.equal(selectActiveWeek([dateKeys, w(1, "final"), dateLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([dateKeys, dateLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover date keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([dateKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, dateLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, invalidDate])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([dateKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", dateKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", dateLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", invalidDate), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", dateKeys),
      `The Harper House · Week ${Number(new Date("2026-01-02T00:00:00Z"))}`,
    );
    assert.doesNotThrow(() => weekSwitcherLabel(dateKeys, e));
  });

  it("leftover map keys cannot hide a newer week (a–e)", () => {
    const mapKeys = {
      season_year: new Map([["y", 2026]]),
      week_number: new Map([["w", 2]]),
      status: "open",
    } as never;
    const mapLocked = {
      season_year: new Map([["y", 2026]]),
      week_number: new Map([["w", 2]]),
      status: "locked",
    } as never;
    const emptyMap = {
      season_year: new Map(),
      week_number: new Map(),
      status: "open",
    } as never;
    const mixed = {
      season_year: new Map([["y", 2026]]),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new Map([["w", 2]]),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover map keys → active W2
    assert.equal(selectActiveWeek([mapKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), mapLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), emptyMap])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([mapKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([mapKeys]), null);
    assert.equal(selectActiveWeek([mapLocked, emptyMap, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([mapKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([mapLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(mapKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(mapLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyMap, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(mapKeys));
    assert.doesNotThrow(() => nextWeekSlot(mapLocked));
    assert.deepEqual(nextWeekSlot(mapKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(mapLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyMap), { season_year: 0, week_number: 1 });
    // leftover map keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([mapKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, mapLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyMap, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(mapKeys, w(2, "final")) > 0);
    assert.ok(recency(mapLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyMap, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is map only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is map only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover map keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([mapKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, mapLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyMap])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([mapKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([mapLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyMap, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover map keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, mapKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([mapLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyMap, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover map keys → W1
    assert.equal(selectActiveWeek([mapKeys, w(1, "final"), mapLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mapKeys, mapLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover map keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([mapKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, mapLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyMap])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([mapKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", mapKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", mapLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyMap), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", mapKeys), "The Harper House · Week NaN");
    assert.doesNotThrow(() => weekSwitcherLabel(mapKeys, e));
  });

  it("leftover set keys cannot hide a newer week (a–e)", () => {
    const setKeys = {
      season_year: new Set([2026]),
      week_number: new Set([2]),
      status: "open",
    } as never;
    const setLocked = {
      season_year: new Set([2026]),
      week_number: new Set([2]),
      status: "locked",
    } as never;
    const emptySet = {
      season_year: new Set(),
      week_number: new Set(),
      status: "open",
    } as never;
    const mixed = {
      season_year: new Set([2026]),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new Set([2]),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover set keys → active W2
    assert.equal(selectActiveWeek([setKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), setLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), emptySet])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([setKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([setKeys]), null);
    assert.equal(selectActiveWeek([setLocked, emptySet, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([setKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([setLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(setKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(setLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptySet, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(setKeys));
    assert.doesNotThrow(() => nextWeekSlot(setLocked));
    assert.deepEqual(nextWeekSlot(setKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(setLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptySet), { season_year: 0, week_number: 1 });
    // leftover set keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([setKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, setLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptySet, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(setKeys, w(2, "final")) > 0);
    assert.ok(recency(setLocked, w(2, "final")) > 0);
    assert.ok(recency(emptySet, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is set only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is set only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover set keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([setKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, setLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptySet])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([setKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([setLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptySet, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover set keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, setKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([setLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptySet, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover set keys → W1
    assert.equal(selectActiveWeek([setKeys, w(1, "final"), setLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([setKeys, setLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover set keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([setKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, setLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptySet])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([setKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", setKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", setLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptySet), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", setKeys), "The Harper House · Week NaN");
    assert.doesNotThrow(() => weekSwitcherLabel(setKeys, e));
  });

  it("leftover weakmap keys cannot hide a newer week (a–e)", () => {
    const weakMapKeys = {
      season_year: new WeakMap([[{}, 2026]]),
      week_number: new WeakMap([[{}, 2]]),
      status: "open",
    } as never;
    const weakMapLocked = {
      season_year: new WeakMap([[{}, 2026]]),
      week_number: new WeakMap([[{}, 2]]),
      status: "locked",
    } as never;
    const emptyWeakMap = {
      season_year: new WeakMap(),
      week_number: new WeakMap(),
      status: "open",
    } as never;
    const mixed = {
      season_year: new WeakMap([[{}, 2026]]),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new WeakMap([[{}, 2]]),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover weakmap keys → active W2
    assert.equal(selectActiveWeek([weakMapKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), weakMapLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), emptyWeakMap])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([weakMapKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([weakMapKeys]), null);
    assert.equal(selectActiveWeek([weakMapLocked, emptyWeakMap, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([weakMapKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([weakMapLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(weakMapKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(weakMapLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyWeakMap, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(weakMapKeys));
    assert.doesNotThrow(() => nextWeekSlot(weakMapLocked));
    assert.deepEqual(nextWeekSlot(weakMapKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(weakMapLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyWeakMap), { season_year: 0, week_number: 1 });
    // leftover weakmap keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([weakMapKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, weakMapLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyWeakMap, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(weakMapKeys, w(2, "final")) > 0);
    assert.ok(recency(weakMapLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyWeakMap, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is weakmap only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is weakmap only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover weakmap keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([weakMapKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, weakMapLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyWeakMap])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([weakMapKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([weakMapLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyWeakMap, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover weakmap keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, weakMapKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([weakMapLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyWeakMap, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover weakmap keys → W1
    assert.equal(selectActiveWeek([weakMapKeys, w(1, "final"), weakMapLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([weakMapKeys, weakMapLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover weakmap keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([weakMapKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, weakMapLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyWeakMap])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([weakMapKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", weakMapKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", weakMapLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyWeakMap), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", weakMapKeys), "The Harper House · Week NaN");
    assert.doesNotThrow(() => weekSwitcherLabel(weakMapKeys, e));
  });

  it("leftover weakset keys cannot hide a newer week (a–e)", () => {
    const weakSetKeys = {
      season_year: new WeakSet([{}]),
      week_number: new WeakSet([{}]),
      status: "open",
    } as never;
    const weakSetLocked = {
      season_year: new WeakSet([{}]),
      week_number: new WeakSet([{}]),
      status: "locked",
    } as never;
    const emptyWeakSet = {
      season_year: new WeakSet(),
      week_number: new WeakSet(),
      status: "open",
    } as never;
    const mixed = {
      season_year: new WeakSet([{}]),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new WeakSet([{}]),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover weakset keys → active W2
    assert.equal(selectActiveWeek([weakSetKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), weakSetLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), emptyWeakSet])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([weakSetKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([weakSetKeys]), null);
    assert.equal(selectActiveWeek([weakSetLocked, emptyWeakSet, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([weakSetKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([weakSetLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(weakSetKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(weakSetLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyWeakSet, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(weakSetKeys));
    assert.doesNotThrow(() => nextWeekSlot(weakSetLocked));
    assert.deepEqual(nextWeekSlot(weakSetKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(weakSetLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyWeakSet), { season_year: 0, week_number: 1 });
    // leftover weakset keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([weakSetKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, weakSetLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyWeakSet, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(weakSetKeys, w(2, "final")) > 0);
    assert.ok(recency(weakSetLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyWeakSet, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is weakset only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is weakset only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover weakset keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([weakSetKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, weakSetLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyWeakSet])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([weakSetKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([weakSetLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyWeakSet, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover weakset keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, weakSetKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([weakSetLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyWeakSet, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover weakset keys → W1
    assert.equal(selectActiveWeek([weakSetKeys, w(1, "final"), weakSetLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([weakSetKeys, weakSetLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover weakset keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([weakSetKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, weakSetLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyWeakSet])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([weakSetKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", weakSetKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", weakSetLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyWeakSet), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", weakSetKeys), "The Harper House · Week NaN");
    assert.doesNotThrow(() => weekSwitcherLabel(weakSetKeys, e));
  });

  it("leftover promise keys cannot hide a newer week (a–e)", () => {
    const promiseKeys = {
      season_year: Promise.resolve(2026),
      week_number: Promise.resolve(2026),
      status: "open",
    } as never;
    const promiseLocked = {
      season_year: Promise.resolve(2026),
      week_number: Promise.resolve(2026),
      status: "locked",
    } as never;
    const emptyPromise = {
      season_year: new Promise(() => {}),
      week_number: new Promise(() => {}),
      status: "open",
    } as never;
    const mixed = {
      season_year: Promise.resolve(2026),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: Promise.resolve(2026),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover promise keys → active W2
    assert.equal(selectActiveWeek([promiseKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), promiseLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), emptyPromise])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([promiseKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([promiseKeys]), null);
    assert.equal(selectActiveWeek([promiseLocked, emptyPromise, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([promiseKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([promiseLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(promiseKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(promiseLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyPromise, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(promiseKeys));
    assert.doesNotThrow(() => nextWeekSlot(promiseLocked));
    assert.deepEqual(nextWeekSlot(promiseKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(promiseLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyPromise), { season_year: 0, week_number: 1 });
    // leftover promise keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([promiseKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, promiseLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyPromise, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(promiseKeys, w(2, "final")) > 0);
    assert.ok(recency(promiseLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyPromise, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is promise only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is promise only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover promise keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([promiseKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, promiseLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyPromise])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([promiseKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([promiseLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyPromise, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover promise keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, promiseKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([promiseLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyPromise, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover promise keys → W1
    assert.equal(selectActiveWeek([promiseKeys, w(1, "final"), promiseLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([promiseKeys, promiseLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover promise keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([promiseKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, promiseLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyPromise])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([promiseKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", promiseKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", promiseLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyPromise), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", promiseKeys), "The Harper House · Week NaN");
    assert.doesNotThrow(() => weekSwitcherLabel(promiseKeys, e));
  });

  it("leftover error keys cannot hide a newer week (a–e)", () => {
    const errorKeys = {
      season_year: new Error("2026"),
      week_number: new Error("2026"),
      status: "open",
    } as never;
    const errorLocked = {
      season_year: new Error("2026"),
      week_number: new Error("2026"),
      status: "locked",
    } as never;
    const emptyError = {
      season_year: new Error(),
      week_number: new TypeError(),
      status: "open",
    } as never;
    const mixed = {
      season_year: new Error("2026"),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new Error("2026"),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover error keys → active W2
    assert.equal(selectActiveWeek([errorKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), errorLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), emptyError])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([errorKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([errorKeys]), null);
    assert.equal(selectActiveWeek([errorLocked, emptyError, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([errorKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([errorLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(errorKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(errorLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyError, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(errorKeys));
    assert.doesNotThrow(() => nextWeekSlot(errorLocked));
    assert.deepEqual(nextWeekSlot(errorKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(errorLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyError), { season_year: 0, week_number: 1 });
    // leftover error keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([errorKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, errorLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyError, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(errorKeys, w(2, "final")) > 0);
    assert.ok(recency(errorLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyError, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is error only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is error only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover error keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([errorKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, errorLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyError])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([errorKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([errorLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyError, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover error keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, errorKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([errorLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyError, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover error keys → W1
    assert.equal(selectActiveWeek([errorKeys, w(1, "final"), errorLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([errorKeys, errorLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover error keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([errorKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, errorLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyError])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([errorKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", errorKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", errorLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyError), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", errorKeys), "The Harper House · Week NaN");
    assert.doesNotThrow(() => weekSwitcherLabel(errorKeys, e));
  });

  it("leftover regexp keys cannot hide a newer week (a–e)", () => {
    const regexpKeys = {
      season_year: new RegExp("2026"),
      week_number: new RegExp("2026"),
      status: "open",
    } as never;
    const regexpLocked = {
      season_year: new RegExp("2026"),
      week_number: new RegExp("2026"),
      status: "locked",
    } as never;
    const emptyRegexp = {
      season_year: new RegExp(""),
      week_number: /2026/i,
      status: "open",
    } as never;
    const mixed = {
      season_year: new RegExp("2026"),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new RegExp("2026"),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover regexp keys → active W2
    assert.equal(selectActiveWeek([regexpKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), regexpLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), emptyRegexp])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome("The Harper House", selectActiveWeek([regexpKeys, w(1, "draft"), w(2, "final")])),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([regexpKeys]), null);
    assert.equal(selectActiveWeek([regexpLocked, emptyRegexp, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([regexpKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([regexpLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(regexpKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(regexpLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyRegexp, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(regexpKeys));
    assert.doesNotThrow(() => nextWeekSlot(regexpLocked));
    assert.deepEqual(nextWeekSlot(regexpKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(regexpLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyRegexp), { season_year: 0, week_number: 1 });
    // leftover regexp keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([regexpKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, regexpLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyRegexp, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(regexpKeys, w(2, "final")) > 0);
    assert.ok(recency(regexpLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyRegexp, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is regexp only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is regexp only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover regexp keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([regexpKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, regexpLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyRegexp])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([regexpKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([regexpLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyRegexp, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover regexp keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, regexpKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([regexpLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyRegexp, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover regexp keys → W1
    assert.equal(selectActiveWeek([regexpKeys, w(1, "final"), regexpLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([regexpKeys, regexpLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover regexp keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([regexpKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, regexpLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyRegexp])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([regexpKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", regexpKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", regexpLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyRegexp), "The Harper House");
    assert.notEqual(familyWeekChrome("The Harper House", regexpKeys), "The Harper House · Week NaN");
    assert.doesNotThrow(() => weekSwitcherLabel(regexpKeys, e));
  });

  it("leftover arraybuffer keys cannot hide a newer week (a–e)", () => {
    const arrayBufferKeys = {
      season_year: new ArrayBuffer(8),
      week_number: new ArrayBuffer(8),
      status: "open",
    } as never;
    const arrayBufferLocked = {
      season_year: new ArrayBuffer(8),
      week_number: new ArrayBuffer(8),
      status: "locked",
    } as never;
    const emptyArrayBuffer = {
      season_year: new ArrayBuffer(0),
      week_number: new ArrayBuffer(0),
      status: "open",
    } as never;
    const mixed = {
      season_year: new ArrayBuffer(8),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new ArrayBuffer(8),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover arraybuffer keys → active W2
    assert.equal(selectActiveWeek([arrayBufferKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(selectActiveWeek([w(1, "draft"), arrayBufferLocked, w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([w(2, "final"), w(1, "draft"), emptyArrayBuffer])?.week_number, 2);
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([arrayBufferKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([arrayBufferKeys]), null);
    assert.equal(selectActiveWeek([arrayBufferLocked, emptyArrayBuffer, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() => selectActiveWeek([arrayBufferKeys, w(1, "draft"), w(2, "final")]));
    assert.doesNotThrow(() => selectActiveWeek([arrayBufferLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(arrayBufferKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(arrayBufferLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyArrayBuffer, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(arrayBufferKeys));
    assert.doesNotThrow(() => nextWeekSlot(arrayBufferLocked));
    assert.deepEqual(nextWeekSlot(arrayBufferKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(arrayBufferLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyArrayBuffer), { season_year: 0, week_number: 1 });
    // leftover arraybuffer keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([arrayBufferKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, arrayBufferLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyArrayBuffer, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(arrayBufferKeys, w(2, "final")) > 0);
    assert.ok(recency(arrayBufferLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyArrayBuffer, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is arraybuffer only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is arraybuffer only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover arraybuffer keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([arrayBufferKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, arrayBufferLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyArrayBuffer])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([arrayBufferKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([arrayBufferLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyArrayBuffer, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover arraybuffer keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, arrayBufferKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([arrayBufferLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyArrayBuffer, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover arraybuffer keys → W1
    assert.equal(selectActiveWeek([arrayBufferKeys, w(1, "final"), arrayBufferLocked])?.week_number, 1);
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([arrayBufferKeys, arrayBufferLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover arraybuffer keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([arrayBufferKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, arrayBufferLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyArrayBuffer])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([arrayBufferKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", arrayBufferKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", arrayBufferLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyArrayBuffer), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", arrayBufferKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(arrayBufferKeys, e));
  });

  it("leftover sharedarraybuffer keys cannot hide a newer week (a–e)", () => {
    const sharedArrayBufferKeys = {
      season_year: new SharedArrayBuffer(8),
      week_number: new SharedArrayBuffer(8),
      status: "open",
    } as never;
    const sharedArrayBufferLocked = {
      season_year: new SharedArrayBuffer(8),
      week_number: new SharedArrayBuffer(8),
      status: "locked",
    } as never;
    const emptySharedArrayBuffer = {
      season_year: new SharedArrayBuffer(0),
      week_number: new SharedArrayBuffer(0),
      status: "open",
    } as never;
    const mixed = {
      season_year: new SharedArrayBuffer(8),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new SharedArrayBuffer(8),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover sharedarraybuffer keys → active W2
    assert.equal(selectActiveWeek([sharedArrayBufferKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), sharedArrayBufferLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptySharedArrayBuffer])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([sharedArrayBufferKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([sharedArrayBufferKeys]), null);
    assert.equal(selectActiveWeek([sharedArrayBufferLocked, emptySharedArrayBuffer, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([sharedArrayBufferKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([sharedArrayBufferLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(sharedArrayBufferKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(sharedArrayBufferLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptySharedArrayBuffer, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(sharedArrayBufferKeys));
    assert.doesNotThrow(() => nextWeekSlot(sharedArrayBufferLocked));
    assert.deepEqual(nextWeekSlot(sharedArrayBufferKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(sharedArrayBufferLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptySharedArrayBuffer), { season_year: 0, week_number: 1 });
    // leftover sharedarraybuffer keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([sharedArrayBufferKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, sharedArrayBufferLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptySharedArrayBuffer, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(sharedArrayBufferKeys, w(2, "final")) > 0);
    assert.ok(recency(sharedArrayBufferLocked, w(2, "final")) > 0);
    assert.ok(recency(emptySharedArrayBuffer, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is sharedarraybuffer only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is sharedarraybuffer only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover sharedarraybuffer keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([sharedArrayBufferKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, sharedArrayBufferLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptySharedArrayBuffer])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([sharedArrayBufferKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([sharedArrayBufferLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptySharedArrayBuffer, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover sharedarraybuffer keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, sharedArrayBufferKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([sharedArrayBufferLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptySharedArrayBuffer, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover sharedarraybuffer keys → W1
    assert.equal(
      selectActiveWeek([sharedArrayBufferKeys, w(1, "final"), sharedArrayBufferLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([sharedArrayBufferKeys, sharedArrayBufferLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover sharedarraybuffer keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([sharedArrayBufferKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, sharedArrayBufferLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptySharedArrayBuffer])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([sharedArrayBufferKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", sharedArrayBufferKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", sharedArrayBufferLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptySharedArrayBuffer), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", sharedArrayBufferKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(sharedArrayBufferKeys, e));
  });

  it("leftover dataview keys cannot hide a newer week (a–e)", () => {
    const dataViewKeys = {
      season_year: new DataView(new ArrayBuffer(8)),
      week_number: new DataView(new ArrayBuffer(8)),
      status: "open",
    } as never;
    const dataViewLocked = {
      season_year: new DataView(new ArrayBuffer(8)),
      week_number: new DataView(new ArrayBuffer(8)),
      status: "locked",
    } as never;
    const emptyDataView = {
      season_year: new DataView(new ArrayBuffer(0)),
      week_number: new DataView(new ArrayBuffer(0)),
      status: "open",
    } as never;
    const mixed = {
      season_year: new DataView(new ArrayBuffer(8)),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new DataView(new ArrayBuffer(8)),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover dataview keys → active W2
    assert.equal(selectActiveWeek([dataViewKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), dataViewLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyDataView])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([dataViewKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([dataViewKeys]), null);
    assert.equal(selectActiveWeek([dataViewLocked, emptyDataView, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([dataViewKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([dataViewLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(dataViewKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(dataViewLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyDataView, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(dataViewKeys));
    assert.doesNotThrow(() => nextWeekSlot(dataViewLocked));
    assert.deepEqual(nextWeekSlot(dataViewKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(dataViewLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyDataView), { season_year: 0, week_number: 1 });
    // leftover dataview keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([dataViewKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, dataViewLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyDataView, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(dataViewKeys, w(2, "final")) > 0);
    assert.ok(recency(dataViewLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyDataView, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is dataview only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is dataview only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover dataview keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([dataViewKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, dataViewLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyDataView])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([dataViewKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([dataViewLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyDataView, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover dataview keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, dataViewKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([dataViewLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyDataView, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover dataview keys → W1
    assert.equal(
      selectActiveWeek([dataViewKeys, w(1, "final"), dataViewLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([dataViewKeys, dataViewLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover dataview keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([dataViewKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, dataViewLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyDataView])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([dataViewKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", dataViewKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", dataViewLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyDataView), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", dataViewKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(dataViewKeys, e));
  });

  it("leftover typedarray keys cannot hide a newer week (a–e)", () => {
    const typedArrayKeys = {
      season_year: new Uint32Array([2026]),
      week_number: new Uint8Array([2]),
      status: "open",
    } as never;
    const typedArrayLocked = {
      season_year: new Uint32Array([2026]),
      week_number: new Uint8Array([2]),
      status: "locked",
    } as never;
    const emptyTypedArray = {
      season_year: new Uint32Array(),
      week_number: new Uint8Array(),
      status: "open",
    } as never;
    const mixed = {
      season_year: new Uint32Array([2026]),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new Uint8Array([2]),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover typedarray keys → active W2
    assert.equal(selectActiveWeek([typedArrayKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), typedArrayLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyTypedArray])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([typedArrayKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([typedArrayKeys]), null);
    assert.equal(selectActiveWeek([typedArrayLocked, emptyTypedArray, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([typedArrayKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([typedArrayLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(typedArrayKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(typedArrayLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyTypedArray, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(typedArrayKeys));
    assert.doesNotThrow(() => nextWeekSlot(typedArrayLocked));
    assert.deepEqual(nextWeekSlot(typedArrayKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(typedArrayLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyTypedArray), { season_year: 0, week_number: 1 });
    // leftover typedarray keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([typedArrayKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, typedArrayLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyTypedArray, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(typedArrayKeys, w(2, "final")) > 0);
    assert.ok(recency(typedArrayLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyTypedArray, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is typedarray only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is typedarray only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover typedarray keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([typedArrayKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, typedArrayLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyTypedArray])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([typedArrayKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([typedArrayLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyTypedArray, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover typedarray keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, typedArrayKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([typedArrayLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyTypedArray, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover typedarray keys → W1
    assert.equal(
      selectActiveWeek([typedArrayKeys, w(1, "final"), typedArrayLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([typedArrayKeys, typedArrayLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover typedarray keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([typedArrayKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, typedArrayLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyTypedArray])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([typedArrayKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", typedArrayKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", typedArrayLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyTypedArray), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", typedArrayKeys),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", typedArrayKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(typedArrayKeys, e));
  });

  it("leftover blob keys cannot hide a newer week (a–e)", () => {
    const blobKeys = {
      season_year: new Blob(["2026"]),
      week_number: new Blob(["2"]),
      status: "open",
    } as never;
    const blobLocked = {
      season_year: new Blob(["2026"]),
      week_number: new Blob(["2"]),
      status: "locked",
    } as never;
    const emptyBlob = {
      season_year: new Blob(),
      week_number: new Blob(),
      status: "open",
    } as never;
    const mixed = {
      season_year: new Blob(["2026"]),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new Blob(["2"]),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover blob keys → active W2
    assert.equal(selectActiveWeek([blobKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), blobLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyBlob])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([blobKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([blobKeys]), null);
    assert.equal(selectActiveWeek([blobLocked, emptyBlob, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([blobKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([blobLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(blobKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(blobLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyBlob, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(blobKeys));
    assert.doesNotThrow(() => nextWeekSlot(blobLocked));
    assert.deepEqual(nextWeekSlot(blobKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(blobLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyBlob), { season_year: 0, week_number: 1 });
    // leftover blob keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([blobKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, blobLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyBlob, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(blobKeys, w(2, "final")) > 0);
    assert.ok(recency(blobLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyBlob, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is blob only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is blob only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover blob keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([blobKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, blobLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyBlob])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([blobKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([blobLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyBlob, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover blob keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, blobKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([blobLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyBlob, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover blob keys → W1
    assert.equal(
      selectActiveWeek([blobKeys, w(1, "final"), blobLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([blobKeys, blobLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover blob keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([blobKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, blobLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyBlob])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([blobKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", blobKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", blobLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyBlob), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", blobKeys),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", blobKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(blobKeys, e));
  });

  it("leftover file keys cannot hide a newer week (a–e)", () => {
    const fileKeys = {
      season_year: new File(["2026"], "year"),
      week_number: new File(["2"], "week"),
      status: "open",
    } as never;
    const fileLocked = {
      season_year: new File(["2026"], "year"),
      week_number: new File(["2"], "week"),
      status: "locked",
    } as never;
    const emptyFile = {
      season_year: new File([], "empty-year"),
      week_number: new File([], "empty-week"),
      status: "open",
    } as never;
    const mixed = {
      season_year: new File(["2026"], "year"),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new File(["2"], "week"),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover file keys → active W2
    assert.equal(selectActiveWeek([fileKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), fileLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyFile])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([fileKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([fileKeys]), null);
    assert.equal(selectActiveWeek([fileLocked, emptyFile, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([fileKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([fileLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(fileKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(fileLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyFile, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(fileKeys));
    assert.doesNotThrow(() => nextWeekSlot(fileLocked));
    assert.deepEqual(nextWeekSlot(fileKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(fileLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyFile), { season_year: 0, week_number: 1 });
    // leftover file keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([fileKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, fileLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyFile, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(fileKeys, w(2, "final")) > 0);
    assert.ok(recency(fileLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyFile, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is file only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is file only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover file keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([fileKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, fileLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyFile])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([fileKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([fileLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyFile, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover file keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, fileKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([fileLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyFile, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover file keys → W1
    assert.equal(
      selectActiveWeek([fileKeys, w(1, "final"), fileLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([fileKeys, fileLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover file keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([fileKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, fileLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyFile])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([fileKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", fileKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", fileLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyFile), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", fileKeys),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", fileKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(fileKeys, e));
  });

  it("leftover url keys cannot hide a newer week (a–e)", () => {
    const urlKeys = {
      season_year: new URL("https://example.com/2026"),
      week_number: new URL("https://example.com/2"),
      status: "open",
    } as never;
    const urlLocked = {
      season_year: new URL("https://example.com/2026"),
      week_number: new URL("https://example.com/2"),
      status: "locked",
    } as never;
    const emptyUrl = {
      season_year: new URL("https://example.com/"),
      week_number: new URL("https://example.com/"),
      status: "open",
    } as never;
    const mixed = {
      season_year: new URL("https://example.com/2026"),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new URL("https://example.com/2"),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover url keys → active W2
    assert.equal(selectActiveWeek([urlKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), urlLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyUrl])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([urlKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([urlKeys]), null);
    assert.equal(selectActiveWeek([urlLocked, emptyUrl, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([urlKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([urlLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(urlKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(urlLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyUrl, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(urlKeys));
    assert.doesNotThrow(() => nextWeekSlot(urlLocked));
    assert.deepEqual(nextWeekSlot(urlKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(urlLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyUrl), { season_year: 0, week_number: 1 });
    // leftover url keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([urlKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, urlLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyUrl, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(urlKeys, w(2, "final")) > 0);
    assert.ok(recency(urlLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyUrl, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is url only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is url only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover url keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([urlKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, urlLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyUrl])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([urlKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([urlLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyUrl, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover url keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, urlKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([urlLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyUrl, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover url keys → W1
    assert.equal(
      selectActiveWeek([urlKeys, w(1, "final"), urlLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([urlKeys, urlLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover url keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([urlKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, urlLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyUrl])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([urlKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", urlKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", urlLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyUrl), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", urlKeys),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", urlKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(urlKeys, e));
  });

  it("leftover urlsearchparams keys cannot hide a newer week (a–e)", () => {
    const urlSearchParamsKeys = {
      season_year: new URLSearchParams("year=2026"),
      week_number: new URLSearchParams("week=2"),
      status: "open",
    } as never;
    const urlSearchParamsLocked = {
      season_year: new URLSearchParams("year=2026"),
      week_number: new URLSearchParams("week=2"),
      status: "locked",
    } as never;
    const emptyUrlSearchParams = {
      season_year: new URLSearchParams(),
      week_number: new URLSearchParams(),
      status: "open",
    } as never;
    const mixed = {
      season_year: new URLSearchParams("year=2026"),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new URLSearchParams("week=2"),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover urlsearchparams keys → active W2
    assert.equal(selectActiveWeek([urlSearchParamsKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), urlSearchParamsLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyUrlSearchParams])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([urlSearchParamsKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([urlSearchParamsKeys]), null);
    assert.equal(selectActiveWeek([urlSearchParamsLocked, emptyUrlSearchParams, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([urlSearchParamsKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([urlSearchParamsLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(urlSearchParamsKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(urlSearchParamsLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyUrlSearchParams, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(urlSearchParamsKeys));
    assert.doesNotThrow(() => nextWeekSlot(urlSearchParamsLocked));
    assert.deepEqual(nextWeekSlot(urlSearchParamsKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(urlSearchParamsLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyUrlSearchParams), { season_year: 0, week_number: 1 });
    // leftover urlsearchparams keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([urlSearchParamsKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, urlSearchParamsLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyUrlSearchParams, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(urlSearchParamsKeys, w(2, "final")) > 0);
    assert.ok(recency(urlSearchParamsLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyUrlSearchParams, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is urlsearchparams only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is urlsearchparams only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover urlsearchparams keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([urlSearchParamsKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, urlSearchParamsLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyUrlSearchParams])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([urlSearchParamsKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([urlSearchParamsLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyUrlSearchParams, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover urlsearchparams keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, urlSearchParamsKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([urlSearchParamsLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyUrlSearchParams, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover urlsearchparams keys → W1
    assert.equal(
      selectActiveWeek([urlSearchParamsKeys, w(1, "final"), urlSearchParamsLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([urlSearchParamsKeys, urlSearchParamsLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover urlsearchparams keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([urlSearchParamsKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, urlSearchParamsLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyUrlSearchParams])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([urlSearchParamsKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", urlSearchParamsKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", urlSearchParamsLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyUrlSearchParams), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", urlSearchParamsKeys),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", urlSearchParamsKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(urlSearchParamsKeys, e));
  });

  it("leftover formdata keys cannot hide a newer week (a–e)", () => {
    const formDataKeys = {
      season_year: (() => {
        const fd = new FormData();
        fd.append("year", "2026");
        return fd;
      })(),
      week_number: (() => {
        const fd = new FormData();
        fd.append("week", "2");
        return fd;
      })(),
      status: "open",
    } as never;
    const formDataLocked = {
      season_year: (() => {
        const fd = new FormData();
        fd.append("year", "2026");
        return fd;
      })(),
      week_number: (() => {
        const fd = new FormData();
        fd.append("week", "2");
        return fd;
      })(),
      status: "locked",
    } as never;
    const emptyFormData = {
      season_year: new FormData(),
      week_number: new FormData(),
      status: "open",
    } as never;
    const mixed = {
      season_year: (() => {
        const fd = new FormData();
        fd.append("year", "2026");
        return fd;
      })(),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: (() => {
        const fd = new FormData();
        fd.append("week", "2");
        return fd;
      })(),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover formdata keys → active W2
    assert.equal(selectActiveWeek([formDataKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), formDataLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyFormData])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([formDataKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([formDataKeys]), null);
    assert.equal(selectActiveWeek([formDataLocked, emptyFormData, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([formDataKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([formDataLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(formDataKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(formDataLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyFormData, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(formDataKeys));
    assert.doesNotThrow(() => nextWeekSlot(formDataLocked));
    assert.deepEqual(nextWeekSlot(formDataKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(formDataLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyFormData), { season_year: 0, week_number: 1 });
    // leftover formdata keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([formDataKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, formDataLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyFormData, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(formDataKeys, w(2, "final")) > 0);
    assert.ok(recency(formDataLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyFormData, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is formdata only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is formdata only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover formdata keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([formDataKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, formDataLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyFormData])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([formDataKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([formDataLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyFormData, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover formdata keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, formDataKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([formDataLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyFormData, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover formdata keys → W1
    assert.equal(
      selectActiveWeek([formDataKeys, w(1, "final"), formDataLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([formDataKeys, formDataLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover formdata keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([formDataKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, formDataLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyFormData])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([formDataKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", formDataKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", formDataLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyFormData), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", formDataKeys),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", formDataKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(formDataKeys, e));
  });

  it("leftover headers keys cannot hide a newer week (a–e)", () => {
    const headersKeys = {
      season_year: (() => {
        const h = new Headers();
        h.append("year", "2026");
        return h;
      })(),
      week_number: (() => {
        const h = new Headers();
        h.append("week", "2");
        return h;
      })(),
      status: "open",
    } as never;
    const headersLocked = {
      season_year: (() => {
        const h = new Headers();
        h.append("year", "2026");
        return h;
      })(),
      week_number: (() => {
        const h = new Headers();
        h.append("week", "2");
        return h;
      })(),
      status: "locked",
    } as never;
    const emptyHeaders = {
      season_year: new Headers(),
      week_number: new Headers(),
      status: "open",
    } as never;
    const mixed = {
      season_year: (() => {
        const h = new Headers();
        h.append("year", "2026");
        return h;
      })(),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: (() => {
        const h = new Headers();
        h.append("week", "2");
        return h;
      })(),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover headers keys → active W2
    assert.equal(selectActiveWeek([headersKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), headersLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyHeaders])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([headersKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([headersKeys]), null);
    assert.equal(selectActiveWeek([headersLocked, emptyHeaders, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([headersKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([headersLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(headersKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(headersLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyHeaders, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(headersKeys));
    assert.doesNotThrow(() => nextWeekSlot(headersLocked));
    assert.deepEqual(nextWeekSlot(headersKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(headersLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyHeaders), { season_year: 0, week_number: 1 });
    // leftover headers keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([headersKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, headersLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyHeaders, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(headersKeys, w(2, "final")) > 0);
    assert.ok(recency(headersLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyHeaders, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is headers only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is headers only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover headers keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([headersKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, headersLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyHeaders])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([headersKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([headersLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyHeaders, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover headers keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, headersKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([headersLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyHeaders, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover headers keys → W1
    assert.equal(
      selectActiveWeek([headersKeys, w(1, "final"), headersLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([headersKeys, headersLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover headers keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([headersKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, headersLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyHeaders])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([headersKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", headersKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", headersLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyHeaders), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", headersKeys),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", headersKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(headersKeys, e));
  });

  it("leftover request keys cannot hide a newer week (a–e)", () => {
    const requestKeys = {
      season_year: new Request("https://example.com/2026"),
      week_number: new Request("https://example.com/2"),
      status: "open",
    } as never;
    const requestLocked = {
      season_year: new Request("https://example.com/2026"),
      week_number: new Request("https://example.com/2"),
      status: "locked",
    } as never;
    const emptyRequest = {
      season_year: new Request("https://example.com/"),
      week_number: new Request("https://example.com/"),
      status: "open",
    } as never;
    const mixed = {
      season_year: new Request("https://example.com/2026"),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new Request("https://example.com/2"),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover request keys → active W2
    assert.equal(selectActiveWeek([requestKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), requestLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyRequest])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([requestKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([requestKeys]), null);
    assert.equal(selectActiveWeek([requestLocked, emptyRequest, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([requestKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([requestLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(requestKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(requestLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyRequest, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(requestKeys));
    assert.doesNotThrow(() => nextWeekSlot(requestLocked));
    assert.deepEqual(nextWeekSlot(requestKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(requestLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyRequest), { season_year: 0, week_number: 1 });
    // leftover request keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([requestKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, requestLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyRequest, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(requestKeys, w(2, "final")) > 0);
    assert.ok(recency(requestLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyRequest, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is request only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is request only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover request keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([requestKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, requestLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyRequest])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([requestKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([requestLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyRequest, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover request keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, requestKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([requestLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyRequest, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover request keys → W1
    assert.equal(
      selectActiveWeek([requestKeys, w(1, "final"), requestLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([requestKeys, requestLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover request keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([requestKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, requestLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyRequest])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([requestKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", requestKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", requestLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyRequest), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", requestKeys),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", requestKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(requestKeys, e));
  });

  it("leftover response keys cannot hide a newer week (a–e)", () => {
    const responseKeys = {
      season_year: new Response("2026"),
      week_number: new Response("2"),
      status: "open",
    } as never;
    const responseLocked = {
      season_year: new Response("2026"),
      week_number: new Response("2"),
      status: "locked",
    } as never;
    const emptyResponse = {
      season_year: new Response(),
      week_number: new Response(),
      status: "open",
    } as never;
    const mixed = {
      season_year: new Response("2026"),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new Response("2"),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover response keys → active W2
    assert.equal(selectActiveWeek([responseKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), responseLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyResponse])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([responseKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([responseKeys]), null);
    assert.equal(selectActiveWeek([responseLocked, emptyResponse, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([responseKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([responseLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(responseKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(responseLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyResponse, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(responseKeys));
    assert.doesNotThrow(() => nextWeekSlot(responseLocked));
    assert.deepEqual(nextWeekSlot(responseKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(responseLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyResponse), { season_year: 0, week_number: 1 });
    // leftover response keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([responseKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, responseLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyResponse, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(responseKeys, w(2, "final")) > 0);
    assert.ok(recency(responseLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyResponse, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is response only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is response only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover response keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([responseKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, responseLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyResponse])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([responseKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([responseLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyResponse, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover response keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, responseKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([responseLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyResponse, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover response keys → W1
    assert.equal(
      selectActiveWeek([responseKeys, w(1, "final"), responseLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([responseKeys, responseLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover response keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([responseKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, responseLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyResponse])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([responseKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", responseKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", responseLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyResponse), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", responseKeys),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", responseKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(responseKeys, e));
  });

  it("leftover readable stream keys cannot hide a newer week (a–e)", () => {
    const streamKeys = {
      season_year: new Blob(["2026"]).stream(),
      week_number: new Blob(["2"]).stream(),
      status: "open",
    } as never;
    const streamLocked = {
      season_year: new Blob(["2026"]).stream(),
      week_number: new Blob(["2"]).stream(),
      status: "locked",
    } as never;
    const emptyStream = {
      season_year: new ReadableStream(),
      week_number: new ReadableStream(),
      status: "open",
    } as never;
    const mixed = {
      season_year: new Blob(["2026"]).stream(),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new Blob(["2"]).stream(),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover readable stream keys → active W2
    assert.equal(selectActiveWeek([streamKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), streamLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyStream])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([streamKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([streamKeys]), null);
    assert.equal(selectActiveWeek([streamLocked, emptyStream, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([streamKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([streamLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(streamKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(streamLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyStream, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(streamKeys));
    assert.doesNotThrow(() => nextWeekSlot(streamLocked));
    assert.deepEqual(nextWeekSlot(streamKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(streamLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyStream), { season_year: 0, week_number: 1 });
    // leftover readable stream keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([streamKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, streamLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyStream, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(streamKeys, w(2, "final")) > 0);
    assert.ok(recency(streamLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyStream, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is readable stream only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is readable stream only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover readable stream keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([streamKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, streamLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyStream])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([streamKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([streamLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyStream, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover readable stream keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, streamKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([streamLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyStream, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover readable stream keys → W1
    assert.equal(
      selectActiveWeek([streamKeys, w(1, "final"), streamLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([streamKeys, streamLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover readable stream keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([streamKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, streamLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyStream])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([streamKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", streamKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", streamLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyStream), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", streamKeys),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", streamKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(streamKeys, e));
  });

  it("leftover writable stream keys cannot hide a newer week (a–e)", () => {
    const writableKeys = {
      season_year: new WritableStream({ write() {} }),
      week_number: new WritableStream({ write() {} }),
      status: "open",
    } as never;
    const writableLocked = {
      season_year: new WritableStream({ write() {} }),
      week_number: new WritableStream({ write() {} }),
      status: "locked",
    } as never;
    const emptyWritable = {
      season_year: new WritableStream(),
      week_number: new WritableStream(),
      status: "open",
    } as never;
    const mixed = {
      season_year: new WritableStream({ write() {} }),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new WritableStream({ write() {} }),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover writable stream keys → active W2
    assert.equal(selectActiveWeek([writableKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), writableLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyWritable])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([writableKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([writableKeys]), null);
    assert.equal(selectActiveWeek([writableLocked, emptyWritable, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([writableKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([writableLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(writableKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(writableLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyWritable, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(writableKeys));
    assert.doesNotThrow(() => nextWeekSlot(writableLocked));
    assert.deepEqual(nextWeekSlot(writableKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(writableLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyWritable), { season_year: 0, week_number: 1 });
    // leftover writable stream keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([writableKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, writableLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyWritable, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(writableKeys, w(2, "final")) > 0);
    assert.ok(recency(writableLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyWritable, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is writable stream only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is writable stream only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover writable stream keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([writableKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, writableLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyWritable])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([writableKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([writableLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyWritable, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover writable stream keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, writableKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([writableLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyWritable, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover writable stream keys → W1
    assert.equal(
      selectActiveWeek([writableKeys, w(1, "final"), writableLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([writableKeys, writableLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover writable stream keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([writableKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, writableLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyWritable])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([writableKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", writableKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", writableLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyWritable), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", writableKeys),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", writableKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(writableKeys, e));
  });

  it("leftover transform stream keys cannot hide a newer week (a–e)", () => {
    const transformKeys = {
      season_year: new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      }),
      week_number: new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      }),
      status: "open",
    } as never;
    const transformLocked = {
      season_year: new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      }),
      week_number: new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      }),
      status: "locked",
    } as never;
    const emptyTransform = {
      season_year: new TransformStream(),
      week_number: new TransformStream(),
      status: "open",
    } as never;
    const mixed = {
      season_year: new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      }),
      week_number: 2,
      status: "open",
    } as never;
    const mixedWeek = {
      season_year: 2026,
      week_number: new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      }),
      status: "open",
    } as never;
    // a: draft W1 + final W2 + leftover transform stream keys → active W2
    assert.equal(selectActiveWeek([transformKeys, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      selectActiveWeek([w(1, "draft"), transformLocked, w(2, "final")])?.status,
      "final",
    );
    assert.equal(
      selectActiveWeek([w(2, "final"), w(1, "draft"), emptyTransform])?.week_number,
      2,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "draft"), w(2, "final")])?.status, "final");
    assert.equal(selectActiveWeek([mixedWeek, w(1, "draft"), w(2, "final")])?.week_number, 2);
    assert.equal(
      familyWeekChrome(
        "The Harper House",
        selectActiveWeek([transformKeys, w(1, "draft"), w(2, "final")]),
      ),
      "The Harper House · Week 2",
    );
    assert.equal(selectActiveWeek([transformKeys]), null);
    assert.equal(selectActiveWeek([transformLocked, emptyTransform, mixed]), null);
    assert.equal(selectActiveWeek([mixedWeek]), null);
    assert.doesNotThrow(() =>
      selectActiveWeek([transformKeys, w(1, "draft"), w(2, "final")]),
    );
    assert.doesNotThrow(() => selectActiveWeek([transformLocked, w(2, "final")]));
    assert.doesNotThrow(() => recency(transformKeys, w(2, "final")));
    assert.doesNotThrow(() => recency(transformLocked, w(2, "final")));
    assert.doesNotThrow(() => recency(emptyTransform, w(2, "final")));
    assert.doesNotThrow(() => recency(mixed, w(2, "final")));
    assert.doesNotThrow(() => recency(mixedWeek, w(2, "final")));
    assert.doesNotThrow(() => nextWeekSlot(transformKeys));
    assert.doesNotThrow(() => nextWeekSlot(transformLocked));
    assert.deepEqual(nextWeekSlot(transformKeys), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(transformLocked), { season_year: 0, week_number: 1 });
    assert.deepEqual(nextWeekSlot(emptyTransform), { season_year: 0, week_number: 1 });
    // leftover transform stream keys must not beat a same-recency leftover draft
    const leftoverMissingDraft = { status: "draft" } as never;
    assert.equal(selectActiveWeek([transformKeys, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([leftoverMissingDraft, transformLocked])?.status, "draft");
    assert.equal(selectActiveWeek([mixed, leftoverMissingDraft])?.status, "draft");
    assert.equal(selectActiveWeek([emptyTransform, leftoverMissingDraft])?.status, "draft");
    assert.ok(recency(transformKeys, w(2, "final")) > 0);
    assert.ok(recency(transformLocked, w(2, "final")) > 0);
    assert.ok(recency(emptyTransform, w(2, "final")) > 0);
    assert.ok(recency(mixed, w(2, "final")) > 0);
    assert.ok(recency(mixedWeek, w(2, "final")) > 0);
    // finite integer keys still rank — leftover skip is transform stream only
    assert.equal(
      selectActiveWeek([{ ...w(1, "open"), season_year: 2026, week_number: 1 }])?.status,
      "open",
    );
    assert.equal(
      selectActiveWeek([
        { season_year: "2026", week_number: "1", status: "draft" },
        w(2, "final"),
      ])?.week_number,
      2,
    );
    // leftover missing-key draft stays selectable — leftover skip is transform stream only
    assert.equal(selectActiveWeek([leftoverMissingDraft])?.status, "draft");
    // b: draft W1 + open W2 + leftover transform stream keys → active W2
    const leftover = wr("3e3aeeeb", 1, "draft");
    const open = wr("52a42a9e", 2, "open");
    const b = selectActiveWeek([transformKeys, leftover, open]);
    assert.equal(b?.id, "52a42a9e");
    assert.equal(b?.status, "open");
    assert.equal(selectActiveWeek([leftover, transformLocked, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover, emptyTransform])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixed, leftover, open])?.id, "52a42a9e");
    assert.equal(selectActiveWeek([mixedWeek, leftover, open])?.id, "52a42a9e");
    assert.equal(weekSwitcherLabel(open, b), "This Sunday");
    assert.equal(weekSwitcherLabel(leftover, b), "Week 1");
    assert.notEqual(weekSwitcherLabel(leftover, b), "This Sunday");
    assert.notEqual(weekSwitcherLabel(leftover, b), "Next week");
    assert.equal(familyWeekChrome("The Harper House", b), "The Harper House · Week 2");
    assert.equal(pickViewWeek([leftover, open], b, "next")?.id, "52a42a9e");
    assert.equal([transformKeys, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([transformLocked, leftover, open].sort(recency)[0]?.week_number, 2);
    assert.equal([emptyTransform, leftover, open].sort(recency)[0]?.week_number, 2);
    // c: open W1 + draft W2 + leftover transform stream keys → active W1, W2 labeled Next week
    const thisSunday = wr("w1", 1, "open");
    const nextDraft = wr("w2", 2, "draft");
    const c = selectActiveWeek([thisSunday, transformKeys, nextDraft]);
    assert.equal(c?.id, "w1");
    assert.equal(c?.week_number, 1);
    assert.equal(weekSwitcherLabel(thisSunday, c), "This Sunday");
    assert.equal(weekSwitcherLabel(nextDraft, c), "Next week");
    assert.equal(pickViewWeek([thisSunday, nextDraft], c, "next")?.id, "w2");
    assert.equal(selectActiveWeek([transformLocked, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([emptyTransform, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixed, thisSunday, nextDraft])?.id, "w1");
    assert.equal(selectActiveWeek([mixedWeek, thisSunday, nextDraft])?.id, "w1");
    // d: only final W1 + leftover transform stream keys → W1
    assert.equal(
      selectActiveWeek([transformKeys, w(1, "final"), transformLocked])?.week_number,
      1,
    );
    assert.equal(selectActiveWeek([mixed, w(1, "final")])?.status, "final");
    assert.equal(selectActiveWeek([transformKeys, transformLocked]), null);
    assert.equal(selectActiveWeek(null), null);
    assert.equal(selectActiveWeek(undefined), null);
    // e: skip path: final/skipped W1 + open W2 + leftover transform stream keys → W2
    const skipped = wr("w1s", 1, "final");
    const dirty = { ...wr("w2d", 2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };
    const e = selectActiveWeek([transformKeys, skipped, dirty]);
    assert.equal(e?.id, "w2d");
    assert.equal(e?.status, "open");
    assert.equal(selectActiveWeek([skipped, transformLocked, dirty])?.week_number, 2);
    assert.equal(selectActiveWeek([dirty, skipped, emptyTransform])?.id, "w2d");
    assert.equal(selectActiveWeek([mixed, skipped, dirty])?.id, "w2d");
    assert.equal(selectActiveWeek([mixedWeek, skipped, dirty])?.id, "w2d");
    assert.equal(weekSwitcherLabel(dirty, e), "This Sunday");
    assert.equal(weekSwitcherLabel(skipped, e), "Week 1");
    assert.notEqual(weekSwitcherLabel(skipped, e), "Next week");
    assert.equal(familyWeekChrome("The Harper House", e), "The Harper House · Week 2");
    assert.equal(pickViewWeek([skipped, dirty], e, "next")?.id, "w2d");
    assert.equal([transformKeys, skipped, dirty].sort(recency)[0]?.week_number, 2);
    assert.equal(familyWeekChrome("The Harper House", transformKeys), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", transformLocked), "The Harper House");
    assert.equal(familyWeekChrome("The Harper House", emptyTransform), "The Harper House");
    assert.notEqual(
      familyWeekChrome("The Harper House", transformKeys),
      "The Harper House · Week 2",
    );
    assert.notEqual(
      familyWeekChrome("The Harper House", transformKeys),
      "The Harper House · Week NaN",
    );
    assert.doesNotThrow(() => weekSwitcherLabel(transformKeys, e));
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
    assert.match(body, /if \(!week\) continue/);
    assert.match(body, /leftover holes cannot hide a newer week/);
    assert.match(body, /if \(typeof week !== "object"\) continue/);
    assert.match(body, /leftover non-object rows cannot hide a newer week/);
    assert.match(body, /if \(Array.isArray\(week\)\) continue/);
    assert.match(body, /leftover array rows cannot hide a newer week/);
    assert.match(body, /leftoverHostObject\(week\)/);
    assert.match(body, /leftover host objects cannot hide a newer week/);
    assert.match(body, /leftover throwing rows cannot hide a newer week/);
    assert.match(body, /leftover unconvertible keys cannot hide a newer week/);
    assert.match(body, /leftover object keys cannot hide a newer week/);
    assert.match(body, /leftoverObjectKey\(week\.season_year\)/);
    assert.match(body, /leftover non-numeric string keys cannot hide a newer week/);
    assert.match(body, /leftoverNonNumericStringKey\(week\.season_year\)/);
    assert.match(body, /leftover non-decimal string keys cannot hide a newer week/);
    assert.match(body, /leftoverNonDecimalStringKey\(week\.season_year\)/);
    assert.match(body, /leftover bigint keys cannot hide a newer week/);
    assert.match(body, /leftoverBigintKey\(week\.season_year\)/);
    assert.match(body, /leftover non-integer keys cannot hide a newer week/);
    assert.match(body, /leftoverNonIntegerKey\(week\.season_year\)/);
    assert.match(body, /leftover non-positive keys cannot hide a newer week/);
    assert.match(body, /leftoverNonPositiveKey\(week\.season_year\)/);
    assert.match(body, /leftover infinity keys cannot hide a newer week/);
    assert.match(body, /leftoverInfinityKey\(week\.season_year\)/);
    assert.match(body, /leftover nan keys cannot hide a newer week/);
    assert.match(body, /leftoverNaNKey\(week\.season_year\)/);
    assert.match(body, /leftover null keys cannot hide a newer week/);
    assert.match(body, /leftoverNullKey\(week\.season_year\)/);
    assert.match(body, /leftover undefined keys cannot hide a newer week/);
    assert.match(body, /leftoverUndefinedKey\(week\.season_year\)/);
    assert.match(body, /leftover accessor keys cannot hide a newer week/);
    assert.match(body, /leftoverAccessorKey\(week, "season_year"\)/);
    assert.match(body, /leftoverAccessorKey\(week, "week_number"\)/);
    assert.match(body, /leftover boolean keys cannot hide a newer week/);
    assert.match(body, /leftoverBooleanKey\(week\.season_year\)/);
    assert.match(body, /leftover symbol keys cannot hide a newer week/);
    assert.match(body, /leftoverSymbolKey\(week\.season_year\)/);
    assert.match(body, /leftover function keys cannot hide a newer week/);
    assert.match(body, /leftoverFunctionKey\(week\.season_year\)/);
    assert.match(body, /leftover array keys cannot hide a newer week/);
    assert.match(body, /leftoverArrayKey\(week\.season_year\)/);
    assert.match(body, /leftover date keys cannot hide a newer week/);
    assert.match(body, /leftoverDateKey\(week\.season_year\)/);
    assert.match(body, /leftover map keys cannot hide a newer week/);
    assert.match(body, /leftoverMapKey\(week\.season_year\)/);
    assert.match(body, /leftover set keys cannot hide a newer week/);
    assert.match(body, /leftoverSetKey\(week\.season_year\)/);
    assert.match(body, /leftover weakmap keys cannot hide a newer week/);
    assert.match(body, /leftoverWeakMapKey\(week\.season_year\)/);
    assert.match(body, /leftover weakset keys cannot hide a newer week/);
    assert.match(body, /leftoverWeakSetKey\(week\.season_year\)/);
    assert.match(body, /leftover promise keys cannot hide a newer week/);
    assert.match(body, /leftoverPromiseKey\(week\.season_year\)/);
    assert.match(body, /leftover error keys cannot hide a newer week/);
    assert.match(body, /leftoverErrorKey\(week\.season_year\)/);
    assert.match(body, /leftover regexp keys cannot hide a newer week/);
    assert.match(body, /leftoverRegExpKey\(week\.season_year\)/);
    assert.match(body, /leftover arraybuffer keys cannot hide a newer week/);
    assert.match(body, /leftoverArrayBufferKey\(week\.season_year\)/);
    assert.match(body, /leftover sharedarraybuffer keys cannot hide a newer week/);
    assert.match(body, /leftoverSharedArrayBufferKey\(week\.season_year\)/);
    assert.match(body, /leftover dataview keys cannot hide a newer week/);
    assert.match(body, /leftoverDataViewKey\(week\.season_year\)/);
    assert.match(body, /leftover typedarray keys cannot hide a newer week/);
    assert.match(body, /leftoverTypedArrayKey\(week\.season_year\)/);
    assert.match(body, /leftover blob keys cannot hide a newer week/);
    assert.match(body, /leftoverBlobKey\(week\.season_year\)/);
    assert.match(body, /leftover file keys cannot hide a newer week/);
    assert.match(body, /leftoverFileKey\(week\.season_year\)/);
    assert.match(body, /leftover url keys cannot hide a newer week/);
    assert.match(body, /leftoverUrlKey\(week\.season_year\)/);
    assert.match(body, /leftover urlsearchparams keys cannot hide a newer week/);
    assert.match(body, /leftoverUrlSearchParamsKey\(week\.season_year\)/);
    assert.match(body, /leftover formdata keys cannot hide a newer week/);
    assert.match(body, /leftoverFormDataKey\(week\.season_year\)/);
    assert.match(body, /leftover headers keys cannot hide a newer week/);
    assert.match(body, /leftoverHeadersKey\(week\.season_year\)/);
    assert.match(body, /leftover request keys cannot hide a newer week/);
    assert.match(body, /leftoverRequestKey\(week\.season_year\)/);
    assert.match(body, /leftover response keys cannot hide a newer week/);
    assert.match(body, /leftoverResponseKey\(week\.season_year\)/);
    assert.match(body, /leftover readable stream keys cannot hide a newer week/);
    assert.match(body, /leftoverReadableStreamKey\(week\.season_year\)/);
    assert.match(body, /leftover writable stream keys cannot hide a newer week/);
    assert.match(body, /leftoverWritableStreamKey\(week\.season_year\)/);
    assert.match(body, /leftover transform stream keys cannot hide a newer week/);
    assert.match(body, /leftoverTransformStreamKey\(week\.season_year\)/);
    assert.match(body, /if \(!weeks\?\.length\) return null/);
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
    assert.match(chromeBody, /recency treats non-finite season_year and week_number as 0/);
    assert.match(chromeBody, /leftover host objects cannot hide a newer week/);
    assert.match(chromeBody, /leftover throwing rows cannot hide a newer week/);
    assert.match(chromeBody, /leftover unconvertible keys cannot hide a newer week/);
    assert.match(chromeBody, /leftover object keys cannot hide a newer week/);
    assert.match(chromeBody, /leftover non-numeric string keys cannot hide a newer week/);
    assert.match(chromeBody, /leftover non-decimal string keys cannot hide a newer week/);
    assert.match(chromeBody, /leftover bigint keys cannot hide a newer week/);
    assert.match(chromeBody, /leftover non-integer keys cannot hide a newer week/);
    assert.match(chromeBody, /leftover non-positive keys cannot hide a newer week/);
    assert.match(chromeBody, /leftover infinity keys cannot hide a newer week/);
    assert.match(chromeBody, /leftover nan keys cannot hide a newer week/);
    assert.match(chromeBody, /leftover null keys cannot hide a newer week/);
    assert.match(chromeBody, /leftover undefined keys cannot hide a newer week/);
    assert.match(chromeBody, /leftover accessor keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverAccessorKey\(week, "week_number"\)/);
    assert.match(chromeBody, /leftover boolean keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverBooleanKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover symbol keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverSymbolKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover function keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverFunctionKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover array keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverArrayKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover date keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverDateKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover map keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverMapKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover set keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverSetKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover weakmap keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverWeakMapKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover weakset keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverWeakSetKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover promise keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverPromiseKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover error keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverErrorKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover regexp keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverRegExpKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover arraybuffer keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverArrayBufferKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover sharedarraybuffer keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverSharedArrayBufferKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover dataview keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverDataViewKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover typedarray keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverTypedArrayKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover blob keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverBlobKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover file keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverFileKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover url keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverUrlKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover urlsearchparams keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverUrlSearchParamsKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover formdata keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverFormDataKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover headers keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverHeadersKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover request keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverRequestKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover response keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverResponseKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover readable stream keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverReadableStreamKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover writable stream keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverWritableStreamKey\(weekNumber\)/);
    assert.match(chromeBody, /leftover transform stream keys cannot hide a newer week/);
    assert.match(chromeBody, /leftoverTransformStreamKey\(weekNumber\)/);
    assert.match(chromeBody, /fetchHouseholdWeeks sorts with recency/);
    assert.match(chromeBody, /familyWeekChrome treats non-finite week_number as 0/);
    assert.match(chromeBody, /Number\(week\.week_number\)/);
    assert.match(chromeBody, /Number\.isFinite\(week\.week_number\)/);
    assert.match(chromeBody, /week\.week_number = 0/);
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
    assert.match(recencyImpl, /Number\.isFinite\(a\.season_year\)/);
    assert.match(recencyImpl, /Number\.isFinite\(a\.week_number\)/);
    assert.match(recencyImpl, /Number\.isFinite\(b\.season_year\)/);
    assert.match(recencyImpl, /Number\.isFinite\(b\.week_number\)/);
    assert.match(recencyImpl, /a\.season_year = 0/);
    assert.match(recencyImpl, /a\.week_number = 0/);
    assert.match(recencyImpl, /b\.season_year = 0/);
    assert.match(recencyImpl, /b\.week_number = 0/);
    assert.match(recencyImpl, /if \(!a\)/);
    assert.match(recencyImpl, /if \(!b\)/);
    assert.match(recencyImpl, /leftover missing rows cannot hide a newer week/);
    assert.match(recencyImpl, /typeof a !== "object"/);
    assert.match(recencyImpl, /typeof b !== "object"/);
    assert.match(recencyImpl, /leftover non-object rows cannot hide a newer week/);
    assert.match(recencyImpl, /Array.isArray\(a\)/);
    assert.match(recencyImpl, /Array.isArray\(b\)/);
    assert.match(recencyImpl, /leftover array rows cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverHostObject\(a\)/);
    assert.match(recencyImpl, /leftoverHostObject\(b\)/);
    assert.match(recencyImpl, /leftover host objects cannot hide a newer week/);
    assert.match(recencyImpl, /leftover throwing rows cannot hide a newer week/);
    assert.match(recencyImpl, /leftover unconvertible keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftover object keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverObjectKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverObjectKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover non-numeric string keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverNonNumericStringKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverNonNumericStringKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover non-decimal string keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverNonDecimalStringKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverNonDecimalStringKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover bigint keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverBigintKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverBigintKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover non-integer keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverNonIntegerKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverNonIntegerKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover non-positive keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverNonPositiveKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverNonPositiveKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover infinity keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverInfinityKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverInfinityKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover nan keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverNaNKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverNaNKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover null keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverNullKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverNullKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover undefined keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverUndefinedKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverUndefinedKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover accessor keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverAccessorKey\(a, "season_year"\)/);
    assert.match(recencyImpl, /leftoverAccessorKey\(b, "season_year"\)/);
    assert.match(recencyImpl, /leftoverAccessorKey\(a, "week_number"\)/);
    assert.match(recencyImpl, /leftoverAccessorKey\(b, "week_number"\)/);
    assert.match(recencyImpl, /leftover boolean keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverBooleanKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverBooleanKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover symbol keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverSymbolKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverSymbolKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover function keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverFunctionKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverFunctionKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover array keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverArrayKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverArrayKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover date keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverDateKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverDateKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover map keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverMapKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverMapKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover set keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverSetKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverSetKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover weakmap keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverWeakMapKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverWeakMapKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover weakset keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverWeakSetKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverWeakSetKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover promise keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverPromiseKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverPromiseKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover error keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverErrorKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverErrorKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover regexp keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverRegExpKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverRegExpKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover arraybuffer keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverArrayBufferKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverArrayBufferKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover sharedarraybuffer keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverSharedArrayBufferKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverSharedArrayBufferKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover dataview keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverDataViewKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverDataViewKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover typedarray keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverTypedArrayKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverTypedArrayKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover blob keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverBlobKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverBlobKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover file keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverFileKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverFileKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover url keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverUrlKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverUrlKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover urlsearchparams keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverUrlSearchParamsKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverUrlSearchParamsKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover formdata keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverFormDataKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverFormDataKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover headers keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverHeadersKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverHeadersKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover request keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverRequestKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverRequestKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover response keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverResponseKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverResponseKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover readable stream keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverReadableStreamKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverReadableStreamKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover writable stream keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverWritableStreamKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverWritableStreamKey\(bYearKey\)/);
    assert.match(recencyImpl, /leftover transform stream keys cannot hide a newer week/);
    assert.match(recencyImpl, /leftoverTransformStreamKey\(aYearKey\)/);
    assert.match(recencyImpl, /leftoverTransformStreamKey\(bYearKey\)/);
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
    const oauth = readFileSync(join(process.cwd(), "ops/google-oauth.md"), "utf8");
    assert.doesNotMatch(oauth, /open\/locked > draft > final/);
    assert.match(oauth, /else newest week overall/);
    const nextStart = src.indexOf("export function nextWeekSlot");
    const nextEnd = src.indexOf("export function weekAtSlot");
    assert.ok(nextStart >= 0 && nextEnd > nextStart);
    const nextBody = src.slice(nextStart, nextEnd);
    assert.match(nextBody, /Number\(week\.season_year\)/);
    assert.match(nextBody, /Number\(week\.week_number\)/);
    assert.match(nextBody, /Number\.isFinite\(season_year\)/);
    assert.match(nextBody, /Number\.isFinite\(week_number\)/);
    assert.match(nextBody, /leftover unconvertible keys cannot hide a newer week/);
    assert.match(nextBody, /leftover object keys cannot hide a newer week/);
    assert.match(nextBody, /leftover non-numeric string keys cannot hide a newer week/);
    assert.match(nextBody, /leftover non-decimal string keys cannot hide a newer week/);
    assert.match(nextBody, /leftover bigint keys cannot hide a newer week/);
    assert.match(nextBody, /leftover non-integer keys cannot hide a newer week/);
    assert.match(nextBody, /leftover non-positive keys cannot hide a newer week/);
    assert.match(nextBody, /leftover infinity keys cannot hide a newer week/);
    assert.match(nextBody, /leftover nan keys cannot hide a newer week/);
    assert.match(nextBody, /leftover null keys cannot hide a newer week/);
    assert.match(nextBody, /leftover undefined keys cannot hide a newer week/);
    assert.match(nextBody, /leftover accessor keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverAccessorKey\(week, "season_year"\)/);
    assert.match(nextBody, /leftoverAccessorKey\(week, "week_number"\)/);
    assert.match(nextBody, /leftover boolean keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverBooleanKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverBooleanKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover symbol keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverSymbolKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverSymbolKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover function keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverFunctionKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverFunctionKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover array keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverArrayKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverArrayKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover date keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverDateKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverDateKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover map keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverMapKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverMapKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover set keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverSetKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverSetKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover weakmap keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverWeakMapKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverWeakMapKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover weakset keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverWeakSetKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverWeakSetKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover promise keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverPromiseKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverPromiseKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover error keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverErrorKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverErrorKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover regexp keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverRegExpKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverRegExpKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover arraybuffer keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverArrayBufferKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverArrayBufferKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover sharedarraybuffer keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverSharedArrayBufferKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverSharedArrayBufferKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover dataview keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverDataViewKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverDataViewKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover typedarray keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverTypedArrayKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverTypedArrayKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover blob keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverBlobKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverBlobKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover file keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverFileKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverFileKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover url keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverUrlKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverUrlKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover urlsearchparams keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverUrlSearchParamsKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverUrlSearchParamsKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover formdata keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverFormDataKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverFormDataKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover headers keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverHeadersKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverHeadersKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover request keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverRequestKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverRequestKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover response keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverResponseKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverResponseKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover readable stream keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverReadableStreamKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverReadableStreamKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover writable stream keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverWritableStreamKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverWritableStreamKey\(week\.week_number\)/);
    assert.match(nextBody, /leftover transform stream keys cannot hide a newer week/);
    assert.match(nextBody, /leftoverTransformStreamKey\(week\.season_year\)/);
    assert.match(nextBody, /leftoverTransformStreamKey\(week\.week_number\)/);
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
    assert.match(labelBody, /Number\(w\.week_number\)/);
    assert.match(labelBody, /Number\.isFinite\(w\.week_number\)/);
    assert.match(labelBody, /w\.week_number = 0/);
    assert.match(labelBody, /leftover unconvertible keys cannot hide a newer week/);
    assert.match(labelBody, /leftover object keys cannot hide a newer week/);
    assert.match(labelBody, /leftover non-numeric string keys cannot hide a newer week/);
    assert.match(labelBody, /leftover non-decimal string keys cannot hide a newer week/);
    assert.match(labelBody, /leftover bigint keys cannot hide a newer week/);
    assert.match(labelBody, /leftover non-integer keys cannot hide a newer week/);
    assert.match(labelBody, /leftover non-positive keys cannot hide a newer week/);
    assert.match(labelBody, /leftover infinity keys cannot hide a newer week/);
    assert.match(labelBody, /leftover nan keys cannot hide a newer week/);
    assert.match(labelBody, /leftover null keys cannot hide a newer week/);
    assert.match(labelBody, /leftover undefined keys cannot hide a newer week/);
    assert.match(labelBody, /leftover accessor keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverAccessorKey\(w, "week_number"\)/);
    assert.match(labelBody, /leftover boolean keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverBooleanKey\(weekNumber\)/);
    assert.match(labelBody, /leftover symbol keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverSymbolKey\(weekNumber\)/);
    assert.match(labelBody, /leftover function keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverFunctionKey\(weekNumber\)/);
    assert.match(labelBody, /leftover array keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverArrayKey\(weekNumber\)/);
    assert.match(labelBody, /leftover date keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverDateKey\(weekNumber\)/);
    assert.match(labelBody, /leftover map keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverMapKey\(weekNumber\)/);
    assert.match(labelBody, /leftover set keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverSetKey\(weekNumber\)/);
    assert.match(labelBody, /leftover weakmap keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverWeakMapKey\(weekNumber\)/);
    assert.match(labelBody, /leftover weakset keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverWeakSetKey\(weekNumber\)/);
    assert.match(labelBody, /leftover promise keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverPromiseKey\(weekNumber\)/);
    assert.match(labelBody, /leftover error keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverErrorKey\(weekNumber\)/);
    assert.match(labelBody, /leftover regexp keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverRegExpKey\(weekNumber\)/);
    assert.match(labelBody, /leftover arraybuffer keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverArrayBufferKey\(weekNumber\)/);
    assert.match(labelBody, /leftover sharedarraybuffer keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverSharedArrayBufferKey\(weekNumber\)/);
    assert.match(labelBody, /leftover dataview keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverDataViewKey\(weekNumber\)/);
    assert.match(labelBody, /leftover typedarray keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverTypedArrayKey\(weekNumber\)/);
    assert.match(labelBody, /leftover blob keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverBlobKey\(weekNumber\)/);
    assert.match(labelBody, /leftover file keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverFileKey\(weekNumber\)/);
    assert.match(labelBody, /leftover url keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverUrlKey\(weekNumber\)/);
    assert.match(labelBody, /leftover urlsearchparams keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverUrlSearchParamsKey\(weekNumber\)/);
    assert.match(labelBody, /leftover formdata keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverFormDataKey\(weekNumber\)/);
    assert.match(labelBody, /leftover headers keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverHeadersKey\(weekNumber\)/);
    assert.match(labelBody, /leftover request keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverRequestKey\(weekNumber\)/);
    assert.match(labelBody, /leftover response keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverResponseKey\(weekNumber\)/);
    assert.match(labelBody, /leftover readable stream keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverReadableStreamKey\(weekNumber\)/);
    assert.match(labelBody, /leftover writable stream keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverWritableStreamKey\(weekNumber\)/);
    assert.match(labelBody, /leftover transform stream keys cannot hide a newer week/);
    assert.match(labelBody, /leftoverTransformStreamKey\(weekNumber\)/);
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
    assert.match(fetchBody, /non-finite keys as 0/);
    assert.match(fetchBody, /\.filter\(\(week\) => week\)/);
    assert.match(fetchBody, /leftover holes cannot hide a newer week/);
    assert.match(fetchBody, /typeof week === "object"/);
    assert.match(fetchBody, /leftover non-object rows cannot hide a newer week/);
    assert.match(fetchBody, /!Array.isArray\(week\)/);
    assert.match(fetchBody, /leftover array rows cannot hide a newer week/);
    assert.match(fetchBody, /leftover host objects cannot hide a newer week/);
    assert.match(fetchBody, /leftover throwing rows cannot hide a newer week/);
    assert.match(fetchBody, /leftover unconvertible keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover object keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover non-numeric string keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover non-decimal string keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover bigint keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover non-integer keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover non-positive keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover infinity keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover nan keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover null keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover undefined keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover accessor keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover boolean keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover symbol keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover function keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover array keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover date keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover map keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover set keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover weakmap keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover weakset keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover promise keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover error keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover regexp keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover arraybuffer keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover sharedarraybuffer keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover dataview keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover typedarray keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover blob keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover file keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover url keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover urlsearchparams keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover formdata keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover headers keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover request keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover response keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover readable stream keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover writable stream keys cannot hide a newer week/);
    assert.match(fetchBody, /leftover transform stream keys cannot hide a newer week/);
    assert.match(fetchBody, /Object.getPrototypeOf\(week\)/);
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
    assert.match(openFn, /select\("season_year, week_number, status, finalized_at, lock_at"\)/);
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
    assert.match(
      autofill,
      /import \{ nextWeekSlot, recency, shouldAutopilotEnsureNextWeek \} from "\.\/current-week"/,
    );
    const ensureFn = autofill.slice(
      autofill.indexOf("export async function ensureNextWeek"),
      autofill.indexOf("const espnGames = await fetchEspnWeek(seasonYear, weekNumber)"),
    );
    assert.match(ensureFn, /nextWeekSlot\(last\)/);
    assert.match(ensureFn, /Number\(last\.week_number\)/);
    assert.doesNotMatch(ensureFn, /\(last\?\.week_number \?\? 0\) \+ 1/);
    assert.match(ensureFn, /shouldAutopilotEnsureNextWeek\(list\)/);
    assert.match(ensureFn, /\[\.\.\.list\]\.sort\(recency\)/);
    assert.doesNotMatch(ensureFn, /\.limit\(1\)/);
    assert.match(ensureFn, /select\("id, season_year, week_number, status, finalized_at, lock_at"\)/);
    assert.match(ensureFn, /reason: "leftover"/);
    const lib = readFileSync(join(process.cwd(), "src/lib/current-week.ts"), "utf8");
    const ensureNextGuard = lib.slice(
      lib.indexOf("export function shouldAutopilotEnsureNextWeek"),
      lib.indexOf("export function shouldAutopilotLockOpen"),
    );
    assert.match(ensureNextGuard, /weeks\.some\(\(w\) => isInPlay\(w\.status\)\)/);
    assert.match(ensureNextGuard, /recoverableFinishedWeek\(weeks\)/);
    assert.match(ensureNextGuard, /!weeks\.some\(isUnplayedLeftover\)/);
    assert.ok(
      lib.indexOf("export function shouldAutopilotOpenDraft") <
        lib.indexOf("export function shouldAutopilotEnsureNextWeek"),
      "leftover-unplayed helper must stay before the auto-create guard so its source-scan slice stays intact",
    );
    const openDraftFn = lib.slice(
      lib.indexOf("export function shouldAutopilotOpenDraft"),
      lib.indexOf("export function shouldAutopilotEnsureNextWeek"),
    );
    assert.match(openDraftFn, /isPrematureFinalWeek\(w,\s*weeks\)/);
    assert.match(openDraftFn, /isOlderThan\(w,\s*week\)/);
    assert.ok(
      openDraftFn.indexOf("isPrematureFinalWeek") < openDraftFn.indexOf("isNewerThan"),
      "older premature-final must block auto-open before the newest-week check",
    );
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
