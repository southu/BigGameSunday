import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const GAMBLE = /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i;
const COPYRIGHT = "© 2026 DP7, LLC. All rights reserved. Big Game Sunday is a product of DP7, LLC.";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("site footer", () => {
  it("uses the exact DP7 copyright line and Privacy + Terms links", () => {
    const footer = read("src/components/bgs/SiteFooter.tsx");
    assert.ok(footer.includes(COPYRIGHT));
    assert.match(footer, /to="\/privacy"/);
    assert.match(footer, /to="\/terms"/);
    assert.match(footer, />\s*Privacy\s*</);
    assert.match(footer, />\s*Terms\s*</);
    assert.doesNotMatch(footer, GAMBLE);
  });

  it("renders on landing, auth, and authenticated shell", () => {
    assert.match(read("src/routes/index.tsx"), /SiteFooter/);
    assert.match(read("src/routes/auth.tsx"), /SiteFooter/);
    assert.match(read("src/components/bgs/AppShell.tsx"), /SiteFooter/);
    assert.doesNotMatch(read("src/routes/index.tsx"), GAMBLE);
    assert.doesNotMatch(read("src/routes/auth.tsx"), GAMBLE);
    assert.doesNotMatch(read("src/components/bgs/AppShell.tsx"), GAMBLE);
  });
});
