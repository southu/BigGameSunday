import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduled autopilot pass (Vercel Cron every 10 minutes).
 * Opens, locks, resolves and finalizes weeks without anyone opening the app.
 * Auth is AUTOPILOT_CRON_SECRET only — the handler lives in a .server.ts module
 * so the secret is never bundled for the browser.
 */
async function handle({ request }: { request: Request }) {
  const { handleAutopilotHook } = await import("@/lib/autopilot-hook.server");
  return handleAutopilotHook(request);
}

export const Route = createFileRoute("/api/public/hooks/autopilot")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});
