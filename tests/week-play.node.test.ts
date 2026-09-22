import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  activeWeekNumber,
  mentionsIdle,
  planSubmission,
  publicBoard,
  qaHouseKey,
  readSubmission,
  rejectionBody,
  scoreResponse,
  weekResponse,
  type PlayEvent,
  type PlayGame,
  type PlayHouse,
  type PlayWeek,
  type QaHouse,
} from "../src/lib/week-play.ts";

const NOW = Date.parse("2026-09-22T14:00:00.000Z");
const OAK_LOCK = "2026-09-25T00:15:00.000Z";
const PINE_LOCK = "2026-09-26T00:15:00.000Z";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function game(id: string, underdog: string): PlayGame {
  return {
    id,
    kickoff_at: "2026-09-25T00:15:00.000Z",
    underdog_team: underdog,
    away_team: underdog || "Away",
    home_team: "Home",
    upset_size: 3,
    away_score: null,
    home_score: null,
    upset_won: null,
  };
}

function moment(id: string, gameId: string | null, isLongshot = false): PlayEvent {
  return {
    id,
    game_id: gameId,
    is_longshot: isLongshot,
    description: `Moment ${id}`,
    created_at: "2026-09-01T00:00:00.000Z",
  };
}

function slate(prefix: string): { games: PlayGame[]; events: PlayEvent[] } {
  const games = [1, 2, 3, 4].map((n) => game(`${prefix}-g${n}`, `Dog ${n}`));
  const events = [moment(`${prefix}-long`, null, true)];
  for (const item of games) {
    events.push(moment(`${prefix}-a-${item.id}`, item.id));
    events.push(moment(`${prefix}-b-${item.id}`, item.id));
  }
  return { games, events };
}

function playWeek(
  id: string,
  weekNumber: number,
  status: string,
  lockAt: string | null,
  prefix: string,
): PlayWeek {
  const board = slate(prefix);
  return {
    id,
    week_number: weekNumber,
    season_year: 2026,
    status,
    lock_at: lockAt,
    games: board.games,
    events: board.events,
  };
}

function playHouse(key: QaHouse, weeks: PlayWeek[], name = `${key} Family`): PlayHouse {
  return {
    key,
    name,
    householdId: `hh-${key}`,
    weeks,
    profiles: [{ id: `profile-${key}`, display_name: "Pat", is_commissioner: true }],
    cards: [],
  };
}

function openTrio(): PlayHouse[] {
  return [
    playHouse("Oak", [
      playWeek("oak-w2", 2, "locked", "2026-09-18T00:15:00.000Z", "oak2"),
      playWeek("oak-w3", 3, "open", OAK_LOCK, "Oak"),
    ]),
    playHouse("Pine", [
      playWeek("pine-w2", 2, "locked", "2026-09-18T00:15:00.000Z", "pine2"),
      playWeek("pine-w3", 3, "open", PINE_LOCK, "Pine"),
    ]),
    playHouse("Cedar", [
      playWeek("cedar-w2", 2, "locked", "2026-09-18T00:15:00.000Z", "cedar2"),
      playWeek("cedar-w3", 3, "open", OAK_LOCK, "Cedar"),
    ]),
  ];
}

