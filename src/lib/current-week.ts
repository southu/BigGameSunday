/**
 * Active week for a household:
 *   1. latest open or locked (never hide these behind a newer draft or final)
 *   2. else newest week overall (highest season_year, then week_number),
 *      whether draft or final — never an older draft over a newer week
 */
/** Ranking keys only. Recency is season_year then week_number. */
export type WeekSlot = {
  season_year: number;
  week_number: number;
};

export type WeekLike = WeekSlot & {
  status: string;
  /** Ranking ignores this. Skip uses it to find a premature-finalize leftover. */
  finalized_at?: string | null;
  /** Ranking ignores this. Finalize-before-lock is premature. */
  lock_at?: string | null;
  /**
   * Ranking ignores this. Live leftover-open weeks can be `open` with
   * `auto_opened_at` still null (Harper House W2). In-play is status only.
   */
  auto_opened_at?: string | null;
  /**
   * Ranking ignores these. Live Harper House skipped W1 + dirty-open W2
   * carry lock_at_override, created_at, featured_game_id, and
   * commissioner_edited_at; in-play is status only.
   */
  lock_at_override?: boolean;
  featured_game_id?: string | null;
  created_at?: string | null;
  commissioner_edited_at?: string | null;
  /**
   * Ranking ignores these. Live Harper House weeks also carry
   * household_id, auto_created_at, auto_locked_at, autopilot_hold,
   * and autopilot_checked_at; in-play is status only.
   */
  household_id?: string;
  auto_created_at?: string | null;
  auto_locked_at?: string | null;
  autopilot_hold?: boolean;
  autopilot_checked_at?: string | null;
  /**
   * Ranking ignores this. Live week rows have a UUID primary key;
   * recency is season_year then week_number, not lexicographic id.
   */
  id?: string;
};

export type WeekRef = WeekLike & { id: string };

/**
 * Recency for ranking: higher season_year, then higher week_number.
 * Timestamps and leftover stamps are not keys. Extra select("*") fields
 * from fetchHouseholdWeeks cannot hide a newer week.
 */
function recency(a: WeekSlot, b: WeekSlot): number {
  if (a.season_year !== b.season_year) return b.season_year - a.season_year;
  return b.week_number - a.week_number;
}

function isNewerThan(week: WeekSlot, than: WeekSlot): boolean {
  return recency(week, than) < 0;
}

function isOlderThan(week: WeekSlot, than: WeekSlot): boolean {
  return recency(week, than) > 0;
}

function isSameSlot(a: WeekSlot, b: WeekSlot): boolean {
  return recency(a, b) === 0;
}

function isInPlay(status: string): boolean {
  return status === "open" || status === "locked";
}

export function isNewerDraft(w: WeekLike, active: WeekLike): boolean {
  return w.status === "draft" && isNewerThan(w, active);
}

/**
 * Latest open|locked (highest season_year, then week_number). Else newest
 * week overall — draft vs final is not a rank, so leftover draft W1 cannot
 * hide a newer final W2 (Harper House).
 */
export function selectActiveWeek<T extends WeekLike>(weeks: readonly T[]): T | null {
  if (weeks.length === 0) return null;
  let latestInPlay: T | null = null;
  let newest: T | null = null;
  for (const week of weeks) {
    if (isInPlay(week.status) && (!latestInPlay || recency(week, latestInPlay) < 0)) {
      latestInPlay = week;
    }
    if (!newest || recency(week, newest) < 0) newest = week;
  }
  // Newest overall — never leftover draft over a newer final or draft.
  return latestInPlay ?? newest;
}

/** Regular season wraps to week 1 of the next year after week 18. */
export function nextWeekSlot(week: WeekSlot): WeekSlot {
  if (week.week_number >= 18) {
    return { season_year: week.season_year + 1, week_number: 1 };
  }
  return { season_year: week.season_year, week_number: week.week_number + 1 };
}

export function weekAtSlot<T extends WeekSlot>(weeks: readonly T[], slot: WeekSlot): T | undefined {
  return weeks.find((w) => isSameSlot(w, slot));
}

