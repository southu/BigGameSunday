/** Shared weekly scoring: used by the Commissioner panel and by autopilot. */
import { firstLineAt, rankWeeklyRows, scoreBoard } from "./scoring.ts";

type Db = { from: (table: string) => any };

export type ScoreRow = {
  card_id: string;
  hits: number;
  lines: number;
  grid_score: number;
  upset_score: number;
  first_line_at: string | null;
  rank: number;
};

export type ComputeResult = {
  rows: ScoreRow[];
  winnerCardId: string | null;
  missedManual: number;
};

export type FinalizeEvent = {
  id: string;
  result: string | null;
  resolution_source: string | null;
  game_id: string | null;
  resolved_at?: string | null;
};

export type FinalizeGame = {
  id: string;
  upset_won: boolean | null;
};

/**
 * Unresolved moments that become misses on finalize.
 *
 * Rule: open hand-called (manual) moments count as misses.
 * Unresolved auto_score moments are NOT marked miss while their game is
 * not completed (`games.upset_won` is still null — set only when ESPN
 * reports the game over). Autopilot only finalizes Tuesday 6:00 AM ET
 * after lock, after the last Sunday/Monday game; commissioner Finalize
 * uses this same miss rule so an early click cannot miss an in-progress
 * auto_score square.
 */
export function unresolvedEventsToMiss(
  events: FinalizeEvent[],
  gamesById: Map<string, FinalizeGame>,
): FinalizeEvent[] {
  return events.filter((e) => {
    if (e.result !== null) return false;
    if (e.resolution_source === "auto_score") {
      if (!e.game_id) return false;
      const game = gamesById.get(e.game_id);
      return game != null && game.upset_won !== null;
    }
    return true;
  });
}

/**
 * Recomputes and stores every card's weekly score for a week.
 * Rank order: grid_score, hits, upset_score, earliest first_line_at.
 * Ranks are written only here (recomputeWeek, autopilot Tuesday finalize,
 * commissioner Finalize) — never rewritten mid-season without a recompute.
 * `finalize` also flips the week to final; see unresolvedEventsToMiss.
 */
export async function computeWeekScores(
  db: Db,
  weekId: string,
  { finalize }: { finalize: boolean },
): Promise<ComputeResult> {
  const { data: events, error: eErr } = await db
    .from("events")
    .select("id, result, resolution_source, game_id, resolved_at")
    .eq("week_id", weekId);
  if (eErr) throw eErr;

  const { data: games, error: gErr } = await db
    .from("games")
    .select("id, upset_won")
    .eq("week_id", weekId);
  if (gErr) throw gErr;

  const eventRows = ((events ?? []) as FinalizeEvent[]).map((e) => ({ ...e }));
  const gameRows = (games ?? []) as FinalizeGame[];
  const gamesById = new Map(gameRows.map((g) => [g.id, g]));

  let missedManual = 0;
  if (finalize) {
    const toMiss = unresolvedEventsToMiss(eventRows, gamesById);
    if (toMiss.length) {
      const now = new Date().toISOString();
      const { error } = await db
        .from("events")
        .update({ result: "miss", resolved_at: now })
        .in(
          "id",
          toMiss.map((e) => e.id),
        );
      if (error) throw error;
      const missIds = new Set(toMiss.map((e) => e.id));
      for (const e of eventRows) {
        if (!missIds.has(e.id)) continue;
        e.result = "miss";
        e.resolved_at = now;
      }
      missedManual = toMiss.length;
    }
  }

  const { data: cards, error: cErr } = await db
    .from("cards")
    .select(
      "id, card_squares(event_id, grid_position), upset_picks(game_id, picked_team, upset_size)",
    )
    .eq("week_id", weekId);
  if (cErr) throw cErr;

  const eventById = new Map(eventRows.map((e) => [e.id, e]));
  const upsetWonById = new Map(gameRows.map((g) => [g.id, !!g.upset_won]));

  const rows = ((cards ?? []) as any[]).map((card) => {
    const grid: (string | null)[] = Array(9).fill(null);
    for (const s of card.card_squares ?? []) grid[s.grid_position] = s.event_id;
    const { hits, lines, gridScore } = scoreBoard(
      grid.map((id) => !!id && eventById.get(id)?.result === "hit"),
    );
    const upsetScore = (card.upset_picks ?? []).reduce(
      (sum: number, u: any) => sum + (upsetWonById.get(u.game_id) ? Number(u.upset_size) : 0),
      0,
    );
    return {
      card_id: card.id as string,
      hits,
      lines,
      grid_score: gridScore,
      upset_score: upsetScore,
      first_line_at: firstLineAt(grid, eventById),
    };
  });

  const ranked: ScoreRow[] = rankWeeklyRows(rows);

  const cardIds = ((cards ?? []) as any[]).map((c) => c.id as string);
  if (cardIds.length) {
    await db.from("weekly_scores").delete().in("card_id", cardIds);
  }
  if (ranked.length) {
    const { error } = await db.from("weekly_scores").insert(ranked);
    if (error) throw error;
  }

  if (finalize) {
    const { error } = await db
      .from("weeks")
      .update({ status: "final", finalized_at: new Date().toISOString() })
      .eq("id", weekId);
    if (error) throw error;
  }

  return {
    rows: ranked,
    winnerCardId: ranked.find((r) => r.rank === 1)?.card_id ?? null,
    missedManual,
  };
}
