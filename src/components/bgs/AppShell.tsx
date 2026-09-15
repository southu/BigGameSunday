import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Grid3x3, LogOut, Radio, Shield, Sparkles, Trophy } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/lib/profile";
import { PlayerAvatar } from "./PlayerChip";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/week", label: "This Week", icon: CalendarDays },
  { to: "/card", label: "My Card", icon: Grid3x3 },
  { to: "/live", label: "Live", icon: Radio },
  { to: "/results", label: "Reveal", icon: Sparkles },
  { to: "/season", label: "Season", icon: Trophy },
  { to: "/commissioner", label: "Commish", icon: Shield },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { activePlayer, setActivePlayerId, profiles, household, week, loading } = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onOnboarding = pathname.startsWith("/onboarding");

  useEffect(() => {
    if (loading || onOnboarding) return;
    if (!household || profiles.length === 0) navigate({ to: "/onboarding", replace: true });
  }, [loading, household, profiles.length, onOnboarding, navigate]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <header className="sticky top-0 z-40 border-b-4 border-gold bg-navy text-cream">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
          <Link to="/week" className="flex min-w-0 items-center gap-2">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gold text-xl">
              🏈
            </span>
            <span className="min-w-0">
              <span className="block truncate font-display text-lg leading-none sm:text-xl">
                Big Game Sunday
              </span>
              <span className="block truncate text-xs text-cream/70">
                {household?.name ?? "Your household"}
                {week ? ` · Week ${week.week_number}` : ""}
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-2">
            {profiles.length > 0 && (
              <div className="flex items-center gap-1 rounded-full bg-navy-soft p-1">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setActivePlayerId(p.id)}
                    aria-label={`Play as ${p.display_name}${p.is_commissioner ? ", commissioner" : ""}`}
                    aria-pressed={p.id === activePlayer?.id}
                    title={`${p.display_name}${p.is_commissioner ? " · Commissioner" : ""}`}
                    className={cn(
                      "rounded-full p-0.5 transition-transform",
                      p.id === activePlayer?.id
                        ? "ring-3 ring-gold scale-105"
                        : "opacity-60 hover:opacity-100",
                    )}
                  >
                    <PlayerAvatar player={p} size="sm" />
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={signOut}
              aria-label="Sign out"
              className="tap-target grid h-10 w-10 place-items-center rounded-full bg-navy-soft text-cream/80 hover:text-cream"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav className="mx-auto hidden max-w-6xl gap-1 px-4 pb-2 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeProps={{ className: "bg-gold text-gold-foreground" }}
              inactiveProps={{ className: "text-cream/80 hover:bg-navy-soft" }}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold"
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-6 border-t-4 border-gold bg-navy text-cream md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeProps={{ className: "text-gold" }}
            inactiveProps={{ className: "text-cream/70" }}
            className="tap-target flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-bold"
          >
            <n.icon className="h-5 w-5" />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function PageTitle({
  title,
  subtitle,
  emoji,
}: {
  title: string;
  subtitle?: string;
  emoji?: string;
}) {
  return (
    <div className="mb-5">
      <h1 className="font-display text-3xl sm:text-4xl">
        {emoji && <span className="mr-2">{emoji}</span>}
        {title}
      </h1>
      {subtitle && <p className="mt-1 text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function EmptyWeek({ message }: { message: string }) {
  return (
    <div className="rounded-4xl border-2 border-dashed border-border bg-card p-8 text-center shadow-soft">
      <p className="text-5xl">🗓️</p>
      <p className="mt-3 font-display text-2xl">{message}</p>
      <Link
        to="/commissioner"
        className="mt-5 inline-flex rounded-full bg-navy px-6 py-3 font-display text-cream shadow-pop"
      >
        Open the Commissioner Panel →
      </Link>
    </div>
  );
}
