import { describe, expect, it } from "vitest";
import { applyEvent, applyEvents, initialState, logText } from "./reducer";
import { selectMode } from "./selectors";
import type { HEvent, State } from "./types";

// Event factory: seq counts up, ts advances by 1 s unless a case pins it.
function makeFeed(startTs = 1_000) {
  let seq = 0;
  let ts = startTs;
  return function ev(
    kind: string,
    data: Record<string, unknown> = {},
    over: Partial<HEvent> = {},
  ): HEvent {
    seq += 1;
    ts += 1;
    return { seq, ts, run_id: "r1", pid: null, kind, data, ...over };
  };
}

const BUDGET = { max_turns: 12, max_seconds: 300, max_output_tokens: 6000 };
const NO_USAGE = { turns: 0, input_tokens: 0, output_tokens: 0, cost_usd_equiv: null };

function spawn(
  ev: ReturnType<typeof makeFeed>,
  pid: number,
  data: Record<string, unknown> = {},
  over: Partial<HEvent> = {},
) {
  return ev(
    "proc.spawned",
    {
      ppid: null,
      program: "scout",
      role: "scout",
      driver: "scripted",
      model: "sim",
      budget: BUDGET,
      task: "Finde etwas",
      ...data,
    },
    { pid, ...over },
  );
}

function run(state: State, events: HEvent[], opts?: { logRing?: number }): State {
  return events.reduce((acc, event) => applyEvent(acc, event, opts), state);
}

