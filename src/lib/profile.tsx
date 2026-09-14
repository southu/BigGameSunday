import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentWeek, useHousehold, useProfiles, type Household, type Profile, type Week } from "./db";

type ProfileCtx = {
  session: Session | null;
  household: Household | null;
  profiles: Profile[];
  activePlayer: Profile | null;
  week: Week | null;
  loading: boolean;
  setActivePlayerId: (id: string) => void;
};

const Ctx = createContext<ProfileCtx | null>(null);
const STORAGE_KEY = "bgs.activeProfile";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, ready };
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { session, ready } = useSession();
  const signedIn = !!session;

  const householdQ = useHousehold(signedIn && ready);
  const household = householdQ.data ?? null;
  const profilesQ = useProfiles(household?.id);
  const weekQ = useCurrentWeek(household?.id);

  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setActiveId(window.localStorage.getItem(STORAGE_KEY));
  }, []);

  const profiles = profilesQ.data ?? [];

  const value = useMemo<ProfileCtx>(() => {
    const active = profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null;
    return {
      session,
      household,
      profiles,
      week: weekQ.data ?? null,
      activePlayer: active,
      loading: !ready || householdQ.isLoading || profilesQ.isLoading,
      setActivePlayerId: (id: string) => {
        setActiveId(id);
        if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
      },
    };
  }, [session, household, profiles, activeId, weekQ.data, ready, householdQ.isLoading, profilesQ.isLoading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProfile() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
}
