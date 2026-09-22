import { createFileRoute } from "@tanstack/react-router";

async function GET({ request }: { request: Request }) {
  const { handlePicks } = await import("@/lib/week-play.server");
  return handlePicks(request);
}

export const Route = createFileRoute("/api/picks")({
  server: {
    handlers: {
      GET,
      POST: GET,
    },
  },
});
