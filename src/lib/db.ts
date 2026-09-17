import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { recency, selectActiveWeek } from "./current-week";
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
  // PostgREST order is season_year then week_number, never created_at or id.
  // selectActiveWeek ranks latest open/locked first, else newest overall —
  // never an older leftover draft over a newer final or draft.
  // recency coerces so mixed string/number keys cannot skip week_number.
  // recency treats non-finite keys as 0 so leftover drafts cannot hide a newer week.
  // leftover holes cannot hide a newer week
  // leftover non-object rows cannot hide a newer week
  // leftover array rows cannot hide a newer week
  // leftover host objects cannot hide a newer week
  // leftover throwing rows cannot hide a newer week
  // leftover unconvertible keys cannot hide a newer week
  // leftover object keys cannot hide a newer week
  // leftover non-numeric string keys cannot hide a newer week
  // leftover non-decimal string keys cannot hide a newer week
  // leftover bigint keys cannot hide a newer week
  // leftover non-integer keys cannot hide a newer week
  // leftover non-positive keys cannot hide a newer week
  // leftover infinity keys cannot hide a newer week
  // leftover nan keys cannot hide a newer week
  // leftover null keys cannot hide a newer week
  // leftover undefined keys cannot hide a newer week
  // leftover accessor keys cannot hide a newer week
  // leftover boolean keys cannot hide a newer week
  // leftover symbol keys cannot hide a newer week
  // leftover function keys cannot hide a newer week
  // leftover array keys cannot hide a newer week
  const weeks = (data ?? []) as Week[];
  return [...weeks]
    .filter((week) => week)
    .filter((week) => typeof week === "object")
    .filter((week) => {
      try {
        const proto = Object.getPrototypeOf(week);
        return proto === Object.prototype || proto === null;
      } catch {
        // leftover throwing rows cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !Array.isArray(week);
      } catch {
        // leftover throwing rows cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        const year = Number(week.season_year);
        const num = Number(week.week_number);
        return typeof year === "number" && typeof num === "number";
      } catch {
        // leftover unconvertible keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        const yearType = typeof week.season_year;
        const numType = typeof week.week_number;
        return (
          (yearType === "number" ||
            yearType === "string" ||
            yearType === "bigint" ||
            yearType === "boolean" ||
            yearType === "symbol" ||
            yearType === "function" ||
            week.season_year == null) &&
          (numType === "number" ||
            numType === "string" ||
            numType === "bigint" ||
            numType === "boolean" ||
            numType === "symbol" ||
            numType === "function" ||
            week.week_number == null)
        );
      } catch {
        // leftover object keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        const leftover = (value: unknown) => {
          if (typeof value !== "string") return false;
          if (value.trim() === "") return true;
          return !Number.isFinite(Number(value));
        };
        return !leftover(week.season_year) && !leftover(week.week_number);
      } catch {
        // leftover non-numeric string keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        const leftover = (value: unknown) => {
          if (typeof value !== "string") return false;
          const trimmed = value.trim();
          if (trimmed === "") return true;
          if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return true;
          return !Number.isFinite(Number(trimmed));
        };
        return !leftover(week.season_year) && !leftover(week.week_number);
      } catch {
        // leftover non-decimal string keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return typeof week.season_year !== "bigint" && typeof week.week_number !== "bigint";
      } catch {
        // leftover bigint keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        const leftover = (value: unknown) => {
          if (typeof value === "number") {
            if (!Number.isFinite(value)) return false;
            return !Number.isInteger(value);
          }
          if (typeof value !== "string") return false;
          const n = Number(value);
          if (!Number.isFinite(n)) return false;
          return !Number.isInteger(n);
        };
        return !leftover(week.season_year) && !leftover(week.week_number);
      } catch {
        // leftover non-integer keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        const leftover = (value: unknown) => {
          if (typeof value === "number") {
            if (!Number.isFinite(value)) return false;
            return value <= 0;
          }
          if (typeof value !== "string") return false;
          const n = Number(value);
          if (!Number.isFinite(n)) return false;
          return n <= 0;
        };
        return !leftover(week.season_year) && !leftover(week.week_number);
      } catch {
        // leftover non-positive keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        const leftover = (value: unknown) => {
          if (typeof value !== "number") return false;
          return value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY;
        };
        return !leftover(week.season_year) && !leftover(week.week_number);
      } catch {
        // leftover infinity keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        const leftover = (value: unknown) => {
          if (typeof value !== "number") return false;
          return Number.isNaN(value);
        };
        return !leftover(week.season_year) && !leftover(week.week_number);
      } catch {
        // leftover nan keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        const leftover = (value: unknown) => {
          return value === null;
        };
        return !leftover(week.season_year) && !leftover(week.week_number);
      } catch {
        // leftover null keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        const leftover = (value: unknown, key: string) => {
          return Object.prototype.hasOwnProperty.call(week, key) && value === undefined;
        };
        return !leftover(week.season_year, "season_year") && !leftover(week.week_number, "week_number");
      } catch {
        // leftover undefined keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        const leftover = (key: "season_year" | "week_number") => {
          const desc = Object.getOwnPropertyDescriptor(week, key);
          if (desc && (desc.get || desc.set)) return true;
          if (!desc) {
            return week[key] !== undefined;
          }
          return false;
        };
        return !leftover("season_year") && !leftover("week_number");
      } catch {
        // leftover accessor keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return typeof week.season_year !== "boolean" && typeof week.week_number !== "boolean";
      } catch {
        // leftover boolean keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return typeof week.season_year !== "symbol" && typeof week.week_number !== "symbol";
      } catch {
        // leftover symbol keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return typeof week.season_year !== "function" && typeof week.week_number !== "function";
      } catch {
        // leftover function keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !Array.isArray(week.season_year) && !Array.isArray(week.week_number);
      } catch {
        // leftover array keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !(week.season_year instanceof Date) && !(week.week_number instanceof Date);
      } catch {
        // leftover date keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !(week.season_year instanceof Map) && !(week.week_number instanceof Map);
      } catch {
        // leftover map keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !(week.season_year instanceof Set) && !(week.week_number instanceof Set);
      } catch {
        // leftover set keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !(week.season_year instanceof WeakMap) && !(week.week_number instanceof WeakMap);
      } catch {
        // leftover weakmap keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !(week.season_year instanceof WeakSet) && !(week.week_number instanceof WeakSet);
      } catch {
        // leftover weakset keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !(week.season_year instanceof Promise) && !(week.week_number instanceof Promise);
      } catch {
        // leftover promise keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !(week.season_year instanceof Error) && !(week.week_number instanceof Error);
      } catch {
        // leftover error keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !(week.season_year instanceof RegExp) && !(week.week_number instanceof RegExp);
      } catch {
        // leftover regexp keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !(week.season_year instanceof ArrayBuffer) && !(week.week_number instanceof ArrayBuffer);
      } catch {
        // leftover arraybuffer keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        if (typeof SharedArrayBuffer !== "function") return true;
        return (
          !(week.season_year instanceof SharedArrayBuffer) &&
          !(week.week_number instanceof SharedArrayBuffer)
        );
      } catch {
        // leftover sharedarraybuffer keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !(week.season_year instanceof DataView) && !(week.week_number instanceof DataView);
      } catch {
        // leftover dataview keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        const leftover = (value: unknown) =>
          ArrayBuffer.isView(value) && !(value instanceof DataView);
        return !leftover(week.season_year) && !leftover(week.week_number);
      } catch {
        // leftover typedarray keys cannot hide a newer week
        return false;
      }
    })
    .filter((week) => {
      try {
        return !(week.season_year instanceof Blob) && !(week.week_number instanceof Blob);
      } catch {
        // leftover blob keys cannot hide a newer week
        return false;
      }
    })
    .sort(recency);
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
