import { describe, expect, it } from "vitest";
import { initialState } from "../../state/reducer";
import type { Proc, State } from "../../state/types";
import { buildGraph, MUNIN_ID } from "./layout";

const RUN = "r1";

function proc(pid: number, ppid: number | null, over: Partial<Proc> = {}): Proc {
  return {
    pid,
    runId: RUN,
    ppid,
    program: ppid === null ? "planner" : "scout",
    role: ppid === null ? "planner" : "scout",
    driver: "scripted",
    model: "sim",
    task: "",
    state: "running",
    budget: { max_turns: 8, max_seconds: 60, max_output_tokens: 4_000 },
    usage: { turns: 0, input_tokens: 0, output_tokens: 0, cost_usd_equiv: null },
    startedAt: 0,
    exitedAt: null,
    exitReason: null,
    stderrTail: null,
    thinking: false,
    budgetPct: 0,
    transcript: [],
    muninWrites: 0,
    ...over,
  };
}

function stateOf(procs: Proc[]): State {
  return {
    ...initialState,
    activeRunId: RUN,
    procs: Object.fromEntries(procs.map((p) => [p.pid, p])),
  };
}

/** The scripted mission: a planner that spawns three scouts and then a judge. */
function mission(): State {
  return stateOf([proc(1, null), proc(2, 1), proc(3, 1), proc(4, 1, { program: "judge" })]);
}

describe("buildGraph", () => {
  it("draws one node per process of the run plus the munin hub", () => {
    const { nodes } = buildGraph(mission(), RUN);
    expect(nodes.map((node) => node.id)).toEqual(["p1", "p2", "p3", "p4", MUNIN_ID]);
    expect(nodes.filter((node) => node.kind === "proc").map((node) => node.pid)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("connects every child to its parent", () => {
    const { edges } = buildGraph(mission(), RUN);
    const tree = edges.filter((edge) => edge.kind === "tree");
    expect(tree).toHaveLength(3);
    expect(tree.map((edge) => [edge.source, edge.target])).toEqual([
      ["p1", "p2"],
      ["p1", "p3"],
      ["p1", "p4"],
    ]);
  });

  it("gives every node a position of its own", () => {
    const { nodes } = buildGraph(mission(), RUN);
    const places = new Set(nodes.map((node) => `${node.x}/${node.y}`));
    expect(places.size).toBe(nodes.length);
  });

  it("ranks the tree top down — children sit below their parent", () => {
    const { nodes } = buildGraph(mission(), RUN);
    const at = (id: string) => nodes.find((node) => node.id === id)!;
    for (const child of ["p2", "p3", "p4"]) {
      expect(at(child).y).toBeGreaterThan(at("p1").y);
    }
  });

  it("puts the munin hub to the right of every agent", () => {
    const { nodes } = buildGraph(mission(), RUN);
    const hub = nodes.find((node) => node.id === MUNIN_ID)!;
    for (const node of nodes.filter((n) => n.kind === "proc")) {
      expect(hub.x).toBeGreaterThan(node.x);
    }
  });

  it("links only the processes that actually wrote to munin", () => {
    const state = stateOf([proc(1, null, { muninWrites: 2 }), proc(2, 1), proc(3, 1)]);
    const munin = buildGraph(state, RUN).edges.filter((edge) => edge.kind === "munin");
    expect(munin).toHaveLength(1);
    expect(munin[0].source).toBe("p1");
    expect(munin[0].target).toBe(MUNIN_ID);
  });

  it("ignores the processes of other runs", () => {
    const state = stateOf([proc(1, null), { ...proc(2, 1), runId: "other" }]);
    expect(buildGraph(state, RUN).nodes.map((node) => node.id)).toEqual(["p1", MUNIN_ID]);
  });

  it("draws nothing at all while no mission has started", () => {
    expect(buildGraph(initialState, null)).toEqual({ nodes: [], edges: [] });
    expect(buildGraph(mission(), null)).toEqual({ nodes: [], edges: [] });
  });
});