/** Skip closes a leftover week without Reveal; finished weeks stay put. */
export function canSkipWeek(week: WeekLike | null | undefined): boolean {
  return !!week && week.status !== "final";
}

/**
 * Autopilot auto-opens a draft 24h after auto-create only when no newer week
 * exists. Opening a leftover draft behind a newer week would trap the family
 * on the skipped week via in-play ranking (Harper: leftover W1 + final W2).
 */
export function shouldAutopilotOpenDraft(
  week: WeekLike,
  weeks: readonly WeekLike[],
): boolean {
  if (week.status !== "draft") return false;
  return !weeks.some((w) => isNewerThan(w, week));
}

/**
 * Autopilot must not lock a leftover-open week skip should close.
 * Dirty-open leftover marks would freeze as misses; leftover open W1
 * behind a newer final/open/locked week would trap the family via
 * in-play ranking. Skip is the Tuesday path — no Reveal required.
 */
export function shouldAutopilotLockOpen(
  week: WeekLike,
  weeks: readonly WeekLike[] = [],
): boolean {
  return week.status === "open" && shouldOfferOpenCards(week, weeks);
}

/**
 * Autopilot must not Finalize a leftover locked week behind a newer
 * final/open/locked week. That scores leftover misses and forces Reveal;
 * skip closes that leftover without Reveal so the family can play Tuesday.
 */
export function shouldAutopilotFinalize(
  week: WeekLike,
  weeks: readonly WeekLike[] = [],
): boolean {
  return week.status === "locked" && shouldOfferOpenCards(week, weeks);
}

/**
 * Autopilot must not call leftover locked weeks behind a newer in-play
 * week. Those scores settle leftover moments while the family is already
 * on This Sunday (leftover locked W1 + open/locked W2). Skip closes that
 * leftover without Reveal and does not clear locked-week results.
 * Leftover locked W1 that is still This Sunday (newer week is draft or
 * final) keeps live scores — in-play ranking has not moved the family.
 */
export function shouldAutopilotResolveScores(
  week: WeekLike,
  weeks: readonly WeekLike[] = [],
): boolean {
  return week.status === "locked" && !hasNewerInPlayThan(week, weeks);
}

/**
 * Draft→open is only safe when this draft is the newest week. Opening a
 * leftover draft behind a newer week would steal the family via in-play
 * ranking (Harper: leftover W1 behind final/open W2). Lock/finalize stay
 * on This Sunday (in-play + next-week draft). They do not stay on a leftover
 * in-play week behind a newer final/open/locked week — skip closes that
 * leftover without Reveal. Lock/finalize also stay off weeks that still
 * have leftover marks from a premature finish — skip scrubs those; locking
 * or Finalize would freeze leftover misses and force Reveal, which skip
 * does not require.
 */
export function shouldOfferOpenCards(
  week: WeekLike,
  weeks: readonly WeekLike[],
): boolean {
  if (skipScrubsLeftoverInPlace(week, weeks)) return false;
  if (hasNewerNonDraftThan(week, weeks)) return false;
  if (week.status !== "draft") return true;
  return shouldAutopilotOpenDraft(week, weeks);
}

function hasNewerInPlayThan(week: WeekSlot, weeks: readonly WeekLike[]): boolean {
  return weeks.some((w) => isInPlay(w.status) && isNewerThan(w, week));
}

function hasOlderInPlayThan(week: WeekSlot, weeks: readonly WeekLike[]): boolean {
  return weeks.some((w) => isInPlay(w.status) && isOlderThan(w, week));
}

/** Newer open/locked/final week exists — this slot is leftover, not This Sunday. */
function hasNewerNonDraftThan(week: WeekSlot, weeks: readonly WeekLike[]): boolean {
  return weeks.some((w) => w.status !== "draft" && isNewerThan(w, week));
}

/** Any newer week exists — opening this slot would steal the family via in-play ranking. */
function hasNewerThan(week: WeekSlot, weeks: readonly WeekLike[]): boolean {
  return weeks.some((w) => isNewerThan(w, week));
}

