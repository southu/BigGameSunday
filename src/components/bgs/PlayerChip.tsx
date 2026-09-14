import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/db";

export const AVATAR_CHOICES = ["🏈", "🧢", "🎉", "🦄", "👑", "🐻", "🦅", "⭐", "🚀", "🐶"];
export const COLOR_CHOICES = ["bg-gold", "bg-sky", "bg-berry", "bg-grass", "bg-navy-soft"];

export function PlayerAvatar({
  player,
  size = "md",
  className,
}: {
  player: Pick<Profile, "avatar" | "color">;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "h-9 w-9 text-lg",
    md: "h-12 w-12 text-2xl",
    lg: "h-16 w-16 text-3xl",
  } as const;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full border-2 border-navy/10 shadow-soft",
        player.color,
        sizes[size],
        className,
      )}
      aria-hidden
    >
      {player.avatar}
    </span>
  );
}

export function StatusPill({ status }: { status: "not_started" | "in_progress" | "locked" }) {
  const map = {
    not_started: { label: "Not started", cls: "bg-muted text-muted-foreground" },
    in_progress: { label: "In progress", cls: "bg-gold/30 text-foreground" },
    locked: { label: "Locked in", cls: "bg-grass text-grass-foreground" },
  } as const;
  const s = map[status];
  return <span className={cn("rounded-full px-3 py-1 text-xs font-bold", s.cls)}>{s.label}</span>;
}
