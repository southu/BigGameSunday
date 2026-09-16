/**
 * Active week for a household:
 *   1. latest open or locked (never hide these behind a newer draft)
 *   2. else newest week overall (highest season_year, then week_number),
 *      whether draft or final — never an older draft over a newer week
 */
export type WeekLike = {
  season_year: number;
  week_number: number;
  status: string;
  /** Ranking ignores this. Skip uses it to find a premature-finalize leftover. */
  finalized_at?: string | null;
};

export type WeekRef = WeekLike & { id: string };

export type WeekSlot = {
  season_year: number;
  week_number: number;
};

function recency(a: WeekLike, b: WeekLike): number {
  if (a.season_year !== b.season_year) return b.season_year - a.season_year;
  return b.week_number - a.week_number;
}

function isInPlay(status: string): boolean {
  return status === "open" || status === "locked";
}

export function isNewerDraft(w: WeekLike, active: WeekLike): boolean {
  return (
    w.status === "draft" &&
    (w.season_year > active.season_year ||
      (w.season_year === active.season_year && w.week_number > active.week_number))
  );
}

/**
 * In-play (open/locked) always beats not-in-play. After that only recency
 * matters — draft vs final is not a rank, so an older leftover draft cannot
 * hide a newer week (Harper House: draft W1 + final W2 → W2).
 */
function compareActiveWeek(a: WeekLike, b: WeekLike): number {
  const aPlay = isInPlay(a.status);
  const bPlay = isInPlay(b.status);
  if (aPlay !== bPlay) return aPlay ? -1 : 1;
  return recency(a, b);
}

export function selectActiveWeek<T extends WeekLike>(weeks: readonly T[]): T | null {
  let active: T | null = null;
  for (const week of weeks) {
    if (!active || compareActiveWeek(week, active) < 0) active = week;
  }
  return active;
}

/** Regular season wraps to week 1 of the next year after week 18. */
export function nextWeekSlot(week: WeekSlot): WeekSlot {
  if (week.week_number >= 18) {
    return { season_year: week.season_year + 1, week_number: 1 };
  }
  return { season_year: week.season_year, week_number: week.week_number + 1 };
}

export function weekAtSlot<T extends WeekSlot>(weeks: readonly T[], slot: WeekSlot): T | undefined {
  return weeks.find(
    (w) => w.season_year === slot.season_year && w.week_number === slot.week_number,
  );
}

/** Skip closes a leftover week without Reveal; finished weeks stay put. */
export function canSkipWeek(week: WeekLike | null | undefined): boolean {
  return !!week && week.status !== "final";
}

function isSameSlot(a: WeekSlot, b: WeekSlot): boolean {
  return a.season_year === b.season_year && a.week_number === b.week_number;
}

function hasNewerInPlayThan(week: WeekSlot, weeks: readonly WeekLike[]): boolean {
  return weeks.some(
    (w) =>
      isInPlay(w.status) &&
      (w.season_year > week.season_year ||
        (w.season_year === week.season_year && w.week_number > week.week_number)),
  );
}

/**
 * Skip leftover may create/reopen/refresh next only when no newer week is
 * already in play. Otherwise just close the leftover and leave the family
 * on that newer week (auto-created W3 must not bounce them back to W2).
 */
export function skipTouchesNextWeek(
  next: WeekSlot | null | undefined,
  weeks: readonly WeekLike[],
): boolean {
  if (!next) return !weeks.some((w) => isInPlay(w.status));
  return !hasNewerInPlayThan(next, weeks);
}

function withStatus<T extends WeekLike>(week: T, status: string): T {
  return { ...week, status };
}

/**
 * Commissioner view after skip. If skip opened/created next, land there
 * (existing next only — a newly created week is the caller's nextId).
 * If a newer week is already in play, land on the post-skip active week
 * so closing leftover W1 does not leave the panel stuck on that draft.
 * Dirty-open leftover (open + leftover finalize stamp) stays put — scrub
 * in place, do not close it and jump to the next week.
 */
export function skipLandingWeek<T extends WeekLike>(weeks: readonly T[], leftover: T): T | null {
  if (hasPrematureFinalizeLeftover(leftover)) {
    return weekAtSlot(weeks, leftover) ?? leftover;
  }
  const closed = weeks.map((w) => (isSameSlot(w, leftover) ? withStatus(w, "final") : w));
  const slot = nextWeekSlot(leftover);
  if (!skipTouchesNextWeek(slot, weeks)) return selectActiveWeek(closed);
  const next = weekAtSlot(weeks, slot);
  if (!next) return selectActiveWeek(closed);
  const opened = closed.map((w) => (isSameSlot(w, slot) ? withStatus(w, "open") : w));
  return selectActiveWeek(opened);
}

