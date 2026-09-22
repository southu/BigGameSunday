/**
 * Public Week 3 play for Oak, Pine, and Cedar.
 * Service role bypasses the pick-lock trigger, so this module refuses writes
 * once the week is locked, final, or the server clock has reached lock_at.
 */
import { supabaseAdmin } from "../integrations/supabase/client.server.ts";
import {
  LOCKED_MESSAGE,
  compareQaHouse,
  picksResponse,
  planSubmission,
  publicBoard,
  qaHouseKey,
  readSubmission,
  rejectionBody,
  requestedWeekNumber,
  savedBody,
  scoreResponse,
  submissionClosed,
  weekResponse,
  type PlannedWrite,
  type PlayCard,
  type PlayEvent,
  type PlayGame,
  type PlayHouse,
  type PlayProfile,
  type PlaySquare,
  type PlayUpset,
  type PlayWeek,
  type PublicBoard,
  type QaHouse,
} from "./week-play.ts";

type Db = { from: (table: string) => any };

type WeekRow = {
  id: string;
  household_id: string;
  week_number: number;
  season_year: number;
  status: string;
  lock_at: string | null;
};

type GameRow = {
  id: string;
  week_id: string;
  kickoff_at: string | null;
  underdog_team: string | null;
  away_team: string | null;
  home_team: string | null;
  upset_size: number | string | null;
  away_score: number | null;
  home_score: number | null;
  upset_won: boolean | null;
};

type EventRow = {
  id: string;
  week_id: string;
  game_id: string | null;
  is_longshot: boolean;
  description: string | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  household_id: string;
  display_name: string | null;
  is_commissioner: boolean;
};

type CardRow = {
  id: string;
  week_id: string;
  profile_id: string;
  household_id: string;
  locked_at: string | null;
};

class WindowClosed extends Error {
  constructor(message = LOCKED_MESSAGE) {
    super(message);
    this.name = "WindowClosed";
  }
}

function db(): Db {
  return supabaseAdmin as unknown as Db;
}

async function selectIn(
  table: string,
  columns: string,
  column: string,
  ids: string[],
): Promise<any[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db().from(table).select(columns).in(column, ids).limit(5000);
  if (error) throw error;
  return data ?? [];
}

