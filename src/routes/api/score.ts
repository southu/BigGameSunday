import { createFileRoute } from "@tanstack/react-router";

async function GET() {
  const { handleScore } = await import("@/lib/week-play.server");
  return handleScore();
}

export const Route = createFileRoute("/api/score")({
  server: {
    handlers: {
      GET,
      POST: GET,
    },
  },
});