/**
 * Skip leftover may create/reopen/refresh next only when that slot is not
 * already in play, no newer week exists, and no older in-play week remains
 * after leftover is closed. Otherwise just close the leftover and leave the
 * family on This Sunday (leftover locked W1 must not unlock open/locked W2;
 * skipping Next week must not open W3 and steal This Sunday; leftover draft
 * W1 behind leftover W2 and a newer week W3 must not open leftover W2;
 * leftover draft W1 behind premature-final W2 and a newer draft W3 must not
 * reopen leftover W2; auto-created W3 must not bounce them to W2).
 * Draft/final next still opens — leftover draft W1 + premature-final W2,
 * skip of leftover W2 behind a newer final W3, and skip of This Sunday
 * still opens Next week, even when Next week is premature-final and a
 * farther auto-created draft already exists (This Sunday W1 + Next week
 * W2 + W3 draft). A leftover draft behind that farther week still does
 * not reopen leftover next.
 * Skip does not reopen a completed Next week (finalized after lock, in
 * order). Leftover open W1 sitting behind Revealed W2 is still This Sunday
 * via in-play ranking; leftover draft W1 sits behind Revealed W2 via
 * newest-week ranking. Closing either leftover must leave W2 final.
 * Reopening would wipe Reveal. Premature-final Next week still opens.
 * Empty `weeks` still touches (no sibling to inspect).
 */
export function skipTouchesNextWeek(
  next: WeekSlot | null | undefined,
  weeks: readonly WeekLike[],
  leftover?: WeekSlot | null,
): boolean {
  if (!next) return !weeks.some((w) => isInPlay(w.status));
  const leftoverIsThisSunday =
    !!leftover &&
    weeks.some((w) => isInPlay(w.status) && isSameSlot(w, leftover)) &&
    !weeks.some((w) => isInPlay(w.status) && isNewerThan(w, leftover));
  if (hasNewerThan(next, weeks) && !leftoverIsThisSunday) return false;
  const existing = weekAtSlot(weeks, next);
  if (existing && isInPlay(existing.status)) return false;
  if (
    existing &&
    existing.status === "final" &&
    !isPrematureFinalWeek(existing, weeks) &&
    (leftoverIsThisSunday || finalizedAfterLock(existing))
  ) {
    return false;
  }
  const remaining = leftover ? weeks.filter((w) => !isSameSlot(w, leftover)) : weeks;
  if (hasOlderInPlayThan(next, remaining)) return false;
  return true;
}

function withStatus<T extends WeekLike>(week: T, status: string): T {
  return { ...week, status };
}

/**
 * Commissioner view after skip. If skip opened/created next, land there
 * (existing next only — a newly created week is the caller's nextId).
 * If a newer week already exists, land on the post-skip active week so
 * closing leftover W1 does not open leftover W2 and steal the family via
 * in-play ranking (leftover W1 behind premature-final W2 and draft W3 stay
 * on W3; leftover drafts W1+W2 behind final W3 stay on W3).
 * If This Sunday remains in play, skip Next week stays there — do not open
 * a farther week and steal the family. Skip of This Sunday still lands on
 * Next week when a farther auto-created draft already exists — including
 * a premature-final Next week. Opening next clears leftover finalize stamps
 * so landing is a clean open week. A completed Next week stays final —
 * skip of leftover This Sunday or leftover draft lands there without
 * wiping Reveal. Skip-in-place leftover stamps stay put.
 * Dirty-open leftover (open + leftover finalize stamp) and premature-final
 * leftover stay put — scrub in place, do not close it and jump to the next week.
 */
export function skipLandingWeek<T extends WeekLike>(weeks: readonly T[], leftover: T): T | null {
  if (skipScrubsLeftoverInPlace(leftover, weeks)) {
    return weekAtSlot(weeks, leftover) ?? leftover;
  }
  const closed = weeks.map((w) => (isSameSlot(w, leftover) ? withStatus(w, "final") : w));
  const slot = nextWeekSlot(leftover);
  if (!skipTouchesNextWeek(slot, weeks, leftover)) return selectActiveWeek(closed);
  const next = weekAtSlot(weeks, slot);
  if (!next) return selectActiveWeek(closed);
  const opened = closed.map((w) =>
    isSameSlot(w, slot) ? { ...withStatus(w, "open"), finalized_at: null } : w,
  );
  return selectActiveWeek(opened);
}

