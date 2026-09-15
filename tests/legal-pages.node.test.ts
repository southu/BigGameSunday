import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { markdownToHtml } from "../src/lib/legal-markdown.ts";

const ROOT = process.cwd();
const GAMBLE = /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i;

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("legal markdown sources", () => {
  it("privacy policy is Counsel text with required entity and contact", () => {
    const src = read("content/legal/privacy-policy.md");
    assert.match(src, /^# Privacy Policy\n/);
    assert.match(src, /DP7, LLC/);
    assert.match(src, /privacy@biggamesunday.com/);
    assert.match(src, /## 1\. Who we are/);
    assert.match(src, /## 2\. Scope/);
    assert.doesNotMatch(src, GAMBLE);
  });

  it("terms of use is Counsel text with required entity and contact", () => {
    const src = read("content/legal/terms-of-service.md");
    assert.match(src, /^# Terms of Use\n/);
    assert.match(src, /DP7, LLC/);
    assert.match(src, /privacy@biggamesunday.com/);
    assert.match(src, /## 1\. Acceptance/);
    assert.match(src, /## 2\. Eligibility/);
    assert.match(src, /https:\/\/biggamesunday.com\/privacy/);
    assert.doesNotMatch(src, GAMBLE);
  });
});

describe("markdownToHtml", () => {
  it("renders headings, lists, links, bold, and hard breaks", () => {
    const html = markdownToHtml(
      [
        "# Title",
        "",
        "**Hello**  ",
        "World",
        "",
        "- one",
        "- two",
        "",
        "See [Privacy Policy](https://biggamesunday.com/privacy).",
        "",
        "---",
        "",
      ].join("\n"),
    );
    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /<strong>Hello<\/strong><br \/>\nWorld/);
    assert.match(html, /<li>one<\/li>/);
    assert.match(html, /<a href="https:\/\/biggamesunday.com\/privacy">Privacy Policy<\/a>/);
    assert.match(html, /<hr \/>/);
  });

  it("renders Counsel privacy markdown including section headings", () => {
    const html = markdownToHtml(read("content/legal/privacy-policy.md"));
    assert.match(html, /<h1>Privacy Policy<\/h1>/);
    assert.match(html, /<h2>1\. Who we are<\/h2>/);
    assert.match(html, /<h2>2\. Scope<\/h2>/);
    assert.match(html, /DP7, LLC/);
    assert.match(
      html,
      /<!--email_off-->[\s\S]*privacy@biggamesunday\.com[\s\S]*<!--\/email_off-->/,
    );
    assert.doesNotMatch(html, GAMBLE);
  });

  it("renders Counsel terms markdown including section headings and privacy link", () => {
    const html = markdownToHtml(read("content/legal/terms-of-service.md"));
    assert.match(html, /<h1>Terms of Use<\/h1>/);
    assert.match(html, /<h2>1\. Acceptance<\/h2>/);
    assert.match(html, /<h2>2\. Eligibility<\/h2>/);
    assert.match(html, /DP7, LLC/);
    assert.match(
      html,
      /<!--email_off-->[\s\S]*privacy@biggamesunday\.com[\s\S]*<!--\/email_off-->/,
    );
    assert.match(html, /href="https:\/\/biggamesunday.com\/privacy"/);
    assert.doesNotMatch(html, GAMBLE);
  });
});

describe("public legal routes", () => {
  it("privacy and terms routes are public file routes with no auth gate", () => {
    const privacy = read("src/routes/privacy.tsx");
    const terms = read("src/routes/terms.tsx");
    assert.match(privacy, /createFileRoute\("\/privacy"\)/);
    assert.match(terms, /createFileRoute\("\/terms"\)/);
    assert.match(privacy, /privacy-policy\.md\?raw/);
    assert.match(terms, /terms-of-service\.md\?raw/);
    assert.doesNotMatch(privacy, /supabase|beforeLoad|_authenticated|ssr:\s*false/);
    assert.doesNotMatch(terms, /supabase|beforeLoad|_authenticated|ssr:\s*false/);
    assert.doesNotMatch(privacy, GAMBLE);
    assert.doesNotMatch(terms, GAMBLE);
    const document = read("src/components/bgs/LegalDocument.tsx");
    assert.match(document, /data-contact="privacy@biggamesunday.com"/);
    assert.doesNotMatch(document, GAMBLE);
  });
});
