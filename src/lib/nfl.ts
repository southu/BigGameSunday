/** NFL teams + smart-default date helpers for the Commissioner Panel. */

export const NFL_TEAMS = [
  "Arizona Cardinals",
  "Atlanta Falcons",
  "Baltimore Ravens",
  "Buffalo Bills",
  "Carolina Panthers",
  "Chicago Bears",
  "Cincinnati Bengals",
  "Cleveland Browns",
  "Dallas Cowboys",
  "Denver Broncos",
  "Detroit Lions",
  "Green Bay Packers",
  "Houston Texans",
  "Indianapolis Colts",
  "Jacksonville Jaguars",
  "Kansas City Chiefs",
  "Las Vegas Raiders",
  "Los Angeles Chargers",
  "Los Angeles Rams",
  "Miami Dolphins",
  "Minnesota Vikings",
  "New England Patriots",
  "New Orleans Saints",
  "New York Giants",
  "New York Jets",
  "Philadelphia Eagles",
  "Pittsburgh Steelers",
  "San Francisco 49ers",
  "Seattle Seahawks",
  "Tampa Bay Buccaneers",
  "Tennessee Titans",
  "Washington Commanders",
] as const;

const ET = "America/New_York";

function etOffsetMinutes(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return (asUTC - at.getTime()) / 60000;
}

/** Instant for a wall-clock date/time in Eastern Time. */
export function easternToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const off = etOffsetMinutes(guess);
  return new Date(guess.getTime() - off * 60000);
}

/** The upcoming Sunday (today if it's Sunday) at 1:00 PM Eastern. */
export function nextSundayKickoff(from = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(from);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dow = days.indexOf(get("weekday"));
  const base = easternToInstant(
    Number(get("year")),
    Number(get("month")),
    Number(get("day")),
    13,
  );
  const add = dow < 0 ? 0 : (7 - dow) % 7;
  return new Date(base.getTime() + add * 86400000);
}

/** ISO string -> value for an <input type="datetime-local"> in the viewer's local time. */
export function toLocalInput(iso: string | Date | null) {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

export function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

/** The three standard auto-scoring moments generated for every game. */
export function standardEvents(game: {
  home_team: string;
  away_team: string;
  underdog_team: string | null;
  upset_size: number;
}) {
  const favorite =
    game.underdog_team === game.home_team ? game.away_team : game.home_team;
  const short = (t: string) => t.split(" ").slice(-1)[0];
  return [
    `${favorite} win by MORE than ${game.upset_size}?`,
    `Both teams combine for 45+ points?`,
    `First score of ${short(game.away_team)}–${short(game.home_team)} is a touchdown?`,
  ];
}

/**
 * Documented Sunday longshots for every auto-filled (or add-game) week.
 * Cards need at least one to lock. Commissioner-called — no auto resolver yet.
 */
export const WEEK_LONGSHOTS = [
  "A safety is scored this Sunday",
  "A defensive or special-teams touchdown is scored this Sunday",
  "A game goes to overtime this Sunday",
  "A field goal of 55 yards or longer is made this Sunday",
] as const;

export function weekLongshotRows(
  week: { id: string; household_id: string },
  existingDescriptions: Iterable<string> = [],
) {
  const have = new Set(existingDescriptions);
  return WEEK_LONGSHOTS.filter((description) => !have.has(description)).map((description) => ({
    week_id: week.id,
    household_id: week.household_id,
    game_id: null as string | null,
    description,
    is_longshot: true,
    resolution_source: "manual" as const,
  }));
}

/** Commissioner-called longshots so a player can lock a card without hand-flagging stars. */
export async function insertMissingWeekLongshots(
  db: { from: (table: string) => any },
  week: { id: string; household_id: string },
): Promise<number> {
  const { data: existingEvents, error } = await db
    .from("events")
    .select("description")
    .eq("week_id", week.id);
  if (error) throw error;
  const rows = weekLongshotRows(
    week,
    ((existingEvents ?? []) as { description: string }[]).map((e) => e.description),
  );
  if (!rows.length) return 0;
  const { error: insErr } = await db.from("events").insert(rows);
  if (insErr) throw insErr;
  return rows.length;
}
