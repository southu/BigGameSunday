import { createFileRoute } from "@tanstack/react-router";

async function GET() {
  const { handleScore } = await import("@/lib/week-play.server");
  return handleScore();
}

export const Route = createFileRoute("/api/autopilot")({
  server: {
    handlers: {
      GET,
      POST: GET,
    },
  },
});
