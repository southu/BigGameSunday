import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell, EmptyWeek, PageTitle } from "@/components/bgs/AppShell";
import { GridBoard, LineTally } from "@/components/bgs/GridBoard";
import { PlayerAvatar } from "@/components/bgs/PlayerChip";
import { useWeekCards, useWeekEvents } from "@/lib/db";
import { useProfile } from "@/lib/profile";

export const Route = createFileRoute("/_authenticated/live")({
  head: () => ({
    meta: [
      { title: "Live Boards — Big Game Sunday" },
      {
        name: "description",
        content:
          "Watch every family board light up together as Sunday's moments land, square by square.",
      },
      { property: "og:title", content: "Live Boards — Big Game Sunday" },
      { property: "og:description", content: "Every family board, lighting up live on Sunday." },
    ],
  }),
  component: LiveBoards,
});

function LiveBoards() {
  const { week, profiles } = useProfile();
  const eventsQ = useWeekEvents(week?.id);
  const cardsQ = useWeekCards(week?.id);
  const events = eventsQ.data ?? [];
  const cards = cardsQ.data ?? [];

  const lookup = useMemo(() => {
    const map = new Map(events.map((e) => [e.id, e]));
    return (id: string | null) => (id ? (map.get(id) ?? null) : null);
  }, [events]);

  const decided = events.filter((e) => e.result !== null).length;

  if (!week || cards.length === 0) {
    return (
      <AppShell>
        <PageTitle emoji="📡" title="Live Boards" />
        <EmptyWeek message="Boards appear here once cards are filled in for the week." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageTitle
        emoji="📡"
        title="Live Boards"
        subtitle={`${decided} of ${events.length} moments called so far`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const player = profiles.find((p) => p.id === card.profile_id);
          const grid: (string | null)[] = Array(9).fill(null);
          for (const s of card.card_squares) grid[s.grid_position] = s.event_id;
          return (
            <div
              key={card.id}
              className="rounded-4xl border-2 border-border bg-card p-4 shadow-soft"
            >
              <div className="flex items-center gap-3">
                {player && <PlayerAvatar player={player} size="sm" />}
                <div className="min-w-0">
                  <p className="truncate font-display text-lg">
                    {player?.display_name ?? "Player"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {card.locked_at ? "Locked in" : "Still editing"}
                  </p>
                </div>
              </div>
              <GridBoard grid={grid} lookup={lookup} compact className="mt-3" />
              <div className="mt-3">
                <LineTally grid={grid} lookup={lookup} />
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
