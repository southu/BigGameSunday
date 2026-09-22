import { createFileRoute } from "@tanstack/react-router";

async function GET() {
  const { handleWeek } = await import("@/lib/week-play.server");
  return handleWeek();
}

export const Route = createFileRoute("/api/week")({
  server: {
    handlers: {
      GET,
      POST: GET,
    },
  },
});
