import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  assertOps,
  collapseDuplicateIdentitiesToHouseholdOwner,
  opsAllowlist,
  parseOpsAllowlist,
  planIdentityCollapse,
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

  it("updates owner providers and stamps extras with merged_into", async () => {
    const updates: Array<{ id: string; attributes: Record<string, unknown> }> = [];
    const admin: OpsAdminLike = {
      auth: {
        admin: {
          updateUserById: async (id, attributes) => {
            updates.push({ id, attributes });
            return {};
          },
        },
      },
    };

    const plans = await collapseDuplicateIdentitiesToHouseholdOwner(
      [owner, googleExtra],
      households,
      admin,
    );

    expect(plans).toHaveLength(1);
    expect(updates).toEqual([
      {
        id: "owner-1",
        attributes: {
          app_metadata: { provider: "email", providers: ["email", "google"] },
        },
      },
      {
        id: "google-2",
        attributes: {
          app_metadata: {
            provider: "google",
            providers: ["google"],
            merged_into: "owner-1",
          },
        },
      },
    ]);
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
});
