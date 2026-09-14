export type CardEventInfo = {
  id: string;
  game_id: string | null;
  is_longshot: boolean;
};

/** /card is read-only when the week is locked/final or the lock clock has passed. */
export function weekCardsReadOnly(
  week: { status: string; lock_at: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  if (!week) return false;
  if (week.status === "locked" || week.status === "final") return true;
  if (!week.lock_at) return false;
  const lockMs = Date.parse(week.lock_at);
  return !Number.isNaN(lockMs) && now >= lockMs;
}

export function perGameCounts(
  eventIds: (string | null)[],
  events: CardEventInfo[],
): Map<string, number> {
  const byId = new Map(events.map((e) => [e.id, e]));
  const counts = new Map<string, number>();
  for (const id of eventIds) {
    if (!id) continue;
    const gameId = byId.get(id)?.game_id;
    if (!gameId) continue;
    counts.set(gameId, (counts.get(gameId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Save-path constraints (not just click handlers).
 * Returns a user-facing reason, or null if the write may proceed.
 */
export function validateCardSave(input: {
  weekStatus: string;
  lockAt: string | null;
  cardLockedAt: string | null;
  eventIds: (string | null)[];
  events: CardEventInfo[];
  upsetGameIds: string[];
  lock: boolean;
  now?: number;
}): string | null {
  const now = input.now ?? Date.now();
  if (input.weekStatus === "draft") {
    return "Waiting for the Commissioner to open cards.";
  }
  if (
    input.cardLockedAt ||
    weekCardsReadOnly({ status: input.weekStatus, lock_at: input.lockAt }, now)
  ) {
    return "This card is locked — no more edits.";
  }

  for (const count of perGameCounts(input.eventIds, input.events).values()) {
    if (count > 2) return "Only 2 moments per game are allowed on your grid.";
  }

  const upsetPerGame = new Map<string, number>();
  for (const gameId of input.upsetGameIds) {
    upsetPerGame.set(gameId, (upsetPerGame.get(gameId) ?? 0) + 1);
  }
  for (const count of upsetPerGame.values()) {
    if (count >= 3) return "Pick 3 underdogs from 3 different games.";
  }
  if (upsetPerGame.size !== input.upsetGameIds.length) {
    return "Pick 3 underdogs from 3 different games.";
  }

  if (input.lock) {
    const filled = input.eventIds.filter(Boolean).length;
    const byId = new Map(input.events.map((e) => [e.id, e]));
    const longshotOk = input.eventIds.some((id) => !!id && !!byId.get(id)?.is_longshot);
    if (filled === 9 && !longshotOk) {
      return "A full grid needs at least one longshot to lock in.";
    }
    if (filled !== 9 || !longshotOk || input.upsetGameIds.length !== 3) {
      return "Finish your picks to lock in.";
    }
  }

  return null;
}
