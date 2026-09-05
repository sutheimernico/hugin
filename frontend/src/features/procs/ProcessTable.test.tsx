import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { applyEvents, initialState } from "../../state/reducer";
import { selectProcs } from "../../state/selectors";
import type { HEvent, Proc } from "../../state/types";
import { ProcessTable } from "./ProcessTable";

const BUDGET = { max_turns: 12, max_seconds: 300, max_output_tokens: 6_000 };

function ev(seq: number, ts: number, kind: string, pid: number | null, data: object = {}): HEvent {
  return { seq, ts, run_id: "r1", pid, kind, data: data as Record<string, unknown> };
}

/** A planner still working and a scout that already finished — folded through the real reducer. */
function twoProcs(): Proc[] {
  const spawn = (program: string, ppid: number | null) => ({
    ppid,
    program,
    role: program,
    driver: "scripted",
    model: "sim",
    budget: BUDGET,
    task: "Finde etwas",
  });
  const state = applyEvents(initialState, [
    ev(1, 1_000, "run.created", null, { goal: "Ziel", driver: "scripted", template: null }),
    ev(2, 1_000, "proc.spawned", 1, spawn("planner", null)),
    ev(3, 1_000, "sched.started", 1, {}),
    ev(4, 1_001, "proc.state", 1, { prev: "spawning", state: "running" }),
    ev(5, 1_002, "budget.tick", 1, { turns: 4, seconds: 2, output_tokens: 1_234, pct: 0.33 }),
    ev(6, 1_003, "proc.spawned", 2, spawn("scout", 1)),
    ev(7, 1_003, "sched.started", 2, {}),
    ev(8, 1_020, "proc.exit", 2, {
      reason: "ok",
      usage: { turns: 2, input_tokens: 900, output_tokens: 300, cost_usd_equiv: null },
    }),
    ev(9, 1_020, "proc.state", 2, { prev: "running", state: "done" }),
  ]);
  return selectProcs(state);
}

function renderTable(over: Partial<Parameters<typeof ProcessTable>[0]> = {}) {
  const props = {
    procs: twoProcs(),
    now: 1_042,
    selectedPid: null,
    onSelect: vi.fn(),
    onKill: vi.fn(),
    ...over,
  };
  render(<ProcessTable {...props} />);
  return props;
}

describe("ProcessTable", () => {
  it("renders one row per process with program, German state, turns, tokens and elapsed time", () => {
    renderTable();
    const rows = screen.getAllByTestId("proc-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("planner");
    expect(rows[0]).toHaveTextContent("Läuft");
    expect(rows[0]).toHaveTextContent("1,2k");
    expect(rows[0]).toHaveTextContent("0:42");
    expect(rows[1]).toHaveTextContent("scout");
    expect(rows[1]).toHaveTextContent("Fertig");
  });

  it("stops the clock of an exited process at its exit", () => {
    renderTable({ now: 9_999 });
    expect(screen.getAllByTestId("proc-row")[1]).toHaveTextContent("0:17");
  });

  it("reports the clicked pid", async () => {
    const { onSelect } = renderTable();
    await userEvent.click(screen.getAllByTestId("proc-row")[1]);
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("marks the selected row", () => {
    renderTable({ selectedPid: 2 });
    expect(screen.getAllByTestId("proc-row")[1]).toHaveAttribute("data-selected", "true");
    expect(screen.getAllByTestId("proc-row")[0]).not.toHaveAttribute("data-selected");
  });

  it("offers the kill switch only for a living process and does not select on kill", async () => {
    const { onKill, onSelect } = renderTable();
    expect(screen.queryByRole("button", { name: "Prozess 2 beenden" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Prozess 1 beenden" }));
    expect(onKill).toHaveBeenCalledWith(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows a designed empty state instead of an empty grid", () => {
    renderTable({ procs: [] });
    expect(screen.getByText("Noch keine Prozesse")).toBeInTheDocument();
    expect(screen.queryAllByTestId("proc-row")).toHaveLength(0);
  });
});
