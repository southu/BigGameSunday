import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validateCardSave, weekCardsReadOnly } from "../src/lib/card-constraints.ts";
import { fromLocalInput, parseTimestamptz, toLocalInput } from "../src/lib/nfl.ts";

const GAMBLE = /\b(odds|parlay|wager|spread|bet|bets|betting)\b/i;
const ROOT = process.cwd();

function ev(id: string, game_id: string | null, is_longshot = false) {
  return { id, game_id, is_longshot };
}

const events = [
  ev("g0a", "g0"),
  ev("g0b", "g0"),
  ev("g0c", "g0"),
  ev("g1a", "g1"),
  ev("g1b", "g1"),
  ev("g2a", "g2"),
  ev("g2b", "g2"),
  ev("g3a", "g3"),
  ev("g3b", "g3"),
  ev("g4a", "g4"),
  ev("ls", null, true),
];

const validNine = ["g0a", "g0b", "g1a", "g1b", "g2a", "g2b", "g3a", "g3b", "ls"];
const nineNoLongshot = ["g0a", "g0b", "g1a", "g1b", "g2a", "g2b", "g3a", "g3b", "g4a"];
const threeFromOneGame = ["g0a", "g0b", "g0c", "g1a", "g1b", "g2a", "g2b", "g3a", "ls"];

function save(patch: Partial<Parameters<typeof validateCardSave>[0]> = {}) {
  return validateCardSave({
    weekStatus: "open",
    lockAt: "2026-12-01T17:00:00.000Z",
    cardLockedAt: null,
    eventIds: validNine,
    events,
    upsetGameIds: ["g0", "g1", "g2"],
    lock: false,
    now: Date.parse("2026-11-01T00:00:00.000Z"),
    ...patch,
  });
}

describe("weekCardsReadOnly", () => {
  const future = "2026-12-06T18:00:00.000Z";
  const past = "2026-09-01T17:00:00+00:00";
  const now = Date.parse("2026-10-01T12:00:00.000Z");

  it("is read-only when week.status is locked or final", () => {
    assert.equal(weekCardsReadOnly({ status: "locked", lock_at: future }, now), true);
    assert.equal(weekCardsReadOnly({ status: "final", lock_at: future }, now), true);
    assert.equal(weekCardsReadOnly({ status: "open", lock_at: future }, now), false);
    assert.equal(weekCardsReadOnly({ status: "draft", lock_at: future }, now), false);
  });

  it("is read-only when now >= lock_at (timestamptz, no local re-parse)", () => {
    const lockMs = parseTimestamptz(past);
    assert.ok(lockMs != null);
    assert.equal(weekCardsReadOnly({ status: "open", lock_at: past }, lockMs), true);
    assert.equal(weekCardsReadOnly({ status: "open", lock_at: past }, lockMs! - 1), false);
    assert.equal(weekCardsReadOnly({ status: "open", lock_at: past }, now), true);
    assert.equal(weekCardsReadOnly({ status: "open", lock_at: null }, now), false);
  });
});

describe("validateCardSave", () => {
  it("blocks save while week.status is draft", () => {
    const msg = save({ weekStatus: "draft" });
    assert.ok(msg);
    assert.match(msg, /waiting for the commissioner to open/i);
  });

  it("rejects more than 2 events per game_id", () => {
    const msg = save({ eventIds: threeFromOneGame });
    assert.equal(msg, "Only 2 moments per game are allowed on your grid.");
  });

  it("rejects a lock attempt with zero longshots on a full 9-grid", () => {
    const msg = save({ eventIds: nineNoLongshot, lock: true });
    assert.equal(msg, "A full grid needs at least one longshot to lock in.");
    assert.equal(save({ eventIds: nineNoLongshot, lock: false }), null);
  });

  it("rejects 3 upsets from the same game", () => {
    const msg = save({ upsetGameIds: ["g0", "g0", "g0"] });
    assert.equal(msg, "Pick 3 underdogs from 3 different games.");
  });

  it("rejects writes after lock_at or when the week is locked/final", () => {
    assert.match(save({ weekStatus: "locked" }) ?? "", /locked/i);
    assert.match(save({ weekStatus: "final" }) ?? "", /locked/i);
    assert.match(
      save({
        lockAt: "2026-09-01T17:00:00.000Z",
        now: Date.parse("2026-09-01T17:00:00.000Z"),
      }) ?? "",
      /locked/i,
    );
  });

  it("allows a complete lock on an open week before lock_at", () => {
    assert.equal(save({ lock: true }), null);
  });
});

