export const LINES: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** +1 per hit, +5 per completed line (blackout = 49). Upset points are separate and never added here. */
export function scoreBoard(hitFlags: boolean[]) {
  const hits = hitFlags.filter(Boolean).length;
  const lines = LINES.filter((l) => l.every((i) => hitFlags[i])).length;
  return { hits, lines, gridScore: hits + lines * 5 };
}

export type EventStamp = {
  result: string | null;
  resolved_at: string | null;
};

function stampMs(iso: string): number | null {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}

/**
 * When this card completed its first line.
 * A line completes at the latest resolved_at among its three hit events;
 * first_line_at is the earliest of those line-completion times
 * (min events.resolved_at among the events that completed that first line —
 * the last hit on the earliest-finished line).
 */
export function firstLineAt(
  gridEventIds: (string | null)[],
  eventById: Map<string, EventStamp>,
): string | null {
  let bestMs: number | null = null;
  let bestIso: string | null = null;
  for (const line of LINES) {
    let completedMs = 0;
    let completedIso: string | null = null;
    let complete = true;
    for (const i of line) {
      const id = gridEventIds[i];
      if (!id) {
        complete = false;
        break;
      }
      const ev = eventById.get(id);
      if (!ev || ev.result !== "hit" || !ev.resolved_at) {
        complete = false;
        break;
      }
      const ms = stampMs(ev.resolved_at);
      if (ms == null) {
        complete = false;
        break;
      }
      if (ms >= completedMs) {
        completedMs = ms;
        completedIso = ev.resolved_at;
      }
    }
    if (!complete || completedIso == null) continue;
    if (bestMs == null || completedMs < bestMs) {
      bestMs = completedMs;
      bestIso = completedIso;
    }
  }
  return bestIso;
}

export type WeeklyRankInput = {
  grid_score: number;
  hits: number;
  upset_score: number;
  first_line_at: string | null;
};

/** grid_score ↓, hits ↓, upset_score ↓, earliest first_line_at (nulls last). */
export function compareWeeklyRank(a: WeeklyRankInput, b: WeeklyRankInput): number {
  if (b.grid_score !== a.grid_score) return b.grid_score - a.grid_score;
  if (b.hits !== a.hits) return b.hits - a.hits;
  const upset = Number(b.upset_score) - Number(a.upset_score);
  if (upset !== 0) return upset;
  if (a.first_line_at === b.first_line_at) return 0;
  if (a.first_line_at == null) return 1;
  if (b.first_line_at == null) return -1;
  const aMs = stampMs(a.first_line_at);
  const bMs = stampMs(b.first_line_at);
  if (aMs != null && bMs != null && aMs !== bMs) return aMs - bMs;
  return a.first_line_at < b.first_line_at ? -1 : 1;
}

export function rankWeeklyRows<T extends WeeklyRankInput>(rows: T[]): Array<T & { rank: number }> {
  return [...rows]
    .sort(compareWeeklyRank)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export type SeasonRow = {
  profile_id: string;
  grid_points: number;
  upset_points: number;
  trophies: number;
};

export type SeasonWeekInput = {
  id: string;
  week_number: number;
  season_year: number;
};

export type SeasonCardInput = {
  week_id: string;
  profile_id: string;
  weekly_scores:
    | { grid_score?: number; upset_score?: number; rank?: number | null }
    | { grid_score?: number; upset_score?: number; rank?: number | null }[]
    | null;
};

export type SeasonHistoryRow = {
  week: number;
  winnerProfileId: string | null;
  points: number;
};

/** Regular season only — playoff weeks (week_number > 18) do not count. */
export function regularSeasonWeeks<T extends { week_number: number; season_year: number }>(
  weeks: T[],
  seasonYear?: number,
): T[] {
  return weeks.filter(
    (w) => (seasonYear ? w.season_year === seasonYear : true) && w.week_number <= 18,
  );
}

/**
 * Season totals from finalized regular-season weeks.
 * Weekly winner is stored rank = 1 (same four-key rank as finalize), not max grid.
 */
export function buildSeasonStandings(
  weeks: SeasonWeekInput[],
  cards: SeasonCardInput[],
  seasonYear?: number,
): { rows: SeasonRow[]; history: SeasonHistoryRow[] } {
  const list = regularSeasonWeeks(weeks, seasonYear);
  if (list.length === 0) return { rows: [], history: [] };

  const totals = new Map<string, SeasonRow>();
  const history: SeasonHistoryRow[] = [];

  for (const w of list) {
    let winner: { profile_id: string; points: number } | null = null;
    for (const c of cards) {
      if (c.week_id !== w.id) continue;
      const s = Array.isArray(c.weekly_scores) ? c.weekly_scores[0] : c.weekly_scores;
      const grid = Number(s?.grid_score ?? 0);
      const upset = Number(s?.upset_score ?? 0);
      const row =
        totals.get(c.profile_id) ??
        { profile_id: c.profile_id, grid_points: 0, upset_points: 0, trophies: 0 };
      row.grid_points += grid;
      row.upset_points += upset;
      totals.set(c.profile_id, row);
      if (Number(s?.rank) === 1) {
        winner = { profile_id: c.profile_id, points: grid };
      }
    }
    if (winner) {
      const row = totals.get(winner.profile_id)!;
      row.trophies += 1;
      history.push({
        week: w.week_number,
        winnerProfileId: winner.profile_id,
        points: winner.points,
      });
    }
  }

  history.sort((a, b) => a.week - b.week);
  return { rows: [...totals.values()], history };
}
