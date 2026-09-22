import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SiteFooter } from "@/components/bgs/SiteFooter";
import { loadPublicBoard, type PublicBoard } from "@/lib/week-play.functions";
import { useSession } from "@/lib/profile";

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      return await loadPublicBoard();
    } catch (error) {
      console.error(error);
      return null;
    }
  },
  head: ({ loaderData }) => {
    const week = loaderData?.active_week;
    const title =
      week != null
        ? `Big Game Sunday — Week ${week}`
        : "Big Game Sunday — Your family's weekly football game";
    const description =
      week != null
        ? `Week ${week} is open for Oak, Pine, and Cedar. Fill the Grid and Upset Watch before kickoff.`
        : "Pick 9 fun football moments, fill your 3x3 grid, and cheer them in on Sunday. A family-friendly NFL prediction game for all ages.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: Landing,
});

function Landing() {
  const board = Route.useLoaderData();
  const { session, ready } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (ready && session) navigate({ to: "/week", replace: true });
  }, [ready, session, navigate]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <section className="field-stripes relative overflow-hidden rounded-4xl p-6 text-cream shadow-pop sm:p-12">
          <span className="grid h-14 w-14 place-items-center rounded-3xl bg-gold text-3xl">🏈</span>
          <h1 className="mt-5 font-display text-4xl leading-tight sm:text-6xl">
            Big Game <span className="text-gold">Sunday</span>
          </h1>
          <p className="mt-3 max-w-xl text-lg text-cream/85">
            Your family's weekly football game. Pick 9 moments, arrange your 3x3 grid, and watch it
            light up together on Sunday. No money, no jargon — just trophies.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/auth"
              className="tap-target inline-flex items-center rounded-full bg-gold px-7 py-3 font-display text-lg text-gold-foreground shadow-gold transition-transform hover:scale-105"
            >
              Start your household →
            </Link>
            <Link
              to="/auth"
              className="tap-target inline-flex items-center rounded-full bg-navy-soft px-7 py-3 font-display text-lg text-cream"
            >
              Sign in
            </Link>
          </div>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-3">
          <Card
            emoji="🧩"
            title="The Grid"
            text="Pick 9 moments and arrange them however you like."
          />
          <Card
            emoji="🐕"
            title="Upset Watch"
            text="Back 3 underdogs and climb the Upset Ladder."
          />
          <Card
            emoji="🏆"
            title="Trophies"
            text="Weekly winners, season champion, all season long."
          />
        </section>

        {board ? <WeekBoard board={board} /> : null}
      </main>
      <SiteFooter />
    </div>
  );
}

function WeekBoard({ board }: { board: PublicBoard }) {
  const week = board.active_week;
  const payload = {
    active_week: board.active_week,
    week: board.active_week,
    season_year: board.season_year,
    houses: board.houses.map((house) => ({
      house: house.house,
      name: house.name,
      label: house.label,
      active_week: house.active_week,
      window: house.window,
      games: house.games,
    })),
  };
  return (
    <section id="this-week" className="mt-10" data-active-week={week ?? ""}>
      <h2 className="font-display text-3xl">This week</h2>
      {week != null ? (
        <p className="mt-2 text-muted-foreground">
          Week {week} is the active week for {board.houses.map((house) => house.name).join(", ")}.
        </p>
      ) : null}
      <div className="mt-5 grid gap-4">
        {board.houses.map((house) => (
          <article
            key={house.house}
            data-house={house.house}
            data-week={house.active_week ?? ""}
            className="rounded-3xl border-2 border-border bg-card p-5 shadow-soft"
          >
            <h3 className="font-display text-2xl">{house.label}</h3>
            <p className="text-sm text-muted-foreground">
              {house.name} · {house.games} games · window {house.window}
            </p>
            <div className="mt-4">
              <h4 className="font-display text-xl">Week {house.active_week} Grid</h4>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                {house.moments.map((moment) => (
                  <li key={moment.id}>{moment.description}</li>
                ))}
              </ol>
              <form method="post" action="/api/grid" className="mt-3">
                <input type="hidden" name="house" value={house.house} />
                <input type="hidden" name="week" value={house.active_week ?? ""} />
                <input type="hidden" name="card" value="grid" />
                <input
                  type="hidden"
                  name="event_ids"
                  value={house.submit.grid.event_ids.join(",")}
                />
                <button
                  type="submit"
                  className="tap-target inline-flex items-center rounded-full bg-gold px-5 py-2 font-display text-gold-foreground"
                >
                  Save {house.label} Grid
                </button>
              </form>
            </div>
            <div className="mt-5">
              <h4 className="font-display text-xl">Week {house.active_week} Upset Watch</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {house.upset_games.map((game) => (
                  <li key={game.id}>
                    {game.underdog_team ?? game.away_team} at {game.home_team}
                  </li>
                ))}
              </ul>
              <form method="post" action="/api/upset" className="mt-3">
                <input type="hidden" name="house" value={house.house} />
                <input type="hidden" name="week" value={house.active_week ?? ""} />
                <input type="hidden" name="card" value="upset" />
                <input
                  type="hidden"
                  name="game_ids"
                  value={house.submit.upset.game_ids.join(",")}
                />
                <button
                  type="submit"
                  className="tap-target inline-flex items-center rounded-full bg-navy-soft px-5 py-2 font-display text-cream"
                >
                  Save {house.label} Upset Watch
                </button>
              </form>
            </div>
            <form method="post" action="/api/grid" className="mt-4">
              <input type="hidden" name="house" value={house.house} />
              <input type="hidden" name="week" value={house.active_week ?? ""} />
              <input type="hidden" name="card" value="grid" />
              <input
                type="hidden"
                name="event_ids"
                value={house.submit.after_lock.event_ids.join(",")}
              />
              <input type="hidden" name="at" value="lock" />
              <button type="submit" className="text-sm text-muted-foreground underline">
                Submit {house.label} after lock
              </button>
            </form>
          </article>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{board.lock_check}</p>
      <p className="mt-3 text-sm">
        Week 2 picks remain stored: {board.week_2.count} cards, {board.week_2.squares} grid squares,{" "}
        {board.week_2.upset_picks} upset picks.
      </p>
      <p className="mt-3 flex flex-wrap gap-3 text-sm">
        <a href="/api/week">Active week</a>
        <a href="/api/score">Scoring</a>
        <a href="/api/autopilot">Autopilot</a>
        <a href="/api/picks?week=2">Week 2 picks</a>
      </p>
      <script
        id="bgs-active-week"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(payload).replace(/</g, "\\u003c") }}
      />
    </section>
  );
}

function Card({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <div className="rounded-3xl border-2 border-border bg-card p-5 shadow-soft">
      <p className="text-3xl">{emoji}</p>
      <p className="mt-2 font-display text-xl">{title}</p>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
