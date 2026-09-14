import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { computeWeekScores, unresolvedEventsToMiss } from "../src/lib/finalize.ts";
import {
  buildSeasonStandings,
  firstLineAt,
  rankWeeklyRows,
  regularSeasonWeeks,
  scoreBoard,
} from "../src/lib/scoring.ts";

const ROOT = process.cwd();
const GAMBLE = /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i;

describe("scoreBoard", () => {
  it("blackout=49 (9 hits + 8 lines × 5)", () => {
    const s = scoreBoard(Array(9).fill(true));
    assert.equal(s.hits, 9);
    assert.equal(s.lines, 8);
    assert.equal(s.gridScore, 49);
  });

  it("line +5: a completed line is +5", () => {
    const flags = [true, true, true, false, false, false, false, false, false];
    const s = scoreBoard(flags);
    assert.equal(s.hits, 3);
    assert.equal(s.lines, 1);
    assert.equal(s.gridScore, 8);
  });

  it("upset not added to grid", () => {
    const empty = scoreBoard(Array(9).fill(false));
    assert.equal(empty.gridScore, 0);
    assert.equal(empty.hits, 0);
    assert.equal(empty.lines, 0);
    const oneHit = scoreBoard([true, false, false, false, false, false, false, false, false]);
    assert.equal(oneHit.gridScore, 1);
    assert.equal(scoreBoard.toString().includes("upset"), false);
  });
});

describe("firstLineAt", () => {
  it("is the completion time of the earliest finished line", () => {
    const grid = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const eventById = new Map([
      ["a", { result: "hit", resolved_at: "2026-09-14T17:00:00.000Z" }],
      ["b", { result: "hit", resolved_at: "2026-09-14T17:05:00.000Z" }],
      ["c", { result: "hit", resolved_at: "2026-09-14T17:10:00.000Z" }],
      ["d", { result: "hit", resolved_at: "2026-09-14T16:00:00.000Z" }],
      ["e", { result: "miss", resolved_at: "2026-09-14T16:01:00.000Z" }],
      ["f", { result: "hit", resolved_at: "2026-09-14T18:00:00.000Z" }],
      ["g", { result: "hit", resolved_at: "2026-09-14T18:01:00.000Z" }],
      ["h", { result: "hit", resolved_at: "2026-09-14T18:02:00.000Z" }],
      ["i", { result: "hit", resolved_at: "2026-09-14T18:03:00.000Z" }],
    ]);
    assert.equal(firstLineAt(grid, eventById), "2026-09-14T17:10:00.000Z");
  });

  it("is null when no line is complete", () => {
    const grid = ["a", "b", "c", null, null, null, null, null, null];
    const eventById = new Map([
      ["a", { result: "hit", resolved_at: "2026-09-14T17:00:00.000Z" }],
      ["b", { result: "hit", resolved_at: "2026-09-14T17:05:00.000Z" }],
      ["c", { result: "miss", resolved_at: "2026-09-14T17:10:00.000Z" }],
    ]);
    assert.equal(firstLineAt(grid, eventById), null);
  });
});

describe("rankWeeklyRows", () => {
  it("four-way tiebreak is earliest first_line_at", () => {
    const ranked = rankWeeklyRows([
      { card_id: "d", grid_score: 10, hits: 5, upset_score: 3, first_line_at: "2026-09-14T20:00:00.000Z" },
      { card_id: "a", grid_score: 10, hits: 5, upset_score: 3, first_line_at: "2026-09-14T17:00:00.000Z" },
      { card_id: "c", grid_score: 10, hits: 5, upset_score: 3, first_line_at: "2026-09-14T19:00:00.000Z" },
      { card_id: "b", grid_score: 10, hits: 5, upset_score: 3, first_line_at: "2026-09-14T18:00:00.000Z" },
    ]);
    assert.deepEqual(
      ranked.map((r) => r.card_id),
      ["a", "b", "c", "d"],
    );
    assert.deepEqual(
      ranked.map((r) => r.rank),
      [1, 2, 3, 4],
    );
  });

  it("order is grid_score, hits, upset_score, then first_line_at", () => {
    const ranked = rankWeeklyRows([
      { card_id: "fewer-hits", grid_score: 20, hits: 4, upset_score: 9, first_line_at: "2026-09-14T17:00:00.000Z" },
      { card_id: "grid", grid_score: 25, hits: 1, upset_score: 0, first_line_at: null },
      { card_id: "late", grid_score: 20, hits: 5, upset_score: 2, first_line_at: "2026-09-14T19:00:00.000Z" },
      { card_id: "upset", grid_score: 20, hits: 5, upset_score: 4, first_line_at: "2026-09-14T18:00:00.000Z" },
      { card_id: "early", grid_score: 20, hits: 5, upset_score: 2, first_line_at: "2026-09-14T18:00:00.000Z" },
    ]);
    assert.deepEqual(
      ranked.map((r) => r.card_id),
      ["grid", "upset", "early", "late", "fewer-hits"],
    );
  });

  it("null first_line_at loses the last tiebreak", () => {
    const ranked = rankWeeklyRows([
      { card_id: "none", grid_score: 8, hits: 3, upset_score: 0, first_line_at: null },
      { card_id: "line", grid_score: 8, hits: 3, upset_score: 0, first_line_at: "2026-09-14T18:00:00.000Z" },
    ]);
    assert.equal(ranked[0].card_id, "line");
    assert.equal(ranked[1].card_id, "none");
  });
});

