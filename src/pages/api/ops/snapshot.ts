import type { APIRoute } from "astro";
import { loadOpsSnapshot } from "../../../lib/ops.functions";
import { getOpsClaimsFromBearer, missingEnvNames } from "../../../lib/ops.server";

export const prerender = false;

const json = { "content-type": "application/json; charset=utf-8" };

function opsErrorResponse(error: unknown): Response {
  const msg = error instanceof Error ? error.message : "Error";
  if (msg === "Unauthorized") {
    return new Response(JSON.stringify({ error: msg }), { status: 401, headers: json });
  }
  if (msg === "Not found") {
    return new Response(JSON.stringify({ error: msg }), { status: 404, headers: json });
  }
  return new Response(JSON.stringify({ error: "Error" }), { status: 500, headers: json });
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await getOpsClaimsFromBearer(request.headers.get("authorization"));
    const snapshot = await loadOpsSnapshot(claims);
    return new Response(JSON.stringify(snapshot), { status: 200, headers: json });
  } catch (error) {
    const missingEnv = missingEnvNames(error);
    if (missingEnv) {
      return new Response(JSON.stringify({ users: [], households: [], missingEnv }), {
        status: 200,
        headers: json,
      });
    }
    return opsErrorResponse(error);
  }
};
