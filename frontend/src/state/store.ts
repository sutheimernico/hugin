/**
 * The single store the shell reads from. It holds the projection (`state`), the replay slice
 * and the ambient bits that are not events (subsystem status, selection, current view).
 *
 * Plain functions, no immer: the reducer already returns fresh objects, and a second copy
 * layer would only hide that.
 *
 * Replay is client-side: entering it loads a run's events once, and everything
 * afterwards is addressing — a cursor into that list. `selectVisibleState` is the one place
 * that decides which projection the views see, so live and replay never grow two code paths.
 */

import { create } from "zustand";
import { stateAt } from "../features/replay/replayMath";
import { applyEvents, initialState } from "./reducer";
import type { HEvent, State, SystemStatus } from "./types";

export type View = "control" | "munin" | "runs";
/** The three panes of the narrow layout (Mission, Verlauf, Prozesse); wide layouts show all. */
export type Pane = "mission" | "log" | "procs";

/** Replay cursor: the actions are enter/seek/play/step/exit. */
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
  pane: Pane;
  /** Prefilled by the palette's "Munin durchsuchen…" command, read by the browser. */
  muninQuery: string;
  /** Process table scope: the active run only (default), or every process the kernel knows. */
  allProcs: boolean;
  /** One call per animation frame (see `lib/sse.ts`), never one per event. */
  dispatch: (events: HEvent[]) => void;
  setSystem: (system: SystemStatus | null) => void;
  setSelectedPid: (pid: number | null) => void;
  setView: (view: View) => void;
  setPane: (pane: Pane) => void;
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
  pane: "mission",
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
  setPane: (pane) => set({ pane, view: "control" }),
  setMuninQuery: (muninQuery) => set({ muninQuery }),
  setAllProcs: (allProcs) => set({ allProcs }),
  setActiveRunId: (activeRunId) => set({ state: { ...get().state, activeRunId } }),

  enterReplay: (source, events) => {
    const runId = source.runId ?? source.slug ?? events[0]?.run_id ?? null;
    if (runId === null) return;
    set({
      // Parked on the first event, not before it: seq 0 is the empty kernel, and a recording
      // that opens on "Gleis frei" reads as broken.
      replay: { runId, playing: false, speed: 1, cursorSeq: firstSeq(events), events },
      // A pid selected in the live shell means nothing in another run's process table.
      selectedPid: null,
    });
  },

  seek: (seq) => {
    const { events } = get().replay;
    const last = lastSeq(events);
    set({ replay: { ...get().replay, cursorSeq: Math.min(last, Math.max(firstSeq(events), Math.round(seq))) } });
  },

  play: () => {
    const replay = get().replay;
    // Pressing ▶ on a finished run starts it over; a player that does nothing reads as broken.
    const atEnd = replay.cursorSeq >= lastSeq(replay.events);
    set({ replay: { ...replay, playing: true, cursorSeq: atEnd ? firstSeq(replay.events) : replay.cursorSeq } });
  },

  pause: () => set({ replay: { ...get().replay, playing: false } }),

  setSpeed: (speed) => set({ replay: { ...get().replay, speed } }),

  step: (delta) => {
    const { events, cursorSeq } = get().replay;
    const target =
      delta > 0
        ? (events.find((event) => event.seq > cursorSeq)?.seq ?? cursorSeq)
        : Math.max(firstSeq(events), events.findLast((event) => event.seq < cursorSeq)?.seq ?? 0);
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
 * instead of a second rendering path.
 */
export function selectVisibleState(store: Pick<HuginStore, "state" | "replay">): State {
  if (store.replay.runId === null) return store.state;
  return stateAt(store.replay.events, store.replay.cursorSeq);
}

/**
 * Where a replay rests at its start: the first event after which a process is on the stage.
 * The events before it (the mission being created) draw an empty kernel, which reads as broken.
 */
function firstSeq(events: HEvent[]): number {
  return (events.find((event) => event.kind === "proc.spawned") ?? events[0])?.seq ?? 0;
}

function lastSeq(events: HEvent[]): number {
  return events[events.length - 1]?.seq ?? 0;
}
