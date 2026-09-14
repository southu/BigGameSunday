import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AVATAR_CHOICES, COLOR_CHOICES, PlayerAvatar } from "@/components/bgs/PlayerChip";
import { db, useHousehold, useProfiles } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Set up your household — Big Game Sunday" },
      {
        name: "description",
        content:
          "Name your household and add a profile for everyone who plays. Kids' profiles are just a name and an avatar.",
      },
      { property: "og:title", content: "Set up your household — Big Game Sunday" },
      { property: "og:description", content: "Name your household and add player profiles." },
    ],
  }),
  component: Onboarding,
});

type Draft = { display_name: string; avatar: string; color: string };

function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const householdQ = useHousehold();
  const household = householdQ.data ?? null;
  const profilesQ = useProfiles(household?.id);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([
    { display_name: "", avatar: "🧢", color: "bg-sky" },
  ]);

  async function createHousehold() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await db.from("households").insert({ name: name.trim() });
    if (error) setError(error.message);
    else await queryClient.invalidateQueries({ queryKey: ["household"] });
    setBusy(false);
  }

  async function saveProfiles() {
    if (!household) return;
    const rows = drafts
      .filter((d) => d.display_name.trim())
      .map((d, i) => ({
        household_id: household.id,
        display_name: d.display_name.trim(),
        avatar: d.avatar,
        color: d.color,
        is_commissioner: i === 0 && (profilesQ.data ?? []).length === 0,
      }));
    if (rows.length === 0) {
      setError("Add at least one player.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await db.from("profiles").insert(rows);
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["profiles", household.id] });
    setBusy(false);
    navigate({ to: "/week" });
  }

  const existing = profilesQ.data ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-display text-3xl sm:text-4xl">
        <span className="mr-2">👋</span>
        Let's set up your household
      </h1>
      <p className="mt-1 text-muted-foreground">
        Two quick steps and you're ready for Sunday.
      </p>

      <section className="mt-6 rounded-4xl border-2 border-border bg-card p-6 shadow-soft">
        <h2 className="font-display text-2xl">1. Name your household</h2>
        {household ? (
          <p className="mt-3 rounded-2xl bg-grass/20 px-4 py-3 font-bold">
            ✅ {household.name}
          </p>
        ) : (
          <div className="mt-3 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Harper House"
              className="min-w-0 flex-1 rounded-2xl border-2 border-input bg-background px-4 py-3 font-bold outline-none focus:border-gold"
            />
            <button
              onClick={createHousehold}
              disabled={busy || !name.trim()}
              className="rounded-2xl bg-navy px-5 font-display text-cream disabled:opacity-40"
            >
              Save
            </button>
          </div>
        )}
      </section>

      <section
        className={cn(
          "mt-5 rounded-4xl border-2 border-border bg-card p-6 shadow-soft",
          !household && "opacity-50",
        )}
      >
        <h2 className="font-display text-2xl">2. Add the players</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Name and avatar only — no emails or personal details for kids.
        </p>

        {existing.length > 0 && (
          <ul className="mt-4 space-y-2">
            {existing.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-background px-4 py-2">
                <PlayerAvatar player={p} size="sm" />
                <span className="font-bold">{p.display_name}</span>
                {p.is_commissioner && <span className="text-xs text-gold">Commish</span>}
              </li>
            ))}
          </ul>
        )}

        <ul className="mt-4 space-y-4">
          {drafts.map((d, i) => (
            <li key={i} className="rounded-3xl border-2 border-border bg-background p-4">
              <div className="flex gap-2">
                <input
                  value={d.display_name}
                  disabled={!household}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, display_name: e.target.value } : x)),
                    )
                  }
                  placeholder="Player name"
                  className="min-w-0 flex-1 rounded-2xl border-2 border-input bg-card px-4 py-3 font-bold outline-none focus:border-gold"
                />
                {drafts.length > 1 && (
                  <button
                    onClick={() => setDrafts((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label="Remove player"
                    className="tap-target grid w-11 place-items-center rounded-2xl bg-secondary"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {AVATAR_CHOICES.map((a) => (
                  <button
                    key={a}
                    onClick={() =>
                      setDrafts((prev) => prev.map((x, idx) => (idx === i ? { ...x, avatar: a } : x)))
                    }
                    className={cn(
                      "grid h-10 w-10 place-items-center rounded-full text-xl",
                      d.avatar === a ? "bg-gold" : "bg-secondary",
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                {COLOR_CHOICES.map((c) => (
                  <button
                    key={c}
                    onClick={() =>
                      setDrafts((prev) => prev.map((x, idx) => (idx === i ? { ...x, color: c } : x)))
                    }
                    aria-label={`Colour ${c}`}
                    className={cn(
                      "h-8 w-8 rounded-full border-2",
                      c,
                      d.color === c ? "border-navy" : "border-transparent",
                    )}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>

        <button
          onClick={() =>
            setDrafts((prev) => [
              ...prev,
              { display_name: "", avatar: AVATAR_CHOICES[prev.length % AVATAR_CHOICES.length]!, color: COLOR_CHOICES[prev.length % COLOR_CHOICES.length]! },
            ])
          }
          disabled={!household}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-5 py-2 font-bold"
        >
          <Plus className="h-4 w-4" /> Add another player
        </button>

        {error && <p className="mt-4 text-sm font-bold text-berry">{error}</p>}

        <button
          onClick={saveProfiles}
          disabled={!household || busy}
          className="mt-5 w-full rounded-full bg-gold px-6 py-4 font-display text-lg text-gold-foreground shadow-gold disabled:opacity-40"
        >
          {busy ? "Saving…" : "Start playing 🏈"}
        </button>
      </section>
    </div>
  );
}
