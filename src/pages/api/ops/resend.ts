import type { APIRoute } from "astro";
import { resendOpsConfirm } from "../../../lib/ops.functions";
import { getOpsClaimsFromBearer } from "../../../lib/ops.server";

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

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await getOpsClaimsFromBearer(request.headers.get("authorization"));
    const body = (await request.json().catch(() => null)) as { userId?: unknown } | null;
    const userId = typeof body?.userId === "string" ? body.userId : "";
    if (!userId) throw new Error("Not found");
    const result = await resendOpsConfirm(claims, userId);
    return new Response(JSON.stringify(result), { status: 200, headers: json });
  } catch (error) {
    return opsErrorResponse(error);
  }
};