function groupBy(rows: any[], key: string): Map<string, any[]> {
  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    const id = String(row[key] ?? "");
    const list = grouped.get(id);
    if (list) list.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

function num(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareText(a: string | null, b: string | null): number {
  const left = a ?? "";
  const right = b ?? "";
  if (left !== right) return left < right ? -1 : 1;
  return 0;
}

export async function loadQaHouses(): Promise<PlayHouse[]> {
  const { data: households, error } = await db().from("households").select("id, name").limit(500);
  if (error) throw error;
  const matched = (households ?? [])
    .map((row: { id: string; name: string | null }) => ({
      id: row.id,
      name: row.name ?? "",
      key: qaHouseKey(row.name),
    }))
    .filter(
      (row: { key: QaHouse | null }): row is { id: string; name: string; key: QaHouse } =>
        row.key != null,
    )
    .sort((a: { key: QaHouse; name: string }, b: { key: QaHouse; name: string }) => {
      const byKey = compareQaHouse(a.key, b.key);
      if (byKey !== 0) return byKey;
      return a.name.localeCompare(b.name);
    });

  const householdIds = matched.map((row: { id: string }) => row.id);
  const weeks = (await selectIn(
    "weeks",
    "id, household_id, week_number, season_year, status, lock_at",
    "household_id",
    householdIds,
  )) as WeekRow[];
  const weekIds = weeks.map((week) => week.id);
  const [games, events, profiles, cards] = (await Promise.all([
    selectIn(
      "games",
      "id, week_id, kickoff_at, underdog_team, away_team, home_team, upset_size, away_score, home_score, upset_won",
      "week_id",
      weekIds,
    ),
    selectIn(
      "events",
      "id, week_id, game_id, is_longshot, description, created_at",
      "week_id",
      weekIds,
    ),
    selectIn(
      "profiles",
      "id, household_id, display_name, is_commissioner",
      "household_id",
      householdIds,
    ),
    selectIn("cards", "id, week_id, profile_id, household_id, locked_at", "week_id", weekIds),
  ])) as [GameRow[], EventRow[], ProfileRow[], CardRow[]];
  const cardIds = cards.map((card) => card.id);
  const [squares, upsets] = (await Promise.all([
    selectIn("card_squares", "card_id, event_id, grid_position", "card_id", cardIds),
    selectIn("upset_picks", "card_id, game_id, picked_team, upset_size", "card_id", cardIds),
  ])) as [Array<PlaySquare & { card_id: string }>, Array<PlayUpset & { card_id: string }>];

  const weeksByHouse = groupBy(weeks, "household_id");
  const gamesByWeek = groupBy(games, "week_id");
  const eventsByWeek = groupBy(events, "week_id");
  const profilesByHouse = groupBy(profiles, "household_id");
  const cardsByHouse = groupBy(cards, "household_id");
  const squaresByCard = groupBy(squares, "card_id");
  const upsetsByCard = groupBy(upsets, "card_id");

  return matched.map((house: { id: string; name: string; key: QaHouse }) => {
    const playWeeks: PlayWeek[] = ((weeksByHouse.get(house.id) ?? []) as WeekRow[])
      .map((week) => ({
        id: week.id,
        week_number: Number(week.week_number),
        season_year: Number(week.season_year),
        status: week.status,
        lock_at: week.lock_at,
        games: ((gamesByWeek.get(week.id) ?? []) as GameRow[])
          .map((game) => ({
            id: game.id,
            kickoff_at: game.kickoff_at,
            underdog_team: game.underdog_team,
            away_team: game.away_team ?? "",
            home_team: game.home_team ?? "",
            upset_size: num(game.upset_size),
            away_score: game.away_score,
            home_score: game.home_score,
            upset_won: game.upset_won,
          }))
          .sort(
            (a: PlayGame, b: PlayGame) =>
              compareText(a.kickoff_at, b.kickoff_at) || compareText(a.id, b.id),
          ),
        events: ((eventsByWeek.get(week.id) ?? []) as EventRow[])
          .map((event) => ({
            id: event.id,
            game_id: event.game_id,
            is_longshot: Boolean(event.is_longshot),
            description: event.description ?? "",
            created_at: event.created_at,
          }))
          .sort(
            (a: PlayEvent, b: PlayEvent) =>
              compareText(a.created_at, b.created_at) || compareText(a.id, b.id),
          ),
      }))
      .sort((a, b) => b.season_year - a.season_year || b.week_number - a.week_number);

    const playProfiles: PlayProfile[] = ((profilesByHouse.get(house.id) ?? []) as ProfileRow[]).map(
      (profile) => ({
        id: profile.id,
        display_name: profile.display_name ?? "",
        is_commissioner: Boolean(profile.is_commissioner),
      }),
    );

    const playCards: PlayCard[] = ((cardsByHouse.get(house.id) ?? []) as CardRow[]).map((card) => ({
      id: card.id,
      week_id: card.week_id,
      profile_id: card.profile_id,
      locked_at: card.locked_at,
      squares: ((squaresByCard.get(card.id) ?? []) as PlaySquare[]).map((square) => ({
        event_id: square.event_id,
        grid_position: Number(square.grid_position),
      })),
      upsets: ((upsetsByCard.get(card.id) ?? []) as PlayUpset[]).map((upset) => ({
        game_id: upset.game_id,
        picked_team: upset.picked_team,
        upset_size: num(upset.upset_size),
      })),
    }));

    return {
      key: house.key,
      name: house.name,
      householdId: house.id,
      weeks: playWeeks,
      profiles: playProfiles,
      cards: playCards,
    } satisfies PlayHouse;
  });
}

export async function loadQaBoard(serverNow = Date.now()): Promise<PublicBoard> {
  return publicBoard(await loadQaHouses(), serverNow);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function unavailable(): Response {
  return json({ ok: false, error: "The board is unavailable." }, 500);
}

export async function handleWeek(): Promise<Response> {
  try {
    return json(weekResponse(await loadQaBoard()));
  } catch (error) {
    console.error(error);
    return unavailable();
  }
}

export async function handleGridInfo(): Promise<Response> {
  try {
    const board = await loadQaBoard();
    return json({
      ok: true,
      active_week: board.active_week,
      week: board.active_week,
      card: "grid",
      lock_check: board.lock_check,
      example: board.example?.grid ?? null,
      after_lock: board.example?.after_lock ?? null,
      houses: board.houses.map((house) => ({
        house: house.house,
        name: house.name,
        label: house.label,
        active_week: house.active_week,
        window: house.window,
        moments: house.moments,
        submit: house.submit.grid,
        after_lock: house.submit.after_lock,
      })),
    });
  } catch (error) {
    console.error(error);
    return unavailable();
  }
}

export async function handleUpsetInfo(): Promise<Response> {
  try {
    const board = await loadQaBoard();
    return json({
      ok: true,
      active_week: board.active_week,
      week: board.active_week,
      card: "upset",
      lock_check: board.lock_check,
      example: board.example?.upset ?? null,
      houses: board.houses.map((house) => ({
        house: house.house,
        name: house.name,
        label: house.label,
        active_week: house.active_week,
        window: house.window,
        upset_games: house.upset_games,
        submit: house.submit.upset,
      })),
    });
  } catch (error) {
    console.error(error);
    return unavailable();
  }
}

export async function handleScore(): Promise<Response> {
  try {
    const houses = await loadQaHouses();
    const body = scoreResponse(houses);
    if (body.processed > 0) {
      try {
        await recordSchedule(houses, body.actions);
      } catch (error) {
        console.error(error);
      }
    }
    return json(body);
  } catch (error) {
    console.error(error);
    return unavailable();
  }
}

export async function handlePicks(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let raw = url.searchParams.get("week") ?? url.searchParams.get("week_number");
    if (!raw && request.method !== "GET" && request.method !== "HEAD") {
      const body = await readSubmission(request);
      const week = requestedWeekNumber(body);
      if (week === "invalid")
        return json({ ok: false, error: "That week is not on the board.", saved: false }, 400);
      if (typeof week === "number") raw = String(week);
    }
    const weekNumber = raw == null || raw === "" ? 2 : Number(raw);
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 22) {
      return json({ ok: false, error: "That week is not on the board.", saved: false }, 400);
    }
    return json(picksResponse(await loadQaHouses(), weekNumber));
  } catch (error) {
    console.error(error);
    return unavailable();
  }
}

export async function handleSubmit(request: Request, hint: "grid" | "upset"): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await readSubmission(request);
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "Couldn't save that card.", saved: false }, 500);
  }
  return submitParsedSafe(body, hint);
}

