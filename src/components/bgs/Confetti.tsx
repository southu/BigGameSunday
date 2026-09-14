import { cn } from "@/lib/utils";

const COLORS = ["bg-gold", "bg-grass", "bg-berry", "bg-sky"];

export function Confetti({ show, className }: { show: boolean; className?: string }) {
  if (!show) return null;
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-visible", className)} aria-hidden>
      {Array.from({ length: 18 }).map((_, i) => (
        <span
          key={i}
          className={cn("absolute h-2 w-2 rounded-sm animate-confetti", COLORS[i % 4])}
          style={
            {
              left: `${(i * 37) % 100}%`,
              top: "60%",
              animationDelay: `${(i % 6) * 60}ms`,
              "--cx": `${((i * 53) % 120) - 60}px`,
              "--cy": `${-60 - ((i * 29) % 90)}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
