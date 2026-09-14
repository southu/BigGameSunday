import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSession } from "@/lib/profile";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Big Game Sunday — Your family's weekly football game" },
      {
        name: "description",
        content:
          "Pick 9 fun football moments, fill your 3x3 grid, and cheer them in on Sunday. A family-friendly NFL prediction game for all ages.",
      },
      { property: "og:title", content: "Big Game Sunday — Your family's weekly football game" },
      {
        property: "og:description",
        content:
          "Pick 9 moments, arrange your 3x3 grid, and cheer them in on Sunday. Family-friendly, all ages welcome.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { session, ready } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (ready && session) navigate({ to: "/week", replace: true });
  }, [ready, session, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-4 py-10">
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
          <Card emoji="🧩" title="The Grid" text="Pick 9 moments and arrange them however you like." />
          <Card emoji="🐕" title="Upset Watch" text="Back 3 underdogs and climb the Upset Ladder." />
          <Card emoji="🏆" title="Trophies" text="Weekly winners, season champion, all season long." />
        </section>
      </main>
    </div>
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