describe("buildSeasonStandings", () => {
  it("weekly winner is stored rank=1, not max grid", () => {
    const out = buildSeasonStandings(
      [{ id: "w1", week_number: 1, season_year: 2026 }],
      [
        {
          week_id: "w1",
          profile_id: "high-grid",
          weekly_scores: { grid_score: 22, upset_score: 0, rank: 2 },
        },
        {
          week_id: "w1",
          profile_id: "rank-one",
          weekly_scores: { grid_score: 18, upset_score: 4, rank: 1 },
        },
      ],
    );
    assert.equal(out.history.length, 1);
    assert.equal(out.history[0].winnerProfileId, "rank-one");
    assert.equal(out.history[0].points, 18);
    const trophies = Object.fromEntries(out.rows.map((r) => [r.profile_id, r.trophies]));
    assert.equal(trophies["rank-one"], 1);
    assert.equal(trophies["high-grid"], 0);
  });

  it("playoff weeks excluded (week_number <= 18)", () => {
    const weeks = [
      { id: "w18", week_number: 18, season_year: 2026 },
      { id: "w19", week_number: 19, season_year: 2026 },
    ];
    assert.deepEqual(
      regularSeasonWeeks(weeks).map((w) => w.week_number),
      [18],
    );
    const out = buildSeasonStandings(weeks, [
      {
        week_id: "w18",
        profile_id: "reg",
        weekly_scores: { grid_score: 10, upset_score: 1, rank: 1 },
      },
      {
        week_id: "w19",
        profile_id: "playoff",
        weekly_scores: { grid_score: 49, upset_score: 9, rank: 1 },
      },
    ]);
    assert.equal(out.history.length, 1);
    assert.equal(out.history[0].week, 18);
    assert.equal(out.history[0].winnerProfileId, "reg");
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].profile_id, "reg");
    assert.equal(out.rows[0].grid_points, 10);
  });
});

describe("unresolvedEventsToMiss", () => {
  it("does not mark in-progress auto_score as miss when the game is not completed", () => {
    const gamesById = new Map([
      ["g-live", { id: "g-live", upset_won: null }],
      ["g-done", { id: "g-done", upset_won: false }],
    ]);
    const missed = unresolvedEventsToMiss(
      [
        { id: "manual-open", result: null, resolution_source: "manual", game_id: "g-live" },
        { id: "auto-live", result: null, resolution_source: "auto_score", game_id: "g-live" },
        { id: "auto-done", result: null, resolution_source: "auto_score", game_id: "g-done" },
        { id: "already", result: "hit", resolution_source: "auto_score", game_id: "g-live" },
      ],
      gamesById,
    );
    assert.deepEqual(
      missed.map((e) => e.id).sort(),
      ["auto-done", "manual-open"],
    );
  });
});

