import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduled autopilot pass (called by the database scheduler every 10 minutes).
 * Opens, locks, resolves and finalizes weeks without anyone opening the app.
 */
export const Route = createFileRoute("/api/public/hooks/autopilot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const allowed = [
          process.env["SUPABASE_ANON_KEY"],
          process.env["SUPABASE_PUBLISHABLE_KEY"],
        ].filter(Boolean) as string[];
        if (!key || !allowed.includes(key)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runAutopilot } = await import("@/lib/autopilot.server");
          const { actions } = await runAutopilot(
            supabaseAdmin as unknown as { from: (t: string) => any },
          );
          return Response.json({ ok: true, actions }, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          console.error("[autopilot]", error);
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "Autopilot failed" },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
