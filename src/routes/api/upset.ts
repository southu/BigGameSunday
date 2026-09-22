import { createFileRoute } from "@tanstack/react-router";

async function GET() {
  const { handleUpsetInfo } = await import("@/lib/week-play.server");
  return handleUpsetInfo();
}

async function POST({ request }: { request: Request }) {
  const { handleSubmit } = await import("@/lib/week-play.server");
  return handleSubmit(request, "upset");
}

export const Route = createFileRoute("/api/upset")({
  server: {
    handlers: {
      GET,
      POST,
    },
  },
});
