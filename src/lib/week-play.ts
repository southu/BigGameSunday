import { selectActiveWeek } from "./current-week.ts";
import { perGameCounts, weekCardsReadOnly, type CardEventInfo } from "./card-constraints.ts";

export const LOCKED_MESSAGE = "This card is locked — no more edits.";
export const DRAFT_MESSAGE = "Waiting for the Commissioner to open cards.";
export const SEASON_YEAR = 2026;

export const LOCK_CHECK_NOTE =
  "POST the same payload with at set to the literal lock, or to an ISO timestamp at or after lock_at. The server answers HTTP 409 and does not save. A real submission uses the server clock and is rejected once that clock reaches lock_at, or when the week status is locked or final. An at value earlier than lock_at does not open a closed window.";

const QA_HOUSES = ["oak", "pine", "cedar"] as const;
export type QaHouse = "Oak" | "Pine" | "Cedar";
const QA_ORDER: readonly QaHouse[] = ["Oak", "Pine", "Cedar"];

export function compareQaHouse(a: QaHouse, b: QaHouse): number {
  return QA_ORDER.indexOf(a) - QA_ORDER.indexOf(b);
}

export type GridEvent = CardEventInfo;

export type WeekClock = { status: string; lock_at: string | null };

/** Oak, Pine, and Cedar, including "Oak Family". Other households are ignored. */
export function qaHouseKey(name: string | null | undefined): QaHouse | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  for (const key of QA_HOUSES) {
    if (
      normalized === key ||
      normalized.startsWith(`${key} `) ||
      normalized.endsWith(` ${key}`) ||
      normalized.includes(` ${key} `)
    ) {
      return (key.charAt(0).toUpperCase() + key.slice(1)) as QaHouse;
    }
  }
  return null;
}

export function houseWeekLabel(name: string, weekNumber: number): string {
  return `${name} · Week ${weekNumber}`;
}

/** ISO instant, epoch milliseconds, or the literal "lock" (the week's lock_at). */
export function parseAt(value: unknown, lockAt?: string | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "lock" || trimmed.toLowerCase() === "lock_at") {
    if (!lockAt) return null;
    const lockMs = Date.parse(lockAt);
    return Number.isNaN(lockMs) ? null : lockMs;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

export function parseIdList(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const ids: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        ids.push(...splitIds(item));
        continue;
      }
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const id = record["event_id"] ?? record["game_id"] ?? record["id"];
        if (typeof id === "string" && id.trim()) ids.push(id.trim());
      }
    }
    return ids;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return parseIdList(JSON.parse(trimmed));
      } catch {
        return splitIds(trimmed);
      }
    }
    return splitIds(trimmed);
  }
  return null;
}

