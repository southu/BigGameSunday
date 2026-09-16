/**
 * Active week for a household:
 *   1. latest open or locked (never hide these behind a newer draft or final)
 *   2. else newest week overall (highest season_year, then week_number),
 *      whether draft or final — never an older draft over a newer week
 */
export type WeekSlot = {
  season_year: number;
  week_number: number;
};

export type WeekLike = WeekSlot & {
  status: string;
  /** Ranking ignores this. Skip uses it to find a premature-finalize leftover. */
  finalized_at?: string | null;
  /** Ranking ignores this. Finalize-before-lock is premature. */
  lock_at?: string | null;
};

export type WeekRef = WeekLike & { id: string };

function recency(a: WeekSlot, b: WeekSlot): number {
  if (a.season_year !== b.season_year) return b.season_year - a.season_year;
  return b.week_number - a.week_number;
}

function isNewerThan(week: WeekSlot, than: WeekSlot): boolean {
  return recency(week, than) < 0;
}

function isOlderThan(week: WeekSlot, than: WeekSlot): boolean {
  return recency(week, than) > 0;
}

function isSameSlot(a: WeekSlot, b: WeekSlot): boolean {
  return recency(a, b) === 0;
}

function isInPlay(status: string): boolean {
  return status === "open" || status === "locked";
}

export function isNewerDraft(w: WeekLike, active: WeekLike): boolean {
  return w.status === "draft" && isNewerThan(w, active);
}

/**
 * Latest open|locked (highest season_year, then week_number). Else newest
 * week overall — draft vs final is not a rank, so leftover draft W1 cannot
 * hide a newer final W2 (Harper House).
 */
export function selectActiveWeek<T extends WeekLike>(weeks: readonly T[]): T | null {
  let latestInPlay: T | null = null;
  let newest: T | null = null;
  for (const week of weeks) {
    if (isInPlay(week.status) && (!latestInPlay || recency(week, latestInPlay) < 0)) {
      latestInPlay = week;
    }
    if (!newest || recency(week, newest) < 0) newest = week;
  }
  return latestInPlay ?? newest;
}

/** Regular season wraps to week 1 of the next year after week 18. */
export function nextWeekSlot(week: WeekSlot): WeekSlot {
  if (week.week_number >= 18) {
    return { season_year: week.season_year + 1, week_number: 1 };
  }
  return { season_year: week.season_year, week_number: week.week_number + 1 };
}

export function weekAtSlot<T extends WeekSlot>(weeks: readonly T[], slot: WeekSlot): T | undefined {
  return weeks.find((w) => isSameSlot(w, slot));
}

/** Skip closes a leftover week without Reveal; finished weeks stay put. */
export function canSkipWeek(week: WeekLike | null | undefined): boolean {
  return !!week && week.status !== "final";
}

/**
 * Autopilot auto-opens a draft 24h after auto-create only when no newer week
 * exists. Opening a leftover draft behind a newer week would trap the family
 * on the skipped week via in-play ranking (Harper: leftover W1 + final W2).
 */
export function shouldAutopilotOpenDraft(
  week: WeekLike,
  weeks: readonly WeekLike[],
): boolean {
  if (week.status !== "draft") return false;
  return !weeks.some((w) => isNewerThan(w, week));
}

/**
 * Autopilot must not lock a leftover-open week skip should close.
 * Dirty-open leftover marks would freeze as misses; leftover open W1
 * behind a newer final/open/locked week would trap the family via
 * in-play ranking. Skip is the Tuesday path — no Reveal required.
 */
export function shouldAutopilotLockOpen(
  week: WeekLike,
  weeks: readonly WeekLike[] = [],
): boolean {
  return week.status === "open" && shouldOfferOpenCards(week, weeks);
}

/**
 * Autopilot must not Finalize a leftover locked week behind a newer
 * final/open/locked week. That scores leftover misses and forces Reveal;
 * skip closes that leftover without Reveal so the family can play Tuesday.
 */
export function shouldAutopilotFinalize(
  week: WeekLike,
  weeks: readonly WeekLike[] = [],
): boolean {
  return week.status === "locked" && shouldOfferOpenCards(week, weeks);
}

/**
 * Autopilot must not call leftover locked weeks behind a newer in-play
 * week. Those scores settle leftover moments while the family is already
 * on This Sunday (leftover locked W1 + open/locked W2). Skip closes that
 * leftover without Reveal and does not clear locked-week results.
 * Leftover locked W1 that is still This Sunday (newer week is draft or
 * final) keeps live scores — in-play ranking has not moved the family.
 */
