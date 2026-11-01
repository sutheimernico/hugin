import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiRecording } from "../../lib/api";
import { initialState } from "../../state/reducer";
import { IDLE_REPLAY, useHuginStore } from "../../state/store";
import type { HEvent } from "../../state/types";
import { EmptyStage } from "./EmptyStage";

const api = vi.hoisted(() => ({
  getRuns: vi.fn(),
  getRunEvents: vi.fn(),
  getRecordings: vi.fn(),
  getRecordingEvents: vi.fn(),
}));

vi.mock("../../lib/api", () => api);

const recording: ApiRecording = {
  slug: "claude-brief",
  run_id: "r0",
  goal: "Erstelle ein Briefing",
  driver: "claude",
  events: 848,
  duration_s: 231,
  exported_at: 1,
};

const events: HEvent[] = [
  { seq: 1, ts: 10, run_id: "r0", pid: null, kind: "run.created", data: { goal: "Erstelle ein Briefing" } },
  { seq: 2, ts: 12, run_id: "r0", pid: null, kind: "run.done", data: {} },
];

beforeEach(() => {
  api.getRecordings.mockResolvedValue([recording]);
  api.getRecordingEvents.mockResolvedValue(events);
  useHuginStore.setState({ state: initialState, replay: IDLE_REPLAY, view: "control" });
});

describe("EmptyStage", () => {
  it("says the track is free and offers to start a mission", () => {
    render(<EmptyStage onOpenPalette={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Gleis frei." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mission starten/ })).toBeInTheDocument();
  });

  it("opens the palette from the call to action", async () => {
    const onOpenPalette = vi.fn();
    render(<EmptyStage onOpenPalette={onOpenPalette} />);
    await userEvent.click(screen.getByRole("button", { name: /Mission starten/ }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("lists the recordings with driver and length", async () => {
    render(<EmptyStage onOpenPalette={vi.fn()} />);
    const row = await screen.findByTestId("recording-row");
    expect(row).toHaveTextContent("Erstelle ein Briefing");
    expect(row).toHaveTextContent("Claude (Abo)");
    expect(row).toHaveTextContent("848 Ereignisse");
    expect(row).toHaveTextContent("3:51");
  });

  it("starts the replay of the chosen recording", async () => {
    render(<EmptyStage onOpenPalette={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: /Replay/ }));
    await vi.waitFor(() => expect(useHuginStore.getState().replay.runId).toBe("claude-brief"));
    expect(api.getRecordingEvents).toHaveBeenCalledWith("claude-brief");
  });

  it("says the page is recorded and has no start button without a kernel", () => {
    render(<EmptyStage />);
    expect(screen.queryByRole("button", { name: /Mission starten/ })).not.toBeInTheDocument();
    expect(screen.getByText(/nichts davon läuft live/)).toBeInTheDocument();
  });

  it("shows why the list is empty", async () => {
    api.getRecordings.mockResolvedValue([]);
    render(<EmptyStage onOpenPalette={vi.fn()} />);
    expect(await screen.findByText(/Noch keine Aufzeichnungen/)).toBeInTheDocument();
  });

  it("shows a load failure instead of an empty list", async () => {
    api.getRecordings.mockRejectedValue(new Error("Der Kernel ist gerade nicht erreichbar."));
    render(<EmptyStage onOpenPalette={vi.fn()} />);
    expect(await screen.findByText("Der Kernel ist gerade nicht erreichbar.")).toBeInTheDocument();
  });
});