/**
 * Button and hint for the commissioner skip control.
 * Do not promise "start next week" / "open this week" when skip will only
 * close the leftover because next (or a newer week) already exists, or
 * because This Sunday would remain in play (skipping Next week must not
 * open a farther week).
 */
export function skipControlCopy(
  leftover: WeekLike,
  viewed: WeekLike | null | undefined,
  weeks: readonly WeekLike[] = [],
): { button: string; hint: string } {
  if (skipScrubsViewedInPlace(leftover, viewed, weeks)) {
    if (viewed && isSameSlot(leftover, viewed)) {
      return {
        button: "Clear leftover marks / open this week",
        hint: "This week was marked finished too early. Clear leftover marks so the family can play — works on Tuesday.",
      };
    }
    return {
      button: `Clear leftover marks / open Week ${leftover.week_number}`,
      hint: `Week ${leftover.week_number} was marked finished too early. Clear leftover marks so the family can play — works on Tuesday.`,
    };
  }
  const slot = nextWeekSlot(leftover);
  const touchesNext = skipTouchesNextWeek(weekAtSlot(weeks, slot) ?? slot, weeks, leftover);
  if (viewed && isSameSlot(leftover, viewed)) {
    if (!touchesNext) {
      return {
        button: "Skip this week",
        hint: "Didn't play this week? Close it without Reveal — works on Tuesday.",
      };
    }
    return {
      button: "Skip this week / start next week",
      hint: "Didn't play this week? Close it without Reveal and open next week's cards — works on Tuesday.",
    };
  }
  const leftoverKind = leftover.status === "draft" ? "a leftover draft" : "leftover";
  if (touchesNext && viewed && isSameSlot(viewed, slot)) {
    return {
      button: `Skip leftover Week ${leftover.week_number} / open this week`,
      hint: `Week ${leftover.week_number} is still ${leftoverKind}. Close it without Reveal and open this week so the family can play — works on Tuesday.`,
    };
  }
  if (touchesNext) {
    return {
      button: `Skip leftover Week ${leftover.week_number} / open Week ${slot.week_number}`,
      hint: `Week ${leftover.week_number} is still ${leftoverKind}. Close it without Reveal and open Week ${slot.week_number} so the family can play — works on Tuesday.`,
    };
  }
  return {
    button: `Skip leftover Week ${leftover.week_number}`,
    hint: `Week ${leftover.week_number} is still ${leftoverKind}. Close it without Reveal — works on Tuesday.`,
  };
}

/**
 * Autopilot next-step for a leftover week. Do not promise "Open cards"
 * or "Lock the cards" — skip/scrub is the Tuesday path.
 */
export function leftoverDraftNextStep(
  week: WeekLike,
  weeks: readonly WeekLike[],
): { label: string; at: null } | null {
  if (skipScrubsLeftoverInPlace(week, weeks)) {
    return {
      label: "This week still has leftover marks — clear them so the family can play",
      at: null,
    };
  }
  if (week.status !== "draft" || shouldAutopilotOpenDraft(week, weeks)) {
    if (!hasNewerNonDraftThan(week, weeks)) return null;
    const slot = nextWeekSlot(week);
    const touchesNext = skipTouchesNextWeek(weekAtSlot(weeks, slot) ?? slot, weeks, week);
    return {
      label: touchesNext
        ? "This leftover week is behind a newer week — skip it to start next week"
        : "This leftover week is behind a newer week — skip it without Reveal",
      at: null,
    };
  }
  const slot = nextWeekSlot(week);
  const touchesNext = skipTouchesNextWeek(weekAtSlot(weeks, slot) ?? slot, weeks, week);
  return {
    label: touchesNext
      ? "This leftover draft will not auto-open — skip it to start next week"
      : "This leftover draft will not auto-open — skip it without Reveal",
    at: null,
  };
}

