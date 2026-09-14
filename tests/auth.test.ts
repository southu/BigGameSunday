import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  AUTH_ERROR_COPY,
  authModeFromSearch,
  googleRedirectTo,
  isPasswordRecoveryHash,
  mapAuthError,
  passwordResetRedirectTo,
} from "../src/lib/auth/parent";
import { CANONICAL_HOST, canonicalRedirectLocation, WWW_HOST } from "../src/lib/auth/host";

const root = process.cwd();
const GAMBLING = /\b(bet|parlay|odds|spread|wager)\b/i;

describe("auth mode", () => {
  it("defaults to Sign in when mode is unset", () => {
    expect(authModeFromSearch("")).toBe("signin");
    expect(authModeFromSearch(new URLSearchParams())).toBe("signin");
    expect(authModeFromSearch("next=/ops")).toBe("signin");
    expect(authModeFromSearch("mode=signin")).toBe("signin");
  });

  it("uses signup only when mode=signup is explicit", () => {
    expect(authModeFromSearch("mode=signup")).toBe("signup");
    expect(authModeFromSearch("?mode=signup&next=/ops")).toBe("signup");
  });
});

describe("password recovery", () => {
  it("builds resetPasswordForEmail redirectTo from the current origin + /auth", () => {
    expect(passwordResetRedirectTo("https://biggamesunday.com")).toBe(
      "https://biggamesunday.com/auth",
    );
    expect(passwordResetRedirectTo("https://biggamesunday.com/")).toBe(
      "https://biggamesunday.com/auth",
    );
  });

  it("detects recovery hash tokens", () => {
    expect(isPasswordRecoveryHash("#access_token=abc&type=recovery")).toBe(true);
    expect(isPasswordRecoveryHash("type=recovery&refresh_token=x")).toBe(true);
    expect(isPasswordRecoveryHash("#type=signup")).toBe(false);
    expect(isPasswordRecoveryHash("")).toBe(false);
  });
});

describe("mapped auth errors", () => {
  it("maps unconfirmed, invalid credentials, and already registered", () => {
    expect(mapAuthError({ message: "Email not confirmed" })).toBe(AUTH_ERROR_COPY.unconfirmed);
    expect(mapAuthError({ code: "email_not_confirmed" })).toBe(AUTH_ERROR_COPY.unconfirmed);
    expect(mapAuthError({ message: "Invalid login credentials" })).toBe(
      AUTH_ERROR_COPY.invalidCredentials,
    );
    expect(mapAuthError({ code: "invalid_credentials" })).toBe(AUTH_ERROR_COPY.invalidCredentials);
    expect(mapAuthError({ message: "User already registered" })).toBe(
      AUTH_ERROR_COPY.alreadyRegistered,
    );
    expect(mapAuthError({ code: "user_already_exists" })).toBe(AUTH_ERROR_COPY.alreadyRegistered);
  });

  it("does not invent gambling vocab", () => {
    expect(GAMBLING.test(AUTH_ERROR_COPY.unconfirmed)).toBe(false);
    expect(GAMBLING.test(AUTH_ERROR_COPY.invalidCredentials)).toBe(false);
    expect(GAMBLING.test(AUTH_ERROR_COPY.alreadyRegistered)).toBe(false);
  });
});

describe("canonical host", () => {
  it("301s www to apex and leaves apex alone", () => {
    const www = canonicalRedirectLocation(
      WWW_HOST,
      new URL("https://www.biggamesunday.com/auth?next=/ops"),
    );
    expect(www).toBe(`https://${CANONICAL_HOST}/auth?next=/ops`);
    expect(canonicalRedirectLocation(CANONICAL_HOST, new URL("https://biggamesunday.com/auth"))).toBe(
      null,
    );
  });
});

describe("google redirect", () => {
  it("keeps ops on /auth?next=/ops and otherwise uses origin", () => {
    expect(googleRedirectTo("https://biggamesunday.com", "/ops")).toBe(
      "https://biggamesunday.com/auth?next=/ops",
    );
    expect(googleRedirectTo("https://biggamesunday.com", null)).toBe("https://biggamesunday.com");
  });
});

describe("auth page source", () => {
  const authPage = fs.readFileSync(path.join(root, "src/pages/auth.astro"), "utf-8");
  const parent = fs.readFileSync(path.join(root, "src/lib/auth/parent.ts"), "utf-8");
  const middleware = fs.readFileSync(path.join(root, "src/middleware.ts"), "utf-8");
  const identityDoc = fs.readFileSync(path.join(root, "ops/identity-merge.md"), "utf-8");

  it("defaults the Sign in tab in HTML when mode is unset", () => {
    expect(authPage).toMatch(/searchParams\.get\("mode"\) === "signup" \? "signup" : "signin"/);
    expect(authPage).toMatch(/id="tab-signin"/);
    expect(authPage).toMatch(/aria-selected=\{initialMode === "signin" \? "true" : "false"\}/);
    expect(authPage).toContain("New household");
    expect(authPage).toContain("Parent's email");
    expect(authPage).not.toMatch(/next === "\/ops" \? "signin" : "signup"/);
  });

  it("exposes resend confirmation on /auth", () => {
    expect(authPage).toMatch(/id="resend"/);
    expect(authPage).toContain("Resend confirmation");
    expect(parent).toMatch(/auth\.resend/);
    expect(parent).toMatch(/type:\s*"signup"/);
  });

  it("sends recovery to current origin + /auth and handles PASSWORD_RECOVERY via updateUser", () => {
    expect(authPage).toContain("passwordResetRedirectTo(window.location.origin)");
    expect(authPage).toContain("PASSWORD_RECOVERY");
    expect(authPage).toContain("Set a new password");
    expect(authPage).toContain("updateUserPassword");
    expect(parent).toMatch(/resetPasswordForEmail/);
    expect(parent).toMatch(/updateUser\(\{\s*password/);
  });

  it("301s www to the apex host", () => {
    expect(middleware).toContain("canonicalRedirectLocation");
    expect(middleware).toMatch(/redirect\(location,\s*301\)/);
  });

  it("documents same-email Google identity linking", () => {
    expect(identityDoc.toLowerCase()).toMatch(/automatic linking/);
    expect(identityDoc).toMatch(/Google/);
    expect(identityDoc).toMatch(/auth\.users/);
  });

  it("keeps parent copy and no gambling vocab on /auth", () => {
    expect(authPage).toContain("Parent's email");
    expect(GAMBLING.test(authPage)).toBe(false);
    expect(GAMBLING.test(parent)).toBe(false);
  });
});