function memoryDb(state: {
  events: any[];
  games: any[];
  cards: any[];
  weekly_scores: any[];
  weeks: any[];
}) {
  const tables: Record<string, any[]> = state;
  return {
    from(table: string) {
      const q: any = {
        _op: "select",
        _patch: null,
        select() {
          q._op = "select";
          return q;
        },
        update(patch: any) {
          q._op = "update";
          q._patch = patch;
          return q;
        },
        delete() {
          q._op = "delete";
          return q;
        },
        insert(rows: any[]) {
          tables[table].push(...(Array.isArray(rows) ? rows : [rows]));
          return { error: null };
        },
        eq(col: string, val: any) {
          return q._run((r: any) => r[col] === val);
        },
        in(col: string, ids: any[]) {
          const set = new Set(ids);
          return q._run((r: any) => set.has(r[col]));
        },
        _run(pred: (r: any) => boolean) {
          const rows = tables[table] ?? [];
          if (q._op === "select") return { data: rows.filter(pred), error: null };
          if (q._op === "update") {
            for (const r of rows) if (pred(r)) Object.assign(r, q._patch);
            return { error: null };
          }
          if (q._op === "delete") {
            tables[table] = rows.filter((r) => !pred(r));
            return { error: null };
          }
          return { error: null };
        },
      };
      return q;
    },
  };
}

describe("computeWeekScores", () => {
  it("persists first_line_at, four-key rank, and skips in-progress auto_score misses", async () => {
    const weekId = "week-1";
    const hit = (
      id: string,
      at: string,
    ) => ({
      id,
      week_id: weekId,
      game_id: "g1",
      result: "hit" as const,
      resolution_source: "auto_score",
      resolved_at: at,
    });
    const events = [
      hit("a1", "2026-09-14T17:00:00.000Z"),
      hit("a2", "2026-09-14T17:01:00.000Z"),
      hit("a3", "2026-09-14T17:02:00.000Z"),
      hit("b1", "2026-09-14T17:00:00.000Z"),
      hit("b2", "2026-09-14T17:01:00.000Z"),
      hit("b3", "2026-09-14T17:09:00.000Z"),
      { id: "e-live", week_id: weekId, game_id: "g-live", result: null, resolution_source: "auto_score", resolved_at: null },
      { id: "e-manual", week_id: weekId, game_id: null, result: null, resolution_source: "manual", resolved_at: null },
    ];
    const line = (ids: [string, string, string]) =>
      ids.map((event_id, grid_position) => ({ event_id, grid_position }));
    const state = {
      events,
      games: [
        { id: "g1", week_id: weekId, upset_won: true },
        { id: "g-live", week_id: weekId, upset_won: null },
      ],
      cards: [
        {
          id: "late",
          week_id: weekId,
          card_squares: line(["b1", "b2", "b3"]),
          upset_picks: [{ game_id: "g1", picked_team: "Away", upset_size: 3 }],
        },
        {
          id: "early",
          week_id: weekId,
          card_squares: line(["a1", "a2", "a3"]),
          upset_picks: [{ game_id: "g1", picked_team: "Away", upset_size: 3 }],
        },
      ],
      weekly_scores: [] as any[],
      weeks: [{ id: weekId, status: "locked", finalized_at: null }],
    };
    const out = await computeWeekScores(memoryDb(state), weekId, { finalize: true });

    assert.equal(state.events.find((e) => e.id === "e-live")?.result, null);
    assert.equal(state.events.find((e) => e.id === "e-manual")?.result, "miss");
    assert.equal(out.missedManual, 1);
    assert.equal(state.weeks[0].status, "final");

    assert.equal(state.weekly_scores.length, 2);
    for (const row of state.weekly_scores) {
      assert.ok("first_line_at" in row);
      assert.ok("rank" in row);
    }
    const byCard = Object.fromEntries(out.rows.map((r) => [r.card_id, r]));
    assert.equal(byCard.early.rank, 1);
    assert.equal(byCard.late.rank, 2);
    assert.equal(byCard.early.first_line_at, "2026-09-14T17:02:00.000Z");
    assert.equal(byCard.late.first_line_at, "2026-09-14T17:09:00.000Z");
    assert.equal(out.winnerCardId, "early");
    assert.equal(byCard.early.upset_score, 3);
    assert.equal(byCard.early.grid_score, 8);
    assert.equal(byCard.early.hits, 3);
    assert.equal(byCard.early.lines, 1);
  });

  it("inserts first_line_at with rank and does not strip the column", async () => {
    const weekId = "week-persist-col";
    const state = {
      events: [] as any[],
      games: [] as any[],
      cards: [{ id: "c1", week_id: weekId, card_squares: [], upset_picks: [] }],
      weekly_scores: [] as any[],
      weeks: [{ id: weekId, status: "locked", finalized_at: null }],
    };
    const out = await computeWeekScores(memoryDb(state), weekId, { finalize: false });
    assert.equal(out.rows[0].rank, 1);
    assert.equal(state.weekly_scores.length, 1);
    assert.equal("first_line_at" in state.weekly_scores[0], true);
    assert.equal(state.weekly_scores[0].first_line_at, null);
    assert.equal(state.weekly_scores[0].rank, 1);
    const src = readFileSync(join(ROOT, "src/lib/finalize.ts"), "utf8");
    assert.doesNotMatch(src, /stripped/);
    assert.match(src, /insert\(ranked\)/);
  });

  it("recompute without finalize leaves in-progress auto_score unresolved and does not flip the week", async () => {
    const weekId = "week-2";
    const state = {
      events: [
        { id: "open-auto", week_id: weekId, game_id: "g-live", result: null, resolution_source: "auto_score", resolved_at: null },
      ],
      games: [{ id: "g-live", week_id: weekId, upset_won: null }],
      cards: [{ id: "c1", week_id: weekId, card_squares: [], upset_picks: [] }],
      weekly_scores: [] as any[],
      weeks: [{ id: weekId, status: "locked", finalized_at: null }],
    };
    const out = await computeWeekScores(memoryDb(state), weekId, { finalize: false });
    assert.equal(state.events[0].result, null);
    assert.equal(state.weeks[0].status, "locked");
    assert.equal(out.missedManual, 0);
    assert.equal(out.rows[0].rank, 1);
    assert.equal(out.rows[0].first_line_at, null);
  });
});