describe("week play", () => {
  it("names Oak, Pine, and Cedar and ignores other houses", () => {
    assert.equal(qaHouseKey("Oak Family"), "Oak");
    assert.equal(qaHouseKey("pine"), "Pine");
    assert.equal(qaHouseKey("Cedar"), "Cedar");
    assert.equal(qaHouseKey("Harper"), null);
    assert.equal(qaHouseKey("The Harper House"), null);
    assert.equal(qaHouseKey("Pineapple"), null);
  });

  it("selects week 3 when week 2 is locked and week 3 is open", () => {
    assert.equal(activeWeekNumber(openTrio()), 3);
    const board = publicBoard(openTrio(), NOW);
    assert.equal(board.active_week, 3);
    assert.deepEqual(
      board.houses.map((house) => house.label),
      ["Oak · Week 3", "Pine · Week 3", "Cedar · Week 3"],
    );
    const json = JSON.stringify(weekResponse(board));
    assert.ok(json.indexOf('"active_week"') < json.indexOf('"week_2"'));
    assert.equal(JSON.parse(json).active_week, 3);
  });

  it("keeps an open week 2 ahead of a draft week 3", () => {
    const houses = [
      playHouse("Oak", [
        playWeek("oak-w3", 3, "draft", OAK_LOCK, "Oak"),
        playWeek("oak-w2", 2, "open", "2026-09-18T00:15:00.000Z", "oak2"),
      ]),
    ];
    assert.equal(activeWeekNumber(houses), 2);
  });

  it("plans a 9-moment grid with a longshot and 3 distinct upsets", () => {
    const plan = planSubmission(openTrio(), {}, null, NOW);
    assert.equal(plan.ok, true);
    assert.equal(plan.writes.length, 3);
    if (!plan.ok) return;
    for (const write of plan.writes) {
      assert.equal(write.weekNumber, 3);
      assert.equal(write.gridIds?.length, 9);
      assert.equal(write.gridIds?.[0], `${write.house}-long`);
      assert.equal(write.upsets?.length, 3);
      assert.equal(new Set(write.upsets?.map((upset) => upset.game_id)).size, 3);
      assert.equal(write.upsets?.[0]?.picked_team, "Dog 1");
    }
  });

  it("rejects foreign ids without a write", () => {
    const plan = planSubmission(openTrio(), { event_ids: ["not-on-this-slate"] }, "grid", NOW);
    assert.equal(plan.ok, false);
    assert.equal(plan.writes.length, 0);
    if (!plan.ok) assert.equal(plan.status, 400);
  });

  it("rejects a locked week 2 without a write", () => {
    const plan = planSubmission(openTrio(), { week: 2 }, "grid", NOW);
    assert.equal(plan.ok, false);
    assert.equal(plan.writes.length, 0);
    if (!plan.ok) {
      assert.equal(plan.status, 409);
      const body = rejectionBody(plan);
      assert.equal(body.closed, true);
      assert.equal(body.window, "closed");
      assert.match(body.error, /locked/i);
      assert.match(body.error, /closed/i);
    }
  });

  it("closes at the house's own lock, not an earlier house's lock", () => {
    const houses = openTrio().filter((house) => house.key !== "Cedar");
    const pine = houses.find((house) => house.key === "Pine");
    const pineIds = pine?.weeks
      .find((week) => week.week_number === 3)
      ?.events.slice(0, 2)
      .map((event) => event.id);
    const atLock = planSubmission(houses, { at: "lock", event_ids: pineIds }, "grid", NOW);
    assert.equal(atLock.ok, false);
    assert.equal(atLock.writes.length, 0);
    if (!atLock.ok) assert.equal(atLock.status, 409);

    const earlier = planSubmission(houses, { at: OAK_LOCK, event_ids: pineIds }, "grid", NOW);
    assert.equal(earlier.ok, true);
    if (earlier.ok) {
      assert.deepEqual(
        earlier.writes.map((write) => write.house),
        ["Pine"],
      );
    }
  });

  it("does not let an earlier at reopen a locked week", () => {
    const houses = [playHouse("Oak", [playWeek("oak-w3", 3, "locked", OAK_LOCK, "Oak")])];
    const plan = planSubmission(houses, { at: "2026-09-01T00:00:00.000Z" }, "grid", NOW);
    assert.equal(plan.ok, false);
    assert.equal(plan.writes.length, 0);
    if (!plan.ok) assert.equal(plan.status, 409);
  });

  it("rejects a future at on an open week", () => {
    const houses = [playHouse("Oak", [playWeek("oak-w3", 3, "open", OAK_LOCK, "Oak")])];
    const plan = planSubmission(houses, { at: "2026-09-26T00:00:00.000Z" }, "grid", NOW);
    assert.equal(plan.ok, false);
    if (!plan.ok) assert.equal(plan.status, 409);
  });

  it("rejects once the server clock has passed lock even if at is earlier", () => {
    const houses = [playHouse("Oak", [playWeek("oak-w3", 3, "open", OAK_LOCK, "Oak")])];
    const plan = planSubmission(
      houses,
      { at: "2026-09-22T00:00:00.000Z" },
      "grid",
      Date.parse(OAK_LOCK) + 60_000,
    );
    assert.equal(plan.ok, false);
    assert.equal(plan.writes.length, 0);
    if (!plan.ok) assert.equal(plan.status, 409);
  });

  it("does not treat a nested after-lock example as the request clock", () => {
    const houses = openTrio();
    const board = publicBoard(houses, NOW);
    const plan = planSubmission(houses, board as unknown as Record<string, unknown>, null, NOW);
    assert.equal(plan.ok, true);
    if (plan.ok) assert.equal(plan.writes.length, 3);
  });

  it("scores the slate without an idle marker", () => {
    const body = scoreResponse(openTrio());
    assert.equal(mentionsIdle(body), false);
    assert.equal(body.action, "week_scheduled");
    assert.equal(body.scheduled, true);
    assert.ok(body.processed > 0);
    assert.equal(
      body.processed,
      body.houses.reduce((sum, house) => sum + house.games, 0),
    );
    assert.equal(
      body.houses.some((house) => house.processed === 0),
      false,
    );
  });

  it("merges a form body over the query and keeps query at=lock", async () => {
    const request = new Request("https://biggamesunday.com/api/grid?house=Oak&at=lock&week=3", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ house: "Pine", event_ids: ["pine-a"] }),
    });
    const body = await readSubmission(request);
    assert.equal(body["house"], "Pine");
    assert.equal(body["at"], "lock");
    assert.equal(body["week"], "3");
    assert.deepEqual(body["event_ids"], ["pine-a"]);

    const form = new Request("https://biggamesunday.com/api/upset?week=3", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "house=Oak+Family&game_ids=g1%2Cg2",
    });
    const posted = await readSubmission(form);
    assert.equal(posted["house"], "Oak Family");
    assert.equal(posted["week"], "3");
    assert.equal(posted["game_ids"], "g1,g2");
  });

  it("records week_scheduled before the open-week return", () => {
    const source = readFileSync(join(root, "src/lib/autopilot.server.ts"), "utf8");
    const cut = source.indexOf('if (week.status !== "locked") return;');
    assert.ok(cut > 0);
    const before = source.slice(0, cut);
    assert.match(before, /action:\s*"week_scheduled"/);
    assert.match(before, /weekScheduledDetail\(/);
  });
});
