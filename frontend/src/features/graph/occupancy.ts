/**
 * The occupancy plan: a time-distance graph in the manner of a railway timetable diagram. One
 * row per process, time on the x axis, a bar for as long as the process held its slot.
 * Geometry only; the component draws it. Everything is in fractions of the axis, so the same
 * numbers serve any width.
 */

import type { Proc, ProcState, Run } from "../../state/types";

export interface OccupancyBar {
  pid: number;
  program: string;
  state: ProcState;
  /** Start and end as fractions of the axis, 0…1. */
  from: number;
  to: number;
}

export interface OccupancyTick {
  at: number;
  fraction: number;
}

export interface Occupancy {
  /** Axis length in seconds. */
  span: number;
  bars: OccupancyBar[];
  ticks: OccupancyTick[];
  /** Where "now" is on the axis, 0…1. */
  cursor: number;
}

/** Candidate tick spacings in seconds; the smallest one that keeps the axis under 7 labels wins. */
const TICK_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 1_800, 3_600];
/** A fresh mission still gets an axis wide enough to read, not a single pixel of bar. */
const MIN_SPAN_S = 20;

export function occupancyOf(run: Run, procs: Proc[], now: number): Occupancy {
  const end = run.doneAt ?? now;
  const latest = procs.reduce((top, proc) => Math.max(top, proc.exitedAt ?? end), end);
  const span = Math.max(MIN_SPAN_S, latest - run.createdAt);
  const at = (ts: number) => Math.min(1, Math.max(0, (ts - run.createdAt) / span));

  const bars = procs
    .filter((proc) => proc.runId === run.id && proc.startedAt !== null)
    .sort((a, b) => a.pid - b.pid)
    .map((proc) => ({
      pid: proc.pid,
      program: proc.program,
      state: proc.state,
      from: at(proc.startedAt as number),
      to: at(proc.exitedAt ?? end),
    }));

  return { span, bars, ticks: ticksOf(span), cursor: at(end) };
}

function ticksOf(span: number): OccupancyTick[] {
  const step = TICK_STEPS.find((candidate) => span / candidate < 7) ?? TICK_STEPS.at(-1)!;
  const ticks: OccupancyTick[] = [];
  for (let at = 0; at <= span; at += step) ticks.push({ at, fraction: at / span });
  return ticks;
}