export async function submitParsed(
  body: Record<string, unknown>,
  hint: "grid" | "upset",
): Promise<Response> {
  const serverNow = Date.now();
  const houses = await loadQaHouses();
  const plan = planSubmission(houses, body, hint, serverNow);
  if (!plan.ok) return json(rejectionBody(plan), plan.status);

  for (const write of plan.writes) {
    await assertWeekOpen(write.weekId, serverNow);
  }
  const saved = [];
  for (const write of plan.writes) {
    saved.push(await applyWrite(write, serverNow));
  }
  const response = savedBody(plan);
  return json({ ...response, cards: saved });
}

async function assertWeekOpen(weekId: string, serverNow: number): Promise<void> {
  const { data, error } = await db()
    .from("weeks")
    .select("id, status, lock_at, week_number")
    .eq("id", weekId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new WindowClosed();
  const reason = submissionClosed(
    { status: data.status as string, lock_at: (data.lock_at as string | null) ?? null },
    serverNow,
    null,
  );
  if (reason) throw new WindowClosed(reason);
}

async function applyWrite(
  write: PlannedWrite,
  serverNow: number,
): Promise<{ house: QaHouse; card_id: string; week: number }> {
  await assertWeekOpen(write.weekId, serverNow);
  const cardId = await ensureCard(write);
  if (write.gridIds) {
    await assertWeekOpen(write.weekId, serverNow);
    const known = await selectIn("events", "id, week_id", "id", write.gridIds);
    const knownIds = new Set(
      known
        .filter((row: { id: string; week_id: string }) => row.week_id === write.weekId)
        .map((row: { id: string }) => row.id),
    );
    if (write.gridIds.some((id) => !knownIds.has(id))) {
      throw new Error("Those moments are not on this week's grid.");
    }
    const removed = await db().from("card_squares").delete().eq("card_id", cardId);
    if (removed.error) throw removed.error;
    if (write.gridIds.length > 0) {
      const inserted = await db()
        .from("card_squares")
        .insert(
          write.gridIds.map((event_id, grid_position) => ({
            card_id: cardId,
            event_id,
            grid_position,
          })),
        );
      if (inserted.error) throw inserted.error;
    }
    const check = await db().from("card_squares").select("event_id").eq("card_id", cardId);
    if (check.error) throw check.error;
    if ((check.data ?? []).length !== write.gridIds.length)
      throw new Error("Grid save did not stick.");
  }
  if (write.upsets) {
    await assertWeekOpen(write.weekId, serverNow);
    const gameIds = write.upsets.map((upset) => upset.game_id);
    const known = await selectIn("games", "id, week_id", "id", gameIds);
    const knownIds = new Set(
      known
        .filter((row: { id: string; week_id: string }) => row.week_id === write.weekId)
        .map((row: { id: string }) => row.id),
    );
    if (gameIds.some((id) => !knownIds.has(id))) {
      throw new Error("Those games are not on this week's Upset Watch.");
    }
    const removed = await db().from("upset_picks").delete().eq("card_id", cardId);
    if (removed.error) throw removed.error;
    if (write.upsets.length > 0) {
      const inserted = await db()
        .from("upset_picks")
        .insert(
          write.upsets.map((upset) => ({
            card_id: cardId,
            game_id: upset.game_id,
            picked_team: upset.picked_team,
            upset_size: upset.upset_size,
          })),
        );
      if (inserted.error) throw inserted.error;
    }
    const check = await db().from("upset_picks").select("game_id").eq("card_id", cardId);
    if (check.error) throw check.error;
    if ((check.data ?? []).length !== write.upsets.length)
      throw new Error("Upset Watch save did not stick.");
  }
  return { house: write.house, card_id: cardId, week: write.weekNumber };
}

async function ensureCard(write: PlannedWrite): Promise<string> {
  const existing = await findCard(write.weekId, write.profileId);
  if (existing?.locked_at) throw new WindowClosed();
  if (existing) return existing.id;
  const inserted = await db()
    .from("cards")
    .insert({ household_id: write.householdId, week_id: write.weekId, profile_id: write.profileId })
    .select("id, locked_at")
    .maybeSingle();
  if (!inserted.error && inserted.data?.id) {
    if (inserted.data.locked_at) throw new WindowClosed();
    return inserted.data.id as string;
  }
  if (inserted.error && !isUnique(inserted.error)) throw inserted.error;
  const again = await findCard(write.weekId, write.profileId);
  if (again?.locked_at) throw new WindowClosed();
  if (again) return again.id;
  throw inserted.error ?? new Error("Couldn't save that card.");
}

async function findCard(
  weekId: string,
  profileId: string,
): Promise<{ id: string; locked_at: string | null } | null> {
  const { data, error } = await db()
    .from("cards")
    .select("id, locked_at")
    .eq("week_id", weekId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id as string, locked_at: (data.locked_at as string | null) ?? null };
}

function isUnique(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" || (error.message ?? "").toLowerCase().includes("duplicate");
}

async function recordSchedule(
  houses: PlayHouse[],
  actions: Array<{ house: string; games: number; detail: string; week: number | null }>,
): Promise<void> {
  for (const action of actions) {
    if (action.games <= 0) continue;
    const house = houses.find((item) => item.key === action.house);
    const week =
      house?.weeks.find((item) => item.week_number === action.week && item.season_year === 2026) ??
      null;
    if (!house || !week) continue;
    const inserted = await db().from("autopilot_log").insert({
      household_id: house.householdId,
      week_id: week.id,
      action: "week_scheduled",
      detail: action.detail,
      status: "ok",
    });
    if (inserted.error) throw inserted.error;
  }
}

export async function submitParsedSafe(
  body: Record<string, unknown>,
  hint: "grid" | "upset",
): Promise<Response> {
  try {
    return await submitParsed(body, hint);
  } catch (error) {
    if (error instanceof WindowClosed) {
      const houses = await loadQaHouses().catch(() => []);
      const plan = planSubmission(houses, body, hint, Date.now());
      const active = plan.active_week;
      return json(
        rejectionBody({
          ok: false,
          status: 409,
          active_week: active,
          error: error.message,
          writes: [],
        }),
        409,
      );
    }
    console.error(error);
    return json({ ok: false, error: "Couldn't save that card.", saved: false }, 500);
  }
}