describe("timestamptz lock_at helpers", () => {
  it("fromLocalInput interprets naive datetime-local as local once", () => {
    const naive = "2026-09-14T13:00";
    const expected = new Date(2026, 8, 14, 13, 0, 0).toISOString();
    assert.equal(fromLocalInput(naive), expected);
    assert.equal(fromLocalInput("2026-09-14T13:00:00"), expected);
  });

  it("fromLocalInput keeps a timestamptz instant (no double local re-parse)", () => {
    const zoned = "2026-09-14T17:00:00.000Z";
    const offset = "2026-09-14T13:00:00-04:00";
    assert.equal(fromLocalInput(zoned), zoned);
    assert.equal(Date.parse(fromLocalInput(offset)!), Date.parse(offset));

    const d = new Date(zoned);
    const doubled = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
    if (d.getTimezoneOffset() !== 0) {
      assert.notEqual(fromLocalInput(zoned), doubled);
    }
    assert.equal(parseTimestamptz(zoned), Date.parse(zoned));
    assert.equal(parseTimestamptz(offset), Date.parse(offset));
  });

  it("toLocalInput/fromLocalInput round-trip the instant without a second local shift", () => {
    const iso = "2026-09-14T17:00:00.000Z";
    const local = toLocalInput(iso);
    assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    assert.equal(Date.parse(fromLocalInput(local)!), Date.parse(iso));
    assert.doesNotMatch(local, /Z|[+-]\d{2}:\d{2}$/);
  });
});

describe("card lock production wiring", () => {
  it("/card gates on week.status and lock_at, and validates on save", () => {
    const src = readFileSync(join(ROOT, "src/routes/_authenticated/card.tsx"), "utf8");
    assert.match(src, /validateCardSave/);
    assert.match(src, /weekCardsReadOnly/);
    assert.match(src, /parseTimestamptz/);
    assert.match(src, /week\?\.status === "locked"/);
    assert.match(src, /week\?\.status === "final"/);
    assert.match(src, /week\.status === "draft"/);
    assert.match(src, /week\?\.lock_at/);
    assert.match(src, /Waiting for the Commissioner to open cards/);
    assert.match(src, /disabled=\{saving \|\| week\.status === "draft"\}/);
    const saveFn = src.slice(src.indexOf("async function save"));
    assert.match(saveFn, /validateCardSave/);
    assert.doesNotMatch(src, GAMBLE);
  });

  it("commish Lock the cards now still sets cards.locked_at and weeks.status", () => {
    const src = readFileSync(join(ROOT, "src/routes/_authenticated/commissioner.tsx"), "utf8");
    assert.match(src, /Lock the cards now/);
    assert.match(src, /status === "locked"/);
    assert.match(src, /locked_at/);
    const setStatus = src.slice(src.indexOf("const setStatus"), src.indexOf("const finalize"));
    assert.match(setStatus, /status/);
    assert.match(setStatus, /locked_at/);
    assert.match(setStatus, /\.eq\("week_id", week!\.id\)/);
    assert.doesNotMatch(src, GAMBLE);
  });

  it("nfl helpers treat lock_at as timestamptz and do not double-local-parse", () => {
    const src = readFileSync(join(ROOT, "src/lib/nfl.ts"), "utf8");
    assert.match(src, /export function parseTimestamptz/);
    assert.match(src, /export function fromLocalInput/);
    const from = src.slice(src.indexOf("export function fromLocalInput"));
    assert.match(from, /interpret as local once/);
    assert.match(from, /do not re-parse as local/);
    assert.doesNotMatch(
      from.slice(0, from.indexOf("export function standardEvents")),
      /return value \? new Date\(value\)\.toISOString\(\)/,
    );
    const to = src.slice(src.indexOf("export function toLocalInput"), src.indexOf("export function fromLocalInput"));
    assert.doesNotMatch(to, /fromLocalInput/);
    assert.match(to, /parseTimestamptz/);
  });

  it("constraint helpers have no gambling vocabulary", () => {
    const src = readFileSync(join(ROOT, "src/lib/card-constraints.ts"), "utf8");
    assert.doesNotMatch(src, GAMBLE);
    assert.match(src, /week\.status === "locked" \|\| week\.status === "final"/);
    assert.match(src, /parseTimestamptz/);
    assert.match(src, /now >= lockMs/);
    assert.doesNotMatch(src, /Date\.parse\(week\.lock_at\)/);
    assert.match(src, /count > 2/);
    assert.match(src, /is_longshot/);
    assert.match(src, /count >= 3/);
  });
});
