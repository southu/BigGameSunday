/** Shared weekly scoring: used by the Commissioner panel and by autopilot. */
import { scoreBoard } from "./scoring";

type Db = { from: (table: string) => any };

export type ScoreRow = {
  card_id: string;
  hits: number;
  lines: number;
  grid_score: number;
  upset_score: number;
  rank: number;
};

export type ComputeResult = {
  rows: ScoreRow[];
  winnerCardId: string | null;
  missedManual: number;
};

/**
 * Recomputes and stores every card's weekly score for a week.
 * `finalize` also flips the week to final and treats any unresolved
 * hand-called moment as a miss.
 */
export async function computeWeekScores(
  db: Db,
  weekId: string,
  { finalize }: { finalize: boolean },
): Promise<ComputeResult> {
  const { data: events, error: eErr } = await db
    .from("events")
    .select("id, result, resolution_source")
    .eq("week_id", weekId);
  if (eErr) throw eErr;

  let missedManual = 0;
  const eventRows = ((events ?? []) as any[]).map((e) => ({ ...e }));

  if (finalize) {
    const unresolved = eventRows.filter((e) => e.result === null);
    if (unresolved.length) {
      const now = new Date().toISOString();
      const { error } = await db
        .from("events")
        .update({ result: "miss", resolved_at: now })
        .in(
          "id",
          unresolved.map((e) => e.id),
        );
      if (error) throw error;
      for (const e of unresolved) e.result = "miss";
      missedManual = unresolved.length;
    }
  }

  const { data: games, error: gErr } = await db
    .from("games")
    .select("id, upset_won")
    .eq("week_id", weekId);
  if (gErr) throw gErr;

  const { data: cards, error: cErr } = await db
    .from("cards")
    .select(
      "id, card_squares(event_id, grid_position), upset_picks(game_id, picked_team, upset_size)",
    )
    .eq("week_id", weekId);
  if (cErr) throw cErr;

  const resultById = new Map(eventRows.map((e) => [e.id as string, e.result as string | null]));
  const upsetWonById = new Map(
    ((games ?? []) as any[]).map((g) => [g.id as string, !!g.upset_won]),
  );

  const rows = ((cards ?? []) as any[]).map((card) => {
    const grid: (string | null)[] = Array(9).fill(null);
    for (const s of card.card_squares ?? []) grid[s.grid_position] = s.event_id;
    const { hits, lines, gridScore } = scoreBoard(
      grid.map((id) => !!id && resultById.get(id) === "hit"),
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
    };
  });

  const ranked: ScoreRow[] = [...rows]
    .sort((a, b) => b.grid_score - a.grid_score || b.hits - a.hits || b.upset_score - a.upset_score)
    .map((r, i) => ({ ...r, rank: i + 1 }));

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
