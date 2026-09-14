import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { db, type Profile } from "@/lib/db";
import { useProfile } from "@/lib/profile";
import { AVATAR_CHOICES, COLOR_CHOICES, PlayerAvatar } from "./PlayerChip";
import { cn } from "@/lib/utils";

type Draft = Pick<Profile, "display_name" | "avatar" | "color">;
const empty: Draft = { display_name: "", avatar: "🏈", color: "bg-gold" };
const button = "rounded-full bg-secondary px-4 py-2 font-bold disabled:opacity-40";

export function PlayerManager() {
  const { household, profiles, setActivePlayerId } = useProfile();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    setNotice("");
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["profiles", household!.id] });
      await queryClient.invalidateQueries({ queryKey: ["cards"] });
      await queryClient.invalidateQueries({ queryKey: ["season"] });
      setNotice(message);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : ((error as { message?: string }).message ?? "Please try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!household || !draft.display_name.trim()) return;
    void run(
      async () => {
        const values = { ...draft, display_name: draft.display_name.trim() };
        const { error } = editing
          ? await db
              .from("profiles")
              .update(values)
              .eq("id", editing)
              .eq("household_id", household.id)
          : await db
              .from("profiles")
              .insert({ ...values, household_id: household.id, is_commissioner: false });
        if (error) throw error;
        setEditing(null);
        setDraft(empty);
      },
      editing ? "Player updated." : "Player added.",
    );
  }

  function remove(player: Profile) {
    void run(async () => {
      if (profiles.length <= 1) throw new Error("Keep at least one player in your household.");
      const { error } = await db
        .from("profiles")
        .delete()
        .eq("id", player.id)
        .eq("household_id", household!.id);
      if (error) throw error;
      if (player.is_commissioner) {
        const next = profiles.find((p) => p.id !== player.id);
        if (next) setActivePlayerId(next.id);
      }
      if (editing === player.id) {
        setEditing(null);
        setDraft(empty);
      }
      setDeleting(null);
    }, "Player removed.");
  }

  return (
    <section
      className="mb-6 rounded-4xl border-2 border-border bg-card p-5 shadow-soft"
      aria-labelledby="players-title"
    >
      <h2 id="players-title" className="font-display text-2xl">
        Household players
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose a name, avatar, and color for each player.
      </p>
      <ul className="my-4 space-y-3">
        {profiles.map((player) => (
          <li key={player.id} className="rounded-2xl bg-background p-3">
            <div className="flex flex-wrap items-center gap-3">
              <PlayerAvatar player={player} size="sm" />
              <span className="font-bold">{player.display_name}</span>
              {player.is_commissioner && <span className="text-sm font-bold">Commissioner</span>}
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  setEditing(player.id);
                  setDraft({
                    display_name: player.display_name,
                    avatar: player.avatar,
                    color: player.color,
                  });
                }}
              >
                Edit <span className="sr-only">{player.display_name}</span>
              </button>
              {!player.is_commissioner && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const { error } = await supabase.rpc("reassign_commissioner", {
                        player_id: player.id,
                      });
                      if (error) throw error;
                      setActivePlayerId(player.id);
                    }, `${player.display_name} is now the commissioner.`)
                  }
                >
                  Make commissioner
                </button>
              )}
              <button
                className={button}
                disabled={busy || profiles.length <= 1}
                onClick={() => setDeleting(player.id)}
              >
                Delete <span className="sr-only">{player.display_name}</span>
              </button>
            </div>
            {deleting === player.id && (
              <div className="mt-3" role="alert">
                <p>
                  Delete {player.display_name}? Their cards and scores will also be removed.
                  {player.is_commissioner && " The next player will become commissioner."}
                </p>
                <div className="mt-2 flex gap-2">
                  <button className={button} disabled={busy} onClick={() => remove(player)}>
                    Confirm delete
                  </button>
                  <button className={button} disabled={busy} onClick={() => setDeleting(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {profiles.length === 1 && (
        <p className="mb-3 text-sm">Keep at least one player in your household.</p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <fieldset disabled={busy} className="space-y-3">
          <legend className="font-display text-xl">{editing ? "Edit player" : "Add player"}</legend>
          <label className="block font-bold">
            Player name
            <input
              required
              maxLength={80}
              value={draft.display_name}
              onChange={(event) => setDraft({ ...draft, display_name: event.target.value })}
              className="mt-1 block w-full rounded-2xl border-2 border-input bg-background px-4 py-3"
            />
          </label>
          <div role="group" aria-label="Avatar" className="flex flex-wrap gap-2">
            {AVATAR_CHOICES.map((avatar) => (
              <button
                type="button"
                key={avatar}
                aria-label={`Avatar ${avatar}`}
                aria-pressed={draft.avatar === avatar}
                onClick={() => setDraft({ ...draft, avatar })}
                className={cn(
                  "h-10 w-10 rounded-full text-xl",
                  draft.avatar === avatar ? "bg-gold" : "bg-secondary",
                )}
              >
                {avatar}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Color" className="flex flex-wrap gap-2">
            {COLOR_CHOICES.map((color) => (
              <button
                type="button"
                key={color}
                aria-label={`Color ${color.replace("bg-", "")}`}
                aria-pressed={draft.color === color}
                onClick={() => setDraft({ ...draft, color })}
                className={cn(
                  "h-9 w-9 rounded-full border-2",
                  color,
                  draft.color === color ? "border-foreground" : "border-transparent",
                )}
              />
            ))}
          </div>
          <button
            type="submit"
            disabled={!draft.display_name.trim()}
            className={cn(button, "bg-gold")}
          >
            {busy ? "Saving…" : editing ? "Save player" : "Add player"}
          </button>
          {editing && (
            <button
              type="button"
              className={cn(button, "ml-2")}
              onClick={() => {
                setEditing(null);
                setDraft(empty);
              }}
            >
              Cancel edit
            </button>
          )}
        </fieldset>
      </form>
      {notice && (
        <p role="status" className="mt-3 font-bold">
          {notice}
        </p>
      )}
    </section>
  );
}
