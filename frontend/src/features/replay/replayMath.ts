/**
 * The arithmetic behind the timeline: where a run stands at a given cursor, and when the next
 * event is due.
 *
 * Replay is a projection, not a second implementation (spec §1.3) — every state on this page
 * comes out of the very same `applyEvent` fold the live stream uses. What is added here is
 * only the *addressing*: a cursor into the event list, a fraction of the run's elapsed time,
 * and the pacing between two events.
 *
 * Time here is the events' own wall-clock seconds. The scrubber runs on that time and not on
 * the index, because a run is not evenly spaced: a single thinking pause can be longer than
 * fifty streamed text deltas, and an index scrubber would hide exactly that.
 */

import { applyEvents, initialState } from "../../state/reducer";
import type { HEvent, State } from "../../state/types";

/** Same cap as the backend player (`replay/player.py`): a long pause never stalls the demo. */
export const MAX_GAP_MS = 3_000;

/**
 * The player's resolution: two frames at 60 Hz. Measured, not guessed — a step costs one full
 * re-render of the graph, and at 16 ms the render was the speed limit rather than the clock.
 */
export const FRAME_MS = 32;

/**
 * The last computation, kept so playing forward does not re-fold the whole run 60 times a
 * second. Only a *forward* move on the *same* event list can build on it; anything else starts
 * from `initialState`, which is what makes scrubbing backwards correct rather than fast.
 */
let memo: { events: HEvent[]; cursorSeq: number; state: State } | null = null;

/** The projection as it was after the event at `cursorSeq` — `applyEvents` over the prefix. */
export function stateAt(events: HEvent[], cursorSeq: number): State {
  if (memo !== null && memo.events === events) {
    if (memo.cursorSeq === cursorSeq) return memo.state;
    if (memo.cursorSeq < cursorSeq) return remember(events, cursorSeq, memo.state, memo.cursorSeq);
  }
  return remember(events, cursorSeq, initialState, 0);
}

function remember(events: HEvent[], cursorSeq: number, base: State, from: number): State {
  const state = applyEvents(
    base,
    events.filter((event) => event.seq > from && event.seq <= cursorSeq),
  );
  memo = { events, cursorSeq, state };
  return state;
}

/** The seq shown at `f` ∈ [0, 1] of the run's elapsed time — the scrubber's position → cursor. */
export function seqAtFraction(events: HEvent[], f: number): number {
  if (events.length === 0) return 0;
  const clamped = clamp(f);
  const span = timeSpan(events);
  // A run whose events share one timestamp has no time to divide; the index keeps the scrubber
  // usable instead of snapping it to the end.
  if (span <= 0) return events[Math.round(clamped * (events.length - 1))].seq;

  const target = events[0].ts + clamped * span;
  let seq = events[0].seq;
  // The log is ordered by time, so the first event past the target ends the search.
  for (const event of events) {
    if (event.ts > target) break;
    seq = event.seq;
  }
  return seq;
}

/** Where `seq` sits on the track — the cursor → scrubber position. */
export function fractionOfSeq(events: HEvent[], seq: number): number {
  if (events.length <= 1) return 0;
  const span = timeSpan(events);
  if (span <= 0) return indexAtSeq(events, seq) / (events.length - 1);
  return clamp((tsAtSeq(events, seq) - events[0].ts) / span);
}

/**
 * The next event and how long to wait for it, or `null` at the end of the run.
 *
 * The gap is divided by the speed *before* the cap, so 8× really is eight times faster inside
 * the cap — capping first would make every speed identical wherever the cap bites.
 */
export function nextTick(
  events: HEvent[],
  cursorSeq: number,
  speed: number,
  maxGapMs = MAX_GAP_MS,
): { seq: number; delayMs: number } | null {
  const next = events.find((event) => event.seq > cursorSeq);
  if (next === undefined) return null;
  const gapMs = (next.ts - tsAtSeq(events, cursorSeq)) * 1_000;
  return { seq: next.seq, delayMs: Math.max(0, Math.min(gapMs / speed, maxGapMs)) };
}

/**
 * Addition to the binding block: the last event due within one frame of `seq`.
 *
 * The live client already coalesces a burst of events per animation frame (`lib/sse.ts`), and
 * the player has to do the same for the same reason: a run has stretches where twenty events
 * share a millisecond, and one React render each turns the *renderer* into the speed limit —
 * measured at 4.4× too slow at 8×, which would make the speed label a lie (spec §1.2).
 */
export function coalesce(
  events: HEvent[],
  seq: number,
  speed: number,
  budgetMs = FRAME_MS,
): number {
  let target = seq;
  let budget = budgetMs;
  for (;;) {
    const after = nextTick(events, target, speed);
    if (after === null || after.delayMs > budget) return target;
    budget -= after.delayMs;
    target = after.seq;
  }
}

/**
 * Addition to the binding block: the event time the cursor stands on. It is what a replayed
 * elapsed time must be measured against — reading the wall clock during a replay would age a
 * finished run by however long ago it ran.
 */
export function tsAtSeq(events: HEvent[], seq: number): number {
  if (events.length === 0) return 0;
  let ts = events[0].ts;
  for (const event of events) {
    if (event.seq > seq) break;
    ts = event.ts;
  }
  return ts;
}

function timeSpan(events: HEvent[]): number {
  return events[events.length - 1].ts - events[0].ts;
}

function indexAtSeq(events: HEvent[], seq: number): number {
  let index = 0;
  for (const [at, event] of events.entries()) {
    if (event.seq > seq) break;
    index = at;
  }
  return index;
}

function clamp(f: number): number {
  if (!Number.isFinite(f)) return 0;
  return Math.min(1, Math.max(0, f));
}