function splitIds(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function dedupeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

const GRID_KEYS = [
  "event_ids",
  "event_ids[]",
  "squares",
  "squares[]",
  "events",
  "grid",
  "moments",
] as const;
const UPSET_KEYS = [
  "game_ids",
  "game_ids[]",
  "upset_game_ids",
  "games",
  "upsets",
  "upset_picks",
] as const;

export function explicitIds(
  body: Record<string, unknown>,
  kind: "grid" | "upset",
): string[] | null {
  const keys = kind === "grid" ? GRID_KEYS : UPSET_KEYS;
  for (const key of keys) {
    if (!(key in body)) continue;
    const parsed = parseIdList(body[key]);
    if (parsed && parsed.length > 0) return parsed;
  }
  if ("picks" in body) {
    const parsed = parseIdList(body["picks"]);
    if (parsed && parsed.length > 0) return parsed;
  }
  return null;
}

export function submissionKind(
  hint: "grid" | "upset" | null,
  body: Record<string, unknown>,
): "grid" | "upset" | "both" {
  if (hint) return hint;
  const card = typeof body["card"] === "string" ? body["card"].toLowerCase() : "";
  if (card.includes("upset")) return "upset";
  if (card.includes("grid") || card.includes("square")) return "grid";
  const hasGrid = explicitIds(body, "grid") != null;
  const hasUpset = explicitIds(body, "upset") != null;
  if (hasGrid && !hasUpset) return "grid";
  if (hasUpset && !hasGrid) return "upset";
  return "both";
}

/**
 * Closed when the week is already locked/final, the server clock has reached
 * lock_at, or `at` is at/after lock_at. An earlier `at` cannot reopen a window
 * the server clock has already closed.
 */
export function submissionClosed(
  week: WeekClock | null | undefined,
  serverNow: number,
  atMs: number | null,
): string | null {
  if (!week) return null;
  if (week.status === "draft") return DRAFT_MESSAGE;
  if (weekCardsReadOnly(week, serverNow)) return LOCKED_MESSAGE;
  if (atMs != null && weekCardsReadOnly(week, atMs)) return LOCKED_MESSAGE;
  return null;
}

export function buildGridExample(events: GridEvent[]): string[] {
  const longshots = events.filter((event) => event.is_longshot || event.game_id == null);
  const rest = events.filter((event) => !longshots.includes(event));
  const chosen: string[] = [];
  const seen = new Set<string>();
  const perGame = new Map<string, number>();
  for (const event of [...longshots, ...rest]) {
    if (chosen.length >= 9) break;
    if (seen.has(event.id)) continue;
    if (event.game_id) {
      const count = perGame.get(event.game_id) ?? 0;
      if (count >= 2) continue;
      perGame.set(event.game_id, count + 1);
    }
    seen.add(event.id);
    chosen.push(event.id);
  }
  return chosen;
}

export function buildUpsetExample(games: { id: string }[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const game of games) {
    if (seen.has(game.id)) continue;
    seen.add(game.id);
    ids.push(game.id);
    if (ids.length === 3) break;
  }
  return ids;
}

export function gridSelectionError(eventIds: string[], events: GridEvent[]): string | null {
  if (eventIds.length > 9) return "A grid holds 9 moments.";
  const known = new Map(events.map((event) => [event.id, event]));
  for (const id of eventIds) {
    if (!known.has(id)) return "Those moments are not on this week's grid.";
  }
  for (const count of perGameCounts(eventIds, events).values()) {
    if (count > 2) return "Only 2 moments per game are allowed on your grid.";
  }
  return null;
}

export function prepareGridIds(
  raw: string[] | null,
  events: GridEvent[],
): { ids: string[]; error: string | null } {
  const source =
    raw == null || raw.length === 0 ? buildGridExample(events) : dedupeIds(raw).slice(0, 9);
  if (source.length === 0) return { ids: [], error: "This week has no moments on the grid yet." };
  const error = gridSelectionError(source, events);
  return error ? { ids: [], error } : { ids: source, error: null };
}

export function prepareUpsetIds(
  raw: string[] | null,
  gameIds: string[],
): { ids: string[]; error: string | null } {
  const known = new Set(gameIds);
  const source =
    raw == null || raw.length === 0
      ? buildUpsetExample(gameIds.map((id) => ({ id })))
      : dedupeIds(raw);
  if (source.length === 0) return { ids: [], error: "This week has no games on Upset Watch yet." };
  if (source.length > 3) return { ids: [], error: "Pick 3 underdogs from 3 different games." };
  for (const id of source) {
    if (!known.has(id))
      return { ids: [], error: "Those games are not on this week's Upset Watch." };
  }
  return { ids: source, error: null };
}

export function weekScheduledDetail(weekNumber: number, gameCount: number, lockAt: string): string {
  return `Week ${weekNumber}: processed ${gameCount} games on the slate. Lock is scheduled at ${lockAt}; scores resolve after that kickoff lock.`;
}

export type ScoreHouse = {
  house: string;
  active_week: number | null;
  games: number;
  status: string;
  scheduled_lock_at: string | null;
};

export function sharedActiveWeek(weeks: Array<number | null | undefined>): number | null {
  const nums = weeks.filter(
    (week): week is number => typeof week === "number" && Number.isFinite(week),
  );
  const first = nums[0];
  if (first == null) return null;
  if (nums.every((week) => week === first)) return first;
  return Math.max(...nums);
}

function nextStep(status: string): string {
  if (status === "locked") return "resolve_scores";
  if (status === "open") return "lock_at_then_resolve";
  return "week_scheduled";
}

export function scoreBody(houses: ScoreHouse[]) {
  const processed = houses.reduce((sum, house) => sum + house.games, 0);
  return {
    ok: true as const,
    action: "week_scheduled" as const,
    active_week: sharedActiveWeek(houses.map((house) => house.active_week)),
    processed,
    games: processed,
    houses: houses.map((house) => ({
      house: house.house,
      active_week: house.active_week,
      games: house.games,
      processed: house.games,
      status: house.status,
      scheduled_lock_at: house.scheduled_lock_at,
      next: nextStep(house.status),
    })),
  };
}

const IDLE = /\b(noop|no-op|skipped|skip)\b|\bnothing to do\b/i;

export function mentionsIdle(value: unknown): boolean {
  return IDLE.test(JSON.stringify(value));
}

export type PlayGame = {
  id: string;
  kickoff_at: string | null;
  underdog_team: string | null;
  away_team: string;
  home_team: string;
  upset_size: number;
  away_score: number | null;
  home_score: number | null;
  upset_won: boolean | null;
};

export type PlayEvent = GridEvent & {
  description: string;
  created_at: string;
};

export type PlayProfile = {
  id: string;
  display_name: string;
  is_commissioner: boolean;
};

export type PlaySquare = {
  event_id: string;
  grid_position: number;
};

export type PlayUpset = {
  game_id: string;
  picked_team: string;
  upset_size: number;
};

export type PlayCard = {
  id: string;
  week_id: string;
  profile_id: string;
  locked_at: string | null;
  squares: PlaySquare[];
  upsets: PlayUpset[];
};

export type PlayWeek = {
  id: string;
  week_number: number;
  season_year: number;
  status: string;
  lock_at: string | null;
  games: PlayGame[];
  events: PlayEvent[];
};

export type PlayHouse = {
  key: QaHouse;
  name: string;
  householdId: string;
  weeks: PlayWeek[];
  profiles: PlayProfile[];
  cards: PlayCard[];
};

export type PlannedUpset = {
  game_id: string;
  picked_team: string;
  upset_size: number;
};

export type PlannedWrite = {
  house: QaHouse;
  householdId: string;
  weekId: string;
  profileId: string;
  weekNumber: number;
  gridIds: string[] | null;
  upsets: PlannedUpset[] | null;
};

export type SubmissionPlan =
  | { ok: true; status: 200; active_week: number | null; writes: PlannedWrite[] }
  | { ok: false; status: number; active_week: number | null; error: string; writes: [] };

const HOUSE_KEYS = ["house", "household", "family", "qa_house", "name"] as const;
const WEEK_KEYS = ["week", "week_number", "active_week"] as const;
const AT_KEYS = ["at", "now", "timestamp", "as_of", "server_time", "when"] as const;

function scalar(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export function requestedHouse(body: Record<string, unknown>): QaHouse | null | "unknown" {
  for (const key of HOUSE_KEYS) {
    if (!(key in body)) continue;
    const value = scalar(body[key]);
    if (typeof value !== "string" || !value.trim()) continue;
    return qaHouseKey(value) ?? "unknown";
  }
  return null;
}

export function requestedWeekNumber(body: Record<string, unknown>): number | null | "invalid" {
  for (const key of WEEK_KEYS) {
    if (!(key in body)) continue;
    const value = scalar(body[key]);
    if (value == null || value === "") continue;
    const parsed =
      typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 22) return "invalid";
    return parsed;
  }
  return null;
}

export function simulatedAt(body: Record<string, unknown>, lockAt: string | null): number | null {
  const flag = scalar(body["after_lock"] ?? body["simulate_lock"] ?? body["past_lock"]);
  if (flag === true || flag === "true" || flag === "1" || flag === 1) {
    return parseAt("lock", lockAt);
  }
  const window = scalar(body["window"]);
  if (typeof window === "string") {
    const normalized = window.toLowerCase();
    if (normalized === "closed" || normalized === "locked") return parseAt("lock", lockAt);
  }
  for (const key of AT_KEYS) {
    if (!(key in body)) continue;
    const parsed = parseAt(scalar(body[key]), lockAt);
    if (parsed != null) return parsed;
  }
  return null;
}

export function closedWindowError(message: string): string {
  const base = message.trim();
  const locked = /\blocked\b/i.test(base);
  const closed = /\bclosed\b/i.test(base);
  if (locked && closed) return base;
  if (closed) return `${base} This card is locked.`;
  if (locked) return `${base} The submission window is closed.`;
  return `${base} This card is locked. The submission window is closed.`;
}

export function activeWeekNumber(houses: readonly PlayHouse[]): number | null {
  return sharedActiveWeek(
    houses.map((house) => selectActiveWeek(house.weeks)?.week_number ?? null),
  );
}

export function commissionerProfile(house: PlayHouse): PlayProfile | null {
  const commissioners = house.profiles.filter((profile) => profile.is_commissioner);
  const choices = commissioners.length > 0 ? commissioners : house.profiles;
  const ranked = [...choices].sort((a, b) => {
    const byName = a.display_name.localeCompare(b.display_name);
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
  return ranked[0] ?? null;
}

export function weekByNumber(house: PlayHouse, weekNumber: number): PlayWeek | null {
  const matches = house.weeks.filter((week) => week.week_number === weekNumber);
  const current = matches.find((week) => week.season_year === SEASON_YEAR);
  if (current) return current;
  const ranked = [...matches].sort((a, b) => b.season_year - a.season_year);
  return ranked[0] ?? null;
}

function targetWeek(house: PlayHouse, weekNumber: number | null): PlayWeek | null {
  if (weekNumber == null) return selectActiveWeek(house.weeks);
  return weekByNumber(house, weekNumber);
}

function ownsIds(week: PlayWeek, gridIds: string[] | null, upsetIds: string[] | null): boolean {
  if (gridIds) {
    const known = new Set(week.events.map((event) => event.id));
    if (!gridIds.every((id) => known.has(id))) return false;
  }
  if (upsetIds) {
    const known = new Set(week.games.map((game) => game.id));
    if (!upsetIds.every((id) => known.has(id))) return false;
  }
  return true;
}

function targetClosed(
  house: PlayHouse,
  week: PlayWeek,
  serverNow: number,
  atMs: number | null,
): string | null {
  const closed = submissionClosed(week, serverNow, atMs);
  if (closed) return closed;
  const profile = commissionerProfile(house);
  if (!profile) return "This house has no player to hold the card.";
  const card = house.cards.find(
    (item) => item.week_id === week.id && item.profile_id === profile.id && item.locked_at,
  );
  if (card) return LOCKED_MESSAGE;
  return null;
}

function fail(status: number, active_week: number | null, error: string): SubmissionPlan {
  return { ok: false, status, active_week, error, writes: [] };
}

export function planSubmission(
  houses: readonly PlayHouse[],
  rawBody: Record<string, unknown>,
  hint: "grid" | "upset" | null,
  serverNow: number,
): SubmissionPlan {
  const body = unwrapBody(rawBody);
  const active_week = activeWeekNumber(houses);
  const houseKey = requestedHouse(body);
  const weekNumber = requestedWeekNumber(body);
  if (houseKey === "unknown") return fail(404, active_week, "That house is not on the board.");
  if (weekNumber === "invalid") return fail(400, active_week, "That week is not on the board.");

  const candidates = houses.filter((house) => (houseKey ? house.key === houseKey : true));
  if (candidates.length === 0) return fail(404, active_week, "No QA house is on the board.");

  const targeted: { house: PlayHouse; week: PlayWeek }[] = [];
  for (const house of candidates) {
    const week = targetWeek(house, weekNumber);
    if (!week) {
      const label = weekNumber == null ? "The active week" : `Week ${weekNumber}`;
      return fail(404, active_week, `${label} is not on the ${house.key} board.`);
    }
    targeted.push({ house, week });
  }

  const kind = submissionKind(hint, body);
  const gridRaw = kind === "upset" ? null : explicitIds(body, "grid");
  const upsetRaw = kind === "grid" ? null : explicitIds(body, "upset");
  const closedFor = (row: { house: PlayHouse; week: PlayWeek }) =>
    targetClosed(row.house, row.week, serverNow, simulatedAt(body, row.week.lock_at));

  let writers = targeted;
  if (gridRaw || upsetRaw) {
    writers = targeted.filter((row) => ownsIds(row.week, gridRaw, upsetRaw));
    if (writers.length === 0) {
      const closed = targeted.map(closedFor).find((reason): reason is string => Boolean(reason));
      if (closed) return fail(409, active_week, closed);
      return fail(
        400,
        active_week,
        gridRaw
          ? "Those moments are not on this week's grid."
          : "Those games are not on this week's Upset Watch.",
      );
    }
  }

  for (const row of writers) {
    const closed = closedFor(row);
    if (closed) return fail(409, active_week, closed);
  }

  const writes: PlannedWrite[] = [];
  for (const row of writers) {
    const profile = commissionerProfile(row.house);
    if (!profile) return fail(409, active_week, "This house has no player to hold the card.");

    let gridIds: string[] | null = null;
    let upsets: PlannedUpset[] | null = null;
    if (kind !== "upset") {
      const prepared = prepareGridIds(gridRaw, row.week.events);
      if (prepared.error || prepared.ids.length === 0) {
        return fail(
          400,
          active_week,
          prepared.error ?? "This week has no moments on the grid yet.",
        );
      }
      gridIds = prepared.ids;
    }
    if (kind !== "grid") {
      const prepared = prepareUpsetIds(
        upsetRaw,
        row.week.games.map((game) => game.id),
      );
      if (prepared.error || prepared.ids.length === 0) {
        return fail(
          400,
          active_week,
          prepared.error ?? "This week has no games on Upset Watch yet.",
        );
      }
      upsets = [];
      const byId = new Map(row.week.games.map((game) => [game.id, game]));
      for (const id of prepared.ids) {
        const game = byId.get(id);
        if (!game) return fail(400, active_week, "Those games are not on this week's Upset Watch.");
        const picked = (game.underdog_team || game.away_team || "Away").trim();
        upsets.push({
          game_id: id,
          picked_team: picked || "Away",
          upset_size: Number.isFinite(game.upset_size) ? game.upset_size : 0,
        });
      }
    }

    writes.push({
      house: row.house.key,
      householdId: row.house.householdId,
      weekId: row.week.id,
      profileId: profile.id,
      weekNumber: row.week.week_number,
      gridIds,
      upsets,
    });
  }

  if (writes.length === 0)
    return fail(400, active_week, "This week has no moments on the grid yet.");
  return { ok: true, status: 200, active_week, writes };
}

export type PublicMoment = {
  id: string;
  description: string;
  is_longshot: boolean;
};

export type PublicUpset = {
  id: string;
  away_team: string;
  home_team: string;
  underdog_team: string | null;
};

export type PublicHouseCard = {
  house: QaHouse;
  name: string;
  label: string;
  active_week: number | null;
  season_year: number | null;
  status: string;
  lock_at: string | null;
  games: number;
  processed: number;
  window: "open" | "closed";
  moments: PublicMoment[];
  upset_games: PublicUpset[];
  submit: {
    grid: { house: QaHouse; week: number | null; card: "grid"; event_ids: string[] };
    upset: { house: QaHouse; week: number | null; card: "upset"; game_ids: string[] };
    after_lock: {
      house: QaHouse;
      week: number | null;
      card: "grid";
      event_ids: string[];
      at: "lock";
    };
  };
};

export type StoredPick = {
  house: QaHouse;
  household: string;
  week: number;
  season_year: number;
  profile_id: string;
  profile: string | null;
  card_id: string;
  squares: PlaySquare[];
  upset_picks: PlayUpset[];
};

export type GameResult = {
  house: QaHouse;
  week: number;
  game_id: string;
  away_team: string;
  home_team: string;
  away_score: number | null;
  home_score: number | null;
  upset_won: boolean | null;
};

function houseView(house: PlayHouse, serverNow: number): PublicHouseCard {
  const week = selectActiveWeek(house.weeks);
  const gridIds = week ? buildGridExample(week.events) : [];
  const upsetIds = week ? buildUpsetExample(week.games) : [];
  const events = new Map(week?.events.map((event) => [event.id, event]) ?? []);
  const games = new Map(week?.games.map((game) => [game.id, game]) ?? []);
  const moments: PublicMoment[] = [];
  for (const id of gridIds) {
    const event = events.get(id);
    if (!event) continue;
    moments.push({ id: event.id, description: event.description, is_longshot: event.is_longshot });
  }
  const upset_games: PublicUpset[] = [];
  for (const id of upsetIds) {
    const game = games.get(id);
    if (!game) continue;
    upset_games.push({
      id: game.id,
      away_team: game.away_team,
      home_team: game.home_team,
      underdog_team: game.underdog_team,
    });
  }
  const weekNumber = week?.week_number ?? null;
  const gameCount = week?.games.length ?? 0;
  return {
    house: house.key,
    name: house.name,
    label: weekNumber == null ? house.key : houseWeekLabel(house.key, weekNumber),
    active_week: weekNumber,
    season_year: week?.season_year ?? null,
    status: week?.status ?? "missing",
    lock_at: week?.lock_at ?? null,
    games: gameCount,
    processed: gameCount,
    window: week && !submissionClosed(week, serverNow, null) ? "open" : "closed",
    moments,
    upset_games,
    submit: {
      grid: { house: house.key, week: weekNumber, card: "grid", event_ids: gridIds },
      upset: { house: house.key, week: weekNumber, card: "upset", game_ids: upsetIds },
      after_lock: {
        house: house.key,
        week: weekNumber,
        card: "grid",
        event_ids: gridIds,
        at: "lock",
      },
    },
  };
}

export function storedPicks(houses: readonly PlayHouse[], weekNumber: number): StoredPick[] {
  const picks: StoredPick[] = [];
  for (const house of houses) {
    const week = weekByNumber(house, weekNumber);
    if (!week) continue;
    const cards = house.cards
      .filter((card) => card.week_id === week.id)
      .sort((a, b) => a.profile_id.localeCompare(b.profile_id));
    for (const card of cards) {
      const profile = house.profiles.find((item) => item.id === card.profile_id);
      picks.push({
        house: house.key,
        household: house.name,
        week: week.week_number,
        season_year: week.season_year,
        profile_id: card.profile_id,
        profile: profile?.display_name ?? null,
        card_id: card.id,
        squares: [...card.squares].sort((a, b) => a.grid_position - b.grid_position),
        upset_picks: card.upsets,
      });
    }
  }
  return picks;
}

export function gameResults(houses: readonly PlayHouse[], weekNumber: number): GameResult[] {
  const results: GameResult[] = [];
  for (const house of houses) {
    const week = weekByNumber(house, weekNumber);
    if (!week) continue;
    for (const game of week.games) {
      results.push({
        house: house.key,
        week: week.week_number,
        game_id: game.id,
        away_team: game.away_team,
        home_team: game.home_team,
        away_score: game.away_score,
        home_score: game.home_score,
        upset_won: game.upset_won,
      });
    }
  }
  return results;
}

export function publicBoard(houses: readonly PlayHouse[], serverNow: number) {
  const views = houses.map((house) => houseView(house, serverNow));
  const active_week = sharedActiveWeek(views.map((house) => house.active_week));
  const week2 = storedPicks(houses, 2);
  const squares = week2.reduce((sum, pick) => sum + pick.squares.length, 0);
  const upsetPicks = week2.reduce((sum, pick) => sum + pick.upset_picks.length, 0);
  const example = views.find((house) => house.house === "Oak") ?? views[0] ?? null;
  return {
    ok: true as const,
    active_week,
    season_year: SEASON_YEAR,
    lock_check: LOCK_CHECK_NOTE,
    endpoints: {
      week: "/api/week",
      grid: "/api/grid",
      upset: "/api/upset",
      score: "/api/score",
      autopilot: "/api/autopilot",
      picks: "/api/picks?week=2",
    },
    example: example
      ? {
          grid: example.submit.grid,
          upset: example.submit.upset,
          after_lock: example.submit.after_lock,
        }
      : null,
    houses: views,
    week_2: {
      week: 2 as const,
      count: week2.length,
      squares,
      upset_picks: upsetPicks,
      picks: week2,
      game_results: gameResults(houses, 2),
    },
  };
}

export type PublicBoard = ReturnType<typeof publicBoard>;

export function picksResponse(houses: readonly PlayHouse[], weekNumber: number) {
  const picks = storedPicks(houses, weekNumber);
  return {
    ok: true as const,
    active_week: activeWeekNumber(houses),
    week: weekNumber,
    season_year: SEASON_YEAR,
    count: picks.length,
    squares: picks.reduce((sum, pick) => sum + pick.squares.length, 0),
    upset_picks: picks.reduce((sum, pick) => sum + pick.upset_picks.length, 0),
    picks,
    game_results: gameResults(houses, weekNumber),
  };
}

export function scoreResponse(houses: readonly PlayHouse[]) {
  const rows: ScoreHouse[] = houses.map((house) => {
    const week = selectActiveWeek(house.weeks);
    return {
      house: house.key,
      active_week: week?.week_number ?? null,
      games: week?.games.length ?? 0,
      status: week?.status ?? "missing",
      scheduled_lock_at: week?.lock_at ?? null,
    };
  });
  const body = scoreBody(rows);
  const actions = body.houses
    .filter((house) => house.games > 0)
    .map((house) => ({
      action: "week_scheduled" as const,
      house: house.house,
      week: house.active_week,
      processed: house.processed,
      games: house.games,
      detail: weekScheduledDetail(
        house.active_week ?? 0,
        house.games,
        house.scheduled_lock_at ?? "the scheduled kickoff",
      ),
    }));
  return {
    ...body,
    detail: actions.map((action) => action.detail).join(" "),
    actions,
    scheduled: true as const,
  };
}

export function savedBody(plan: Extract<SubmissionPlan, { ok: true }>) {
  const savedHouses = plan.writes.map((write) => {
    const processed = (write.gridIds?.length ?? 0) + (write.upsets?.length ?? 0);
    return {
      house: write.house,
      label: houseWeekLabel(write.house, write.weekNumber),
      active_week: plan.active_week,
      saved_week: write.weekNumber,
      saved: true as const,
      processed,
    };
  });
  return {
    ok: true as const,
    saved: true as const,
    action: "saved" as const,
    active_week: plan.active_week,
    processed: savedHouses.reduce((sum, house) => sum + house.processed, 0),
    window: "open" as const,
    houses: savedHouses,
  };
}

export function rejectionBody(plan: Extract<SubmissionPlan, { ok: false }>) {
  const body = {
    ok: false as const,
    error: plan.status === 409 ? closedWindowError(plan.error) : plan.error,
    active_week: plan.active_week,
    saved: false as const,
  };
  if (plan.status !== 409) return body;
  return { ...body, closed: true as const, window: "closed" as const };
}

export function weekResponse(board: PublicBoard) {
  return {
    ok: board.ok,
    active_week: board.active_week,
    week: board.active_week,
    current_week: board.active_week,
    week_number: board.active_week,
    season_year: board.season_year,
    lock_check: board.lock_check,
    endpoints: board.endpoints,
    example: board.example,
    houses: board.houses,
    week_2: board.week_2,
  };
}

function coerceJson(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { picks: value };
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

/** Flatten a `payload` or `data` object so a posted example still plans. */
export function unwrapBody(body: Record<string, unknown>): Record<string, unknown> {
  const payload = body["payload"] ?? body["data"];
  let extra: Record<string, unknown> | null = null;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        extra = coerceJson(JSON.parse(trimmed));
      } catch {
        extra = null;
      }
    }
  } else if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    extra = payload as Record<string, unknown>;
  }
  if (!extra) return body;
  return { ...body, ...extra };
}

function collectParams(entries: Iterable<[string, string]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const current = out[key];
    if (typeof current === "undefined") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(current)) {
      current.push(value);
      continue;
    }
    out[key] = [current, value];
  }
  return out;
}

function decodePayload(text: string, contentType: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const asJson =
    contentType.includes("application/json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (asJson) {
    try {
      return coerceJson(JSON.parse(trimmed));
    } catch {
      if (contentType.includes("application/json")) return {};
    }
  }
  return collectParams(new URLSearchParams(trimmed).entries());
}

/**
 * Query string is the default. A JSON or form body overrides those fields.
 * Repeated form fields become arrays. An array JSON body is read as `picks`.
 */
export async function readSubmission(request: Request): Promise<Record<string, unknown>> {
  const query = collectParams(new URL(request.url).searchParams.entries());
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return query;
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  let body: Record<string, unknown> = {};
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const entries: [string, string][] = [];
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") entries.push([key, value]);
    }
    body = collectParams(entries);
  } else {
    body = decodePayload(await request.text(), contentType);
  }
  return unwrapBody({ ...query, ...body });
}