describe("wiring", () => {
  it("finalize persists first_line_at and documents the auto_score miss rule", () => {
    const src = readFileSync(join(ROOT, "src/lib/finalize.ts"), "utf8");
    assert.match(src, /first_line_at/);
    assert.match(src, /rankWeeklyRows/);
    assert.match(src, /unresolvedEventsToMiss/);
    assert.match(src, /auto_score/);
    assert.match(src, /Tuesday 6:00 AM ET/);
    assert.match(src, /upset_won/);
    assert.doesNotMatch(src, GAMBLE);
  });

  it("recomputeWeek still calls computeWeekScores", () => {
    const src = readFileSync(join(ROOT, "src/lib/autopilot.functions.ts"), "utf8");
    assert.match(src, /export const recomputeWeekScores/);
    assert.match(src, /export const recomputeWeek = recomputeWeekScores/);
    assert.match(src, /import \{ computeWeekScores \} from "\.\/finalize"/);
    assert.match(src, /computeWeekScores/);
    assert.match(src, /finalize: !!data\.finalize/);
    assert.match(src, /first_line_at/);
    assert.doesNotMatch(src, /import\("\.\/finalize"\)/);
  });

  it("/results winner after playback is stored rank 1", () => {
    const src = readFileSync(join(ROOT, "src/routes/_authenticated/results.tsx"), "utf8");
    assert.match(src, /weekly_scores\?\.rank === 1/);
    assert.match(src, /theatricalLeader/);
    assert.match(src, /rankWeeklyRows/);
    assert.match(src, /compareWeeklyRank/);
    assert.match(src, /first_line_at/);
    assert.doesNotMatch(src, GAMBLE);
  });

  it("weekly_scores migration adds first_line_at", () => {
    const src = readFileSync(
      join(ROOT, "supabase/migrations/20260914140000_weekly_scores_first_line_at.sql"),
      "utf8",
    );
    assert.match(src, /first_line_at/);
    assert.match(src, /weekly_scores/);
  });

  it("season standings use stored rank=1 and skip playoff weeks", () => {
    const dbSrc = readFileSync(join(ROOT, "src/lib/db.ts"), "utf8");
    assert.match(dbSrc, /buildSeasonStandings/);
    assert.match(dbSrc, /regularSeasonWeeks/);
    assert.match(dbSrc, /first_line_at/);
    const scoring = readFileSync(join(ROOT, "src/lib/scoring.ts"), "utf8");
    assert.match(scoring, /week_number <= 18/);
    assert.match(scoring, /Number\(s\?\.rank\) === 1/);
    assert.doesNotMatch(scoring, GAMBLE);
  });

  it("commissioner documents Tuesday finalize and in-progress auto_score miss skip", () => {
    const src = readFileSync(join(ROOT, "src/routes/_authenticated/commissioner.tsx"), "utf8");
    assert.match(src, /Tuesday at 6:00 AM Eastern/);
    assert.match(src, /auto_score/);
    assert.match(src, /not marked miss/);
    assert.doesNotMatch(src, GAMBLE);
  });
});
