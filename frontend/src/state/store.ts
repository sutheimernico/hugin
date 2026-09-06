/**
 * The single store the shell reads from. It holds the projection (`state`), the replay slice
 * and the ambient bits that are not events (subsystem status, selection, current view).
 *
 * Plain functions, no immer: the reducer already returns fresh objects, and a second copy
 * layer would only hide that.
 *
 * Replay is client-side (plan Task 25): entering it loads a run's events once, and everything
 * afterwards is addressing — a cursor into that list. `selectVisibleState` is the one place
 * that decides which projection the views see, so live and replay never grow two code paths.
 */

import { create } from "zustand";
import { stateAt } from "../features/replay/replayMath";
import { applyEvents, initialState } from "./reducer";
import type { HEvent, State, SystemStatus } from "./types";

export type View = "control" | "munin" | "runs";

/** Task 25 adds the actions (enter/seek/play/step/exit); Task 13 only defines the shape. */
export interface ReplaySlice {
  /** The run id, or a recording's slug — whichever the shell is replaying. `null` while live. */
  runId: string | null;
  playing: boolean;
  speed: Speed;
  cursorSeq: number;
  events: HEvent[];
}

export type Speed = 1 | 2 | 4 | 8;
export const SPEEDS: Speed[] = [1, 2, 4, 8];

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
  /**
   * Live events that arrived while the shell was replaying. They are kept, not dropped: the
   * SSE stream has no second chance, and `exitReplay` owes the user the present it missed.
   */
  pendingLive: HEvent[];
  system: SystemStatus | null;
  selectedPid: number | null;
  view: View;
  /** Prefilled by the palette's "Munin durchsuchen…" command, read by the browser (Task 23). */
  muninQuery: string;
  /** Process table scope: the active run only (default), or every process the kernel knows. */
  allProcs: boolean;
  /** One call per animation frame (see `lib/sse.ts`), never one per event. */
  dispatch: (events: HEvent[]) => void;
  setSystem: (system: SystemStatus | null) => void;
  setSelectedPid: (pid: number | null) => void;
  setView: (view: View) => void;
  setMuninQuery: (query: string) => void;
  setAllProcs: (allProcs: boolean) => void;
  /**
   * Which run the shell follows. The reducer sets this when a run is created; the palette may
   * point it at an older run instead — that is a selection, like `selectedPid`, not a rewrite
   * of the projection.
   */
  setActiveRunId: (runId: string | null) => void;

  /** Load a finished run or a recording and show it from its first event on. */
  enterReplay: (source: { runId?: string; slug?: string }, events: HEvent[]) => void;
  seek: (seq: number) => void;
  play: () => void;
  pause: () => void;
  setSpeed: (speed: Speed) => void;
  step: (delta: 1 | -1) => void;
  exitReplay: () => void;
}

export const useHuginStore = create<HuginStore>()((set, get) => ({
  state: initialState,
  replay: IDLE_REPLAY,
  pendingLive: [],
  system: null,
  selectedPid: null,
  view: "control",
  muninQuery: "",
  allProcs: false,

  dispatch: (events) => {
    if (get().replay.runId !== null) {
      // Buffered, in arrival order. `applyEvent` is idempotent on a seq it has seen, so an
      // overlap with the backfill after a reconnect costs nothing here.
      set({ pendingLive: [...get().pendingLive, ...events] });
      return;
    }
    const current = get().state;
    const next = applyEvents(current, events);
    // A batch of nothing but already-seen seqs must not wake a single subscriber.
    if (next !== current) set({ state: next });
  },

  setSystem: (system) => set({ system }),
  setSelectedPid: (selectedPid) => set({ selectedPid }),
  setView: (view) => set({ view }),
  setMuninQuery: (muninQuery) => set({ muninQuery }),
  setAllProcs: (allProcs) => set({ allProcs }),
  setActiveRunId: (activeRunId) => set({ state: { ...get().state, activeRunId } }),

  enterReplay: (source, events) => {
    const runId = source.runId ?? source.slug ?? events[0]?.run_id ?? null;
    if (runId === null) return;
    set({
      replay: { runId, playing: false, speed: 1, cursorSeq: 0, events },
      // A pid selected in the live shell means nothing in another run's process table.
      selectedPid: null,
    });
  },

  seek: (seq) => {
    const { events } = get().replay;
    const last = lastSeq(events);
    set({ replay: { ...get().replay, cursorSeq: Math.min(last, Math.max(0, Math.round(seq))) } });
  },

  play: () => {
    const replay = get().replay;
    // Pressing ▶ on a finished run starts it over; a player that does nothing reads as broken.
    const atEnd = replay.cursorSeq >= lastSeq(replay.events);
    set({ replay: { ...replay, playing: true, cursorSeq: atEnd ? 0 : replay.cursorSeq } });
  },

  pause: () => set({ replay: { ...get().replay, playing: false } }),

  setSpeed: (speed) => set({ replay: { ...get().replay, speed } }),

  step: (delta) => {
    const { events, cursorSeq } = get().replay;
    const target =
      delta > 0
        ? (events.find((event) => event.seq > cursorSeq)?.seq ?? cursorSeq)
        : (events.findLast((event) => event.seq < cursorSeq)?.seq ?? 0);
    // Stepping is a manual move, so it takes over from the player rather than fighting it.
    set({ replay: { ...get().replay, playing: false, cursorSeq: target } });
  },

  exitReplay: () => {
    const pending = get().pendingLive;
    set({
      replay: IDLE_REPLAY,
      pendingLive: [],
      state: pending.length === 0 ? get().state : applyEvents(get().state, pending),
      selectedPid: null,
    });
  },
}));

/**
 * What every view renders: the live projection, or the replayed run as it stood at the cursor.
 * Components read this and never `state` directly — that is what keeps replay a projection
 * instead of a second rendering path (spec §1.3).
 */
export function selectVisibleState(store: Pick<HuginStore, "state" | "replay">): State {
  if (store.replay.runId === null) return store.state;
  return stateAt(store.replay.events, store.replay.cursorSeq);
}

function lastSeq(events: HEvent[]): number {
  return events[events.length - 1]?.seq ?? 0;
}
