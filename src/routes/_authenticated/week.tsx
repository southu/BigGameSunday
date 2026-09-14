import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, EmptyWeek, PageTitle } from "@/components/bgs/AppShell";
import { PlayerAvatar, StatusPill } from "@/components/bgs/PlayerChip";
import { useProfile } from "@/lib/profile";
import { useWeekCards, useWeekEvents, useWeekGames } from "@/lib/db";

export const Route = createFileRoute("/_authenticated/week")({
  head: () => ({
    meta: [
      { title: "This Week — Big Game Sunday" },
      {
        name: "description",
        content:
          "The Big Game of the Week, the countdown to card lock, and how every player's card is coming along.",
      },
      { property: "og:title", content: "This Week — Big Game Sunday" },
      {
        property: "og:description",
        content: "The featured game, the lock countdown, and your family's card status.",
      },
    ],
  }),
  component: ThisWeek,
});

function useCountdown(iso: string | null) {
  const [left, setLeft] = useState("--:--:--");
  useEffect(() => {
    if (!iso) return setLeft("Not set yet");
    const tick = () => {
      const ms = new Date(iso).getTime() - Date.now();
      if (ms <= 0) return setLeft("Locked!");
      const d = Math.floor(ms / 86400000);
      const h = Math.floor((ms % 86400000) / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setLeft(`${d}d ${h}h ${m}m ${s}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [iso]);
  return left;
}

function ThisWeek() {
  const { week, profiles, activePlayer, household } = useProfile();
  const countdown = useCountdown(week?.lock_at ?? null);
  const gamesQ = useWeekGames(week?.id);
  const eventsQ = useWeekEvents(week?.id);
  const cardsQ = useWeekCards(week?.id);

  const games = gamesQ.data ?? [];
  const cards = cardsQ.data ?? [];
  const featured = games.find((g) => g.id === week?.featured_game_id) ?? games[0] ?? null;
  const myCard = cards.find((c) => c.profile_id === activePlayer?.id) ?? null;
  const myFilled = myCard?.card_squares.length ?? 0;

  if (!week) {
    return (
      <AppShell>
        <PageTitle emoji="🏈" title="No week set up yet" subtitle={household?.name ?? ""} />
        <EmptyWeek message="Your Commissioner hasn't created this week yet." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="field-stripes relative overflow-hidden rounded-4xl p-6 text-cream shadow-pop sm:p-10">
        <p className="font-display text-sm uppercase tracking-widest text-gold">
          Big Game of the Week
        </p>
        <h1 className="mt-2 font-display text-4xl leading-tight sm:text-6xl">
          {featured ? (
            <>
              {featured.away_team} <span className="text-gold">vs</span> {featured.home_team}
            </>
          ) : (
            <>Week {week.week_number}</>
          )}
        </h1>
        <p className="mt-2 text-cream/80">
          {featured
            ? `${formatKick(featured.kickoff_at)}${featured.underdog_team ? ` · Underdog to watch: ${featured.underdog_team}` : ""}`
            : "No games added yet."}
        </p>

        <div className="mt-6 inline-flex flex-col rounded-3xl bg-navy-soft/80 px-5 py-4">
          <span className="text-xs font-bold uppercase tracking-wide text-cream/70">
            Cards lock in
          </span>
          <span className="font-display text-2xl text-gold sm:text-3xl">{countdown}</span>
        </div>

        <div className="mt-6">
          <Link
            to="/card"
            className="tap-target inline-flex items-center rounded-full bg-gold px-7 py-3 font-display text-lg text-gold-foreground shadow-gold transition-transform hover:scale-105"
          >
            {myFilled === 9 ? "Review my card" : "Build my card"} →
          </Link>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl">Who's ready?</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {profiles.map((p) => {
            const card = cards.find((c) => c.profile_id === p.id);
            const count = card?.card_squares.length ?? 0;
            const upsets = card?.upset_picks.length ?? 0;
            const status = card?.locked_at
              ? "locked"
              : count > 0 || upsets > 0
                ? "in_progress"
                : "not_started";
            return (
              <div
                key={p.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-3xl border-2 border-border bg-card p-4 shadow-soft"
              >
                <PlayerAvatar player={p} />
                <div className="min-w-0">
                  <p className="truncate font-display text-lg">
                    {p.display_name}
                    {p.is_commissioner && <span className="ml-2 text-sm text-gold">Commish</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {count}/9 squares · {upsets}/3 upset picks
                  </p>
                </div>
                <StatusPill status={status} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8 grid gap-3 sm:grid-cols-3">
        <Fact big={`${(eventsQ.data ?? []).length}`} label="moments on this week's list" />
        <Fact big={`${games.length}`} label="games in the slate" />
        <Fact big={`Week ${week.week_number}`} label={`${week.season_year} season`} />
      </section>
    </AppShell>
  );
}

export function formatKick(iso: string | null) {
  if (!iso) return "Kickoff TBD";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Fact({ big, label }: { big: string; label: string }) {
  return (
    <div className="rounded-3xl border-2 border-border bg-card p-5 text-center shadow-soft">
      <p className="font-display text-3xl text-gold">{big}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
