import { createFileRoute } from "@tanstack/react-router";
import { AppShell, EmptyWeek, PageTitle } from "@/components/bgs/AppShell";
import { PlayerAvatar } from "@/components/bgs/PlayerChip";
import { useSeason } from "@/lib/db";
import { useProfile } from "@/lib/profile";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/season")({
  head: () => ({
    meta: [
      { title: "Season Standings — Big Game Sunday" },
      {
        name: "description",
        content:
          "The season leaderboard, the Upset Ladder chasing Upset King or Queen, and everyone's trophy case.",
      },
      { property: "og:title", content: "Season Standings — Big Game Sunday" },
      {
        property: "og:description",
        content: "Season leaderboard, Upset Ladder, and trophy cases for the whole household.",
      },
    ],
  }),
  component: Season,
});

function Season() {
  const { household, profiles, week } = useProfile();
  const seasonQ = useSeason(household?.id, week?.season_year);
  const rows = seasonQ.data?.rows ?? [];
  const history = seasonQ.data?.history ?? [];

  const board = profiles
    .map((p) => {
      const r = rows.find((x) => x.profile_id === p.id);
      return {
        player: p,
        grid: r?.grid_points ?? 0,
        upset: r?.upset_points ?? 0,
        trophies: r?.trophies ?? 0,
      };
    })
    .sort((a, b) => b.grid - a.grid);

  const ladder = [...board].sort((a, b) => b.upset - a.upset);

  return (
    <AppShell>
      <PageTitle
        emoji="🏆"
        title="Season"
        subtitle={`${week?.season_year ?? new Date().getFullYear()} · Weeks 1–18 count toward the title`}
      />

      {rows.length === 0 && (
        <EmptyWeek message="Standings fill in once the Commissioner finalizes a week." />
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-4xl border-2 border-border bg-card p-5 shadow-soft">
          <h2 className="font-display text-2xl">Season Leaderboard</h2>
          <ul className="mt-3 space-y-2">
            {board.map((row, i) => (
              <li
                key={row.player.id}
                className={cn(
                  "grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-3xl px-4 py-3",
                  i === 0 ? "bg-gold/25" : "bg-background",
                )}
              >
                <span className="font-display text-xl text-muted-foreground">{i + 1}</span>
                <PlayerAvatar player={row.player} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate font-display text-lg">
                    {row.player.display_name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {"🏆".repeat(row.trophies) || "No trophies yet"}
                  </span>
                </span>
                <span className="font-display text-xl">{row.grid}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-4xl border-2 border-border bg-card p-5 shadow-soft">
          <h2 className="font-display text-2xl">Upset Ladder</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Points for every underdog who wins outright. Top spot is Upset King or Queen.
          </p>
          <ul className="mt-3 space-y-2">
            {ladder.map((row, i) => (
              <li
                key={row.player.id}
                className={cn(
                  "grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-3xl px-4 py-3",
                  i === 0 ? "bg-berry/20" : "bg-background",
                )}
              >
                <span className="font-display text-xl text-muted-foreground">{i + 1}</span>
                <PlayerAvatar player={row.player} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate font-display text-lg">
                    {row.player.display_name}
                  </span>
                  {i === 0 && row.upset > 0 && (
                    <span className="block text-xs text-berry">👑 Leading the ladder</span>
                  )}
                </span>
                <span className="font-display text-xl">{row.upset}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {history.length > 0 && (
        <section className="mt-4 rounded-4xl border-2 border-border bg-card p-5 shadow-soft">
          <h2 className="font-display text-2xl">Weekly winners</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {history.map((h) => {
              const p = profiles.find((x) => x.id === h.winnerProfileId);
              return (
                <li
                  key={h.week}
                  className="flex items-center gap-3 rounded-3xl bg-background px-4 py-3"
                >
                  <span className="font-display text-lg text-gold">W{h.week}</span>
                  {p && <PlayerAvatar player={p} size="sm" />}
                  <span className="min-w-0 truncate font-bold">{p?.display_name ?? "—"}</span>
                  <span className="ml-auto font-display">{h.points}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
