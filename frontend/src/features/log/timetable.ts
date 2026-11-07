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
 * Lines at or after `origin`, minus the ones that only repeat another line. Without a mission
 * the whole log is shown from its own first line, so an idle kernel still has a readable ticker.
 *
 * Two kinds of repetition are dropped: a Claude tool call that is one of hugin's own syscalls
 * is logged twice (`tool.call` and `sys.call`, then both results), and the lamp flipping
 * between "Läuft" and "Werkzeug aktiv" just restates the call that caused it.
 */
export function timetableRows(lines: LogLine[], origin: number | null): TimetableRow[] {
  const start = origin ?? lines[0]?.ts ?? 0;
  const inSyscall = new Set<number | null>();
  const rows: TimetableRow[] = [];
  for (const line of lines) {
    if (line.ts < start) continue;
    if (line.kind === "tool.call" && line.kernelTool === true) inSyscall.add(line.pid);
    else if ((line.kind === "sys.call" || line.kind === "sys.result") && inSyscall.has(line.pid)) continue;
    else if (line.kind === "tool.result") inSyscall.delete(line.pid);
    if (line.kind === "proc.state" && LAMP_FLIP.test(line.text)) continue;
    rows.push({ line, at: line.ts - start });
  }
  return rows;
}

const LAMP_FLIP = /: (Läuft → Werkzeug aktiv|Werkzeug aktiv → Läuft)$/;