export function shouldAutopilotResolveScores(
  week: WeekLike,
  weeks: readonly WeekLike[] = [],
): boolean {
  return week.status === "locked" && !hasNewerInPlayThan(week, weeks);
}

/**
 * Draft→open is only safe when this draft is the newest week. Opening a
 * leftover draft behind a newer week would steal the family via in-play
 * ranking (Harper: leftover W1 behind final/open W2). Lock/finalize stay
 * on This Sunday (in-play + next-week draft). They do not stay on a leftover
 * in-play week behind a newer final/open/locked week — skip closes that
 * leftover without Reveal. Lock/finalize also stay off weeks that still
 * have leftover marks from a premature finish — skip scrubs those; locking
 * or Finalize would freeze leftover misses and force Reveal, which skip
 * does not require.
 */
export function shouldOfferOpenCards(
  week: WeekLike,
  weeks: readonly WeekLike[],
): boolean {
  if (skipScrubsLeftoverInPlace(week, weeks)) return false;
  if (hasNewerNonDraftThan(week, weeks)) return false;
  if (week.status !== "draft") return true;
  return shouldAutopilotOpenDraft(week, weeks);
}

function hasNewerInPlayThan(week: WeekSlot, weeks: readonly WeekLike[]): boolean {
  return weeks.some((w) => isInPlay(w.status) && isNewerThan(w, week));
}

/** Newer open/locked/final week exists — this slot is leftover, not This Sunday. */
function hasNewerNonDraftThan(week: WeekSlot, weeks: readonly WeekLike[]): boolean {
  return weeks.some((w) => w.status !== "draft" && isNewerThan(w, week));
}

/**
 * Skip leftover may create/reopen/refresh next only when that slot is not
 * already in play and no newer week is in play. Otherwise just close the
 * leftover and leave the family on This Sunday (leftover locked W1 must
 * not unlock open/locked W2; auto-created W3 must not bounce them to W2).
 * Draft/final next still opens — leftover draft W1 + premature-final W2.
 * Empty `weeks` still touches (no sibling to inspect).
 */
export function skipTouchesNextWeek(
  next: WeekSlot | null | undefined,
  weeks: readonly WeekLike[],
): boolean {
  if (!next) return !weeks.some((w) => isInPlay(w.status));
  if (hasNewerInPlayThan(next, weeks)) return false;
  const existing = weekAtSlot(weeks, next);
  if (existing && isInPlay(existing.status)) return false;
  return true;
}

function withStatus<T extends WeekLike>(week: T, status: string): T {
  return { ...week, status };
}

/**
 * Commissioner view after skip. If skip opened/created next, land there
 * (existing next only — a newly created week is the caller's nextId).
 * If a newer week is already in play, land on the post-skip active week
 * so closing leftover W1 does not leave the panel stuck on that draft.
 * Dirty-open leftover (open + leftover finalize stamp) and premature-final
 * leftover stay put — scrub in place, do not close it and jump to the next week.
 */
export function skipLandingWeek<T extends WeekLike>(weeks: readonly T[], leftover: T): T | null {
  if (skipScrubsLeftoverInPlace(leftover, weeks)) {
    return weekAtSlot(weeks, leftover) ?? leftover;
  }
  const closed = weeks.map((w) => (isSameSlot(w, leftover) ? withStatus(w, "final") : w));
  const slot = nextWeekSlot(leftover);
  if (!skipTouchesNextWeek(slot, weeks)) return selectActiveWeek(closed);
  const next = weekAtSlot(weeks, slot);
  if (!next) return selectActiveWeek(closed);
  const opened = closed.map((w) => (isSameSlot(w, slot) ? withStatus(w, "open") : w));
  return selectActiveWeek(opened);
}

/**
 * Button and hint for the commissioner skip control.
 * Do not promise "start next week" / "open this week" when skip will only
 * close the leftover because next (or a newer week) is already in play.
 */
