import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiRecording } from "../../lib/api";
import { initialState } from "../../state/reducer";
import { IDLE_REPLAY, useHuginStore } from "../../state/store";
import type { HEvent, Run } from "../../state/types";
import { RunsView } from "./RunsView";

const api = vi.hoisted(() => ({
  getRuns: vi.fn(),
  getRunEvents: vi.fn(),
  getRecordings: vi.fn(),
  getRecordingEvents: vi.fn(),
}));

vi.mock("../../lib/api", () => api);

function run(over: Partial<Run> = {}): Run {
  return {
    id: "r1",
    goal: "Vergleiche drei Ansätze",
    driver: "scripted",
    state: "done",
    createdAt: 1_757_000_000,
    doneAt: 1_757_000_042,
    artifacts: ["plan.md"],
    usage: { turns: 6, input_tokens: 9_000, output_tokens: 2_400, cost_usd_equiv: null },
    ...over,
  };
}

function recording(over: Partial<ApiRecording> = {}): ApiRecording {
  return {
    slug: "bloom",
    run_id: "r0",
    goal: "Drei Wege zu einem Ziel",
    driver: "claude",
    events: 128,
    duration_s: 95,
    exported_at: 1_757_000_500,
    ...over,
  };
}

const EVENTS: HEvent[] = [
  { seq: 1, ts: 1_000, run_id: "r1", pid: null, kind: "run.created", data: { goal: "Ziel" } },
  { seq: 2, ts: 1_001, run_id: "r1", pid: null, kind: "run.done", data: {} },
];

beforeEach(() => {
  vi.clearAllMocks();
  useHuginStore.setState({
    state: initialState,
    replay: IDLE_REPLAY,
    pendingLive: [],
    view: "runs",
  });
  api.getRuns.mockResolvedValue([run()]);
  api.getRecordings.mockResolvedValue([recording()]);
  api.getRunEvents.mockResolvedValue(EVENTS);
  api.getRecordingEvents.mockResolvedValue(EVENTS);
});

describe("RunsView", () => {
  it("lists past runs with driver, state, date, tokens and artifacts", async () => {
    render(<RunsView />);

    const row = await screen.findByTestId("run-row");
    expect(row).toHaveTextContent("Vergleiche drei Ansätze");
    expect(row).toHaveTextContent("Simulation");
    expect(row).toHaveTextContent("Fertig");
    expect(row).toHaveTextContent("2,4k");
    expect(row).toHaveTextContent("1 Artefakt");
    expect(row).toHaveTextContent(/\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/);
  });

  it("shows the newest run first", async () => {
    api.getRuns.mockResolvedValue([
      run({ id: "alt", goal: "Älter", createdAt: 1_756_000_000 }),
      run({ id: "neu", goal: "Neuer", createdAt: 1_757_100_000 }),
    ]);
    render(<RunsView />);

    const rows = await screen.findAllByTestId("run-row");
    expect(rows[0]).toHaveTextContent("Neuer");
    expect(rows[1]).toHaveTextContent("Älter");
  });

  it("lists the demo recordings with their length", async () => {
    render(<RunsView />);

    const row = await screen.findByTestId("recording-row");
    expect(screen.getByText("Demo-Aufnahmen")).toBeInTheDocument();
    expect(row).toHaveTextContent("bloom");
    expect(row).toHaveTextContent("Drei Wege zu einem Ziel");
    expect(row).toHaveTextContent("Claude (Abo)");
    expect(row).toHaveTextContent("128 Ereignisse");
    expect(row).toHaveTextContent("1:35");
  });

  it("loads a run's events and enters replay in mission control", async () => {
    render(<RunsView />);
    const row = await screen.findByTestId("run-row");
    await userEvent.click(within(row).getByRole("button", { name: "Replay" }));

    expect(api.getRunEvents).toHaveBeenCalledWith("r1", 0);
    const store = useHuginStore.getState();
    expect(store.replay.runId).toBe("r1");
    expect(store.replay.events).toEqual(EVENTS);
    expect(store.view).toBe("control");
  });

  it("replays a recording by its slug", async () => {
    render(<RunsView />);
    const row = await screen.findByTestId("recording-row");
    await userEvent.click(within(row).getByRole("button", { name: "Replay" }));

    expect(api.getRecordingEvents).toHaveBeenCalledWith("bloom");
    expect(useHuginStore.getState().replay.runId).toBe("bloom");
  });

  it("says so when there is nothing to replay yet", async () => {
    api.getRuns.mockResolvedValue([]);
    api.getRecordings.mockResolvedValue([]);
    render(<RunsView />);

    expect(await screen.findByText("Noch keine Runs — starte eine Mission.")).toBeInTheDocument();
    expect(screen.getByText("Noch keine Aufnahmen exportiert.")).toBeInTheDocument();
  });

  it("names the trouble instead of showing an empty list", async () => {
    api.getRuns.mockRejectedValue(new Error("Der Kernel antwortet nicht."));
    render(<RunsView />);
    expect(await screen.findByText("Der Kernel antwortet nicht.")).toBeInTheDocument();
  });
});
