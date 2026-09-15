import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteFooter } from "@/components/bgs/SiteFooter";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/profile";
import { cn } from "@/lib/utils";
import {
  authModeFromSearch,
  isPasswordRecoveryHash,
  mapAuthError,
  passwordResetRedirectTo,
} from "@/lib/parent-auth";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => {
    const next = search["next"] === "/ops" ? ("/ops" as const) : undefined;
    const mode = search["mode"] === "signup" ? ("signup" as const) : undefined;
    return { ...(next ? { next } : {}), ...(mode ? { mode } : {}) };
  },
  head: () => ({
    meta: [
      { title: "Sign in — Big Game Sunday" },
      {
        name: "description",
        content:
          "Sign in or create your household account to play Big Game Sunday with your family this week.",
      },
      { property: "og:title", content: "Sign in — Big Game Sunday" },
      {
        property: "og:description",
        content: "Create your household and start playing Big Game Sunday.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { session, ready } = useSession();
  const { next, mode: modeParam } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(authModeFromSearch({ mode: modeParam }));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isPasswordRecoveryHash(window.location.hash)) setRecovery(true);
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!ready || !session) return;
    if (recovery) return;
    if (typeof window !== "undefined" && isPasswordRecoveryHash(window.location.hash)) return;
    navigate({ to: next ?? "/week", replace: true });
  }, [ready, session, navigate, next, recovery]);

  function selectMode(nextMode: "signin" | "signup") {
    setMode(nextMode);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (nextMode === "signup") url.searchParams.set("mode", "signup");
    else url.searchParams.delete("mode");
    window.history.replaceState(null, "", url);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: passwordResetRedirectTo(window.location.origin) },
        });
        if (error) throw error;
        if (!data.session) {
          setMessage("Check your email to confirm your account, then come back and sign in.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(mapAuthError(err instanceof Error ? err : { message: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          next === "/ops" ? `${window.location.origin}/auth?next=/ops` : window.location.origin,
      },
    });
    if (error) {
      setError("Google sign-in didn't work. Try email instead.");
      return;
    }
  }

  async function forgotPassword() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!email.trim()) {
        setError("Enter your email first.");
        return;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: passwordResetRedirectTo(window.location.origin),
      });
      if (error) throw error;
      setMessage("If that email is registered, a reset link is on the way. Check your inbox.");
    } catch (err) {
      setError(mapAuthError(err instanceof Error ? err : { message: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!email.trim()) {
        setError("Enter your email first.");
        return;
      }
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: passwordResetRedirectTo(window.location.origin) },
      });
      if (error) throw error;
      setMessage(
        "If that email still needs confirming, a new link is on the way. Check your inbox.",
      );
    } catch (err) {
      setError(mapAuthError(err instanceof Error ? err : { message: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  async function saveNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (newPassword.length < 6) {
        setError("Use at least 6 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("Those passwords don't match.");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setMessage("Password saved. Taking you in.");
      navigate({ to: next ?? "/week", replace: true });
    } catch (err) {
      setError(mapAuthError(err instanceof Error ? err : { message: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="grid flex-1 place-items-center px-4 py-10">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-6 flex items-center justify-center gap-2">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gold text-2xl">
              🏈
            </span>
            <span className="font-display text-2xl">Big Game Sunday</span>
          </Link>

          <div className="rounded-4xl border-2 border-border bg-card p-6 shadow-soft">
            {recovery ? (
              <form onSubmit={saveNewPassword} className="space-y-3">
                <h1 className="font-display text-xl">Set a new password</h1>
                <label className="block">
                  <span className="text-sm font-bold">New password</span>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="mt-1 w-full rounded-2xl border-2 border-input bg-background px-4 py-3 font-bold outline-none focus:border-gold"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-bold">Confirm new password</span>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="mt-1 w-full rounded-2xl border-2 border-input bg-background px-4 py-3 font-bold outline-none focus:border-gold"
                  />
                </label>
                {error && <p className="text-sm font-bold text-berry">{error}</p>}
                {message && <p className="text-sm font-bold text-grass">{message}</p>}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-full bg-navy px-6 py-4 font-display text-lg text-cream shadow-pop disabled:opacity-50"
                >
                  {busy ? "One moment…" : "Save new password"}
                </button>
              </form>
            ) : (
              <>
                <div
                  className="grid grid-cols-2 gap-1 rounded-full bg-secondary p-1"
                  role="tablist"
                >
                  {(["signup", "signin"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      id={m === "signin" ? "tab-signin" : "tab-signup"}
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => selectMode(m)}
                      className={cn(
                        "rounded-full px-4 py-2 font-display",
                        mode === m ? "bg-navy text-cream" : "text-muted-foreground",
                      )}
                    >
                      {m === "signup" ? "New household" : "Sign in"}
                    </button>
                  ))}
                </div>

                <form onSubmit={submit} className="mt-5 space-y-3">
                  <label className="block">
                    <span className="text-sm font-bold">Parent's email</span>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 w-full rounded-2xl border-2 border-input bg-background px-4 py-3 font-bold outline-none focus:border-gold"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-bold">Password</span>
                    <input
                      type="password"
                      required
                      minLength={6}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1 w-full rounded-2xl border-2 border-input bg-background px-4 py-3 font-bold outline-none focus:border-gold"
                    />
                  </label>

                  {error && <p className="text-sm font-bold text-berry">{error}</p>}
                  {message && <p className="text-sm font-bold text-grass">{message}</p>}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full rounded-full bg-navy px-6 py-4 font-display text-lg text-cream shadow-pop disabled:opacity-50"
                  >
                    {busy
                      ? "One moment…"
                      : mode === "signup"
                        ? "Create household account"
                        : "Sign in"}
                  </button>
                  <button
                    type="button"
                    onClick={forgotPassword}
                    disabled={busy}
                    className="w-full text-center text-sm font-bold text-muted-foreground"
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    id="resend"
                    onClick={resendConfirmation}
                    disabled={busy}
                    className="w-full text-center text-sm font-bold text-muted-foreground"
                  >
                    Resend confirmation
                  </button>
                </form>

                <div className="my-4 flex items-center gap-3 text-xs font-bold text-muted-foreground">
                  <span className="h-0.5 flex-1 bg-border" /> OR{" "}
                  <span className="h-0.5 flex-1 bg-border" />
                </div>

                <button
                  type="button"
                  onClick={google}
                  className="w-full rounded-full border-2 border-border bg-background px-6 py-4 font-display text-lg"
                >
                  Continue with Google
                </button>

                <p className="mt-5 text-center text-xs text-muted-foreground">
                  Only the parent account uses an email. Kids' profiles are just a name and an
                  avatar.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
