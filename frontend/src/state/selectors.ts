/**
 * Derivations from the projection. Pure and store-agnostic: the arguments are structural, so
 * these work on the live store, on a replay snapshot and in a unit test alike.
 */

import type { Mode, Proc, ProcState, Run, State } from "./types";

export interface ModeInput {
  state: State;
  replay: { runId: string | null };
}

/** What the shell is doing right now — replay wins, then a running mission, then nothing. */
export function selectMode(input: ModeInput): Mode {
  if (input.replay.runId !== null) return "replay";
  const run = selectActiveRun(input.state);
  return run === undefined ? "idle" : run.driver;
}

/** The mission the shell is following: the newest run, but only while it is still running. */
export function selectActiveRun(state: State): Run | undefined {
  if (state.activeRunId === null) return undefined;
  const run = state.runs[state.activeRunId];
  return run?.state === "running" ? run : undefined;
}

/** The process table's order: by pid, which is also the order they were spawned in. */
export function selectProcs(state: State): Proc[] {
  return Object.values(state.procs).sort((a, b) => a.pid - b.pid);
}

/** The states a process still occupies the machine in — the meters and the kill switch use it. */
export const ALIVE_STATES: ReadonlySet<ProcState> = new Set<ProcState>([
  "queued",
  "spawning",
  "running",
  "waiting_tool",
]);

export function isAlive(proc: Proc): boolean {
  return ALIVE_STATES.has(proc.state);
}
