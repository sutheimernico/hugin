import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiRecording } from "../../lib/api";
import { initialState } from "../../state/reducer";
import { IDLE_REPLAY, useHuginStore } from "../../state/store";
import type { HEvent } from "../../state/types";
import { useShowcaseReplay } from "./useShowcaseReplay";

const api = vi.hoisted(() => ({
  getRuns: vi.fn(),
  getRunEvents: vi.fn(),
  getRecordings: vi.fn(),
  getRecordingEvents: vi.fn(),
}));

vi.mock("../../lib/api", () => api);

const rec = (slug: string, driver: string) => ({ slug, driver }) as ApiRecording;
const events: HEvent[] = [
  { seq: 1, ts: 1, run_id: "r", pid: null, kind: "run.created", data: {} },
  { seq: 2, ts: 5, run_id: "r", pid: null, kind: "run.done", data: {} },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getRecordingEvents.mockResolvedValue(events);
  useHuginStore.setState({ state: initialState, replay: IDLE_REPLAY, view: "control" });
});

describe("useShowcaseReplay", () => {
  it("starts the real Claude recording at 4x", async () => {
    api.getRecordings.mockResolvedValue([rec("sim", "scripted"), rec("real", "claude")]);
    renderHook(() => useShowcaseReplay(true));
    await waitFor(() => expect(useHuginStore.getState().replay.runId).toBe("real"));
    expect(useHuginStore.getState().replay).toMatchObject({ playing: true, speed: 4 });
  });

  it("does nothing when it is not the replay-only build", () => {
    renderHook(() => useShowcaseReplay(false));
    expect(api.getRecordings).not.toHaveBeenCalled();
  });

  it("stays on the idle stage when the recordings cannot be loaded", async () => {
    api.getRecordings.mockRejectedValue(new Error("offline"));
    renderHook(() => useShowcaseReplay(true));
    await waitFor(() => expect(api.getRecordings).toHaveBeenCalled());
    expect(useHuginStore.getState().replay.runId).toBeNull();
  });
});