describe("applyEvent — idempotency", () => {
  it("ignores an event whose seq was already applied and keeps the same object", () => {
    const ev = makeFeed();
    const created = ev("run.created", { goal: "Ziel", driver: "scripted", template: null });
    const once = applyEvent(initialState, created);
    const twice = applyEvent(once, created);

    expect(twice).toBe(once);
    expect(once.lastSeq).toBe(created.seq);
  });

  it("ignores a replayed lower seq (SSE reconnect backfill)", () => {
    const ev = makeFeed();
    const a = ev("run.created", { goal: "Ziel", driver: "scripted", template: null });
    const b = ev("sched.queued", {}, { pid: 1 });
    const state = run(initialState, [a, b]);

    expect(applyEvent(state, a)).toBe(state);
    expect(state.lastSeq).toBe(b.seq);
  });

  it("never mutates the state it is given", () => {
    const ev = makeFeed();
    const state = run(initialState, [
      ev("run.created", { goal: "Ziel", driver: "scripted", template: null }),
      spawn(ev, 1),
      ev("proc.text", { delta: "hallo" }, { pid: 1 }),
    ]);
    const before = JSON.stringify(state);

    // One event per container the reducer copies on write.
    run(state, [
      ev("proc.text", { delta: " du" }, { pid: 1 }),
      ev("tool.call", { call_id: "c1", tool: "Read", input_summary: "a.md" }, { pid: 1 }),
      ev("tool.result", { call_id: "c1", ok: true, output_summary: "da", ms: 2 }, { pid: 1 }),
      ev("munin.write", { memory_id: 1, title: "A" }, { pid: 1 }),
      ev("msg.sent", { from_pid: 1, to_pid: 1, preview: "hi" }, { pid: 1 }),
      ev("artifact.written", { name: "a.md", bytes: 10 }, { pid: 1 }),
      ev("budget.tick", { turns: 1, output_tokens: 5, seconds: 1, pct: 0.1 }, { pid: 1 }),
      ev("proc.exit", { reason: "done", usage: NO_USAGE }, { pid: 1 }),
      ev("run.done", { usage: NO_USAGE, artifacts: ["a.md"], duration_s: 1 }),
    ]);

    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("applyEvent — runs", () => {
  it("builds a Run from run.created and closes it on run.done", () => {
    const ev = makeFeed();
    const state = run(initialState, [
      ev("run.created", { goal: "Recherche", driver: "claude", template: "research_brief" }),
      ev("artifact.written", { name: "brief.md", bytes: 120 }, { pid: 1 }),
      ev("run.done", {
        usage: { turns: 4, input_tokens: 900, output_tokens: 300, cost_usd_equiv: 0.04 },
        artifacts: ["brief.md"],
        duration_s: 12.5,
      }),
    ]);

    expect(state.runs.r1).toMatchObject({
      id: "r1",
      goal: "Recherche",
      driver: "claude",
      state: "done",
      artifacts: ["brief.md"],
    });
    expect(state.runs.r1.usage.output_tokens).toBe(300);
    expect(state.runs.r1.doneAt).not.toBeNull();
  });

  it("keeps activeRunId on the running run and hands it over once that one is finished", () => {
    const ev = makeFeed();
    const first = run(initialState, [
      ev("run.created", { goal: "Erste", driver: "scripted", template: null }),
      ev("run.created", { goal: "Zweite", driver: "scripted", template: null }, { run_id: "r2" }),
    ]);
    expect(first.activeRunId).toBe("r1");

    const second = run(first, [
      ev("run.done", { usage: NO_USAGE, artifacts: [], duration_s: 1 }),
      ev("run.created", { goal: "Dritte", driver: "ollama", template: null }, { run_id: "r3" }),
    ]);
    expect(second.activeRunId).toBe("r3");
  });
});

describe("applyEvent — processes", () => {
  it("builds a Proc through its lifecycle", () => {
    const ev = makeFeed();
    const state = run(initialState, [
      ev("run.created", { goal: "Ziel", driver: "scripted", template: null }),
      spawn(ev, 3, { program: "scout", role: "scout", task: "Suche Quellen" }),
      ev("sched.started", {}, { pid: 3 }),
      ev("proc.state", { state: "running", prev: "spawning" }, { pid: 3 }),
      ev("proc.thinking", { on: true }, { pid: 3 }),
      ev("budget.tick", { turns: 2, output_tokens: 400, seconds: 3, pct: 0.33 }, { pid: 3 }),
      ev(
        "proc.exit",
        {
          reason: "done",
          usage: { turns: 3, input_tokens: 700, output_tokens: 500, cost_usd_equiv: null },
          stderr_tail: null,
        },
        { pid: 3 },
      ),
      ev("proc.state", { state: "done", prev: "running" }, { pid: 3 }),
    ]);

    const proc = state.procs[3];
    expect(proc).toMatchObject({
      pid: 3,
      runId: "r1",
      program: "scout",
      role: "scout",
      driver: "scripted",
      state: "done",
      exitReason: "done",
      thinking: false,
      budgetPct: 0.33,
    });
    expect(proc.startedAt).not.toBeNull();
    expect(proc.exitedAt).not.toBeNull();
    // Both counters are cumulative, so the larger one wins — same rule as the kernel.
    expect(proc.usage).toEqual({
      turns: 3,
      input_tokens: 700,
      output_tokens: 500,
      cost_usd_equiv: null,
    });
  });

  it("coalesces proc.text into a single transcript item", () => {
    const ev = makeFeed();
    const state = run(initialState, [
      spawn(ev, 1),
      ev("proc.text", { delta: "Ich " }, { pid: 1 }),
      ev("proc.text", { delta: "denke " }, { pid: 1 }),
      ev("proc.text", { delta: "nach." }, { pid: 1 }),
    ]);

    expect(state.procs[1].transcript).toEqual([{ t: "text", text: "Ich denke nach." }]);
  });

  it("starts a new text item after something else interrupted the stream", () => {
    const ev = makeFeed();
    const state = run(initialState, [
      spawn(ev, 1),
      ev("proc.text", { delta: "eins" }, { pid: 1 }),
      ev("tool.call", { call_id: "c1", tool: "Read", input_summary: "a.md" }, { pid: 1 }),
      ev("proc.text", { delta: "zwei" }, { pid: 1 }),
    ]);

    const transcript = state.procs[1].transcript;
    expect(transcript).toHaveLength(3);
    expect(transcript[0]).toEqual({ t: "text", text: "eins" });
    expect(transcript[2]).toEqual({ t: "text", text: "zwei" });
  });

  it("pairs tool.call with tool.result and sys.call with sys.result by callId", () => {
    const ev = makeFeed();
    const state = run(initialState, [
      spawn(ev, 1),
      ev("tool.call", { call_id: "c1", tool: "Read", input_summary: "a.md" }, { pid: 1 }),
      ev("sys.call", { call_id: "s1", syscall: "munin_write", args_summary: "Titel" }, { pid: 1 }),
      ev("sys.result", { call_id: "s1", ok: true, result_summary: "id 7", ms: 12 }, { pid: 1 }),
      ev("tool.result", { call_id: "c1", ok: false, output_summary: "nicht da", ms: 3 }, { pid: 1 }),
    ]);

    expect(state.procs[1].transcript).toEqual([
      { t: "tool", callId: "c1", tool: "Read", input: "a.md", sys: false, output: "nicht da", ok: false, ms: 3 },
      { t: "tool", callId: "s1", tool: "munin_write", input: "Titel", sys: true, output: "id 7", ok: true, ms: 12 },
    ]);
  });
});

describe("applyEvent — pulses", () => {
  it("creates a spawn, msg and munin pulse", () => {
    const ev = makeFeed();
    // All three inside one 1.2 s window, otherwise the earlier pulses are already pruned.
    const state = run(initialState, [
      spawn(ev, 1),
      spawn(ev, 2, { ppid: 1 }, { ts: 5_000 }),
      ev("msg.sent", { from_pid: 2, to_pid: 1, preview: "fertig" }, { pid: 2, ts: 5_000.4 }),
      ev("munin.write", { memory_id: 7, title: "Fund" }, { pid: 2, ts: 5_000.8 }),
    ]);

    expect(state.pulses.map((p) => [p.from, p.to, p.kind])).toEqual([
      [1, 2, "spawn"],
      [2, 1, "msg"],
      [2, "munin", "munin"],
    ]);
    expect(new Set(state.pulses.map((p) => p.id)).size).toBe(3);
  });

  it("prunes pulses older than 1.2 s of event time", () => {
    const ev = makeFeed(1_000);
    const withPulse = run(initialState, [
      spawn(ev, 1),
      ev("msg.sent", { from_pid: 1, to_pid: 1, preview: "hi" }, { pid: 1, ts: 2_000 }),
    ]);
    expect(withPulse.pulses).toHaveLength(1);

    const stillFresh = applyEvent(withPulse, ev("sched.queued", {}, { pid: 1, ts: 2_001 }));
    expect(stillFresh.pulses).toHaveLength(1);

    const stale = applyEvent(stillFresh, ev("sched.queued", {}, { pid: 1, ts: 2_001.5 }));
    expect(stale.pulses).toHaveLength(0);
  });
});

describe("applyEvent — kernel log", () => {
  it("keeps the log inside the ring buffer bound", () => {
    const ev = makeFeed();
    const events = [1, 2, 3, 4, 5].map((n) => ev("kill", { target: n, by: "user" }, { pid: n }));
    const state = run(initialState, events, { logRing: 3 });

    expect(state.log).toHaveLength(3);
    expect(state.log.map((line) => line.pid)).toEqual([3, 4, 5]);
  });

  it("never logs proc.text or budget.tick", () => {
    const ev = makeFeed();
    const state = run(initialState, [
      spawn(ev, 1),
      ev("proc.text", { delta: "still" }, { pid: 1 }),
      ev("budget.tick", { turns: 1, output_tokens: 10, seconds: 1, pct: 0.1 }, { pid: 1 }),
    ]);

    expect(state.log.map((line) => line.kind)).toEqual(["proc.spawned"]);
  });
});

describe("logText", () => {
  const ev = makeFeed();

  it("writes a German one-liner for a spawned process", () => {
    expect(logText(spawn(ev, 3, { program: "scout" }))).toBe("Prozess 3 (scout) gestartet");
  });

  it("writes a German one-liner for a munin write", () => {
    expect(logText(ev("munin.write", { memory_id: 4, title: "Titel" }, { pid: 2 }))).toBe(
      "Speicher: »Titel«",
    );
  });

  it("writes a German one-liner for a budget breach", () => {
    expect(logText(ev("budget.exceeded", { which: "turns" }, { pid: 2 }))).toBe(
      "Budget überschritten: Runden",
    );
  });

  it("writes a German one-liner for a message", () => {
    expect(logText(ev("msg.sent", { from_pid: 2, to_pid: 1, preview: "Ergebnis" }, { pid: 2 }))).toBe(
      "Nachricht 2 → 1: »Ergebnis«",
    );
  });

  it("writes a German one-liner for a process exit", () => {
    const exit = ev("proc.exit", { reason: "budget:turns", usage: NO_USAGE }, { pid: 5 });
    expect(logText(exit)).toBe("Prozess 5 beendet: budget:turns");
  });

  it("writes a German one-liner for an artifact", () => {
    expect(logText(ev("artifact.written", { name: "brief.md", bytes: 120 }, { pid: 1 }))).toBe(
      "Artefakt geschrieben: brief.md (120 Bytes)",
    );
  });

  it("writes a German one-liner for a kill-all", () => {
    expect(logText(ev("kill", { target: "all", by: "user" }))).toBe(
      "Alle Prozesse beendet (durch user)",
    );
  });
});

describe("applyEvent — meters and munin activity", () => {
  it("counts active processes and the highest budget fill", () => {
    const ev = makeFeed();
    const state = run(initialState, [
      spawn(ev, 1),
      spawn(ev, 2),
      ev("budget.tick", { turns: 1, output_tokens: 100, seconds: 2, pct: 0.4 }, { pid: 1 }),
      ev("budget.tick", { turns: 2, output_tokens: 200, seconds: 2, pct: 0.7 }, { pid: 2 }),
      ev("proc.exit", { reason: "done", usage: NO_USAGE }, { pid: 2 }),
      ev("proc.state", { state: "done", prev: "running" }, { pid: 2 }),
    ]);

    expect(state.meters.activeProcs).toBe(1);
    expect(state.meters.budgetPct).toBe(0.4);
    expect(state.meters.totalTokens).toBe(300);
  });

  it("measures tokensPerMin over the last 60 s of event time", () => {
    const ev = makeFeed();
    const warm = run(initialState, [
      spawn(ev, 1),
      ev("budget.tick", { turns: 1, output_tokens: 300, seconds: 1, pct: 0.1 }, { pid: 1, ts: 100 }),
      ev("budget.tick", { turns: 2, output_tokens: 800, seconds: 2, pct: 0.2 }, { pid: 1, ts: 130 }),
    ]);
    expect(warm.meters.tokensPerMin).toBe(800);

    const cold = applyEvent(warm, ev("sched.queued", {}, { pid: 1, ts: 200 }));
    expect(cold.meters.tokensPerMin).toBe(0);
  });

  it("counts munin writes globally and per process", () => {
    const ev = makeFeed();
    const state = run(initialState, [
      spawn(ev, 1),
      ev("munin.write", { memory_id: 1, title: "A" }, { pid: 1 }),
      ev("munin.write", { memory_id: 2, title: "B" }, { pid: 1 }),
      ev("munin.read", { query: "A", hits: 1 }, { pid: 1 }),
    ]);

    expect(state.munin.writes).toBe(2);
    expect(state.munin.reads).toBe(1);
    expect(state.munin.lastAt).not.toBeNull();
    expect(state.procs[1].muninWrites).toBe(2);
  });
});

describe("applyEvents", () => {
  it("folds a whole batch and reports the last seq", () => {
    const ev = makeFeed();
    const events = [
      ev("run.created", { goal: "Ziel", driver: "scripted", template: null }),
      spawn(ev, 1),
      ev("proc.text", { delta: "los" }, { pid: 1 }),
    ];
    const state = applyEvents(initialState, events);

    expect(state.lastSeq).toBe(events[events.length - 1].seq);
    expect(Object.keys(state.procs)).toEqual(["1"]);
  });
});

describe("selectMode", () => {
  const idle = { state: initialState, replay: { runId: null } };

  it("is idle without a run", () => {
    expect(selectMode(idle)).toBe("idle");
  });

  it("follows the driver of the active run", () => {
    for (const driver of ["scripted", "claude", "ollama"] as const) {
      const ev = makeFeed();
      const state = applyEvent(
        initialState,
        ev("run.created", { goal: "Ziel", driver, template: null }),
      );
      expect(selectMode({ state, replay: { runId: null } })).toBe(driver);
    }
  });

  it("is idle again once the active run is finished", () => {
    const ev = makeFeed();
    const state = run(initialState, [
      ev("run.created", { goal: "Ziel", driver: "claude", template: null }),
      ev("run.done", { usage: NO_USAGE, artifacts: [], duration_s: 1 }),
    ]);
    expect(selectMode({ state, replay: { runId: null } })).toBe("idle");
  });

  it("is replay whenever a replay run is loaded", () => {
    const ev = makeFeed();
    const state = applyEvent(
      initialState,
      ev("run.created", { goal: "Ziel", driver: "claude", template: null }),
    );
    expect(selectMode({ state, replay: { runId: "r1" } })).toBe("replay");
  });
});