export function skipControlCopy(
  leftover: WeekLike,
  viewed: WeekLike | null | undefined,
  weeks: readonly WeekLike[] = [],
): { button: string; hint: string } {
  if (skipScrubsViewedInPlace(leftover, viewed, weeks)) {
    if (viewed && isSameSlot(leftover, viewed)) {
      return {
        button: "Clear leftover marks / open this week",
        hint: "This week was marked finished too early. Clear leftover marks so the family can play — works on Tuesday.",
      };
    }
    return {
      button: `Clear leftover marks / open Week ${leftover.week_number}`,
      hint: `Week ${leftover.week_number} was marked finished too early. Clear leftover marks so the family can play — works on Tuesday.`,
    };
  }
  const slot = nextWeekSlot(leftover);
  const touchesNext = skipTouchesNextWeek(weekAtSlot(weeks, slot) ?? slot, weeks);
  if (viewed && isSameSlot(leftover, viewed)) {
    if (!touchesNext) {
      return {
        button: "Skip this week",
        hint: "Didn't play this week? Close it without Reveal — works on Tuesday.",
      };
    }
    return {
      button: "Skip this week / start next week",
      hint: "Didn't play this week? Close it without Reveal and open next week's cards — works on Tuesday.",
    };
  }
  const leftoverKind = leftover.status === "draft" ? "a leftover draft" : "leftover";
  if (touchesNext && viewed && isSameSlot(viewed, slot)) {
    return {
      button: `Skip leftover Week ${leftover.week_number} / open this week`,
      hint: `Week ${leftover.week_number} is still ${leftoverKind}. Close it without Reveal and open this week so the family can play — works on Tuesday.`,
    };
  }
  if (touchesNext) {
    return {
      button: `Skip leftover Week ${leftover.week_number} / open Week ${slot.week_number}`,
      hint: `Week ${leftover.week_number} is still ${leftoverKind}. Close it without Reveal and open Week ${slot.week_number} so the family can play — works on Tuesday.`,
    };
  }
  return {
    button: `Skip leftover Week ${leftover.week_number}`,
    hint: `Week ${leftover.week_number} is still ${leftoverKind}. Close it without Reveal — works on Tuesday.`,
  };
}

/**
 * Autopilot next-step for a leftover week. Do not promise "Open cards"
 * or "Lock the cards" — skip/scrub is the Tuesday path.
 */
export function leftoverDraftNextStep(
  week: WeekLike,
  weeks: readonly WeekLike[],
): { label: string; at: null } | null {
  if (skipScrubsLeftoverInPlace(week, weeks)) {
    return {
      label: "This week still has leftover marks — clear them so the family can play",
      at: null,
    };
  }
  if (week.status !== "draft" || shouldAutopilotOpenDraft(week, weeks)) {
    if (!hasNewerNonDraftThan(week, weeks)) return null;
    const slot = nextWeekSlot(week);
    const touchesNext = skipTouchesNextWeek(weekAtSlot(weeks, slot) ?? slot, weeks);
    return {
      label: touchesNext
        ? "This leftover week is behind a newer week — skip it to start next week"
        : "This leftover week is behind a newer week — skip it without Reveal",
      at: null,
    };
  }
  const slot = nextWeekSlot(week);
  const touchesNext = skipTouchesNextWeek(weekAtSlot(weeks, slot) ?? slot, weeks);
  return {
    label: touchesNext
      ? "This leftover draft will not auto-open — skip it to start next week"
      : "This leftover draft will not auto-open — skip it without Reveal",
    at: null,
  };
}

/**
 * Newest finished week is recoverable only with evidence it was marked
 * finished too early (finalized before lock, or finalized before an older
 * sibling was marked final). Ordinary completed weeks — newest final after
 * older finals — are not recoverable. Do not reopen a lone finished week,
 * and do not reopen a finished week while another week is open or locked.
 * Leftover drafts still close first (skipTargetWeek ranks those ahead).
 */
function recoverableFinishedWeek<T extends WeekLike>(weeks: readonly T[]): T | null {
  if (weeks.some((w) => isInPlay(w.status))) return null;
  const newest = [...weeks].sort(recency)[0];
  if (!newest) return null;
  if (weeks.some((w) => w.status === "draft" && isOlderThan(w, newest))) return null;
  const finals = [...weeks].filter((w) => w.status === "final").sort(recency);
  const target = finals[0];
  if (!target) return null;
  if (!weeks.some((w) => isOlderThan(w, target))) return null;
  if (!isPrematureFinalWeek(target, weeks)) return null;
  return target;
}

