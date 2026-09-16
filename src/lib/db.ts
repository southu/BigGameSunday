import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { selectActiveWeek } from "./current-week";
import {
  buildSeasonStandings,
  regularSeasonWeeks,
  type SeasonCardInput,
  type SeasonHistoryRow,
  type SeasonRow,
  type SeasonWeekInput,
} from "./scoring";

export type Household = {
  id: string;
  name: string;
  owner_user_id: string;
  auto_create_weeks: boolean;
};

export type Profile = {
  id: string;
  household_id: string;
  display_name: string;
  avatar: string;
  color: string;
  is_commissioner: boolean;
  created_at: string;
};

export type Week = {
  id: string;
  household_id: string;
  season_year: number;
  week_number: number;
  featured_game_id: string | null;
  lock_at: string | null;
  lock_at_override: boolean;
  status: "draft" | "open" | "locked" | "final";
  auto_created_at: string | null;
  auto_opened_at: string | null;
  auto_locked_at: string | null;
  autopilot_checked_at: string | null;
  finalized_at: string | null;
  commissioner_edited_at: string | null;
  autopilot_hold: boolean;

};

export type Game = {
  id: string;
  week_id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  underdog_team: string | null;
  upset_size: number;
  upset_won: boolean | null;
  needs_review: boolean;
  espn_event_id: string | null;
};

export type WeekEvent = {
  id: string;
  week_id: string;
  game_id: string | null;
  description: string;
  is_longshot: boolean;
  result: "hit" | "miss" | null;
  resolved_at: string | null;
  resolution_source: "auto_score" | "manual";
};

export type CardRow = {
  id: string;
  week_id: string;
  profile_id: string;
  locked_at: string | null;
  card_squares: { event_id: string; grid_position: number }[];
  upset_picks: { id: string; game_id: string; picked_team: string; upset_size: number }[];
  weekly_scores:
    | {
        hits: number;
        lines: number;
        grid_score: number;
        upset_score: number;
        rank: number | null;
        first_line_at: string | null;
      }
    | null;
};

const anyDb = supabase as unknown as {
  from: (t: string) => any;
};

const CARD_SCORES_SELECT =
  "id, week_id, profile_id, locked_at, card_squares(event_id, grid_position), upset_picks(id, game_id, picked_team, upset_size), weekly_scores(hits, lines, grid_score, upset_score, rank, first_line_at)";
const CARD_SCORES_SELECT_FALLBACK =
  "id, week_id, profile_id, locked_at, card_squares(event_id, grid_position), upset_picks(id, game_id, picked_team, upset_size), weekly_scores(hits, lines, grid_score, upset_score, rank)";
const SEASON_CARD_SELECT =
  "id, week_id, profile_id, weekly_scores(grid_score, upset_score, rank, first_line_at)";
const SEASON_CARD_SELECT_FALLBACK =
  "id, week_id, profile_id, weekly_scores(grid_score, upset_score, rank)";

function missingFirstLineAt(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return /first_line_at|42703|PGRST204/i.test(`${error.code ?? ""} ${error.message ?? ""}`);
}

export function useHousehold(enabled = true) {
  return useQuery({
    queryKey: ["household"],
    enabled,
    queryFn: async (): Promise<Household | null> => {
      const { data, error } = await anyDb.from("households").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return (data as Household) ?? null;
    },
  });
}