/** Button and hint for the commissioner skip control. */
export function skipControlCopy(
  leftover: WeekLike,
  viewed: WeekLike | null | undefined,
  weeks: readonly WeekLike[] = [],
): { button: string; hint: string } {
  if (skipScrubsViewedInPlace(leftover, viewed)) {
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
  if (viewed && isSameSlot(leftover, viewed)) {
    return {
      button: "Skip this week / start next week",
      hint: "Didn't play this week? Close it without Reveal and open next week's cards — works on Tuesday.",
    };
  }
  const slot = nextWeekSlot(leftover);
  if (viewed && isSameSlot(viewed, slot)) {
    return {
      button: `Skip leftover Week ${leftover.week_number} / open this week`,
      hint: `Week ${leftover.week_number} is still a leftover draft. Close it without Reveal and open this week so the family can play — works on Tuesday.`,
    };
  }
  if (skipTouchesNextWeek(weekAtSlot(weeks, slot) ?? slot, weeks)) {
    return {
      button: `Skip leftover Week ${leftover.week_number} / open Week ${slot.week_number}`,
      hint: `Week ${leftover.week_number} is still a leftover draft. Close it without Reveal and open Week ${slot.week_number} so the family can play — works on Tuesday.`,
    };
  }
  return {
    button: `Skip leftover Week ${leftover.week_number}`,
    hint: `Week ${leftover.week_number} is still a leftover draft. Close it without Reveal — works on Tuesday.`,
  };
}

function isOlderThan(week: WeekLike, than: WeekLike): boolean {
  return (
    week.season_year < than.season_year ||
    (week.season_year === than.season_year && week.week_number < than.week_number)
  );
}

/**
 * Week the skip control closes.
 * Prefer an older leftover draft behind the viewed week (Harper: draft W1
 * sitting behind open/final W2) so Skip cannot close the week the family
 * is about to play. Otherwise close the viewed week when it is still playable.
 * If the viewed week is already finished, still target a leftover open week
 * with a premature finalize stamp so Skip can scrub it in place (Harper:
 * skipped W1 + dirty-open W2, commissioner looking at W1).
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
  if (canSkipWeek(viewed)) return viewed;
  const dirtyOpen = [...weeks].filter(hasPrematureFinalizeLeftover).sort(recency);
  return dirtyOpen[0] ?? null;
}

/** Open + leftover finalize stamp: skip must reopen/scrub, not take the already-open path. */
function hasPrematureFinalizeLeftover(week: WeekLike | null | undefined): boolean {
  return !!week && week.status === "open" && !!week.finalized_at;
}

/**
 * After leftover W1 is already closed, Harper House still sits on open W2 with a
 * stale finalized_at. Scrub that leftover in place — do not skip it to W3 —
 * even if the commissioner is looking at the already-skipped week.
 */
export function skipScrubsViewedInPlace(
  leftover: WeekLike,
  viewed: WeekLike | null | undefined,
): boolean {
  return !!viewed && hasPrematureFinalizeLeftover(leftover);
}

/**
 * After skip, an existing next week is playable only when already open
 * without a leftover finalize stamp. Draft, locked, prematurely final,
 * or open-with-finalized_at next weeks must be reopened (and scrubbed)
 * — unless a newer week is already in play, in which case leftover skip
 * just closes the leftover and leaves the family on that newer week.
 */
export function shouldOpenExistingNextWeek<T extends WeekLike>(
  next: T | null | undefined,
  weeks: readonly WeekLike[] = [],
): next is T {
  if (!next || (next.status === "open" && !hasPrematureFinalizeLeftover(next))) return false;
  return skipTouchesNextWeek(next, weeks);
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

/** This Sunday = in-play active week; Next week = newer draft the commish can open. */
export function weekSwitcherLabel(w: WeekRef, active: WeekRef | null): string {
  if (!active) return `Week ${w.week_number}`;
  if (isInPlay(active.status) && w.id === active.id) return "This Sunday";
  if (isInPlay(active.status) && isNewerDraft(w, active)) return "Next week";
  return `Week ${w.week_number}`;
}

/**
 * Commissioner view: default is the active (open/locked) week.
 * `next` or a week id reaches the auto-created draft without changing selectActiveWeek.
 */
export function pickViewWeek<T extends WeekRef>(
  weeks: readonly T[],
  active: T | null,
  requested?: string | null,
): T | null {
  if (requested === "next" && active) {
    const ranked = [...weeks].sort(recency);
    const next = ranked.find((w) => isNewerDraft(w, active));
    if (next) return next;
  }
  if (requested && requested !== "next") {
    const found = weeks.find((w) => w.id === requested);
    if (found) return found;
  }
  return active ?? null;
}
