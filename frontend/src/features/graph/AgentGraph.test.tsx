import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initialState } from "../../state/reducer";
import type { Proc, State } from "../../state/types";
import { AgentGraph } from "./AgentGraph";

const RUN = "r1";

function proc(pid: number, ppid: number | null, program: string): Proc {
  return {
    pid,
    runId: RUN,
    ppid,
    program,
    role: "Researcher",
    driver: "scripted",
    model: "sim",
    task: "Recherchiere etwas",
    state: "running",
    budget: { max_turns: 8, max_seconds: 60, max_output_tokens: 4_000 },
    usage: { turns: 1, input_tokens: 20_000, output_tokens: 400, cost_usd_equiv: null },
    startedAt: 0,
    exitedAt: null,
    exitReason: null,
    stderrTail: null,
    thinking: false,
    budgetPct: 0.1,
    transcript: [],
    muninWrites: 1,
  };
}

function mission(): State {
  return {
    ...initialState,
    activeRunId: RUN,
    munin: { writes: 3, reads: 1, lastAt: 10 },
    procs: {
      1: proc(1, null, "planner"),
      2: proc(2, 1, "scout"),
    },
  };
}

/** xyflow measures its container; in jsdom that measurement comes from the inline style. */
function renderGraph(state: State, onSelect = vi.fn(), panicking = false) {
  render(
    <div style={{ width: "800px", height: "600px" }}>
      <AgentGraph
        state={state}
        runId={state.activeRunId}
        selectedPid={null}
        onSelect={onSelect}
        panicking={panicking}
      />
    </div>,
  );
  return onSelect;
}

describe("AgentGraph", () => {
  it("draws a card per agent and the memory hub", async () => {
    renderGraph(mission());

    expect(await screen.findByText("planner · PID 1")).toBeInTheDocument();
    expect(screen.getByText("scout · PID 2")).toBeInTheDocument();
    expect(screen.getByText("munin")).toBeInTheDocument();
    // The German role labels sit under the program names.
    expect(screen.getByText("Planer")).toBeInTheDocument();
    expect(screen.getByText("Späher")).toBeInTheDocument();
    expect(screen.getAllByTestId("agent-node")).toHaveLength(2);
  });

  it("shows the hub's write counter", async () => {
    renderGraph(mission());
    const hub = await screen.findByTestId("munin-node");
    expect(hub).toHaveTextContent("3");
  });

  it("selects the process behind a card that is clicked", async () => {
    const onSelect = renderGraph(mission());
    // A bare click, not a full pointer sequence: the mousedown would land in d3-zoom, which
    // has no viewport to drag in jsdom.
    fireEvent.click(await screen.findByText("Späher"));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("selects the focused process on Enter and on Space", async () => {
    const onSelect = renderGraph(mission());
    const card = await screen.findByLabelText("scout · PID 2");

    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });

    expect(onSelect).toHaveBeenNthCalledWith(1, 2);
    expect(onSelect).toHaveBeenNthCalledWith(2, 2);
  });

  it("labels every agent card with its program and pid", async () => {
    renderGraph(mission());
    expect(await screen.findByLabelText("planner · PID 1")).toBeInTheDocument();
    expect(screen.getByLabelText("scout · PID 2")).toBeInTheDocument();
  });

  it("shows what an agent is doing, in German, under its role", async () => {
    renderGraph(mission());
    await screen.findByText("Planer");
    for (const node of screen.getAllByTestId("agent-node")) {
      expect(node).toHaveTextContent("Läuft");
    }
  });

  it("follows a process through its states, and stamps one that was stopped", async () => {
    const running = mission();
    const { rerender } = render(
      <div style={{ width: "800px", height: "600px" }}>
        <AgentGraph state={running} runId={RUN} selectedPid={null} onSelect={vi.fn()} panicking={false} />
      </div>,
    );
    const card = await screen.findByText("Späher");
    const node = card.closest("[data-testid=agent-node]") as HTMLElement;
    expect(node).toHaveAttribute("data-state", "running");
    expect(screen.queryByText("KILL")).not.toBeInTheDocument();

    const killed: State = {
      ...running,
      procs: { 1: running.procs[1], 2: { ...running.procs[2], state: "killed" } },
    };
    rerender(
      <div style={{ width: "800px", height: "600px" }}>
        <AgentGraph state={killed} runId={RUN} selectedPid={null} onSelect={vi.fn()} panicking={false} />
      </div>,
    );

    await waitFor(() => expect(node).toHaveAttribute("data-state", "killed"));
    // The kill was watched live, so the amber TERM beat comes first and the red mark follows.
    expect(screen.getByText("TERM")).toBeInTheDocument();
    expect(screen.getByText("KILL")).toBeInTheDocument();
  });

  it("shows a card that mounts already stopped without the amber beat", async () => {
    const state = mission();
    renderGraph({
      ...state,
      procs: { 1: state.procs[1], 2: { ...state.procs[2], state: "killed" } },
    });
    expect(await screen.findByText("KILL")).toBeInTheDocument();
    expect(screen.queryByText("TERM")).not.toBeInTheDocument();
  });

  it("desaturates the whole surface while a panic is propagating", () => {
    renderGraph(mission(), vi.fn(), true);
    expect(screen.getByTestId("graph-surface")).toHaveClass("hugin-panic");
  });

  it("says so instead of drawing an empty canvas while nothing runs", () => {
    renderGraph(initialState);
    expect(screen.getByText(/Noch keine Agenten/)).toBeInTheDocument();
  });
});