/**
 * Week the skip control closes.
 * Prefer an older leftover draft behind the viewed week (Harper: draft W1
 * sitting behind open/final W2) so Skip cannot close the week the family
 * is about to play. Prefer an older leftover in-play week behind This Sunday
 * (locked/open W1 sitting behind open/locked W2) for the same reason — Skip
 * must not close the week the family is playing. Otherwise recover a
 * premature-final week when nothing is in play and an older week exists
 * (Harper: skipped W1 + premature-final W2). Otherwise close the viewed week
 * when it is still playable.
 * If the viewed week is already finished, still target a leftover in-play
 * week behind a newer in-play week, or a leftover open week with a premature
 * finalize stamp so Skip can scrub it in place (Harper: skipped W1 + dirty-open
 * W2, commissioner looking at W1). A newest final without premature evidence
 * is left alone.
 */
export function skipTargetWeek<T extends WeekLike>(
  weeks: readonly T[],
  viewed: T | null | undefined,
): T | null {
  if (!viewed) return null;
  const olderDrafts = [...weeks]
    .filter((w) => w.status === "draft" && isOlderThan(w, viewed))
    .sort(recency);
  if (olderDrafts[0]) return olderDrafts[0];
  const olderLeftoverInPlay = [...weeks]
    .filter((w) => isInPlay(w.status) && hasNewerInPlayThan(w, weeks) && isOlderThan(w, viewed))
    .sort(recency);
  if (olderLeftoverInPlay[0]) return olderLeftoverInPlay[0];
  const recoverable = recoverableFinishedWeek(weeks);
  if (recoverable) return recoverable;
  if (canSkipWeek(viewed)) return viewed;
  const leftoverInPlay = [...weeks]
    .filter((w) => isInPlay(w.status) && hasNewerInPlayThan(w, weeks))
    .sort(recency);
  if (leftoverInPlay[0]) return leftoverInPlay[0];
  const dirtyOpen = [...weeks].filter(hasPrematureFinalizeLeftover).sort(recency);
  return dirtyOpen[0] ?? null;
}

/** Open + leftover finalize stamp: skip must reopen/scrub, not take the already-open path. */
function hasPrematureFinalizeLeftover(week: WeekLike | null | undefined): boolean {
  return !!week && week.status === "open" && !!week.finalized_at;
}

function stampMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Finalized before kickoff — the week was marked finished too early. */
function finalizedBeforeLock(week: WeekLike): boolean {
  const finalized = stampMs(week.finalized_at);
  const lock = stampMs(week.lock_at);
  return finalized != null && lock != null && finalized < lock;
}

/**
 * This week was marked final before an older sibling was — leftover skip
 * after a premature finalize (W2 finished, then leftover W1 closed later).
 * In-order finals (older first) do not match.
 */
function finalizedBeforeOlderSibling(week: WeekLike, weeks: readonly WeekLike[]): boolean {
  const finalized = stampMs(week.finalized_at);
  if (finalized == null) return false;
  return weeks.some((other) => {
    if (!isOlderThan(other, week) || other.status !== "final") return false;
    const older = stampMs(other.finalized_at);
    return older != null && older > finalized;
  });
}

function isPrematureFinalWeek(week: WeekLike, weeks: readonly WeekLike[] = []): boolean {
  if (week.status !== "final") return false;
  return finalizedBeforeLock(week) || finalizedBeforeOlderSibling(week, weeks);
}

/**
 * Premature-final or dirty-open leftover: reopen/scrub this week, do not skip
 * to the next. A leftover sitting behind a newer non-draft week is closed, not
 * scrubbed — reopening it would steal the family back via in-play ranking.
 */
function skipScrubsLeftoverInPlace(leftover: WeekLike, weeks: readonly WeekLike[] = []): boolean {
  if (hasNewerNonDraftThan(leftover, weeks)) return false;
  return hasPrematureFinalizeLeftover(leftover) || isPrematureFinalWeek(leftover, weeks);
}

/**
 * After leftover W1 is already closed, Harper House still sits on W2 that
 * was marked finished too early (premature-final, or open with a stale
 * finalized_at). Scrub that leftover in place — do not skip it to W3 —
 * even if the commissioner is looking at the already-skipped week.
 */
export function skipScrubsViewedInPlace(
  leftover: WeekLike,
  viewed: WeekLike | null | undefined,
  weeks: readonly WeekLike[] = [],
): boolean {
  return !!viewed && skipScrubsLeftoverInPlace(leftover, weeks);
}

/**
 * After skip, an existing next week is playable only when already open
 * without a leftover finalize stamp. Draft, locked, prematurely final,
 * or open-with-finalized_at next weeks must be reopened (and scrubbed)
 * — unless that next week (or a newer one) is already in play, in which
 * case leftover skip just closes the leftover and leaves the family on
 * This Sunday. Dirty-open next is already This Sunday; scrub it later.
 */
