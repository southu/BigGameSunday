import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";

function deploySha(): string {
  const fromEnv =
    process.env["VERCEL_GIT_COMMIT_SHA"] || process.env["VITE_VERCEL_GIT_COMMIT_SHA"] || process.env["DEPLOY_SHA"];
  if (fromEnv) return fromEnv.trim();
  for (const candidate of [join(process.cwd(), "public/version"), join(process.cwd(), "version")]) {
    try {
      const text = readFileSync(candidate, "utf8").trim();
      if (text) return text;
    } catch {
      /* try next */
    }
  }
  return "unknown";
}

export const Route = createFileRoute("/version")({
  server: {
    handlers: {
      GET: async () =>
        new Response(`${deploySha()}\n`, {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        }),
    },
  },
});
