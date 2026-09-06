import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { initialState } from "../../state/reducer";
import { IDLE_REPLAY, useHuginStore } from "../../state/store";
import type { HEvent } from "../../state/types";
import { Timeline } from "./Timeline";

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

/** Ten seconds of run: created, two processes, an artifact, done. */
const RUN: HEvent[] = [
  ev(1, 1_000, "run.created", null, { goal: "Vergleiche drei Ansätze", driver: "scripted" }),
  ev(2, 1_001, "proc.spawned", 1, SPAWN),
  ev(3, 1_002, "proc.spawned", 2, { ...SPAWN, ppid: 1, program: "scout" }),
  ev(4, 1_008, "artifact.written", 1, { name: "plan.md", bytes: 120 }),
  ev(5, 1_010, "run.done", null, { duration_s: 10, usage: {}, artifacts: ["plan.md"] }),
];

function replay() {
  return useHuginStore.getState().replay;
}

beforeEach(() => {
  useHuginStore.setState({
    state: initialState,
    // Parked three events in, so the player's next tick is a long one and no timer fires
    // inside a test that is not about the player.
    replay: { ...IDLE_REPLAY, runId: "r1", cursorSeq: 3, events: RUN },
    pendingLive: [],
  });
});

describe("Timeline", () => {
  it("offers the four speeds and switches to the one that was clicked", async () => {
    render(<Timeline />);
    for (const label of ["1×", "2×", "4×", "8×"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    await userEvent.click(screen.getByRole("button", { name: "4×" }));
    expect(replay().speed).toBe(4);
    expect(screen.getByRole("button", { name: "4×" })).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles between play and pause", async () => {
    render(<Timeline />);
    await userEvent.click(screen.getByRole("button", { name: "Abspielen" }));
    expect(replay().playing).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(replay().playing).toBe(false);
  });

  it("seeks to the position the scrubber was dragged to", () => {
    render(<Timeline />);
    const scrubber = screen.getByRole("slider", { name: "Zeitleiste" });
    fireEvent.change(scrubber, { target: { value: "800" } });
    // 80 % of ten seconds is the artifact at 1_008.
    expect(replay().cursorSeq).toBe(4);
  });

  it("reads out the event time, never the wall clock", () => {
    render(<Timeline />);
    expect(screen.getByTestId("replay-time")).toHaveTextContent("0:02 / 0:10");
  });

  it("marks spawned processes and written artifacts on the track", () => {
    render(<Timeline />);
    expect(screen.getAllByTestId("replay-marker")).toHaveLength(3);
  });

  it("names the run it is replaying", () => {
    render(<Timeline />);
    expect(screen.getByText("Vergleiche drei Ansätze")).toBeInTheDocument();
  });

  it("leaves replay through the button", async () => {
    render(<Timeline />);
    await userEvent.click(screen.getByRole("button", { name: /Beenden/ }));
    expect(replay().runId).toBeNull();
  });

  it("steps and exits by keyboard", async () => {
    render(<Timeline />);
    await userEvent.keyboard("{ArrowLeft}");
    expect(replay().cursorSeq).toBe(2);
    await userEvent.keyboard("{ArrowRight}");
    expect(replay().cursorSeq).toBe(3);
    await userEvent.keyboard("[Escape]");
    expect(replay().runId).toBeNull();
  });

  it("ignores shortcuts while something is being typed into", async () => {
    render(
      <>
        <input aria-label="Suche" />
        <Timeline />
      </>,
    );
    await userEvent.type(screen.getByLabelText("Suche"), " a");
    expect(replay().playing).toBe(false);
    expect(replay().runId).toBe("r1");
  });
});
