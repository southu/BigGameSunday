import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Check, GripVertical, Trash2 } from "lucide-react";
import { AppShell, EmptyWeek, PageTitle } from "@/components/bgs/AppShell";
import { Confetti } from "@/components/bgs/Confetti";
import { db, useWeekCards, useWeekEvents, useWeekGames, type Game, type WeekEvent } from "@/lib/db";
import { useProfile } from "@/lib/profile";
import { cn } from "@/lib/utils";
import { formatKick } from "./week";

export const Route = createFileRoute("/_authenticated/card")({
  head: () => ({
    meta: [
      { title: "Card Builder — Big Game Sunday" },
      {
        name: "description",
        content:
          "Pick 9 moments from this week's list and arrange them on your 3x3 grid, then choose 3 underdogs for Upset Watch.",
      },
      { property: "og:title", content: "Card Builder — Big Game Sunday" },
      {
        property: "og:description",
        content: "Pick 9 moments, arrange your 3x3 grid, and choose 3 underdogs.",
      },
    ],
  }),
  component: CardBuilder,
});

type Filter = "all" | "longshot" | string;

function CardBuilder() {
  const { activePlayer, week, household } = useProfile();
  const queryClient = useQueryClient();
  const eventsQ = useWeekEvents(week?.id);
  const gamesQ = useWeekGames(week?.id);
  const cardsQ = useWeekCards(week?.id);

  const events = eventsQ.data ?? [];
  const games = gamesQ.data ?? [];
  const myCard = (cardsQ.data ?? []).find((c) => c.profile_id === activePlayer?.id) ?? null;
  const locked = !!myCard?.locked_at;

  const [grid, setGrid] = useState<(string | null)[]>(Array(9).fill(null));
  const [upsets, setUpsets] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [held, setHeld] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const next: (string | null)[] = Array(9).fill(null);
    for (const s of myCard?.card_squares ?? []) next[s.grid_position] = s.event_id;
    setGrid(next);
    setUpsets((myCard?.upset_picks ?? []).map((u) => u.game_id));
  }, [myCard?.id, myCard?.card_squares.length, myCard?.upset_picks.length]);

  const eventById = useMemo(() => {
    const map = new Map(events.map((e) => [e.id, e]));
    return (id: string | null) => (id ? (map.get(id) ?? null) : null);
  }, [events]);

  const chosen = grid.filter(Boolean) as string[];
  const filled = chosen.length;
  const longshotOk = chosen.some((id) => eventById(id)?.is_longshot);
  const perGame = new Map<string, number>();
  for (const id of chosen) {
    const g = eventById(id)?.game_id;
    if (g) perGame.set(g, (perGame.get(g) ?? 0) + 1);
  }
  const upsetGames = games.filter((g) => upsets.includes(g.id));
  const complete = filled === 9 && longshotOk && upsets.length === 3;

  const list = events.filter((e) =>
    filter === "all" ? true : filter === "longshot" ? e.is_longshot : e.game_id === filter,
  );

  function place(eventId: string, slot?: number) {
    setGrid((prev) => {
      const next = [...prev];
      const existing = next.indexOf(eventId);
      const target = slot ?? (existing >= 0 ? existing : next.findIndex((g) => g === null));
      if (target < 0) return prev;
      if (existing >= 0 && existing !== target) next[existing] = next[target] ?? null;
      next[target] = eventId;
      return next;
    });
    setHeld(null);
  }

  function toggleEvent(ev: WeekEvent) {
    if (locked) return;
    if (grid.includes(ev.id)) {
      setGrid((prev) => prev.map((g) => (g === ev.id ? null : g)));
      return;
    }
    if (grid.findIndex((g) => g === null) < 0) return;
    if (ev.game_id && (perGame.get(ev.game_id) ?? 0) >= 2) {
      setNotice("Only 2 moments per game are allowed on your grid.");
      return;
    }
    setNotice(null);
    place(ev.id);
    if (filled === 8) {
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 1400);
    }
  }

  function toggleUpset(game: Game) {
    if (locked) return;
    setUpsets((prev) =>
      prev.includes(game.id)
        ? prev.filter((g) => g !== game.id)
        : prev.length >= 3
          ? prev
          : [...prev, game.id],
    );
  }

  async function save(lock: boolean) {
    if (!week || !activePlayer || !household) return;
    setSaving(true);
    setNotice(null);
    try {
      let cardId = myCard?.id;
      if (!cardId) {
        const { data, error } = await db
          .from("cards")
          .insert({ household_id: household.id, week_id: week.id, profile_id: activePlayer.id })
          .select("id")
          .single();
        if (error) throw error;
        cardId = data.id as string;
      }

      await db.from("card_squares").delete().eq("card_id", cardId);
      const squares = grid
        .map((eventId, grid_position) => ({ card_id: cardId!, event_id: eventId, grid_position }))
        .filter((s) => s.event_id) as { card_id: string; event_id: string; grid_position: number }[];
      if (squares.length) {
        const { error } = await db.from("card_squares").insert(squares);
        if (error) throw error;
      }

      await db.from("upset_picks").delete().eq("card_id", cardId);
      if (upsetGames.length) {
        const { error } = await db.from("upset_picks").insert(
          upsetGames.map((g) => ({
            card_id: cardId!,
            game_id: g.id,
            picked_team: g.underdog_team ?? g.away_team,
            upset_size: g.upset_size,
          })),
        );
        if (error) throw error;
      }

      if (lock) {
        const { error } = await db
          .from("cards")
          .update({ locked_at: new Date().toISOString() })
          .eq("id", cardId);
        if (error) throw error;
      }

      await queryClient.invalidateQueries({ queryKey: ["cards", week.id] });
      setNotice(lock ? "Card locked in! 🔒" : "Saved.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't save your card.");
    } finally {
      setSaving(false);
    }
  }

  if (!week) {
    return (
      <AppShell>
        <PageTitle emoji="🧩" title="No week yet" />
        <EmptyWeek message="There's no week open for picks right now." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageTitle
        emoji="🧩"
        title={`${activePlayer?.display_name ?? "Player"}'s card`}
        subtitle={
          locked
            ? "This card is locked — no more edits."
            : "Pick 9 moments, arrange your grid, then choose 3 underdogs."
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="relative rounded-4xl border-2 border-border bg-card p-4 shadow-soft sm:p-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <h2 className="truncate font-display text-2xl">The Grid</h2>
            <span
              className={cn(
                "rounded-full px-4 py-1.5 font-display",
                filled === 9 ? "bg-grass text-grass-foreground" : "bg-secondary",
              )}
            >
              {filled}/9
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Max 2 moments per game · at least 1 longshot {longshotOk ? "✅" : "⭐"}
          </p>

          <div className="relative mt-4">
            <Confetti show={celebrate} />
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {grid.map((id, i) => {
                const ev = eventById(id);
                const isHeld = !!id && held === id;
                return (
                  <div
                    key={i}
                    draggable={!!id && !locked}
                    onDragStart={(e) => id && e.dataTransfer.setData("text/plain", id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (locked) return;
                      const dropped = e.dataTransfer.getData("text/plain");
                      if (dropped) place(dropped, i);
                    }}
                    onClick={() => {
                      if (locked) return;
                      if (held) return place(held, i);
                      if (grid[i]) setHeld(grid[i]!);
                    }}
                    className={cn(
                      "relative flex aspect-square cursor-pointer select-none items-center justify-center rounded-2xl border-2 p-2 text-center transition-all",
                      ev
                        ? "border-navy bg-secondary shadow-soft hover:scale-[1.03]"
                        : "border-dashed border-border bg-muted/40",
                      isHeld && "animate-pulse border-gold bg-gold/30",
                    )}
                  >
                    {ev ? (
                      <>
                        <span className="line-clamp-4 text-[11px] font-bold leading-tight sm:text-sm">
                          {ev.description}
                        </span>
                        <GripVertical className="absolute left-1 top-1 h-3.5 w-3.5 text-muted-foreground" />
                        {!locked && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setGrid((prev) => prev.map((g, idx) => (idx === i ? null : g)));
                            }}
                            aria-label="Remove from square"
                            className="absolute right-1 top-1 rounded-full bg-card p-1 text-muted-foreground"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="font-display text-2xl text-muted-foreground">+</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-8">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <h2 className="truncate font-display text-2xl">Upset Watch</h2>
              <span
                className={cn(
                  "rounded-full px-4 py-1.5 font-display",
                  upsets.length === 3 ? "bg-grass text-grass-foreground" : "bg-secondary",
                )}
              >
                {upsets.length}/3
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick 3 underdog teams from 3 different games.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {games.map((g) => {
                const picked = upsets.includes(g.id);
                return (
                  <button
                    key={g.id}
                    onClick={() => toggleUpset(g)}
                    className={cn(
                      "tap-target flex items-center justify-between gap-2 rounded-2xl border-2 px-4 py-3 text-left transition-all",
                      picked
                        ? "border-gold bg-gold text-gold-foreground shadow-gold"
                        : "border-border bg-card hover:border-navy",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-display text-lg">
                        {g.underdog_team ?? g.away_team}
                      </span>
                      <span className="block truncate text-xs opacity-70">
                        {g.away_team} at {g.home_team} · {formatKick(g.kickoff_at)} · upset size{" "}
                        {g.upset_size}
                      </span>
                    </span>
                    {picked && <Check className="h-5 w-5 shrink-0" />}
                  </button>
                );
              })}
              {games.length === 0 && (
                <p className="text-sm text-muted-foreground">No games added for this week yet.</p>
              )}
            </div>
          </div>

          {notice && <p className="mt-4 text-sm font-bold text-berry">{notice}</p>}

          {!locked && (
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => save(false)}
                disabled={saving}
                className="flex-1 rounded-full border-2 border-border bg-background px-6 py-4 font-display text-lg disabled:opacity-40"
              >
                Save progress
              </button>
              <button
                onClick={() => save(true)}
                disabled={!complete || saving}
                className="flex-1 rounded-full bg-navy px-6 py-4 font-display text-lg text-cream shadow-pop disabled:opacity-40"
              >
                {complete ? "Lock in my card 🔒" : "Finish your picks to lock in"}
              </button>
            </div>
          )}
        </div>

        <div className="rounded-4xl border-2 border-border bg-card p-4 shadow-soft sm:p-6">
          <h2 className="font-display text-2xl">This week's moments</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
              All
            </FilterChip>
            <FilterChip active={filter === "longshot"} onClick={() => setFilter("longshot")}>
              ⭐ Longshots
            </FilterChip>
            {games.map((g) => (
              <FilterChip key={g.id} active={filter === g.id} onClick={() => setFilter(g.id)}>
                {g.away_team} @ {g.home_team}
              </FilterChip>
            ))}
          </div>

          <ul className="mt-4 space-y-2">
            {list.map((ev) => {
              const picked = grid.includes(ev.id);
              const game = games.find((g) => g.id === ev.game_id);
              return (
                <li key={ev.id}>
                  <button
                    draggable={!locked}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", ev.id)}
                    onClick={() => toggleEvent(ev)}
                    className={cn(
                      "tap-target flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-all",
                      picked
                        ? "border-grass bg-grass/15"
                        : "border-border bg-card hover:border-navy hover:bg-secondary/60",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-full font-display",
                        picked ? "bg-grass text-grass-foreground" : "bg-secondary",
                      )}
                    >
                      {picked ? <Check className="h-4 w-4" /> : "+"}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold leading-tight">
                        {ev.is_longshot && "⭐ "}
                        {ev.description}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {game ? `${game.away_team} at ${game.home_team}` : "Any game"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {list.length === 0 && (
              <li className="rounded-2xl bg-background p-6 text-center text-sm text-muted-foreground">
                Nothing here yet — the Commissioner is still writing the list.
              </li>
            )}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-bold",
        active ? "bg-navy text-cream" : "bg-secondary text-secondary-foreground",
      )}
    >
      {children}
    </button>
  );
}
