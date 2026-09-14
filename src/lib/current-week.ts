/**
 * Active week for a household:
 *   1. latest open or locked (never hide these behind a newer draft)
 *   2. else latest draft (none in play yet)
 *   3. else latest final
 * "Latest" is highest season_year, then highest week_number.
 */
export type WeekLike = {
  season_year: number;
  week_number: number;
  status: string;
};

function recency(a: WeekLike, b: WeekLike): number {
  if (a.season_year !== b.season_year) return b.season_year - a.season_year;
  return b.week_number - a.week_number;
}

function isInPlay(status: string): boolean {
  return status === "open" || status === "locked";
}

export function selectActiveWeek<T extends WeekLike>(weeks: readonly T[]): T | null {
  if (weeks.length === 0) return null;
  const ranked = [...weeks].sort(recency);
  const inPlay = ranked.find((w) => isInPlay(w.status));
  if (inPlay) return inPlay;
  const draft = ranked.find((w) => w.status === "draft");
  if (draft) return draft;
  return ranked.find((w) => w.status === "final") ?? ranked[0] ?? null;
}
