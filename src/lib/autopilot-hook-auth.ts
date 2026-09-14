/** Pure gate for the public autopilot hook. No env reads — callers pass values. */

export function providedAutopilotSecret(headers: Headers): string {
  const named =
    headers.get("x-autopilot-cron-secret") ??
    headers.get("autopilot-cron-secret") ??
    "";
  if (named.trim()) return named.trim();

  const auth = headers.get("authorization") ?? "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  if (bearer) return bearer;

  return (headers.get("apikey") ?? "").trim();
}

function secretsMatch(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/** True only when `provided` equals AUTOPILOT_CRON_SECRET. Publishable/anon keys never pass. */
export function autopilotHookAuthorized(opts: {
  provided: string;
  cronSecret: string;
  publishableKeys: readonly string[];
}): boolean {
  const provided = opts.provided;
  const cronSecret = opts.cronSecret;
  if (!provided || !cronSecret) return false;
  if (opts.publishableKeys.includes(provided)) return false;
  if (opts.publishableKeys.includes(cronSecret)) return false;
  return secretsMatch(provided, cronSecret);
}
