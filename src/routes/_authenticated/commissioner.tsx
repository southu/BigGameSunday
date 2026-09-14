import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Plus, Sparkles, Star, Trash2, X } from "lucide-react";
import { AppShell, PageTitle } from "@/components/bgs/AppShell";
import { autoFillWeek, ensureAutoWeek } from "@/lib/autofill.functions";
import { recomputeWeek, runAutopilotNow } from "@/lib/autopilot.functions";
import { nextStepFor } from "@/lib/autopilot-schedule";
import { pickViewWeek, weekSwitcherLabel } from "@/lib/current-week";
import { db, useAutopilotLog, useHouseholdWeeks, useWeekCards, useWeekEvents, useWeekGames } from "@/lib/db";
import { useProfile } from "@/lib/profile";
import {
  NFL_TEAMS,
  fromLocalInput,
  nextSundayKickoff,
  standardEvents,
  toLocalInput,
  weekLongshotRows,
} from "@/lib/nfl";
import { cn } from "@/lib/utils";
import { formatKick } from "./week";

export const Route = createFileRoute("/_authenticated/commissioner")({
  validateSearch: (search: Record<string, unknown>) => ({
    week: typeof search.week === "string" && search.week.length > 0 ? search.week : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Commissioner Panel — Big Game Sunday" },
      {
        name: "description",
        content:
          "Create the week in one tap, add games with smart defaults, call results on Sunday, and finalize to crown a winner.",
      },
      { property: "og:title", content: "Commissioner Panel — Big Game Sunday" },
      {
        property: "og:description",
        content: "Set up the week, call Sunday's results, and finalize the scores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Commissioner,
});

function formatStamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_FLOW = ["draft", "open", "locked", "final"] as const;
const NEXT_LABEL: Record<string, string> = {
  draft: "Open cards for the family",
  open: "Lock the cards now",
  locked: "Finalize the week 🏆",
};

function Commissioner() {
  const { household, week: activeWeek, profiles, activePlayer } = useProfile();
  const { week: requestedWeek } = Route.useSearch();
  const navigate = useNavigate();
  const weeksQ = useHouseholdWeeks(household?.id);
  const weeks = weeksQ.data ?? [];
  const [viewWeekId, setViewWeekIdState] = useState<string | null>(null);

  function setViewWeekId(id: string | null) {
    setViewWeekIdState(id);
    const w = id
      ? (weeks.find((x) => x.id === id) ?? (activeWeek?.id === id ? activeWeek : null))
      : null;
    const label = w && activeWeek ? weekSwitcherLabel(w, activeWeek) : "";
    const search =
      !id || id === activeWeek?.id || label === "This Sunday"
        ? {}
        : label === "Next week"
          ? { week: "next" }
          : { week: id };
    void navigate({ to: "/commissioner", search, replace: true });
  }

  const requested = useMemo(() => {
    if (viewWeekId && (!weeksQ.isSuccess || weeks.some((w) => w.id === viewWeekId))) {
      return viewWeekId;
    }
    return requestedWeek ?? null;
  }, [viewWeekId, weeks, weeksQ.isSuccess, requestedWeek]);

  const week = useMemo(
    () => pickViewWeek(weeks, activeWeek ?? null, requested),
    [weeks, activeWeek, requested],
  );

  useEffect(() => {
    if (!viewWeekId) return;
    if (weeksQ.isSuccess && !weeks.some((w) => w.id === viewWeekId)) {
      setViewWeekIdState(null);
    }
  }, [viewWeekId, weeks, weeksQ.isSuccess]);

  const queryClient = useQueryClient();
  const gamesQ = useWeekGames(week?.id);
  const eventsQ = useWeekEvents(week?.id);
  const cardsQ = useWeekCards(week?.id);
  const logQ = useAutopilotLog(household?.id);

  const games = gamesQ.data ?? [];
  const events = eventsQ.data ?? [];
  const cards = cardsQ.data ?? [];

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showWeekDefaults, setShowWeekDefaults] = useState(false);

  const defaultKick = useMemo(() => nextSundayKickoff(), []);
  const nextWeekNumber = (week?.week_number ?? 0) + 1;

  const [draft, setDraft] = useState({
    week_number: String(nextWeekNumber),
    season_year: String(new Date().getFullYear()),
    lock_at: toLocalInput(defaultKick),
  });

  const [game, setGame] = useState({
    away_team: "",
    home_team: "",
    kickoff_at: toLocalInput(defaultKick),
    underdog_team: "",
    upset_size: "3",
  });

  const [ev, setEv] = useState({
    description: "",
    game_id: "",
    is_longshot: false,
    resolution_source: "manual" as "manual" | "auto_score",
  });

  async function refresh(keys: string[][]) {
    for (const key of keys) await queryClient.invalidateQueries({ queryKey: key });
  }

  async function run(fn: () => Promise<void | string>, msg: string) {
    setBusy(true);
    setNotice(null);
    try {
      const custom = await fn();
      setNotice(typeof custom === "string" ? custom : msg);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const runAutoFill = useServerFn(autoFillWeek);
  const runEnsureWeek = useServerFn(ensureAutoWeek);
  const runRecompute = useServerFn(recomputeWeek);
  const runAutopilot = useServerFn(runAutopilotNow);
  const autoCheckedRef = useRef(false);

  async function insertWeek() {
    if (!household) throw new Error("No household yet.");
    const { data, error } = await db
      .from("weeks")
      .insert({
        household_id: household.id,
        season_year: Number(draft.season_year) || new Date().getFullYear(),
        week_number: Number(draft.week_number) || 1,
        lock_at: fromLocalInput(draft.lock_at),
        status: "draft",
      })
      .select("id")
      .single();
    if (error) throw error;
    const id = data.id as string;
    await refresh([["current-week", household.id]]);
    setViewWeekId(id);
    return id;
  }

  const createWeek = () =>
    run(async () => {
      await insertWeek();
    }, "Week created — add a few games next.");

  /** Default path: create the week and pull the real NFL schedule into it. */
  const createWeekAutoFilled = () =>
    run(async () => {
      const weekId = await insertWeek();
      const res = await runAutoFill({ data: { weekId } });
      await refresh([
        ["games", weekId],
        ["events", weekId],
        ["current-week", household!.id],
      ]);
      return `Auto-filled ${res.gamesAdded} games and ${res.momentsAdded} moments, including this week's longshots${
        res.needsReview ? ` · ${res.needsReview} need a quick review (underdog not set yet)` : ""
      }.`;
    }, "Week auto-filled.");

  const autoFillExistingWeek = () =>
    run(async () => {
      if (!week) throw new Error("Create a week first.");
      const res = await runAutoFill({ data: { weekId: week.id } });
      await refresh([
        ["games", week.id],
        ["events", week.id],
        ["current-week", household!.id],
      ]);
      if (res.gamesAdded) {
        return `Added ${res.gamesAdded} games and ${res.momentsAdded} moments, including this week's longshots${
          res.skipped ? ` · skipped ${res.skipped} already on the list` : ""
        }${res.needsReview ? ` · ${res.needsReview} need a quick review (underdog not set yet)` : ""}.`;
      }
      if (res.momentsAdded) {
        return `This week's longshot list is on the board (${res.momentsAdded}) — cards can lock.`;
      }
      return "Every game from that NFL week is already on your list.";
    }, "Auto-fill done.");

  const toggleAutoCreate = (on: boolean) =>
    run(
      async () => {
        const { error } = await db
          .from("households")
          .update({ auto_create_weeks: on })
          .eq("id", household!.id);
        if (error) throw error;
        await refresh([["household"]]);
      },
      on ? "Weeks will auto-create 4 days before kickoff." : "Auto-create is off.",
    );

  // With auto-create on, quietly build next week's draft once it's within 4 days of kickoff.
  useEffect(() => {
    if (!household?.auto_create_weeks || autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void (async () => {
      try {
        const res = await runEnsureWeek({ data: { householdId: household.id } });
        if (res.created) {
          await queryClient.invalidateQueries({ queryKey: ["current-week", household.id] });
          setNotice(
            `Week ${res.weekNumber} auto-created and filled — switch to Next week to review and open it.`,
          );
        }
      } catch {
        /* auto-create is best effort; manual creation still works */
      }
    })();
  }, [household?.id, household?.auto_create_weeks]);


  /** Keep the lock time on the earliest kickoff unless the Commissioner set it by hand. */
  async function syncLock(allKickoffs: (string | null)[]) {
    if (!week || week.lock_at_override) return;
    const times = allKickoffs.filter(Boolean).map((k) => new Date(k as string).getTime());
    if (!times.length) return;
    const earliest = new Date(Math.min(...times)).toISOString();
    if (earliest === week.lock_at) return;
    await db.from("weeks").update({ lock_at: earliest }).eq("id", week.id);
    await refresh([["current-week", household!.id]]);
  }

  /** Any hands-on edit stops autopilot from auto-opening this draft behind your back. */
  async function touchWeek() {
    if (!week) return;
    await db
      .from("weeks")
      .update({ commissioner_edited_at: new Date().toISOString() })
      .eq("id", week.id);
    await refresh([["current-week", household!.id]]);
  }

  /** After a correction on a finalized week, rebuild scores + standings. */
  async function recomputeIfFinal() {
    if (week?.status !== "final") return null;
    await runRecompute({ data: { weekId: week.id } });
    await refresh([
      ["cards", week.id],
      ["season", household!.id],
    ]);
    return "Correction saved — scores and standings recomputed.";
  }


  const addGame = () =>
    run(async () => {
      if (!week) throw new Error("Create a week first.");
      if (!game.away_team || !game.home_team) throw new Error("Pick both teams.");
      if (game.away_team === game.home_team) throw new Error("Pick two different teams.");
      const upsetSize = Number(game.upset_size) || 0;
      const underdog = game.underdog_team || game.away_team;
      const kickoff = fromLocalInput(game.kickoff_at);

      const { data, error } = await db
        .from("games")
        .insert({
          week_id: week.id,
          household_id: household!.id,
          away_team: game.away_team,
          home_team: game.home_team,
          kickoff_at: kickoff,
          underdog_team: underdog,
          upset_size: upsetSize,
        })
        .select("id")
        .single();
      if (error) throw error;

      const descriptions = standardEvents({
        home_team: game.home_team,
        away_team: game.away_team,
        underdog_team: underdog,
        upset_size: upsetSize,
      });
      const longshots = weekLongshotRows(
        { id: week.id, household_id: household!.id },
        events.map((e) => e.description),
      );
      const { error: eErr } = await db.from("events").insert([
        ...descriptions.map((description) => ({
          week_id: week.id,
          household_id: household!.id,
          game_id: data.id,
          description,
          is_longshot: false,
          resolution_source: "auto_score" as const,
        })),
        ...longshots,
      ]);
      if (eErr) throw eErr;

      if (!week.featured_game_id) {
        await db.from("weeks").update({ featured_game_id: data.id }).eq("id", week.id);
      }

      setGame({
        away_team: "",
        home_team: "",
        kickoff_at: toLocalInput(defaultKick),
        underdog_team: "",
        upset_size: "3",
      });
      await refresh([["games", week.id], ["events", week.id], ["current-week", household!.id]]);
      await syncLock([...games.map((g) => g.kickoff_at), kickoff]);
      await touchWeek();
    }, "Game added with ready-made moments and this week's longshots.");

  const deleteGame = (gameId: string) =>
    run(async () => {
      await db.from("events").delete().eq("game_id", gameId);
      const { error } = await db.from("games").delete().eq("id", gameId);
      if (error) throw error;
      await refresh([["games", week!.id], ["events", week!.id], ["current-week", household!.id]]);
      await syncLock(games.filter((g) => g.id !== gameId).map((g) => g.kickoff_at));
      await touchWeek();
    }, "Game removed.");

  const updateGame = (gameId: string, patch: Record<string, unknown>) =>
    run(async () => {
      const { error } = await db.from("games").update(patch).eq("id", gameId);
      if (error) throw error;
      await refresh([["games", week!.id]]);
      if ("kickoff_at" in patch) {
        await syncLock(
          games.map((g) => (g.id === gameId ? (patch["kickoff_at"] as string | null) : g.kickoff_at)),
        );
      }
      await touchWeek();
    }, "Game updated.");

  const setLockManually = (value: string) =>
    run(async () => {
      const { error } = await db
        .from("weeks")
        .update({ lock_at: fromLocalInput(value), lock_at_override: true })
        .eq("id", week!.id);
      if (error) throw error;
      await refresh([["current-week", household!.id]]);
    }, "Lock time set by hand — it won't auto-sync now.");

  const resumeAutoLock = () =>
    run(async () => {
      const { error } = await db
        .from("weeks")
        .update({ lock_at_override: false })
        .eq("id", week!.id);
      if (error) throw error;
      await refresh([["current-week", household!.id]]);
      await syncLock(games.map((g) => g.kickoff_at));
    }, "Back to auto lock at the earliest kickoff.");

  const addEvent = () =>
    run(async () => {
      if (!week) throw new Error("Create a week first.");
      if (!ev.description.trim()) throw new Error("Describe the moment.");
      const { error } = await db.from("events").insert({
        week_id: week.id,
        household_id: household!.id,
        game_id: ev.game_id || null,
        description: ev.description.trim(),
        is_longshot: ev.is_longshot,
        resolution_source: ev.resolution_source,
      });
      if (error) throw error;
      setEv({ ...ev, description: "", is_longshot: false });
      await refresh([["events", week.id]]);
      await touchWeek();
    }, "Moment added to the list.");

  const updateEvent = (id: string, patch: Record<string, unknown>) =>
    run(async () => {
      const { error } = await db.from("events").update(patch).eq("id", id);
      if (error) throw error;
      await refresh([["events", week!.id]]);
      await touchWeek();
    }, "Moment updated.");

  const deleteEvent = (id: string) =>
    run(async () => {
      const { error } = await db.from("events").delete().eq("id", id);
      if (error) throw error;
      await refresh([["events", week!.id]]);
      await touchWeek();
    }, "Moment removed.");

  const mark = (id: string, result: "hit" | "miss" | null) =>
    run(async () => {
      const { error } = await db
        .from("events")
        .update({ result, resolved_at: result ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw error;
      await refresh([["events", week!.id]]);
      return (await recomputeIfFinal()) ?? undefined;
    }, "Result saved.");

  const markUpset = (gameId: string, won: boolean) =>
    run(
      async () => {
        const { error } = await db.from("games").update({ upset_won: won }).eq("id", gameId);
        if (error) throw error;
        await refresh([["games", week!.id]]);
        return (await recomputeIfFinal()) ?? undefined;
      },
      won ? "Upset recorded!" : "Upset cleared.",
    );

  const setFeatured = (gameId: string) =>
    run(async () => {
      const { error } = await db
        .from("weeks")
        .update({ featured_game_id: gameId })
        .eq("id", week!.id);
      if (error) throw error;
      await refresh([["current-week", household!.id]]);
    }, "Big Game of the Week set.");

  const setStatus = (status: string) =>
    run(async () => {
      const patch: Record<string, unknown> = { status };
      const { error } = await db.from("weeks").update(patch).eq("id", week!.id);
      if (error) throw error;
      if (status === "locked") {
        const now = new Date().toISOString();
        await db.from("cards").update({ locked_at: now }).eq("week_id", week!.id);
        await refresh([["cards", week!.id]]);
      }
      await refresh([["current-week", household!.id]]);
    }, "Week status updated.");

  const finalize = () =>
    run(async () => {
      if (!week) throw new Error("No week to finalize.");
      const out = await runRecompute({ data: { weekId: week.id, finalize: true } });
      await refresh([
        ["events", week.id],
        ["cards", week.id],
        ["current-week", household!.id],
        ["season", household!.id],
        ["autopilot-log", household!.id],
      ]);
      return out.missedManual
        ? `Week finalized — ${out.missedManual} uncalled moments counted as misses. Head to the Reveal!`
        : "Week finalized — head to the Reveal!";
    }, "Week finalized — head to the Reveal!");

  const toggleHold = (on: boolean) =>
    run(
      async () => {
        const { error } = await db
          .from("weeks")
          .update({ autopilot_hold: on })
          .eq("id", week!.id);
        if (error) throw error;
        await refresh([["current-week", household!.id]]);
      },
      on ? "Autopilot paused for this week — you're driving." : "Autopilot back on for this week.",
    );

  const runAutopilotPass = () =>
    run(async () => {
      const res = await runAutopilot({ data: { householdId: household!.id } });
      await refresh([
        ["current-week", household!.id],
        ["games", week?.id ?? ""],
        ["events", week?.id ?? ""],
        ["cards", week?.id ?? ""],
        ["season", household!.id],
        ["autopilot-log", household!.id],
      ]);
      return res.actions.length
        ? res.actions.map((a) => a.detail).join(" · ")
        : "Autopilot checked in — nothing to do just yet.";
    }, "Autopilot ran.");


  if (!activePlayer?.is_commissioner) {
    return (
      <AppShell>
        <PageTitle
          emoji="🛡️"
          title="Commissioner Panel"
          subtitle="This one's just for the Commissioner."
        />
        <p className="rounded-4xl border-2 border-border bg-card p-6 text-lg font-bold shadow-soft">
          Only the household Commissioner can set up the week and call results. Switch to the
          Commissioner profile up top to get in here.
        </p>
      </AppShell>
    );
  }

  const logs = logQ.data ?? [];
  const lastLog = logs[0] ?? null;
  const autopilotWarning = logs.find((l) => l.status === "error") ?? null;
  const nextStep = week
    ? nextStepFor(week)
    : { label: "Create or auto-fill a week to start", at: null };

  const needsCall = events.filter((e) => e.result === null);
  const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(week?.status ?? "draft") + 1];

  return (
    <AppShell>
      <PageTitle
        emoji="🛡️"
        title="Commissioner Panel"
        subtitle={
          week
            ? `Week ${week.week_number} · ${week.status} · ${cards.length} cards`
            : "One tap and this week is ready to go."
        }
      />

      {weeks.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Week to manage">
          {[...weeks]
            .sort((a, b) => a.season_year - b.season_year || a.week_number - b.week_number)
            .map((w) => {
              const selected = week?.id === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setViewWeekId(w.id)}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-bold",
                    selected ? "bg-gold text-gold-foreground" : "bg-secondary",
                  )}
                >
                  {weekSwitcherLabel(w, activeWeek)}
                  <span className="ml-1 font-normal opacity-70">· {w.status}</span>
                </button>
              );
            })}
        </div>
      )}

      {notice && (
        <p className="mb-4 rounded-2xl bg-secondary px-4 py-3 text-sm font-bold">{notice}</p>
      )}

      {!week && (
        <Panel title="Create the week">
          <p className="text-sm text-muted-foreground">
            We'll call it Week {draft.week_number} of {draft.season_year}, pull in every real NFL
            game for that week with kickoff times and underdogs, add the three ready-made moments to
            each one, and add this week's longshot list. You can change anything afterwards.
          </p>
          <Action onClick={createWeekAutoFilled} disabled={busy}>
            <Sparkles className="h-4 w-4" /> Auto-fill this week
          </Action>
          <button onClick={createWeek} disabled={busy} className="ml-3 text-sm font-bold underline">
            Create an empty week instead
          </button>
          <button
            onClick={() => setShowWeekDefaults((v) => !v)}
            className="ml-3 text-sm font-bold underline"
          >
            {showWeekDefaults ? "Hide details" : "Tweak the details"}
          </button>

          {showWeekDefaults && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Field label="Week number">
                <input
                  value={draft.week_number}
                  onChange={(e) => setDraft({ ...draft, week_number: e.target.value })}
                  inputMode="numeric"
                  className={inputCls}
                />
              </Field>
              <Field label="Season">
                <input
                  value={draft.season_year}
                  onChange={(e) => setDraft({ ...draft, season_year: e.target.value })}
                  inputMode="numeric"
                  className={inputCls}
                />
              </Field>
              <Field label="Cards lock at">
                <input
                  type="datetime-local"
                  value={draft.lock_at}
                  onChange={(e) => setDraft({ ...draft, lock_at: e.target.value })}
                  className={inputCls}
                />
              </Field>
            </div>
          )}
        </Panel>
      )}

      {week && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Week status" className="lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              {STATUS_FLOW.map((s, i) => (
                <span key={s} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-4 py-2 text-sm font-bold capitalize",
                      week.status === s ? "bg-gold text-gold-foreground" : "bg-secondary",
                    )}
                  >
                    {s}
                  </span>
                  {i < STATUS_FLOW.length - 1 && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
              ))}
            </div>
            {nextStatus && (
              <Action
                onClick={() => (nextStatus === "final" ? finalize() : setStatus(nextStatus))}
                disabled={busy || (nextStatus === "final" && events.length === 0)}
              >
                {NEXT_LABEL[week.status] ?? "Next step"}
              </Action>
            )}
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <Field label="Cards lock at">
                <input
                  type="datetime-local"
                  value={toLocalInput(week.lock_at)}
                  onChange={(e) => setLockManually(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <p className="min-w-40 flex-1 text-xs font-bold text-muted-foreground">
                {week.lock_at_override ? (
                  <>
                    Set by hand.{" "}
                    <button onClick={resumeAutoLock} className="underline">
                      Use earliest kickoff instead
                    </button>
                  </>
                ) : (
                  "Auto-synced to the earliest kickoff."
                )}
              </p>
            </div>
          </Panel>

          <Panel title="Auto-pilot" className="lg:col-span-2">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-3 font-bold">
                <input
                  type="checkbox"
                  checked={!!household?.auto_create_weeks}
                  onChange={(e) => toggleAutoCreate(e.target.checked)}
                  disabled={busy}
                  className="h-6 w-6"
                />
                Auto-create each week
              </label>
              <p className="min-w-40 flex-1 text-xs font-bold text-muted-foreground">
                Next week builds itself in draft with the real games filled in, 4 days before the
                first kickoff. Your job: review → adjust → open.
              </p>
              <label className="flex items-center gap-3 font-bold">
                <input
                  type="checkbox"
                  checked={!!week.autopilot_hold}
                  onChange={(e) => toggleHold(e.target.checked)}
                  disabled={busy}
                  className="h-6 w-6"
                />
                Hold this week
              </label>
            </div>

            <div className="mt-4 rounded-2xl bg-background px-4 py-3">
              <p className="text-sm font-bold">
                Last: {lastLog ? lastLog.detail : "nothing yet — autopilot is standing by."}
                {lastLog && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    ({formatStamp(lastLog.created_at)})
                  </span>
                )}
              </p>
              <p className="mt-1 text-sm font-bold">
                Next: {nextStep.label}
                {nextStep.at && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    ({formatStamp(nextStep.at)})
                  </span>
                )}
              </p>
              {autopilotWarning && (
                <p className="mt-2 rounded-xl bg-gold/20 px-3 py-2 text-sm font-bold">
                  ⚠️ {autopilotWarning.detail} It retries every hour — you can always call results by
                  hand below.
                </p>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Action onClick={autoFillExistingWeek} disabled={busy}>
                <Sparkles className="h-4 w-4" /> Auto-fill this week
              </Action>
              <Action onClick={runAutopilotPass} disabled={busy}>
                <Check className="h-4 w-4" /> Run autopilot now
              </Action>
            </div>
            <p className="mt-2 text-xs font-bold text-muted-foreground">
              Cards lock by the clock at {formatKick(week.lock_at)} and the week finalizes itself
              Tuesday at 6:00 AM Eastern — no buttons required.
            </p>
          </Panel>


          <Panel title="Games">
            <ul className="space-y-2">
              {games.map((g) => (
                <li key={g.id} className="rounded-2xl bg-background px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">
                        {g.away_team} at {g.home_team}
                        {g.needs_review && (
                          <span className="ml-2 rounded-full bg-gold px-2 py-0.5 align-middle text-[10px] uppercase text-gold-foreground">
                            check underdog
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatKick(g.kickoff_at)} · underdog {g.underdog_team} (+{g.upset_size})
                      </span>
                    </span>

                    <button
                      onClick={() => markUpset(g.id, !g.upset_won)}
                      className={cn(
                        "tap-target rounded-full px-3 py-2 text-xs font-bold",
                        g.upset_won ? "bg-berry text-cream" : "bg-secondary",
                      )}
                    >
                      Upset!
                    </button>
                    <button
                      onClick={() => setFeatured(g.id)}
                      aria-label="Make Big Game of the Week"
                      className={cn(
                        "tap-target grid w-11 place-items-center rounded-2xl",
                        week.featured_game_id === g.id
                          ? "bg-gold text-gold-foreground"
                          : "bg-secondary",
                      )}
                    >
                      <Star className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => deleteGame(g.id)}
                      aria-label="Remove game"
                      className="tap-target grid w-11 place-items-center rounded-2xl bg-secondary"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <select
                      value={g.underdog_team ?? g.away_team}
                      onChange={(e) => updateGame(g.id, { underdog_team: e.target.value, needs_review: false })}
                      className={smallInputCls}
                    >
                      <option value={g.away_team}>Underdog: {g.away_team}</option>
                      <option value={g.home_team}>Underdog: {g.home_team}</option>
                    </select>
                    <input
                      value={String(g.upset_size)}
                      onChange={(e) => updateGame(g.id, { upset_size: Number(e.target.value) || 0, needs_review: false })}
                      inputMode="decimal"
                      aria-label="Upset size"
                      className={smallInputCls}
                    />
                    <input
                      type="datetime-local"
                      value={toLocalInput(g.kickoff_at)}
                      onChange={(e) => updateGame(g.id, { kickoff_at: fromLocalInput(e.target.value) })}
                      aria-label="Kickoff"
                      className={smallInputCls}
                    />
                  </div>
                </li>
              ))}
              {games.length === 0 && <li className="text-sm text-muted-foreground">No games yet.</li>}
            </ul>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <TeamSelect
                label="Away team"
                value={game.away_team}
                onChange={(v) => setGame({ ...game, away_team: v })}
              />
              <TeamSelect
                label="Home team"
                value={game.home_team}
                onChange={(v) => setGame({ ...game, home_team: v })}
              />
              <select
                value={game.underdog_team}
                onChange={(e) => setGame({ ...game, underdog_team: e.target.value })}
                className={inputCls}
              >
                <option value="">Underdog: away team{game.away_team && ` (${game.away_team})`}</option>
                {game.home_team && <option value={game.home_team}>Underdog: {game.home_team}</option>}
              </select>
              <input
                value={game.upset_size}
                onChange={(e) => setGame({ ...game, upset_size: e.target.value })}
                aria-label="Upset size"
                inputMode="decimal"
                className={inputCls}
              />
              <input
                type="datetime-local"
                value={game.kickoff_at}
                onChange={(e) => setGame({ ...game, kickoff_at: e.target.value })}
                aria-label="Kickoff"
                className={cn(inputCls, "sm:col-span-2")}
              />
            </div>
            <Action onClick={addGame} disabled={busy}>
              <Plus className="h-4 w-4" /> Add game
            </Action>
            <p className="mt-2 text-xs font-bold text-muted-foreground">
              Adds three ready-made moments plus this week's longshot list (safety, defensive score,
              overtime, 55+ yard field goal). You'll call those on Sunday.
            </p>
          </Panel>

          <Panel title="Add your own moment">
            <div className="grid gap-2">
              <input
                placeholder="e.g. A safety happens on Sunday"
                value={ev.description}
                onChange={(e) => setEv({ ...ev, description: e.target.value })}
                className={inputCls}
              />
              <select
                value={ev.game_id}
                onChange={(e) => setEv({ ...ev, game_id: e.target.value })}
                className={inputCls}
              >
                <option value="">Any game</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.away_team} at {g.home_team}
                  </option>
                ))}
              </select>
              <select
                value={ev.resolution_source}
                onChange={(e) =>
                  setEv({ ...ev, resolution_source: e.target.value as "manual" | "auto_score" })
                }
                className={inputCls}
              >
                <option value="manual">I'll call this one</option>
                <option value="auto_score">Resolves from the score</option>
              </select>
              <label className="flex items-center gap-2 font-bold">
                <input
                  type="checkbox"
                  checked={ev.is_longshot}
                  onChange={(e) => setEv({ ...ev, is_longshot: e.target.checked })}
                  className="h-5 w-5"
                />
                ⭐ Longshot
              </label>
            </div>
            <Action onClick={addEvent} disabled={busy}>
              <Plus className="h-4 w-4" /> Add moment
            </Action>
            <p className="mt-3 text-sm text-muted-foreground">
              {events.length} moments on the list · {events.filter((e) => e.is_longshot).length}{" "}
              longshots
            </p>
          </Panel>

          <Panel title={`Needs your call (${needsCall.length})`} className="lg:col-span-2">
            <ul className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className="rounded-2xl bg-background px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={e.description}
                      onChange={(x) => updateEvent(e.id, { description: x.target.value })}
                      aria-label="Moment description"
                      className="min-w-0 flex-1 rounded-xl bg-transparent px-2 py-1 font-bold outline-none focus:bg-secondary"
                    />
                    <button
                      onClick={() => mark(e.id, "hit")}
                      className={cn(
                        "tap-target inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-bold",
                        e.result === "hit" ? "bg-grass text-grass-foreground" : "bg-secondary",
                      )}
                    >
                      <Check className="h-4 w-4" /> Happened
                    </button>
                    <button
                      onClick={() => mark(e.id, "miss")}
                      className={cn(
                        "tap-target inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-bold",
                        e.result === "miss" ? "bg-navy text-cream" : "bg-secondary",
                      )}
                    >
                      <X className="h-4 w-4" /> Nope
                    </button>
                    {e.result && (
                      <button
                        onClick={() => mark(e.id, null)}
                        className="rounded-full px-3 py-2 text-xs font-bold text-muted-foreground underline"
                      >
                        Undo
                      </button>
                    )}
                    <button
                      onClick={() => deleteEvent(e.id)}
                      aria-label="Remove moment"
                      className="tap-target grid w-11 place-items-center rounded-2xl bg-secondary"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <label className="mt-1 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={e.is_longshot}
                      onChange={(x) => updateEvent(e.id, { is_longshot: x.target.checked })}
                      className="h-4 w-4"
                    />
                    ⭐ Longshot
                  </label>
                </li>
              ))}
              {events.length === 0 && (
                <li className="text-sm text-muted-foreground">Add a game above to fill this list.</li>
              )}
            </ul>
          </Panel>

          <Panel title="Finalize the week" className="lg:col-span-2">
            <p className="text-sm text-muted-foreground">
              Scores every card ({cards.length} in), crowns the weekly winner, and updates the
              season standings. Household: {profiles.length} players.
            </p>
            <Action onClick={finalize} disabled={busy || events.length === 0}>
              Finalize Week {week.week_number} 🏆
            </Action>
          </Panel>
        </div>
      )}
    </AppShell>
  );
}

const inputCls =
  "w-full rounded-2xl border-2 border-input bg-background px-4 py-3 font-bold outline-none focus:border-gold";
const smallInputCls =
  "w-full rounded-xl border-2 border-input bg-card px-3 py-2 text-xs font-bold outline-none focus:border-gold";

function TeamSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
    >
      <option value="">{label}</option>
      {NFL_TEAMS.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-4xl border-2 border-border bg-card p-5 shadow-soft", className)}
    >
      <h2 className="font-display text-2xl">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="min-w-40 flex-1">
      <span className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function Action({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mt-4 inline-flex items-center gap-2 rounded-full bg-navy px-6 py-3 font-display text-lg text-cream shadow-pop disabled:opacity-40"
    >
      {children}
    </button>
  );
}
