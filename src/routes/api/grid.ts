import { createFileRoute } from "@tanstack/react-router";

async function GET() {
  const { handleGridInfo } = await import("@/lib/week-play.server");
  return handleGridInfo();
}

async function POST({ request }: { request: Request }) {
  const { handleSubmit } = await import("@/lib/week-play.server");
  return handleSubmit(request, "grid");
}

export const Route = createFileRoute("/api/grid")({
  server: {
    handlers: {
      GET,
      POST,
    },
  },
});
