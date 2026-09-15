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

export function selectActiveWeek<T extends WeekLike>(weeks: readonly T[]): T | null {
  if (weeks.length === 0) return null;
  const ranked = [...weeks].sort(recency);
  const inPlay = ranked.find((w) => isInPlay(w.status));
  if (inPlay) return inPlay;
  return ranked[0] ?? null;
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

function isOlderThan(week: WeekLike, than: WeekLike): boolean {
  return (
    week.season_year < than.season_year ||
    (week.season_year === than.season_year && week.week_number < than.week_number)
  );
}

/**
 * Week the skip control closes.
 * The viewed leftover if it is still playable; otherwise the newest older
 * leftover draft sitting behind a finished week (Harper: draft W1 + final W2).
 */
export function skipTargetWeek<T extends WeekLike>(
  weeks: readonly T[],
  viewed: T | null | undefined,
): T | null {
  if (canSkipWeek(viewed)) return viewed ?? null;
  if (!viewed) return null;
  const olderDrafts = [...weeks]
    .filter((w) => w.status === "draft" && isOlderThan(w, viewed))
    .sort(recency);
  return olderDrafts[0] ?? null;
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

/** Past lock times would immediately re-lock a reopened week; refresh them on skip. */
export function skipLockNeedsRefresh(lockAt: string | null | undefined, now = Date.now()): boolean {
  if (!lockAt) return false;
  const ms = Date.parse(lockAt);
  return Number.isFinite(ms) && ms <= now;
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
