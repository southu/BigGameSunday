import { cn } from "@/lib/utils";
import { LINES, scoreBoard } from "@/lib/scoring";
import type { WeekEvent } from "@/lib/db";

export type EventLookup = (id: string | null) => WeekEvent | null;

function hitFlagsFor(grid: (string | null)[], lookup: EventLookup, revealed?: string[]) {
  return grid.map((id) => {
    if (!id) return false;
    if (revealed) return revealed.includes(id);
    return lookup(id)?.result === "hit";
  });
}

export function GridBoard({
  grid,
  lookup,
  revealed,
  compact,
  className,
}: {
  grid: (string | null)[];
  lookup: EventLookup;
  /** event ids revealed as hits so far */
  revealed?: string[];
  compact?: boolean;
  className?: string;
}) {
  const hitFlags = hitFlagsFor(grid, lookup, revealed);
  const doneLines = LINES.filter((l) => l.every((i) => hitFlags[i]));
  const inLine = new Set(doneLines.flat());

  return (
    <div className={cn("grid grid-cols-3 gap-1.5 sm:gap-2", className)}>
      {grid.map((id, i) => {
        const ev = lookup(id);
        const hit = hitFlags[i];
        return (
          <div
            key={i}
            className={cn(
              "relative flex items-center justify-center overflow-hidden rounded-2xl border-2 p-1.5 text-center leading-tight transition-all duration-500",
              compact
                ? "aspect-square text-[9px] sm:text-[10px]"
                : "aspect-square text-[11px] sm:text-sm",
              hit
                ? "border-gold bg-gold text-gold-foreground font-extrabold shadow-gold"
                : "border-border bg-card text-muted-foreground",
              inLine.has(i) && "animate-shine",
            )}
          >
            <span className="line-clamp-4 px-0.5 font-bold">{ev?.description ?? "Empty"}</span>
          </div>
        );
      })}
    </div>
  );
}

export function LineTally({
  grid,
  lookup,
  revealed,
}: {
  grid: (string | null)[];
  lookup: EventLookup;
  revealed?: string[];
}) {
  const { hits, lines, gridScore } = scoreBoard(hitFlagsFor(grid, lookup, revealed));
  return (
    <div className="flex flex-wrap gap-2 text-sm font-bold">
      <span className="rounded-full bg-secondary px-3 py-1">{hits} hits</span>
      <span className="rounded-full bg-gold px-3 py-1 text-gold-foreground">{lines} lines</span>
      <span className="rounded-full bg-navy px-3 py-1 text-cream">{gridScore} pts</span>
    </div>
  );
}
