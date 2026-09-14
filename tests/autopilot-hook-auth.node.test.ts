import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  autopilotHookAuthorized,
  providedAutopilotSecret,
} from "../src/lib/autopilot-hook-auth.ts";

const ROOT = process.cwd();
const GAMBLE = /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i;
const CRON = "cron-secret-for-tests-only-not-a-real-key";
const PUBLISHABLE = "sb_publishable_test_key";
const ANON = "eyJhbGciOi-anon-test-key";

describe("autopilotHookAuthorized", () => {
  it("accepts only AUTOPILOT_CRON_SECRET", () => {
    assert.equal(
      autopilotHookAuthorized({
        provided: CRON,
        cronSecret: CRON,
        publishableKeys: [PUBLISHABLE, ANON],
      }),
      true,
    );
  });

  it("rejects missing auth, missing secret, and publishable/anon keys", () => {
    const keys = [PUBLISHABLE, ANON];
    assert.equal(
      autopilotHookAuthorized({ provided: "", cronSecret: CRON, publishableKeys: keys }),
      false,
    );
    assert.equal(
      autopilotHookAuthorized({ provided: CRON, cronSecret: "", publishableKeys: keys }),
      false,
    );
    assert.equal(
      autopilotHookAuthorized({
        provided: PUBLISHABLE,
        cronSecret: CRON,
        publishableKeys: keys,
      }),
      false,
    );
    assert.equal(
      autopilotHookAuthorized({ provided: ANON, cronSecret: CRON, publishableKeys: keys }),
      false,
    );
    assert.equal(
      autopilotHookAuthorized({
        provided: PUBLISHABLE,
        cronSecret: PUBLISHABLE,
        publishableKeys: keys,
      }),
      false,
    );
  });
});

describe("providedAutopilotSecret", () => {
  it("reads the named header before Authorization or apikey", () => {
    assert.equal(
      providedAutopilotSecret(
        new Headers({
          "x-autopilot-cron-secret": CRON,
          authorization: `Bearer ${PUBLISHABLE}`,
          apikey: PUBLISHABLE,
        }),
      ),
      CRON,
    );
    assert.equal(
      providedAutopilotSecret(new Headers({ "autopilot-cron-secret": ` ${CRON} ` })),
      CRON,
    );
    assert.equal(
      providedAutopilotSecret(new Headers({ authorization: `Bearer ${CRON}` })),
      CRON,
    );
    assert.equal(providedAutopilotSecret(new Headers({ apikey: CRON })), CRON);
    assert.equal(providedAutopilotSecret(new Headers()), "");
  });
});

describe("autopilot hook wiring", () => {
  it("public hook uses the server handler and does not allow publishable-key auth", () => {
    const route = readFileSync(join(ROOT, "src/routes/api/public/hooks/autopilot.ts"), "utf8");
    assert.match(route, /handleAutopilotHook/);
    assert.match(route, /autopilot-hook\.server/);
    assert.match(route, /GET:\s*handle/);
    assert.match(route, /POST:\s*handle/);
    assert.doesNotMatch(route, /SUPABASE_ANON_KEY/);
    assert.doesNotMatch(route, /SUPABASE_PUBLISHABLE_KEY/);
    assert.doesNotMatch(route, /VITE_AUTOPILOT/);
    assert.doesNotMatch(route, GAMBLE);

    const server = readFileSync(join(ROOT, "src/lib/autopilot-hook.server.ts"), "utf8");
    assert.match(server, /process\.env\["AUTOPILOT_CRON_SECRET"\]/);
    assert.match(server, /autopilotHookAuthorized/);
    assert.doesNotMatch(server, /VITE_AUTOPILOT/);
    assert.doesNotMatch(server, /allowed\.includes/);
    assert.doesNotMatch(server, GAMBLE);
  });

  it("vercel.json schedules the production hook every 10 minutes", () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
      crons?: { path?: string; schedule?: string }[];
    };
    const cron = (vercel.crons ?? []).find((row) => row.path === "/api/public/hooks/autopilot");
    assert.ok(cron, "missing vercel.json cron for /api/public/hooks/autopilot");
    assert.equal(cron.schedule, "*/10 * * * *");
  });

  it("commish Run autopilot now still uses JWT + household ownership", () => {
    const fn = readFileSync(join(ROOT, "src/lib/autopilot.functions.ts"), "utf8");
    assert.match(fn, /export const runAutopilotNow/);
    assert.match(fn, /requireSupabaseAuth/);
    assert.match(fn, /householdId/);
    assert.match(fn, /That household isn't yours/);
    assert.doesNotMatch(fn, /AUTOPILOT_CRON_SECRET/);
    assert.doesNotMatch(fn, GAMBLE);

    const commish = readFileSync(join(ROOT, "src/routes/_authenticated/commissioner.tsx"), "utf8");
    assert.match(commish, /Run autopilot now/);
    assert.match(commish, /runAutopilotNow/);
    assert.doesNotMatch(commish, /AUTOPILOT_CRON_SECRET/);
    assert.doesNotMatch(commish, /VITE_AUTOPILOT/);
    assert.doesNotMatch(commish, GAMBLE);
  });

  it("does not expose the cron secret through a VITE_ env", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    assert.match(example, /^AUTOPILOT_CRON_SECRET=$/m);
    assert.doesNotMatch(example, /VITE_AUTOPILOT/);
  });
});
