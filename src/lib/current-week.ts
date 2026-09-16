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

function isSameSlot(a: WeekLike, b: WeekLike): boolean {
  return a.season_year === b.season_year && a.week_number === b.week_number;
}

/** Button and hint for the commissioner skip control. */
export function skipControlCopy(
  leftover: WeekLike,
  viewed: WeekLike | null | undefined,
): { button: string; hint: string } {
  if (viewed && isSameSlot(leftover, viewed)) {
    return {
      button: "Skip this week / start next week",
      hint: "Didn't play this week? Close it without Reveal and open next week's cards — works on Tuesday.",
    };
  }
  return {
    button: `Skip leftover Week ${leftover.week_number} / open this week`,
    hint: `Week ${leftover.week_number} is still a leftover draft. Close it without Reveal and open this week so the family can play — works on Tuesday.`,
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
  return null;
}

/**
 * After skip, an existing next week is playable only when already open.
 * Draft, locked, or prematurely final next weeks must be reopened.
 */
export function shouldOpenExistingNextWeek<T extends WeekLike>(
  next: T | null | undefined,
): next is T {
  return !!next && next.status !== "open";
}

/**
 * Premature-final and locked next weeks may still have cards locked from
 * Reveal or kickoff. Skip must clear those so the family can play Tuesday.
 * A leftover draft has no week-level lock to lift.
 */
export function skipUnlocksCards(next: WeekLike | null | undefined): boolean {
  return !!next && (next.status === "locked" || next.status === "final");
}

/**
 * Premature finalize marks uncalled moments miss and writes weekly scores.
 * Skip must uncall those so Tuesday play is not already "called".
 * A locked week may have real Sunday results — leave those alone.
 */
export function skipClearsCalledMoments(next: WeekLike | null | undefined): boolean {
  return !!next && next.status === "final";
}

/**
 * Premature finalize / live scoring may write game scores and settle upset
 * watches. Skip must clear those so Tuesday play is not already decided
 * (finalize treats a non-null upset_won as the game being over).
 * A locked week may have real Sunday results — leave those alone.
 */
export function skipClearsGameOutcomes(next: WeekLike | null | undefined): boolean {
  return !!next && next.status === "final";
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
