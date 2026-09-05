/**
 * The single store the shell reads from. It holds the projection (`state`), the replay slice
 * and the ambient bits that are not events (subsystem status, selection, current view).
 *
 * Plain functions, no immer: the reducer already returns fresh objects, and a second copy
 * layer would only hide that.
 */

import { create } from "zustand";
import { applyEvents, initialState } from "./reducer";
import type { HEvent, State, SystemStatus } from "./types";

export type View = "control" | "munin" | "runs";

/** Task 25 adds the actions (enter/seek/play/step/exit); Task 13 only defines the shape. */
export interface ReplaySlice {
  runId: string | null;
  playing: boolean;
  speed: 1 | 2 | 4 | 8;
  cursorSeq: number;
  events: HEvent[];
}

export const IDLE_REPLAY: ReplaySlice = {
  runId: null,
  playing: false,
  speed: 1,
  cursorSeq: 0,
  events: [],
};

export interface HuginStore {
  state: State;
  replay: ReplaySlice;
  system: SystemStatus | null;
  selectedPid: number | null;
  view: View;
  /** One call per animation frame (see `lib/sse.ts`), never one per event. */
  dispatch: (events: HEvent[]) => void;
  setSystem: (system: SystemStatus | null) => void;
  setSelectedPid: (pid: number | null) => void;
  setView: (view: View) => void;
}

export const useHuginStore = create<HuginStore>()((set, get) => ({
  state: initialState,
  replay: IDLE_REPLAY,
  system: null,
  selectedPid: null,
  view: "control",

  dispatch: (events) => {
    const current = get().state;
    const next = applyEvents(current, events);
    // A batch of nothing but already-seen seqs must not wake a single subscriber.
    if (next !== current) set({ state: next });
  },

  setSystem: (system) => set({ system }),
  setSelectedPid: (selectedPid) => set({ selectedPid }),
  setView: (view) => set({ view }),
}));