/**
 * Newest finished week is recoverable only with evidence it was marked
 * finished too early (finalized before lock, or finalized before an older
 * sibling was marked final). Ordinary completed weeks — newest final after
 * older finals — are not recoverable. Do not reopen a lone finished week,
 * and do not reopen a finished week while another week is open or locked.
 * Leftover drafts still close first (skipTargetWeek ranks those ahead).
 */
function recoverableFinishedWeek<T extends WeekLike>(weeks: readonly T[]): T | null {
  if (weeks.some((w) => isInPlay(w.status))) return null;
  const newest = [...weeks].sort(recency)[0];
  if (!newest) return null;
  if (weeks.some((w) => w.status === "draft" && isOlderThan(w, newest))) return null;
  const finals = [...weeks].filter((w) => w.status === "final").sort(recency);
  const target = finals[0];
  if (!target) return null;
  if (!weeks.some((w) => isOlderThan(w, target))) return null;
  if (!isPrematureFinalWeek(target, weeks)) return null;
  return target;
}

/**
 * Week the skip control closes.
 * Prefer an older leftover draft behind the viewed week (Harper: draft W1
 * sitting behind open/final W2) so Skip cannot close the week the family
 * is about to play. Prefer an older leftover in-play week behind This Sunday
 * (locked/open W1 sitting behind open/locked W2) for the same reason — Skip
 * must not close the week the family is playing. Otherwise recover a
 * premature-final week when nothing is in play and an older week exists
 * (Harper: skipped W1 + premature-final W2). Otherwise close the viewed week
 * when it is still playable.
 * If the viewed week is already finished, still target a leftover in-play
 * week behind a newer in-play week, or a leftover open week with a premature
 * finalize stamp so Skip can scrub it in place (Harper: skipped W1 + dirty-open
 * W2, commissioner looking at W1). A newest final without premature evidence
 * is left alone.
 */
export function skipTargetWeek<T extends WeekLike>(
  weeks: readonly T[],
  viewed: T | null | undefined,
): T | null {
  if (!viewed) return null;
  const olderDrafts = [...weeks]
    .filter((w) => w.status === "draft" && isOlderThan(w, viewed))
    .sort(recency);
  if (olderDrafts[0]) return olderDrafts[0];
  const olderLeftoverInPlay = [...weeks]
    .filter((w) => isInPlay(w.status) && hasNewerInPlayThan(w, weeks) && isOlderThan(w, viewed))
    .sort(recency);
  if (olderLeftoverInPlay[0]) return olderLeftoverInPlay[0];
  const recoverable = recoverableFinishedWeek(weeks);
  if (recoverable) return recoverable;
  if (canSkipWeek(viewed)) return viewed;
  const leftoverInPlay = [...weeks]
    .filter((w) => isInPlay(w.status) && hasNewerInPlayThan(w, weeks))
    .sort(recency);
  if (leftoverInPlay[0]) return leftoverInPlay[0];
  const dirtyOpen = [...weeks].filter(hasPrematureFinalizeLeftover).sort(recency);
  return dirtyOpen[0] ?? null;
}

/** Open + leftover finalize stamp: skip must reopen/scrub, not take the already-open path. */
function hasPrematureFinalizeLeftover(week: WeekLike | null | undefined): boolean {
  return !!week && week.status === "open" && !!week.finalized_at;
}

function stampMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Finalized before kickoff — the week was marked finished too early. */
function finalizedBeforeLock(week: WeekLike): boolean {
  const finalized = stampMs(week.finalized_at);
  const lock = stampMs(week.lock_at);
  return finalized != null && lock != null && finalized < lock;
}

/** Finalized after kickoff — Reveal already ran in order. */
function finalizedAfterLock(week: WeekLike): boolean {
  const finalized = stampMs(week.finalized_at);
  const lock = stampMs(week.lock_at);
  return finalized != null && lock != null && finalized >= lock;
}

/**
 * This week was marked final before an older sibling was — leftover skip
 * after a premature finalize (W2 finished, then leftover W1 closed later).
 * In-order finals (older first) do not match.
 */
