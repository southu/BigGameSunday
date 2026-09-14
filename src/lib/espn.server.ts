/** ESPN public NFL scoreboard reader (server-only). */
import { NFL_TEAMS } from "./nfl";

export type EspnGame = {
  espn_event_id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  underdog_team: string;
  upset_size: number;
  needs_review: boolean;
};

function matchTeam(name: string | undefined): string | null {
  if (!name) return null;
  const exact = NFL_TEAMS.find((t) => t.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  const nickname = name.split(" ").slice(-1)[0]?.toLowerCase();
  return NFL_TEAMS.find((t) => t.toLowerCase().endsWith(` ${nickname}`)) ?? null;
}

type Competitor = {
  homeAway?: string;
  team?: { displayName?: string; abbreviation?: string };
};

/** "DET -3.5" / "EVEN" -> { favoriteAbbr, size } */
function parseSpread(odds: any): { favoriteAbbr: string | null; size: number } | null {
  if (!odds) return null;
  const details: string | undefined = odds.details;
  if (typeof details === "string" && details.trim()) {
    if (details.trim().toUpperCase().startsWith("EVEN")) return { favoriteAbbr: null, size: 0 };
    const m = details.match(/([A-Z]{2,4})\s*(-?\d+(?:\.\d+)?)/);
    if (m) return { favoriteAbbr: m[1]!, size: Math.abs(Number(m[2])) };
  }
  const spread = Number(odds.spread);
  if (Number.isFinite(spread) && spread !== 0) {
    return { favoriteAbbr: null, size: Math.abs(spread) };
  }
  return null;
}

export async function fetchEspnWeek(seasonYear: number, weekNumber: number): Promise<EspnGame[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${seasonYear}&seasontype=2&week=${weekNumber}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN scoreboard request failed (${res.status}).`);
  const json = (await res.json()) as { events?: any[] };
  const events = json.events ?? [];

  const games: EspnGame[] = [];
  for (const event of events) {
    const comp = event?.competitions?.[0];
    const competitors: Competitor[] = comp?.competitors ?? [];
    const home = matchTeam(competitors.find((c) => c.homeAway === "home")?.team?.displayName);
    const away = matchTeam(competitors.find((c) => c.homeAway === "away")?.team?.displayName);
    if (!home || !away || home === away) continue;

    const homeAbbr = competitors.find((c) => c.homeAway === "home")?.team?.abbreviation ?? "";
    const spread = parseSpread(comp?.odds?.[0]);

    let underdog = away;
    let size = 3;
    let needsReview = true;
    if (spread && spread.size > 0) {
      needsReview = false;
      size = spread.size;
      if (spread.favoriteAbbr) {
        underdog = spread.favoriteAbbr.toUpperCase() === homeAbbr.toUpperCase() ? away : home;
      } else {
        // Positive/negative ESPN spread is relative to the home team.
        underdog = Number(comp?.odds?.[0]?.spread) < 0 ? away : home;
      }
    }

    const kickoff = event?.date ? new Date(event.date) : null;
    games.push({
      espn_event_id: String(event?.id ?? comp?.id ?? ""),
      home_team: home,
      away_team: away,
      kickoff_at: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff.toISOString() : null,
      underdog_team: underdog,
      upset_size: size,
      needs_review: needsReview,
    });
  }
  games.sort((a, b) => (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? ""));
  return games;
}

export type EspnScore = {
  espn_event_id: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  /** "pre" (not started), "in" (playing), "post" (over) */
  state: string;
  completed: boolean;
};

/** Live/final scores for one NFL week. */
export async function fetchEspnScores(
  seasonYear: number,
  weekNumber: number,
): Promise<EspnScore[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${seasonYear}&seasontype=2&week=${weekNumber}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN scoreboard request failed (${res.status}).`);
  const json = (await res.json()) as { events?: any[] };

  const out: EspnScore[] = [];
  for (const event of json.events ?? []) {
    const comp = event?.competitions?.[0];
    const competitors: any[] = comp?.competitors ?? [];
    const homeC = competitors.find((c) => c.homeAway === "home");
    const awayC = competitors.find((c) => c.homeAway === "away");
    const home = matchTeam(homeC?.team?.displayName);
    const away = matchTeam(awayC?.team?.displayName);
    if (!home || !away) continue;
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    out.push({
      espn_event_id: String(event?.id ?? comp?.id ?? ""),
      home_team: home,
      away_team: away,
      home_score: num(homeC?.score),
      away_score: num(awayC?.score),
      state: String(comp?.status?.type?.state ?? event?.status?.type?.state ?? "pre"),
      completed: !!(comp?.status?.type?.completed ?? event?.status?.type?.completed),
    });
  }
  return out;
}

/** True/false once a game has scored; null while nobody has scored yet. */
export async function fetchFirstScoreWasTouchdown(espnEventId: string): Promise<boolean | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${espnEventId}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN summary request failed (${res.status}).`);
  const json = (await res.json()) as { scoringPlays?: any[] };
  const first = json.scoringPlays?.[0];
  if (!first) return null;
  const label = `${first?.type?.text ?? ""} ${first?.type?.abbreviation ?? ""}`.toLowerCase();
  return label.includes("touchdown") || label.trim() === "td";
}
