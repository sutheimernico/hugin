/**
 * The kernel log as a timetable: which lines belong on it and when each one "departs", counted
 * from the start of the mission rather than from the wall clock — a replay of a run from last
 * month should read "0:42", not "14:07:33".
 */

import type { LogLine } from "../../state/types";

export interface TimetableRow {
  line: LogLine;
  /** Seconds since the mission began. */
  at: number;
}

/**
 * Lines at or after `origin`. Without a mission the whole log is shown from its own first line,
 * so an idle kernel still has a readable ticker.
 */
export function timetableRows(lines: LogLine[], origin: number | null): TimetableRow[] {
  const start = origin ?? lines[0]?.ts ?? 0;
  return lines
    .filter((line) => line.ts >= start)
    .map((line) => ({ line, at: line.ts - start }));
}
