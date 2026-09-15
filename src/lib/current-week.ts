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
