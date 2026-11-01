/**
 * The emergency-brake stamp. A kill is two beats on the card: an amber `TERM` while the block
 * holds, then a red mark that stays. Only a transition observed on screen stamps — a card that
 * mounts already stopped (a replay seeked to the end) shows the final mark without the beat.
 */

import type { ProcState } from "../../state/types";

export type Stamp = { word: "TERM" | "KILL" | "FEHLER"; tone: "amber" | "red" };

/** How long the amber beat holds before the red mark replaces it. */
export const TERM_HOLD_MS = 600;

const ALIVE: ReadonlySet<ProcState> = new Set(["queued", "spawning", "running", "waiting_tool"]);

/** The stamp the card shows once the process is stopped. */
export function finalStamp(state: ProcState): Stamp | null {
  if (state === "killed") return { word: "KILL", tone: "red" };
  if (state === "failed") return { word: "FEHLER", tone: "red" };
  return null;
}

/** True when going from `prev` to `next` is a live process being stopped by force. */
export function startsTermBeat(prev: ProcState | null, next: ProcState): boolean {
  return prev !== null && ALIVE.has(prev) && next === "killed";
}