export function shouldOpenExistingNextWeek<T extends WeekLike>(
  next: T | null | undefined,
  weeks: readonly WeekLike[] = [],
): next is T {
  if (!next || (next.status === "open" && !hasPrematureFinalizeLeftover(next))) return false;
  return skipTouchesNextWeek(next, weeks);
}

/**
 * Premature-final and locked next weeks may still have cards locked from
 * Reveal or kickoff. Skip must clear those so the family can play Tuesday.
 * An already-open week with leftover finalized_at may too. A leftover draft
 * has no week-level lock to lift.
 */
export function skipUnlocksCards(next: WeekLike | null | undefined): boolean {
  return (
    !!next &&
    (next.status === "locked" || next.status === "final" || hasPrematureFinalizeLeftover(next))
  );
}

/**
 * Premature finalize marks uncalled moments miss and writes weekly scores.
 * Skip must uncall those so Tuesday play is not already "called" — including
 * an already-open week that still has finalized_at from that premature pass.
 * A locked week may have real Sunday results — leave those alone.
 */
export function skipClearsCalledMoments(next: WeekLike | null | undefined): boolean {
  return !!next && (next.status === "final" || hasPrematureFinalizeLeftover(next));
}

/**
 * Premature finalize / live scoring may write game scores and settle upset
 * watches. Skip must clear those so Tuesday play is not already decided
 * (finalize treats a non-null upset_won as the game being over) — including
 * an already-open week that still has finalized_at from that premature pass.
 * A locked week may have real Sunday results — leave those alone.
 */
export function skipClearsGameOutcomes(next: WeekLike | null | undefined): boolean {
  return !!next && (next.status === "final" || hasPrematureFinalizeLeftover(next));
}

/** Past lock times would immediately re-lock a reopened week; refresh them on skip. */
export function skipLockNeedsRefresh(lockAt: string | null | undefined, now = Date.now()): boolean {
  if (!lockAt) return false;
  const ms = Date.parse(lockAt);
  return Number.isFinite(ms) && ms <= now;
}

/**
 * After skip autofills next week, keep a future lock (ESPN earliest kickoff).
 * Only return the Sunday fallback when the current lock would immediately
 * re-lock cards — never clobber Thursday night with next Sunday.
 */
export function skipLockAfterAutofill(
  lockAt: string | null | undefined,
  sundayKickoff: string,
  now = Date.now(),
): string | undefined {
  if (!skipLockNeedsRefresh(lockAt, now)) return undefined;
  return sundayKickoff;
}

/**
 * When skip refreshes a past lock_at on an already-open week, cards may still
 * have locked_at from last Sunday. Clear those so Tuesday play is not frozen.
 * A future ESPN kickoff (no fallback) leaves cards as they are.
 */
export function skipUnlocksCardsOnLockRefresh(
  lockFallback: string | null | undefined,
): boolean {
  return typeof lockFallback === "string" && lockFallback.length > 0;
}

/** This Sunday = in-play active slot; Next week = the next slot when it is a newer draft. */
export function weekSwitcherLabel(w: WeekRef, active: WeekRef | null): string {
  if (!active) return `Week ${w.week_number}`;
  if (isInPlay(active.status) && isSameSlot(w, active)) return "This Sunday";
  if (isInPlay(active.status) && isNewerDraft(w, active) && isSameSlot(w, nextWeekSlot(active))) {
    return "Next week";
  }
  return `Week ${w.week_number}`;
}

/**
 * Commissioner view: default is the active (open/locked) week.
 * `next` or a week id reaches the auto-created draft without changing selectActiveWeek.
 * "Next" is only the next slot's draft (same rule as weekSwitcherLabel).
 * If that slot is missing or already final/open/locked, stay on the active week
 * so a later leftover cannot steal "next" — including through an empty gap
 * (skipped or never-created weeks between This Sunday and a farther draft).
 */
export function pickViewWeek<T extends WeekRef>(
  weeks: readonly T[],
  active: T | null,
  requested?: string | null,
): T | null {
  if (requested === "next" && active) {
    const slotDraft = weekAtSlot(weeks, nextWeekSlot(active));
    if (slotDraft && isNewerDraft(slotDraft, active)) return slotDraft;
  }
  if (requested && requested !== "next") {
    const found = weeks.find((w) => w.id === requested);
    if (found) return found;
  }
  return active ?? null;
}
