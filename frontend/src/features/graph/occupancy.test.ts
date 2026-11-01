import { describe, expect, it } from "vitest";
import type { Proc, Run } from "../../state/types";
import { occupancyOf } from "./occupancy";

const run = { id: "r", createdAt: 100, doneAt: null } as Run;

function proc(pid: number, startedAt: number | null, exitedAt: number | null, over: Partial<Proc> = {}): Proc {
  return { pid, program: "scout", runId: "r", state: "running", startedAt, exitedAt, ...over } as Proc;
}

describe("occupancyOf", () => {
  it("draws a bar from start to exit as fractions of the axis", () => {
    const { bars, span } = occupancyOf(
      { ...run, doneAt: 200 },
      [proc(1, 100, 200), proc(2, 125, 175)],
      999,
    );
    expect(span).toBe(100);
    expect(bars.map((bar) => [bar.pid, bar.from, bar.to])).toEqual([
      [1, 0, 1],
      [2, 0.25, 0.75],
    ]);
  });

  it("lets a running process reach the cursor", () => {
    const { bars, cursor } = occupancyOf(run, [proc(1, 100, null)], 150);
    expect(bars[0].to).toBe(1);
    expect(cursor).toBe(1);
  });

  it("leaves out processes that never started or belong to another run", () => {
    const { bars } = occupancyOf(run, [proc(1, null, null), proc(2, 105, null, { runId: "x" })], 130);
    expect(bars).toEqual([]);
  });

  it("keeps a readable axis for a mission that has just begun", () => {
    expect(occupancyOf(run, [], 102).span).toBe(20);
  });

  it("puts ticks at round times and keeps them few", () => {
    const { ticks } = occupancyOf({ ...run, doneAt: 100 + 231 }, [], 999);
    expect(ticks.map((tick) => tick.at)).toEqual([0, 60, 120, 180]);
    expect(ticks.length).toBeLessThan(7);
  });
});
