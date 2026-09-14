/** Client-safe autopilot timing helpers (shared by the panel and the scheduled job). */

const ET = "America/New_York";
export const DAY_MS = 86400000;

function etParts(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    weekday: get("weekday"),
  };
}

function etOffsetMinutes(at: Date) {
  const p = etParts(at);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, at.getUTCMinutes());
  const asUtcClock = Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate(),
    at.getUTCHours(),
    at.getUTCMinutes(),
  );
  return (asUTC - asUtcClock) / 60000;
}

/** The first Tuesday 6:00 AM Eastern strictly after the given instant. */
export function tuesdaySixAmEtAfter(from: Date): Date {
  for (let i = 0; i <= 8; i++) {
    const probe = new Date(from.getTime() + i * DAY_MS);
    const p = etParts(probe);
    if (p.weekday !== "Tue") continue;
    const guess = new Date(Date.UTC(p.year, p.month - 1, p.day, 6, 0));
    const instant = new Date(guess.getTime() - etOffsetMinutes(guess) * 60000);
    if (instant.getTime() > from.getTime()) return instant;
  }
  return new Date(from.getTime() + 2 * DAY_MS);
}

export type AutopilotWeek = {
  status: string;
  lock_at: string | null;
  auto_created_at: string | null;
  commissioner_edited_at: string | null;
  autopilot_hold: boolean;
};

/** What autopilot will do next for a week, and roughly when. */
export function nextStepFor(week: AutopilotWeek): { label: string; at: string | null } {
  if (week.autopilot_hold) return { label: "Autopilot is on hold for this week", at: null };
  if (week.status === "draft") {
    if (!week.auto_created_at || week.commissioner_edited_at) {
      return { label: "Waiting for you to open cards", at: null };
    }
    return {
      label: "Open cards for the family",
      at: new Date(new Date(week.auto_created_at).getTime() + DAY_MS).toISOString(),
    };
  }
  if (week.status === "open") return { label: "Lock the cards", at: week.lock_at };
  if (week.status === "locked") {
    return {
      label: "Finalize the week and award the trophy",
      at: week.lock_at ? tuesdaySixAmEtAfter(new Date(week.lock_at)).toISOString() : null,
    };
  }
  return { label: "Week is done — next week creates itself", at: null };
}
