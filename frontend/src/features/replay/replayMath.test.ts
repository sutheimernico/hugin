import { describe, expect, it } from "vitest";
import { applyEvents, initialState } from "../../state/reducer";
import type { HEvent } from "../../state/types";
import { coalesce, FRAME_MS, fractionOfSeq, nextTick, seqAtFraction, stateAt, tsAtSeq } from "./replayMath";

function ev(seq: number, ts: number, kind: string, pid: number | null, data: object = {}): HEvent {
  return { seq, ts, run_id: "r1", pid, kind, data: data as Record<string, unknown> };
}

const SPAWN = {
  ppid: null,
  program: "planner",
  role: "planner",
  driver: "scripted",
  model: "sim",
  budget: { max_turns: 12, max_seconds: 300, max_output_tokens: 6_000 },
  task: "Finde etwas",
};

/** Deliberately uneven: 0 s, 1 s, 10 s after the start — the scrubber runs on time, not index. */
const RUN: HEvent[] = [
  ev(1, 1_000, "run.created", null, { goal: "Ziel", driver: "scripted", template: null }),
  ev(2, 1_001, "proc.spawned", 1, SPAWN),
  ev(3, 1_010, "proc.spawned", 2, { ...SPAWN, ppid: 1, program: "scout", role: "scout" }),
];

/** Two events ten seconds apart — the gap the cap exists for. */
const GAP: HEvent[] = [RUN[0], ev(2, 1_010, "proc.spawned", 1, SPAWN)];

describe("seqAtFraction / fractionOfSeq", () => {
  it("places every event at its share of the elapsed time, not of the index", () => {
    expect(RUN.map((e) => fractionOfSeq(RUN, e.seq))).toEqual([0, 0.1, 1]);
  });

  it("round-trips every event's seq through its fraction", () => {
    for (const event of RUN) {
      expect(seqAtFraction(RUN, fractionOfSeq(RUN, event.seq))).toBe(event.seq);
    }
  });

  it("snaps a fraction between two events back to the one already shown", () => {
    // Half way through is still the second event: nothing new happened until 10 s.
    expect(seqAtFraction(RUN, 0.5)).toBe(2);
  });

  it("clamps out-of-range input instead of returning nonsense", () => {
    expect(seqAtFraction(RUN, -1)).toBe(1);
    expect(seqAtFraction(RUN, 2)).toBe(3);
    expect(fractionOfSeq(RUN, 0)).toBe(0);
    expect(fractionOfSeq(RUN, 99)).toBe(1);
  });

  it("answers an empty recording without dividing by zero", () => {
    expect(seqAtFraction([], 0.5)).toBe(0);
    expect(fractionOfSeq([], 3)).toBe(0);
  });
});

describe("nextTick", () => {
  it("delivers the first event immediately", () => {
    expect(nextTick(RUN, 0, 1)).toEqual({ seq: 1, delayMs: 0 });
  });

  it("caps a long gap so a thinking pause never stalls the player", () => {
    expect(nextTick(GAP, 1, 1)).toEqual({ seq: 2, delayMs: 3_000 });
  });

  it("divides the gap by the speed before the cap applies", () => {
    expect(nextTick(GAP, 1, 4)).toEqual({ seq: 2, delayMs: 2_500 });
  });

  it("returns null at the end of the run", () => {
    expect(nextTick(RUN, 3, 1)).toBeNull();
    expect(nextTick([], 0, 1)).toBeNull();
  });
});

describe("coalesce", () => {
  /** Three events in the same millisecond, then one a second later. */
  const BURST: HEvent[] = [
    ev(1, 1_000, "proc.text", 1, { delta: "a" }),
    ev(2, 1_000, "proc.text", 1, { delta: "b" }),
    ev(3, 1_000, "proc.text", 1, { delta: "c" }),
    ev(4, 1_001, "proc.text", 1, { delta: "d" }),
  ];

  it("takes a whole burst in one step and stops before the next real gap", () => {
    expect(coalesce(BURST, 1, 1, 16)).toBe(3);
  });

  it("reaches further the faster the run is played", () => {
    // At 8× the one-second gap is 125 ms — still too long for a single frame.
    expect(coalesce(BURST, 1, 8, 16)).toBe(3);
    // At 100× it is 10 ms and fits.
    expect(coalesce(BURST, 1, 100, 16)).toBe(4);
  });

  it("spends its frame budget only once across a chain of small gaps", () => {
    const trickle: HEvent[] = [
      ev(1, 1_000, "proc.text", 1, {}),
      ev(2, 1_000.01, "proc.text", 1, {}),
      ev(3, 1_000.02, "proc.text", 1, {}),
      ev(4, 1_000.03, "proc.text", 1, {}),
    ];
    // 10 ms each: the first fits in the 16 ms frame, the second does not.
    expect(coalesce(trickle, 1, 1, 16)).toBe(2);
  });

  it("stands still at the end of the run", () => {
    expect(coalesce(BURST, 4, 1)).toBe(4);
  });

  it("uses a two-frame budget by default", () => {
    expect(coalesce(BURST, 1, 1)).toBe(3);
    expect(FRAME_MS).toBe(32);
  });
});

describe("tsAtSeq", () => {
  it("reports the event time the cursor stands on", () => {
    expect(tsAtSeq(RUN, 2)).toBe(1_001);
    // Before the first event the run has not started — its own start is the reading.
    expect(tsAtSeq(RUN, 0)).toBe(1_000);
    expect(tsAtSeq([], 0)).toBe(0);
  });
});

describe("stateAt", () => {
  it("equals the reducer folded over the prefix", () => {
    for (const cursor of [0, 1, 2, 3]) {
      const expected = applyEvents(
        initialState,
        RUN.filter((e) => e.seq <= cursor),
      );
      expect(stateAt(RUN, cursor)).toEqual(expected);
    }
  });

  it("recomputes from scratch when the cursor moves backwards", () => {
    stateAt(RUN, 3);
    const back = stateAt(RUN, 1);
    expect(Object.keys(back.procs)).toHaveLength(0);
    expect(back).toEqual(applyEvents(initialState, [RUN[0]]));
  });

  it("returns the identical object for the same cursor, so React can skip a render", () => {
    expect(stateAt(RUN, 2)).toBe(stateAt(RUN, 2));
  });
});
