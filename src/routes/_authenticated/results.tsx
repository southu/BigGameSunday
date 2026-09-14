import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { AppShell, EmptyWeek, PageTitle } from "@/components/bgs/AppShell";
import { Confetti } from "@/components/bgs/Confetti";
import { GridBoard, LineTally } from "@/components/bgs/GridBoard";
import { PlayerAvatar } from "@/components/bgs/PlayerChip";
import { useWeekCards, useWeekEvents } from "@/lib/db";
import { useProfile } from "@/lib/profile";
import { scoreBoard } from "@/lib/scoring";

export const Route = createFileRoute("/_authenticated/results")({
  head: () => ({
    meta: [
      { title: "The Reveal — Big Game Sunday" },
      {
        name: "description",
        content:
          "Play back the week moment by moment: squares light up, lines flash, and the weekly trophy gets handed out.",
      },
      { property: "og:title", content: "The Reveal — Big Game Sunday" },
      {
        property: "og:description",
        content: "Play back the week moment by moment and crown the weekly winner.",
      },
    ],
  }),
  component: Results,
});

function Results() {
  const { week, profiles } = useProfile();
  const eventsQ = useWeekEvents(week?.id);
  const cardsQ = useWeekCards(week?.id);
  const events = eventsQ.data ?? [];
  const cards = cardsQ.data ?? [];

  const hitEvents = useMemo(() => events.filter((e) => e.result === "hit"), [events]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (step >= hitEvents.length) return setPlaying(false);
    const t = setTimeout(() => setStep((s) => s + 1), 900);
    return () => clearTimeout(t);
  }, [playing, step, hitEvents.length]);

  const revealed = hitEvents.slice(0, step).map((e) => e.id);
  const lookup = useMemo(() => {
    const map = new Map(events.map((e) => [e.id, e]));
    return (id: string | null) => (id ? (map.get(id) ?? null) : null);
  }, [events]);

  const boards = cards.map((card) => {
    const grid: (string | null)[] = Array(9).fill(null);
    for (const s of card.card_squares) grid[s.grid_position] = s.event_id;
    const flags = grid.map((id) => !!id && revealed.includes(id));
    const score = scoreBoard(flags);
    return {
      card,
      grid,
      score,
      player: profiles.find((p) => p.id === card.profile_id) ?? null,
    };
  });

  const done = step >= hitEvents.length && hitEvents.length > 0;
  // Playback stays theatrical (grid points as squares light up). After the
  // last moment, the trophy is the stored rank-1 card from finalize.
  const theatricalLeader =
    [...boards].sort((a, b) => b.score.gridScore - a.score.gridScore)[0] ?? null;
  const storedWinner = boards.find((b) => b.card.weekly_scores?.rank === 1) ?? null;
  const leader = done && storedWinner ? storedWinner : theatricalLeader;

  if (!week || cards.length === 0) {
    return (
      <AppShell>
        <PageTitle emoji="✨" title="The Reveal" />
        <EmptyWeek message="Once the Commissioner marks results, the reveal plays here." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageTitle
        emoji="✨"
        title={`Week ${week.week_number} Reveal`}
        subtitle="Press play and watch the boards light up, moment by moment."
      />

      <div className="relative overflow-hidden rounded-4xl bg-navy p-6 text-cream shadow-pop">
        <Confetti show={done} />
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              if (done) setStep(0);
              setPlaying((p) => !p);
            }}
            className="tap-target inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 font-display text-lg text-gold-foreground shadow-gold"
          >
            {playing ? "Pause" : done ? <>Replay <RotateCcw className="h-5 w-5" /></> : <>Play the reveal <Play className="h-5 w-5" /></>}
          </button>
          <span className="rounded-full bg-navy-soft px-4 py-2 text-sm font-bold">
            {step}/{hitEvents.length} moments revealed
          </span>
        </div>

        <p className="mt-4 min-h-12 font-display text-2xl text-gold">
          {step === 0
            ? "Ready when you are…"
            : (lookup(hitEvents[step - 1]?.id ?? null)?.description ?? "")}
        </p>

        {done && leader?.player && (
          <p className="mt-2 font-display text-xl">
            🏆 {leader.player.display_name} takes Week {week.week_number} with{" "}
            {leader.score.gridScore} points!
          </p>
        )}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {boards.map((b) => (
          <div key={b.card.id} className="rounded-4xl border-2 border-border bg-card p-4 shadow-soft">
            <div className="flex items-center gap-3">
              {b.player && <PlayerAvatar player={b.player} size="sm" />}
              <p className="truncate font-display text-lg">{b.player?.display_name ?? "Player"}</p>
            </div>
            <GridBoard grid={b.grid} lookup={lookup} revealed={revealed} compact className="mt-3" />
            <div className="mt-3">
              <LineTally grid={b.grid} lookup={lookup} revealed={revealed} />
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