function finalizedBeforeOlderSibling(week: WeekLike, weeks: readonly WeekLike[]): boolean {
  const finalized = stampMs(week.finalized_at);
  if (finalized == null) return false;
  return weeks.some((other) => {
    if (!isOlderThan(other, week) || other.status !== "final") return false;
    const older = stampMs(other.finalized_at);
    return older != null && older > finalized;
  });
}

function isPrematureFinalWeek(week: WeekLike, weeks: readonly WeekLike[] = []): boolean {
  if (week.status !== "final") return false;
  return finalizedBeforeLock(week) || finalizedBeforeOlderSibling(week, weeks);
}

/**
 * Premature-final or dirty-open leftover: reopen/scrub this week, do not skip
 * to the next. A leftover sitting behind a newer non-draft week is closed, not
 * scrubbed — reopening it would steal the family back via in-play ranking.
 */
function skipScrubsLeftoverInPlace(leftover: WeekLike, weeks: readonly WeekLike[] = []): boolean {
  if (hasNewerNonDraftThan(leftover, weeks)) return false;
  return hasPrematureFinalizeLeftover(leftover) || isPrematureFinalWeek(leftover, weeks);
}

/**
 * After leftover W1 is already closed, Harper House still sits on W2 that
 * was marked finished too early (premature-final, or open with a stale
 * finalized_at). Scrub that leftover in place — do not skip it to W3 —
 * even if the commissioner is looking at the already-skipped week.
 */
export function skipScrubsViewedInPlace(
  leftover: WeekLike,
  viewed: WeekLike | null | undefined,
  weeks: readonly WeekLike[] = [],
): boolean {
  return !!viewed && skipScrubsLeftoverInPlace(leftover, weeks);
}

/**
 * After skip, an existing next week is playable only when already open
 * without a leftover finalize stamp. Draft, locked, prematurely final,
 * or open-with-finalized_at next weeks must be reopened (and scrubbed)
 * — unless a newer week than next already exists, or This Sunday would
 * remain in play after leftover is closed, in which case leftover skip
 * just closes the leftover and leaves the family on This Sunday.
 * Skip of This Sunday still opens Next week when a farther draft exists,
 * including a premature-final Next week. A completed Next week is left
 * final — skipTouchesNextWeek refuses that reopen, including leftover
 * draft W1 sitting behind Revealed W2.
 * Dirty-open next is already This Sunday; scrub it later.
 * Pass leftover so skip of This Sunday can still open Next week.
 */
export function shouldOpenExistingNextWeek<T extends WeekLike>(
  next: T | null | undefined,
  weeks: readonly WeekLike[] = [],
  leftover?: WeekSlot | null,
): next is T {
  if (!next || (next.status === "open" && !hasPrematureFinalizeLeftover(next))) return false;
  return skipTouchesNextWeek(next, weeks, leftover);
}

/**
 * Premature-final and locked next weeks may still have cards locked from
 * Reveal or kickoff. Skip must clear those so the family can play Tuesday.
 * An already-open week with leftover finalized_at may too. A leftover draft
 * has no week-level lock to lift.
 */
export function skipUnlocksCards(next: WeekLike | null | undefined): boolean {
  return (
    !!next &&
    (next.status === "locked" || next.status === "final" || hasPrematureFinalizeLeftover(next))
  );
}

/**
 * Premature finalize marks uncalled moments miss and writes weekly scores.
 * Skip must uncall those so Tuesday play is not already "called" — including
 * an already-open week that still has finalized_at from that premature pass.
 * A locked week may have real Sunday results — leave those alone.
 */
export function skipClearsCalledMoments(next: WeekLike | null | undefined): boolean {
  return !!next && (next.status === "final" || hasPrematureFinalizeLeftover(next));
}

/**
 * Premature finalize / live scoring may write game scores and settle upset
 * watches. Skip must clear those so Tuesday play is not already decided
 * (finalize treats a non-null upset_won as the game being over) — including
 * an already-open week that still has finalized_at from that premature pass.
 * A locked week may have real Sunday results — leave those alone.
 */
export function skipClearsGameOutcomes(next: WeekLike | null | undefined): boolean {
  return !!next && (next.status === "final" || hasPrematureFinalizeLeftover(next));
}

