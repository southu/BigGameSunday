import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  assertOps,
  collapseDuplicateIdentitiesToHouseholdOwner,
  confirmationSentAdvanced,
  OPS_RELINK_IDENTITIES_RPC,
  opsAllowlist,
  parseOpsAllowlist,
  planIdentityCollapse,
  resendOpsConfirmHandler,
  type CollapseUser,
  type OpsAdminLike,
} from "../src/lib/ops.server";
import type { OpsHousehold } from "../src/lib/ops.functions";

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

  it("falls back to the live operator when the env is empty (server-only)", () => {
    process.env.OPS_ALLOWLIST = "";
    expect(opsAllowlist().has("jsnhrpr@gmail.com")).toBe(true);
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
});

describe("identity collapse", () => {
  const households: OpsHousehold[] = [
    {
      id: "hh-1",
      name: "Family",
      owner_user_id: "owner-1",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];

  const owner: CollapseUser = {
    id: "owner-1",
    email: "parent@example.com",
    email_confirmed_at: "2026-01-02T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] },
    identities: [{ provider: "email" }],
  };

  const googleExtra: CollapseUser = {
    id: "google-2",
    email: "parent@example.com",
    email_confirmed_at: "2026-01-03T00:00:00Z",
    app_metadata: { provider: "google", providers: ["google"] },
    identities: [{ provider: "google" }],
  };

  it("is a no-op when there is no household to collapse onto", () => {
    expect(planIdentityCollapse([owner, googleExtra], [])).toEqual([]);
  });

  it("is a no-op when the email is unique", () => {
    expect(planIdentityCollapse([owner], households)).toEqual([]);
  });

  it("plans extras onto households.owner_user_id", () => {
    const plans = planIdentityCollapse([owner, googleExtra], households);
    expect(plans).toEqual([
      {
        email: "parent@example.com",
        ownerId: "owner-1",
        extraIds: ["google-2"],
        extraProviders: ["google"],
        confirmOwnerEmail: false,
      },
    ]);
  });

  it("relinks the Google identity onto the owner and deletes the extra user", async () => {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const deleted: string[] = [];
    const updates: Array<{ id: string; attributes: Record<string, unknown> }> = [];

    const admin: OpsAdminLike = {
      auth: {
        resend: async () => ({ error: null }),
        admin: {
          getUserById: async (id) => ({ data: { user: { id } }, error: null }),
          updateUserById: async (id, attributes) => {
            updates.push({ id, attributes });
            return {};
          },
          deleteUser: async (id) => {
            deleted.push(id);
            return {};
          },
        },
      },
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        return { data: { moved: 1 }, error: null };
      },
    };

    const plans = await collapseDuplicateIdentitiesToHouseholdOwner(
      [owner, googleExtra],
      households,
      admin,
    );

    expect(plans).toHaveLength(1);
    expect(rpcCalls).toEqual([
      {
        fn: OPS_RELINK_IDENTITIES_RPC,
        args: { from_user_id: "google-2", to_user_id: "owner-1" },
      },
    ]);
    expect(updates).toEqual([
      {
        id: "owner-1",
        attributes: {
          app_metadata: { provider: "email", providers: ["email", "google"] },
        },
      },
    ]);
    expect(deleted).toEqual(["google-2"]);
  });

  it("does not succeed with metadata-only stamps when identities cannot be relinked", async () => {
    const updates: Array<{ id: string; attributes: Record<string, unknown> }> = [];
    const deleted: string[] = [];
    const admin: OpsAdminLike = {
      auth: {
        resend: async () => ({ error: null }),
        admin: {
          getUserById: async (id) => ({ data: { user: { id } }, error: null }),
          updateUserById: async (id, attributes) => {
            updates.push({ id, attributes });
            return {};
          },
          deleteUser: async (id) => {
            deleted.push(id);
            return {};
          },
        },
      },
      rpc: async () => ({ data: null, error: { message: "Could not find the function", code: "PGRST202" } }),
    };

    await expect(
      collapseDuplicateIdentitiesToHouseholdOwner([owner, googleExtra], households, admin),
    ).rejects.toThrow(/relink auth identities/i);
    expect(updates).toEqual([]);
    expect(deleted).toEqual([]);
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
          updateUserById: async () => ({}),
          deleteUser: async () => ({}),
          generateLink: async (params: unknown) => {
            generateLinkCalls.push(params);
            return { error: null };
          },
        } as OpsAdminLike["auth"]["admin"],
      },
      rpc: async () => ({ data: null, error: null }),
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

  it("does not put operator emails in client ops modules", () => {
    const functions = fs.readFileSync(path.join(root, "src/lib/ops.functions.ts"), "utf-8");
    const opsPage = fs.readFileSync(path.join(root, "src/pages/ops.astro"), "utf-8");
    expect(functions.includes("jsnhrpr@gmail.com")).toBe(false);
    expect(opsPage.includes("jsnhrpr@gmail.com")).toBe(false);
    expect(opsPage.includes("ops.server")).toBe(false);
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
