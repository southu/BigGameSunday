import { createFileRoute, notFound, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadOpsSnapshot, resendOpsConfirm, type OpsSnapshot } from "@/lib/ops.functions";

export const Route = createFileRoute("/ops")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ops — users and households" },
      { name: "description", content: "ops users and households" },
      { property: "og:title", content: "ops — users and households" },
      { property: "og:description", content: "ops users and households" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { next: "/ops" } });
    }
    try {
      const snapshot = await loadOpsSnapshot();
      return { snapshot };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error ?? "");
      if (msg.includes("Missing Supabase environment variable")) {
        const names = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"].filter((name) =>
          msg.includes(name),
        );
        return {
          snapshot: {
            users: [],
            households: [],
            missingEnv: names.length > 0 ? names : ["SUPABASE_SERVICE_ROLE_KEY"],
          },
        };
      }
      throw notFound();
    }
  },
  component: OpsPage,
});

function OpsPage() {
  const { snapshot } = Route.useRouteContext() as { snapshot: OpsSnapshot };
  const resend = useServerFn(resendOpsConfirm);
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onResend(userId: string) {
    setBusyId(userId);
    setNotice(null);
    try {
      const result = await resend({ data: { userId } });
      if (result.ok) {
        setNotice("Sent.");
        await router.invalidate();
      } else {
        setNotice(result.error);
      }
    } catch {
      setNotice("Not found");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="font-display text-xl">ops</h1>
      {snapshot.missingEnv && snapshot.missingEnv.length > 0 ? (
        <p id="missingEnv" className="mt-3 text-sm font-bold text-berry">
          missingEnv: {snapshot.missingEnv.join(", ")}
        </p>
      ) : null}
      {notice ? <p className="mt-3 text-sm font-bold">{notice}</p> : null}

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        users
      </h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="px-2 py-1 font-bold">email</th>
              <th className="px-2 py-1 font-bold">confirmed</th>
              <th className="px-2 py-1 font-bold">confirm sent</th>
              <th className="px-2 py-1 font-bold">created</th>
              <th className="px-2 py-1 font-bold" />
            </tr>
          </thead>
          <tbody>
            {snapshot.users.map((user) => {
              const unconfirmed = !user.email_confirmed_at;
              return (
                <tr key={user.id} className="border-b">
                  <td className="px-2 py-1">{user.email ?? "—"}</td>
                  <td className="px-2 py-1">{user.email_confirmed_at ?? "—"}</td>
                  <td className="px-2 py-1">{user.confirmation_sent_at ?? "—"}</td>
                  <td className="px-2 py-1">{user.created_at}</td>
                  <td className="px-2 py-1">
                    {unconfirmed ? (
                      <button
                        type="button"
                        disabled={busyId === user.id}
                        onClick={() => void onResend(user.id)}
                        className="rounded-full bg-navy px-3 py-1 font-display text-cream disabled:opacity-50"
                      >
                        {busyId === user.id ? "…" : "resend"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        households
      </h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="px-2 py-1 font-bold">name</th>
              <th className="px-2 py-1 font-bold">owner</th>
              <th className="px-2 py-1 font-bold">created</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.households.map((household) => (
              <tr key={household.id} className="border-b">
                <td className="px-2 py-1">{household.name}</td>
                <td className="px-2 py-1">{household.owner_user_id}</td>
                <td className="px-2 py-1">{household.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
