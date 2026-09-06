import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Fragment, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { applyEvents, initialState } from "../../state/reducer";
import type { HEvent, Proc, Usage } from "../../state/types";
import { AgentWindow } from "./AgentWindow";

// The transcript is virtualised in the browser; in jsdom nothing has a height, so a plain list
// stands in for `Virtuoso` and every row is actually rendered (same stand-in as the log's test).
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data = [],
    itemContent,
  }: {
    data?: unknown[];
    itemContent: (index: number, item: never) => ReactNode;
  }) => (
    <div data-testid="virtuoso">
      {data.map((item, index) => (
        <Fragment key={index}>{itemContent(index, item as never)}</Fragment>
      ))}
    </div>
  ),
}));

const BUDGET = { max_turns: 12, max_seconds: 300, max_output_tokens: 6_000 };
const USAGE: Usage = { turns: 3, input_tokens: 20_000, output_tokens: 1_234, cost_usd_equiv: null };

function ev(seq: number, ts: number, kind: string, pid: number | null, data: object = {}): HEvent {
  return { seq, ts, run_id: "r1", pid, kind, data: data as Record<string, unknown> };
}

/** A scout mid-flight: one paragraph of prose, one finished tool call, one budget tick. */
function makeProc(tail: HEvent[] = []): Proc {
  const state = applyEvents(initialState, [
    ev(1, 1_000, "run.created", null, { goal: "Ziel", driver: "scripted", template: null }),
    ev(2, 1_000, "proc.spawned", 2, {
      ppid: 1,
      program: "scout",
      role: "Researcher",
      driver: "scripted",
      model: "sim-1",
      budget: BUDGET,
      task: "Finde Quellen",
    }),
    ev(3, 1_000, "sched.started", 2, {}),
    ev(4, 1_001, "proc.state", 2, { prev: "spawning", state: "running" }),
    ev(5, 1_002, "proc.text", 2, { delta: "Ich prüfe drei Quellen." }),
    ev(6, 1_003, "tool.call", 2, {
      call_id: "c1",
      tool: "web_search",
      input_summary: "query=hugin",
    }),
    ev(7, 1_004, "tool.result", 2, {
      call_id: "c1",
      ok: true,
      output_summary: "3 Treffer",
      ms: 128,
    }),
    ev(8, 1_005, "budget.tick", 2, { turns: 3, seconds: 5, output_tokens: 1_234, pct: 0.25 }),
    ...tail,
  ]);
  return state.procs[2];
}

function exited(reason: string, stderrTail: string | null = null): Proc {
  return makeProc([
    ev(9, 1_042, "proc.exit", 2, { reason, usage: USAGE, stderr_tail: stderrTail }),
    ev(10, 1_042, "proc.state", 2, {
      prev: "running",
      state: reason === "done" ? "done" : "killed",
    }),
  ]);
}

function renderWindow(over: Partial<Parameters<typeof AgentWindow>[0]> = {}) {
  const props = {
    proc: makeProc(),
    now: 1_042,
    onClose: vi.fn(),
    onKill: vi.fn(),
    ...over,
  };
  render(<AgentWindow {...props} />);
  return props;
}

describe("AgentWindow", () => {
  it("names the agent: program, German role, pid, state, model and driver", () => {
    renderWindow();
    expect(screen.getByText("scout")).toBeInTheDocument();
    expect(screen.getByText("Späher")).toBeInTheDocument();
    expect(screen.getByText("PID 2")).toBeInTheDocument();
    expect(screen.getByText("Läuft")).toBeInTheDocument();
    expect(screen.getByText("sim-1")).toBeInTheDocument();
    expect(screen.getByText("Simulation")).toBeInTheDocument();
  });

  it("shows turns, tokens and elapsed time against their limits", () => {
    renderWindow();
    expect(screen.getByText("3/12")).toBeInTheDocument();
    expect(screen.getByText("1,2k/6,0k")).toBeInTheDocument();
    expect(screen.getByText("0:42/5:00")).toBeInTheDocument();
    // Only `proc.exit` reports input tokens, so a live process is honestly at zero context.
    expect(screen.getByText("0 %")).toBeInTheDocument();
  });

  it("measures context against the model window once the usage report arrives", () => {
    renderWindow({ proc: exited("done"), now: 9_999 });
    expect(screen.getByText("10 %")).toBeInTheDocument();
  });

  it("renders the transcript as prose and marks the live end with a cursor", () => {
    renderWindow();
    expect(screen.getByText("Ich prüfe drei Quellen.")).toBeInTheDocument();
    expect(screen.getByTestId("transcript-cursor")).toBeInTheDocument();
  });

  it("drops the cursor once the process has exited", () => {
    renderWindow({ proc: exited("done"), now: 9_999 });
    expect(screen.queryByTestId("transcript-cursor")).not.toBeInTheDocument();
  });

  it("shows the thinking shimmer only while the agent is thinking", () => {
    renderWindow();
    expect(screen.queryByText("denkt…")).not.toBeInTheDocument();
    const thinking = makeProc([ev(9, 1_006, "proc.thinking", 2, { on: true })]);
    render(<AgentWindow proc={thinking} now={1_042} onClose={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByText("denkt…")).toBeInTheDocument();
  });

  it("collapses a tool call to one line and expands it to input and output on click", async () => {
    renderWindow();
    const card = screen.getByRole("button", { name: /web_search/ });
    expect(card).toHaveTextContent("128 ms");
    expect(screen.queryByText("query=hugin")).not.toBeInTheDocument();

    await userEvent.click(card);
    expect(screen.getByText("query=hugin")).toBeInTheDocument();
    expect(screen.getByText("3 Treffer")).toBeInTheDocument();

    await userEvent.click(card);
    expect(screen.queryByText("query=hugin")).not.toBeInTheDocument();
  });

  it("offers the kill switch while the process is alive and reports the pid", async () => {
    const { onKill } = renderWindow();
    const kill = screen.getByRole("button", { name: "Prozess beenden" });
    expect(kill).toBeEnabled();
    await userEvent.click(kill);
    expect(onKill).toHaveBeenCalledWith(2);
  });

  it("disables the kill switch for a process that has already exited", () => {
    renderWindow({ proc: exited("done") });
    expect(screen.getByRole("button", { name: "Prozess beenden" })).toBeDisabled();
  });

  it("translates the exit reason and shows the driver's last words", () => {
    renderWindow({ proc: exited("budget:turns") });
    expect(screen.getByText("Budget: Runden überschritten")).toBeInTheDocument();

    render(
      <AgentWindow
        proc={exited("driver_error", "Traceback\nRuntimeError: boom")}
        now={9_999}
        onClose={vi.fn()}
        onKill={vi.fn()}
      />,
    );
    expect(screen.getByText("Treiberfehler")).toBeInTheDocument();
    expect(screen.getByTestId("stderr-tail")).toHaveTextContent("RuntimeError: boom");
  });

  it("closes on the close button and on Esc", async () => {
    const { onClose } = renderWindow();
    await userEvent.click(screen.getByRole("button", { name: "Agentfenster schließen" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
