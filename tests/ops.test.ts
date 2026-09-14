import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  assertOps,
  confirmationSentAdvanced,
  extractAccessTokenFromRequest,
  getOpsClaimsFromRequest,
  loadOpsSnapshotHandler,
  missingEnvNames,
  opsAllowlist,
  parseOpsAllowlist,
  resendOpsConfirmHandler,
  resetOpsAdminForTests,
  type OpsAdminLike,
} from "../src/lib/ops.server";
import { gateOpsRequest } from "../src/lib/ops.functions";

const previousAllowlist = process.env.OPS_ALLOWLIST;

afterEach(() => {
  if (previousAllowlist === undefined) delete process.env.OPS_ALLOWLIST;
  else process.env.OPS_ALLOWLIST = previousAllowlist;
});

describe("OPS_ALLOWLIST", () => {
  it("parses comma-separated emails, trimmed and lowercased", () => {
    expect(parseOpsAllowlist("  JsnHrpr@gmail.com, other@example.com ")).toEqual([
      "jsnhrpr@gmail.com",
      "other@example.com",
    ]);
  });

  it("is empty when the env is unset or blank", () => {
    delete process.env.OPS_ALLOWLIST;
    expect(opsAllowlist().size).toBe(0);
    process.env.OPS_ALLOWLIST = "";
    expect(opsAllowlist().size).toBe(0);
    process.env.OPS_ALLOWLIST = "  ,  ";
    expect(opsAllowlist().size).toBe(0);
  });

  it("uses the env list when set", () => {
    process.env.OPS_ALLOWLIST = "ops@example.com";
    expect(opsAllowlist().has("ops@example.com")).toBe(true);
    expect(opsAllowlist().has("jsnhrpr@gmail.com")).toBe(false);
  });

  it("throws Not found for a non-allowlisted email", () => {
    process.env.OPS_ALLOWLIST = "ops@example.com";
    expect(() => assertOps({ email: "stranger@example.com" })).toThrow("Not found");
  });

  it("throws Not found for any email when the allowlist is empty", () => {
    delete process.env.OPS_ALLOWLIST;
    expect(() => assertOps({ email: "jsnhrpr@gmail.com" })).toThrow("Not found");
    process.env.OPS_ALLOWLIST = "";
    expect(() => assertOps({ email: "ops@example.com" })).toThrow("Not found");
  });
});

describe("missingEnv", () => {
  const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    if (previousServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
    resetOpsAdminForTests();
  });

  it("extracts service role and url names from the admin error", () => {
    expect(
      missingEnvNames(
        new Error("Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL"),
      ),
    ).toEqual(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]);
  });

  it("returns undefined for unrelated errors", () => {
    expect(missingEnvNames(new Error("Not found"))).toBeUndefined();
  });

  it("loadOpsSnapshotHandler returns missingEnv when the service role key is absent", async () => {
    process.env.OPS_ALLOWLIST = "ops@example.com";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetOpsAdminForTests();

    const snapshot = await loadOpsSnapshotHandler({ email: "ops@example.com" });
    expect(snapshot.users).toEqual([]);
    expect(snapshot.households).toEqual([]);
    expect(snapshot.missingEnv).toEqual(expect.arrayContaining(["SUPABASE_SERVICE_ROLE_KEY"]));
  });

  it("still 404s a non-allowlisted email when env is missing", async () => {
    process.env.OPS_ALLOWLIST = "ops@example.com";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetOpsAdminForTests();

    await expect(loadOpsSnapshotHandler({ email: "stranger@example.com" })).rejects.toThrow(
      "Not found",
    );
  });
});

