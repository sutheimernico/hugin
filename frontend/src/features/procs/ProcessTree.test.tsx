import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Proc } from "../../state/types";
import { ProcessTree } from "./ProcessTree";

function proc(pid: number, ppid: number | null, program: string, over: Partial<Proc> = {}): Proc {
  return {
    pid,
    ppid,
    program,
    role: program,
    runId: "r",
    state: "running",
    thinking: false,
    transcript: [],
    exitReason: null,
    budgetPct: 0.3,
    usage: { turns: 1, input_tokens: 0, output_tokens: 1_500, cost_usd_equiv: null },
    ...over,
  } as Proc;
}

const procs = [proc(1, null, "planner"), proc(2, 1, "scout"), proc(3, 1, "scout", { state: "done" })];

describe("ProcessTree", () => {
  it("lists every agent with its German role, state line and tokens", () => {
    render(<ProcessTree procs={procs} selectedPid={null} onSelect={vi.fn()} />);
    const rows = screen.getAllByTestId("tree-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Planer");
    expect(rows[1]).toHaveTextContent("Läuft");
    expect(rows[2]).toHaveTextContent("Fertig · Bericht abgegeben");
    expect(rows[1]).toHaveTextContent("1,5k");
  });

  it("indents children under their parent", () => {
    render(<ProcessTree procs={procs} selectedPid={null} onSelect={vi.fn()} />);
    const [planner, scout] = screen.getAllByTestId("tree-row").map((row) => row.querySelector("button"));
    expect(planner?.style.marginLeft).toBe("0px");
    expect(scout?.style.marginLeft).toBe("22px");
  });

  it("selects the process behind a tapped row and marks the selected one", async () => {
    const onSelect = vi.fn();
    render(<ProcessTree procs={procs} selectedPid={3} onSelect={onSelect} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[2]).toHaveAttribute("aria-current", "true");
    await userEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});
