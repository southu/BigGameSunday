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
  });

  it("b: draft W1 + open W2 → active W2", () => {
    const leftover = w(1, "draft");
    const open = w(2, "open");
    assert.equal(selectActiveWeek([leftover, open])?.week_number, 2);
    assert.equal(selectActiveWeek([open, leftover])?.week_number, 2);
    assert.equal(selectActiveWeek([leftover, open])?.status, "open");
    assert.equal(selectActiveWeek([leftover, w(2, "locked")])?.week_number, 2);
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
    assert.match(body, /recency\(week, latestInPlay\)/);
    assert.match(body, /recency\(week, newest\)/);
    assert.doesNotMatch(body, /status === ["']draft["']/);
    assert.doesNotMatch(body, /status === ["']final["']/);
    assert.doesNotMatch(src, /ranked\.find\(\(w\) => w\.status === "draft"\)/);
    assert.doesNotMatch(src, /else latest draft/);
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
    assert.match(pickBody, /isNewerDraft\(w, active\)/);
    assert.match(pickBody, /if \(!slotDraft\)/);
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
    const stay = skipControlCopy(leftover, w(3, "open"), [leftover, w(2, "final"), w(3, "open")]);
    assert.equal(stay.button, "Skip leftover Week 1");
    assert.doesNotMatch(stay.button, /open/);
    assert.match(stay.hint, /without Reveal/);
  });

  it("skip does not reopen next when a newer week is already in play", () => {
    const leftover = w(1, "draft");
    const premature = w(2, "final");
    const open3 = w(3, "open");
    const locked3 = w(3, "locked");
    const draft3 = w(3, "draft");
    const dirtyOpen = { ...w(2, "open"), finalized_at: "2026-09-15T19:04:43.880Z" };

    assert.equal(skipTouchesNextWeek(premature, [leftover, premature]), true);
    assert.equal(skipTouchesNextWeek(premature, [leftover, premature, draft3]), true);
    assert.equal(skipTouchesNextWeek(premature, [leftover, premature, open3]), false);
    assert.equal(skipTouchesNextWeek(premature, [leftover, premature, locked3]), false);
    assert.equal(skipTouchesNextWeek({ season_year: 2026, week_number: 2 }, [leftover, open3]), false);

    assert.equal(shouldOpenExistingNextWeek(premature), true);
    assert.equal(shouldOpenExistingNextWeek(premature, [leftover, premature]), true);
    assert.equal(shouldOpenExistingNextWeek(premature, [leftover, premature, open3]), false);
    assert.equal(shouldOpenExistingNextWeek(w(2, "draft"), [leftover, w(2, "draft"), open3]), false);
    assert.equal(shouldOpenExistingNextWeek(w(2, "locked"), [leftover, w(2, "locked")]), true);
    assert.equal(shouldOpenExistingNextWeek(w(2, "locked"), [leftover, w(2, "locked"), open3]), false);
    assert.equal(shouldOpenExistingNextWeek(dirtyOpen, [leftover, dirtyOpen]), true);
    assert.equal(shouldOpenExistingNextWeek(dirtyOpen, [leftover, dirtyOpen, open3]), false);

    assert.equal(selectActiveWeek([w(1, "final"), premature, open3])?.week_number, 3);
    assert.equal(selectActiveWeek([w(1, "final"), w(2, "open"), open3])?.week_number, 3);
    assert.equal(selectActiveWeek([leftover, premature, draft3])?.week_number, 3);
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

    assert.equal(skipLandingWeek([leftover, open2], leftover)?.id, "w2");
    assert.equal(skipLandingWeek([leftover, open2], leftover)?.status, "open");

    const reopenWithDraft3 = skipLandingWeek([leftover, premature, draft3], leftover);
    assert.equal(reopenWithDraft3?.id, "w2");
    assert.equal(reopenWithDraft3?.status, "open");

    const only = skipLandingWeek([leftover], leftover);
    assert.equal(only?.id, "w1");
    assert.equal(only?.status, "final");
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
    assert.equal(pickViewWeek([open, laterDraft], active, "next")?.id, "w3");
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
    assert.equal(pickViewWeek([open, laterDraft], active, "next")?.id, "w3");
    const fartherDraft = wr("w4", 4, "draft");
    assert.equal(pickViewWeek([open, laterDraft, fartherDraft], active, "next")?.id, "w3");
    assert.equal(pickViewWeek([open, fartherDraft, laterDraft], active, "next")?.id, "w3");
    assert.equal(pickViewWeek([open, fartherDraft], active, "next")?.id, "w4");
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
    assert.equal(pickViewWeek([open, laterDraft], active, "next")?.id, "w4");
    assert.equal(pickViewWeek([open, wr("w3d", 3, "draft"), laterDraft], active, "next")?.id, "w3d");
    const wrapLocked = wr("w18", 18, "locked", 2025);
    const wrapFinal = wr("w2", 2, "final", 2026);
    const wrapDraft = wr("w3", 3, "draft", 2026);
    const wrapActive = selectActiveWeek([wrapLocked, wrapFinal, wrapDraft]);
    assert.equal(wrapActive?.id, "w18");
    assert.equal(pickViewWeek([wrapLocked, wrapFinal, wrapDraft], wrapActive, "next")?.id, "w18");
    assert.notEqual(pickViewWeek([wrapLocked, wrapFinal, wrapDraft], wrapActive, "next")?.id, "w3");
    assert.equal(pickViewWeek([wrapLocked, wrapDraft], wrapActive, "next")?.id, "w3");
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
    const recoverFn = lib.slice(
      lib.indexOf("function recoverableFinishedWeek"),
      lib.indexOf("export function skipTargetWeek"),
    );
    assert.match(recoverFn, /isPrematureFinalWeek\(target, weeks\)/);
    const scrubFn = lib.slice(
      lib.indexOf("function skipScrubsLeftoverInPlace"),
      lib.indexOf("export function skipScrubsViewedInPlace"),
    );
    assert.doesNotMatch(scrubFn, /leftover\.status === ["']final["']/);
    assert.match(scrubFn, /isPrematureFinalWeek\(leftover, weeks\)/);
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
    assert.match(skipFn, /skipTouchesNextWeek/);
    assert.match(skipFn, /skipLandingWeek\(weeks,\s*leftover\)/);
    assert.match(skipFn, /setViewWeekId\(landing\.id\)/);
    assert.match(skipFn, /shouldOpenExistingNextWeek\(next,\s*weeks\)/);
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