export function useProfiles(householdId?: string) {
  return useQuery({
    queryKey: ["profiles", householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await anyDb
        .from("profiles")
        .select("*")
        .eq("household_id", householdId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });
}

async function fetchHouseholdWeeks(householdId: string): Promise<Week[]> {
  const { data, error } = await anyDb
    .from("weeks")
    .select("*")
    .eq("household_id", householdId)
    .order("season_year", { ascending: false })
    .order("week_number", { ascending: false });
  if (error) throw error;
  // Recency is applied here so useCurrentWeek never depends on PostgREST LIMIT 1.
  // selectActiveWeek ranks latest open/locked first, else newest overall —
  // never an older leftover draft over a newer final or draft.
  const weeks = (data ?? []) as Week[];
  return [...weeks].sort((a, b) =>
    a.season_year !== b.season_year ? b.season_year - a.season_year : b.week_number - a.week_number,
  );
}

/** Every week for the household (same cache as useCurrentWeek). */
export function useHouseholdWeeks(householdId?: string) {
  return useQuery({
    queryKey: ["current-week", householdId],
    enabled: !!householdId,
    queryFn: () => fetchHouseholdWeeks(householdId!),
  });
}

/** Active week: latest open/locked; else newest week overall (never older draft over newer final). */
export function useCurrentWeek(householdId?: string) {
  return useQuery({
    queryKey: ["current-week", householdId],
    enabled: !!householdId,
    queryFn: () => fetchHouseholdWeeks(householdId!),
    select: (weeks) => selectActiveWeek(weeks),
  });
}

export function useWeekGames(weekId?: string) {
  return useQuery({
    queryKey: ["games", weekId],
    enabled: !!weekId,
    queryFn: async (): Promise<Game[]> => {
      const { data, error } = await anyDb
        .from("games")
        .select("*")
        .eq("week_id", weekId)
        .order("kickoff_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Game[];
    },
  });
}

export function useWeekEvents(weekId?: string) {
  return useQuery({
    queryKey: ["events", weekId],
    enabled: !!weekId,
    queryFn: async (): Promise<WeekEvent[]> => {
      const { data, error } = await anyDb
        .from("events")
        .select("*")
        .eq("week_id", weekId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WeekEvent[];
    },
  });
}

export function useWeekCards(weekId?: string) {
  return useQuery({
    queryKey: ["cards", weekId],
    enabled: !!weekId,
    queryFn: async (): Promise<CardRow[]> => {
      let { data, error } = await anyDb.from("cards").select(CARD_SCORES_SELECT).eq("week_id", weekId);
      if (missingFirstLineAt(error)) {
        ({ data, error } = await anyDb.from("cards").select(CARD_SCORES_SELECT_FALLBACK).eq("week_id", weekId));
      }
      if (error) throw error;
      return ((data ?? []) as any[]).map((c) => {
        const raw = Array.isArray(c.weekly_scores) ? (c.weekly_scores[0] ?? null) : c.weekly_scores;
        return {
          ...c,
          weekly_scores: raw
            ? { ...raw, first_line_at: raw.first_line_at ?? null }
            : null,
        };
      }) as CardRow[];
    },
  });
}

export type AutopilotLogRow = {
  id: string;
  week_id: string | null;
  action: string;
  detail: string | null;
  status: string;
  created_at: string;
};

/** Recent autopilot activity for the household's status line. */
export function useAutopilotLog(householdId?: string) {
  return useQuery({
    queryKey: ["autopilot-log", householdId],
    enabled: !!householdId,
    refetchInterval: 60000,
    queryFn: async (): Promise<AutopilotLogRow[]> => {
      const { data, error } = await anyDb
        .from("autopilot_log")
        .select("id, week_id, action, detail, status, created_at")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as AutopilotLogRow[];
    },
  });
}

export type { SeasonHistoryRow, SeasonRow };

/** Season totals built from finalized weeks. */
export function useSeason(householdId?: string, seasonYear?: number) {
  return useQuery({
    queryKey: ["season", householdId, seasonYear],
    enabled: !!householdId,
    queryFn: async () => {
      const { data: weeks, error: wErr } = await anyDb
        .from("weeks")
        .select("id, week_number, season_year, status")
        .eq("household_id", householdId)
        .eq("status", "final");
      if (wErr) throw wErr;
      const list = regularSeasonWeeks((weeks ?? []) as SeasonWeekInput[], seasonYear);
      if (list.length === 0) return { rows: [] as SeasonRow[], history: [] as SeasonHistoryRow[] };

      const weekIds = list.map((w) => w.id);
      let { data: cards, error: cErr } = await anyDb.from("cards").select(SEASON_CARD_SELECT).in("week_id", weekIds);
      if (missingFirstLineAt(cErr)) {
        ({ data: cards, error: cErr } = await anyDb
          .from("cards")
          .select(SEASON_CARD_SELECT_FALLBACK)
          .in("week_id", weekIds));
      }
      if (cErr) throw cErr;

      return buildSeasonStandings(list, (cards ?? []) as SeasonCardInput[]);
    },
  });
}

export { anyDb as db };