describe("ops request session token", () => {
  it("reads a Bearer access token", () => {
    const token = "aaa.bbb.ccc";
    const request = new Request("https://biggamesunday.com/ops", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(extractAccessTokenFromRequest(request)).toBe(token);
  });

  it("reads the parent access cookie", () => {
    const token = "aaa.bbb.ccc";
    const request = new Request("https://biggamesunday.com/ops", {
      headers: { cookie: `sb-access-token=${token}` },
    });
    expect(extractAccessTokenFromRequest(request)).toBe(token);
  });

  it("returns null when the request has no session", () => {
    const request = new Request("https://biggamesunday.com/ops");
    expect(extractAccessTokenFromRequest(request)).toBeNull();
  });

  it("getOpsClaimsFromRequest throws Unauthorized without a session", async () => {
    const request = new Request("https://biggamesunday.com/ops");
    await expect(getOpsClaimsFromRequest(request)).rejects.toThrow("Unauthorized");
  });

  it("gateOpsRequest throws Unauthorized without a session", async () => {
    const request = new Request("https://biggamesunday.com/ops");
    await expect(gateOpsRequest(request)).rejects.toThrow("Unauthorized");
  });
});

describe("resend confirm", () => {
  function adminForUnconfirmed(opts: {
    before: string | null;
    after: string | null;
    resendError?: { message: string } | null;
    email?: string;
    confirmed?: string | null;
  }): { admin: OpsAdminLike; resendCalls: unknown[]; generateLinkCalls: unknown[] } {
    const resendCalls: unknown[] = [];
    const generateLinkCalls: unknown[] = [];
    let reads = 0;
    const admin: OpsAdminLike = {
      auth: {
        resend: async (params) => {
          resendCalls.push(params);
          return { error: opts.resendError ?? null };
        },
        admin: {
          getUserById: async (id) => {
            reads += 1;
            return {
              data: {
                user: {
                  id,
                  email: opts.email ?? "unconfirmed@example.com",
                  email_confirmed_at: opts.confirmed ?? null,
                  confirmation_sent_at: reads === 1 ? opts.before : opts.after,
                },
              },
              error: null,
            };
          },
          generateLink: async (params: unknown) => {
            generateLinkCalls.push(params);
            return { error: null };
          },
        } as OpsAdminLike["auth"]["admin"],
      },
    };
    return { admin, resendCalls, generateLinkCalls };
  }

  it("sends a signup confirmation and requires confirmation_sent_at to advance", async () => {
    process.env.OPS_ALLOWLIST = "ops@example.com";
    const { admin, resendCalls, generateLinkCalls } = adminForUnconfirmed({
      before: "2026-09-14T11:00:00.000Z",
      after: "2026-09-14T12:00:00.000Z",
    });

    const result = await resendOpsConfirmHandler(
      { email: "ops@example.com" },
      "user-1",
      admin,
    );

    expect(result).toEqual({ ok: true });
    expect(resendCalls).toEqual([
      {
        type: "signup",
        email: "unconfirmed@example.com",
        options: { emailRedirectTo: "https://biggamesunday.com/auth" },
      },
    ]);
    expect(generateLinkCalls).toEqual([]);
  });

  it("fails when signup resend does not update the sent marker", async () => {
    process.env.OPS_ALLOWLIST = "ops@example.com";
    const { admin, resendCalls } = adminForUnconfirmed({
      before: "2026-09-14T11:00:00.000Z",
      after: "2026-09-14T11:00:00.000Z",
    });

    const result = await resendOpsConfirmHandler(
      { email: "ops@example.com" },
      "user-1",
      admin,
    );

    expect(resendCalls).toHaveLength(1);
    expect(result).toEqual({ ok: false, error: "Could not send" });
  });

  it("fails when auth.resend returns an error (does not fall back to generateLink)", async () => {
    process.env.OPS_ALLOWLIST = "ops@example.com";
    const { admin, generateLinkCalls } = adminForUnconfirmed({
      before: null,
      after: "2026-09-14T12:00:00.000Z",
      resendError: { message: "rate limited" },
    });

    const result = await resendOpsConfirmHandler(
      { email: "ops@example.com" },
      "user-1",
      admin,
    );

    expect(result).toEqual({ ok: false, error: "Could not send" });
    expect(generateLinkCalls).toEqual([]);
  });

  it("treats a newly set confirmation_sent_at as advanced", () => {
    expect(confirmationSentAdvanced(null, "2026-09-14T12:00:00.000Z")).toBe(true);
    expect(confirmationSentAdvanced("2026-09-14T11:00:00.000Z", "2026-09-14T11:00:00.000Z")).toBe(
      false,
    );
  });
});

describe("ops surfaces in the repo", () => {
  const root = process.cwd();

  it("keeps /ops out of public Header nav", () => {
    const header = fs.readFileSync(path.join(root, "src/components/Header.astro"), "utf-8");
    expect(header.includes('href="/ops"')).toBe(false);
  });

  it("does not hard-code operator emails in ops modules", () => {
    const functions = fs.readFileSync(path.join(root, "src/lib/ops.functions.ts"), "utf-8");
    const opsPage = fs.readFileSync(path.join(root, "src/pages/ops.astro"), "utf-8");
    const server = fs.readFileSync(path.join(root, "src/lib/ops.server.ts"), "utf-8");
    expect(functions.includes("jsnhrpr@gmail.com")).toBe(false);
    expect(opsPage.includes("jsnhrpr@gmail.com")).toBe(false);
    expect(opsPage.includes("ops.server")).toBe(false);
    expect(server.includes("jsnhrpr@gmail.com")).toBe(false);
  });

  it("renders missingEnv and Not found on the ops page", () => {
    const opsPage = fs.readFileSync(path.join(root, "src/pages/ops.astro"), "utf-8");
    expect(opsPage).toMatch(/id="missingEnv"/);
    expect(opsPage).toMatch(/missingEnv:/);
    expect(opsPage).toMatch(/Not found/);
    expect(opsPage).toMatch(/\/auth\?next=\/ops/);
  });

  it("redirects unauthenticated GET /ops on the server", () => {
    const opsPage = fs.readFileSync(path.join(root, "src/pages/ops.astro"), "utf-8");
    expect(opsPage).toMatch(/Astro\.redirect\(\s*["']\/auth\?next=\/ops["']\s*\)/);
    expect(opsPage).toMatch(/gateOpsRequest\(Astro\.request\)/);
  });

  it("GET snapshot only reads users and households", () => {
    const src = fs.readFileSync(path.join(root, "src/lib/ops.server.ts"), "utf-8");
    expect(src).not.toMatch(/collapseDuplicateIdentitiesToHouseholdOwner\(/);
    expect(src).not.toMatch(/deleteUser\(/);
    expect(src).not.toMatch(/updateUserById\(/);
    expect(src).toMatch(/auth\.admin\.listUsers/);
    expect(src).toMatch(/from\("households"\)/);
  });

  it("documents the allowlist env as server-only", () => {
    const doc = fs.readFileSync(path.join(root, "ops/allowlist.md"), "utf-8");
    expect(doc.includes("OPS_ALLOWLIST")).toBe(true);
    expect(doc.includes("src/lib/ops.server.ts")).toBe(true);
    expect(doc.includes("src/pages/ops.astro")).toBe(true);
  });

  it("resend handler does not succeed via generateLink invite", () => {
    const src = fs.readFileSync(path.join(root, "src/lib/ops.server.ts"), "utf-8");
    expect(src).not.toMatch(/generateLink/);
    expect(src).toMatch(/type:\s*"signup"/);
    expect(src).toMatch(/confirmation_sent_at/);
  });
});
