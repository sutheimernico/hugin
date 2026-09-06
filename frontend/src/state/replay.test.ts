import { beforeEach, describe, expect, it } from "vitest";
import { applyEvents, initialState } from "./reducer";
import { selectActiveRun, selectMode } from "./selectors";
import { IDLE_REPLAY, selectVisibleState, useHuginStore } from "./store";
import type { HEvent } from "./types";

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

/** A whole little run: created, one process, a second one, both gone, run done. */
const RUN: HEvent[] = [
  ev(1, 1_000, "run.created", null, { goal: "Ziel", driver: "scripted", template: null }),
  ev(2, 1_001, "proc.spawned", 1, SPAWN),
  ev(3, 1_002, "proc.spawned", 2, { ...SPAWN, ppid: 1, program: "scout", role: "scout" }),
  ev(4, 1_008, "proc.state", 2, { prev: "running", state: "done" }),
  ev(5, 1_010, "run.done", null, {
    duration_s: 10,
    usage: { turns: 3, input_tokens: 10, output_tokens: 20, cost_usd_equiv: null },
    artifacts: ["plan.md"],
  }),
];

/** A live batch that arrives while the shell is busy replaying an older run. */
const LIVE: HEvent[] = [
  ev(6, 2_000, "run.created", null, { goal: "Neu", driver: "scripted", template: null }),
  ev(7, 2_001, "proc.spawned", 9, SPAWN),
];

function store() {
  return useHuginStore.getState();
}

beforeEach(() => {
  useHuginStore.setState({ state: initialState, replay: IDLE_REPLAY, selectedPid: null });
});

describe("replay slice", () => {
  it("switches the shell into replay mode and starts at the beginning of the run", () => {
    store().enterReplay({ runId: "r1" }, RUN);

    expect(selectMode(store())).toBe("replay");
    expect(store().replay.cursorSeq).toBe(0);
    expect(store().replay.events).toHaveLength(5);
    expect(selectVisibleState(store())).toEqual(initialState);
  });

  it("replays a recording by its slug", () => {
    store().enterReplay({ slug: "bloom" }, RUN);
    expect(selectMode(store())).toBe("replay");
    expect(store().replay.runId).toBe("bloom");
  });

  it("shows the run as it was at the cursor", () => {
    store().enterReplay({ runId: "r1" }, RUN);
    store().seek(3);

    const visible = selectVisibleState(store());
    expect(Object.keys(visible.procs)).toHaveLength(2);
    expect(visible.runs["r1"].state).toBe("running");
  });

  it("recomputes correctly when the cursor moves backwards", () => {
    store().enterReplay({ runId: "r1" }, RUN);
    store().seek(5);
    expect(selectVisibleState(store()).runs["r1"].state).toBe("done");

    store().seek(2);
    const back = selectVisibleState(store());
    expect(Object.keys(back.procs)).toEqual(["1"]);
    expect(back.runs["r1"].state).toBe("running");
    expect(back).toEqual(applyEvents(initialState, RUN.slice(0, 2)));
  });

  it("clamps a seek to the run it is replaying", () => {
    store().enterReplay({ runId: "r1" }, RUN);
    store().seek(99);
    expect(store().replay.cursorSeq).toBe(5);
    store().seek(-3);
    expect(store().replay.cursorSeq).toBe(0);
  });

  it("steps one event forwards and backwards", () => {
    store().enterReplay({ runId: "r1" }, RUN);
    store().step(1);
    expect(store().replay.cursorSeq).toBe(1);
    store().step(1);
    expect(store().replay.cursorSeq).toBe(2);
    store().step(-1);
    expect(store().replay.cursorSeq).toBe(1);
    store().step(-1);
    expect(store().replay.cursorSeq).toBe(0);
    // Neither end of the run runs off the track.
    store().step(-1);
    expect(store().replay.cursorSeq).toBe(0);
    store().seek(5);
    store().step(1);
    expect(store().replay.cursorSeq).toBe(5);
  });

  it("plays, pauses and changes speed", () => {
    store().enterReplay({ runId: "r1" }, RUN);
    store().play();
    expect(store().replay.playing).toBe(true);
    store().pause();
    expect(store().replay.playing).toBe(false);
    store().setSpeed(4);
    expect(store().replay.speed).toBe(4);
  });

  it("starts over when play is pressed at the end of the run", () => {
    store().enterReplay({ runId: "r1" }, RUN);
    store().seek(5);
    store().play();
    expect(store().replay.cursorSeq).toBe(0);
    expect(store().replay.playing).toBe(true);
  });

  it("keeps the replayed run as the active one after it finished", () => {
    store().enterReplay({ runId: "r1" }, RUN);
    store().seek(5);

    const visible = selectVisibleState(store());
    expect(selectActiveRun(visible)).toBeUndefined();
    expect(selectActiveRun(visible, store().replay)?.id).toBe("r1");
  });

  it("buffers live events during replay and applies them in order on exit", () => {
    store().dispatch(RUN);
    const live = store().state;

    store().enterReplay({ runId: "r1" }, RUN);
    store().dispatch(LIVE);
    // The live projection stands still: a replay must not be disturbed by the present.
    expect(store().state).toBe(live);
    expect(selectVisibleState(store())).toEqual(initialState);

    store().exitReplay();
    expect(store().replay).toEqual(IDLE_REPLAY);
    expect(store().state).toEqual(applyEvents(initialState, [...RUN, ...LIVE]));
    expect(selectMode(store())).not.toBe("replay");
    // The visible state is the live one again the moment replay ends.
    expect(selectVisibleState(store())).toBe(store().state);
  });

  it("does not apply a buffered batch twice", () => {
    store().enterReplay({ runId: "r1" }, RUN);
    store().dispatch(LIVE);
    store().exitReplay();
    const after = store().state;

    store().dispatch(LIVE);
    expect(store().state).toBe(after);
  });
});