/** Past lock times would immediately re-lock a reopened week; refresh them on skip. */
export function skipLockNeedsRefresh(lockAt: string | null | undefined, now = Date.now()): boolean {
  if (!lockAt) return false;
  const ms = Date.parse(lockAt);
  return Number.isFinite(ms) && ms <= now;
}

/**
 * After skip autofills next week, keep a future lock (ESPN earliest kickoff).
 * Only return the Sunday fallback when the current lock would immediately
 * re-lock cards — never clobber Thursday night with next Sunday.
 */
export function skipLockAfterAutofill(
  lockAt: string | null | undefined,
  sundayKickoff: string,
  now = Date.now(),
): string | undefined {
  if (!skipLockNeedsRefresh(lockAt, now)) return undefined;
  return sundayKickoff;
}

/**
 * When skip refreshes a past lock_at on an already-open week, cards may still
 * have locked_at from last Sunday. Clear those so Tuesday play is not frozen.
 * A future ESPN kickoff (no fallback) leaves cards as they are.
 */
export function skipUnlocksCardsOnLockRefresh(
  lockFallback: string | null | undefined,
): boolean {
  return typeof lockFallback === "string" && lockFallback.length > 0;
}

/**
 * Family header caption from the household name and the active week
 * (`selectActiveWeek`). Harper House skipped W1 + dirty-open W2 →
 * "The Harper House · Week 2". Original incident 2026-09-15
 * leftover draft W1 + premature-final W2 also captions Week 2 — never
 * leftover Week 1. Ranking is status-only — a leftover `finalized_at`
 * or a null `auto_opened_at` does not hide an open week. Neither do
 * `lock_at_override`, `created_at`, or `featured_game_id`. Neither do
 * `auto_created_at`, `auto_locked_at`, `autopilot_hold`, or
 * `autopilot_checked_at`. Neither do `household_id` or
 * `commissioner_edited_at`. Neither does `id`. Recency is
 * season_year then week_number.
 */
export function familyWeekChrome(
  householdName: string | null | undefined,
  week: WeekSlot | null | undefined,
): string {
  // leftover draft W1 + premature-final W2 → The Harper House · Week 2
  // ranking ignores lock_at_override, created_at, featured_game_id
  // ranking ignores auto_created_at, auto_locked_at, autopilot_hold
  // ranking ignores household_id, commissioner_edited_at, autopilot_checked_at
  // ranking ignores id
  // recency is season_year then week_number
  const name = householdName ?? "Your household";
  return week ? `${name} · Week ${week.week_number}` : name;
}

/** This Sunday = in-play active slot; Next week = the next slot when it is a newer draft. */
export function weekSwitcherLabel(w: WeekRef, active: WeekRef | null): string {
  if (!active) return `Week ${w.week_number}`;
  if (isInPlay(active.status) && isSameSlot(w, active)) return "This Sunday";
  if (isInPlay(active.status) && isNewerDraft(w, active) && isSameSlot(w, nextWeekSlot(active))) {
    return "Next week";
  }
  return `Week ${w.week_number}`;
}

/**
 * Commissioner view: default is the active (open/locked) week.
 * `next` or a week id reaches the auto-created draft without changing selectActiveWeek.
 * "Next" is only the next slot's draft (same rule as weekSwitcherLabel).
 * If that slot is missing or already final/open/locked, stay on the active week
 * so a later leftover cannot steal "next" — including through an empty gap
 * (skipped or never-created weeks between This Sunday and a farther draft).
 * An older leftover draft behind the active week is never "next" (Harper: leftover
 * draft W1 sitting behind final/open W2 must not steal a ?week=next bookmark).
 */
export function pickViewWeek<T extends WeekRef>(
  weeks: readonly T[],
  active: T | null,
  requested?: string | null,
): T | null {
  if (requested === "next" && active) {
    const slotDraft = weekAtSlot(weeks, nextWeekSlot(active));
    if (slotDraft && isNewerDraft(slotDraft, active)) return slotDraft;
    return active;
  }
  if (requested && requested !== "next") {
    const found = weeks.find((w) => w.id === requested);
    if (found) return found;
  }
  return active ?? null;
}
