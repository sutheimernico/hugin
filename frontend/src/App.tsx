import { MotionConfig } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BottomNav } from "./components/BottomNav";
import { Toast, type ToastMessage, type ToastTone } from "./components/Toast";
import { hasBooted, markBooted } from "./features/boot/sequence";
import { tsAtSeq } from "./features/replay/replayMath";
import { Timeline } from "./features/replay/Timeline";
import { useShowcaseReplay } from "./features/replay/useShowcaseReplay";
import { ControlView } from "./features/shell/ControlView";
import { Layout } from "./features/shell/Layout";
import { MoreSheet } from "./features/shell/MoreSheet";
import { TopBar } from "./features/shell/TopBar";
import { useBreakpoint } from "./hooks/useBreakpoint";
import { getSystem, killAll, killProc } from "./lib/api";
import { connectEvents } from "./lib/sse";
import { selectMode } from "./state/selectors";
import type { HEvent, SystemStatus } from "./state/types";
import { selectVisibleState, useHuginStore } from "./state/store";

// Everything below the first screen is its own chunk: the other two views, the command palette
// and the boot overlay load when they are first needed (the palette right after first paint).
const MuninBrowser = lazy(() =>
  import("./features/munin/MuninBrowser").then((module) => ({ default: module.MuninBrowser })),
);
const RunsView = lazy(() =>
  import("./features/replay/RunsView").then((module) => ({ default: module.RunsView })),
);
const CommandPalette = lazy(() =>
  import("./features/palette/CommandPalette").then((module) => ({
    default: module.CommandPalette,
  })),
);
const BootScreen = lazy(() =>
  import("./features/boot/BootScreen").then((module) => ({ default: module.BootScreen })),
);

/** The Pages build replays recordings: no kernel, no stream, no boot sequence. */
const REPLAY_ONLY = __REPLAY_ONLY__;

/** How often the shell re-asks `/api/system` while the tab is visible. */
const SYSTEM_POLL_MS = 30_000;
/** How long the graph stays desaturated after "Panik". */
const PANIC_FLASH_MS = 300;

/** Mission Control: the shell is a pure projection of the event stream. */
export default function App() {
  const state = useHuginStore((store) => store.state);
  const replay = useHuginStore((store) => store.replay);
  const selectedPid = useHuginStore((store) => store.selectedPid);
  const setSelectedPid = useHuginStore((store) => store.setSelectedPid);
  const view = useHuginStore((store) => store.view);
  const setView = useHuginStore((store) => store.setView);
  const dispatch = useHuginStore((store) => store.dispatch);

  const pane = useHuginStore((store) => store.pane);
  const setPane = useHuginStore((store) => store.setPane);
  const layout = useBreakpoint();
  const [moreOpen, setMoreOpen] = useState(false);

  const setSystem = useHuginStore((store) => store.setSystem);
  const allProcs = useHuginStore((store) => store.allProcs);
  const setAllProcs = useHuginStore((store) => store.setAllProcs);

  useEventStream(dispatch, !REPLAY_ONLY);
  useSystemStatus(setSystem, !REPLAY_ONLY);
  useShowcaseReplay(REPLAY_ONLY);

  // Once per browser session, and never in the way: the stream above is already connected
  // while the overlay is still counting subsystems.
  const [booted, setBooted] = useState(() => REPLAY_ONLY || hasBooted());
  const finishBoot = useCallback(() => {
    markBooted();
    setBooted(true);
  }, []);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // The palette borrows the keyboard, it does not keep it. Captured here, in the open handler
  // both the ⌘K hotkey and the top bar's button run through — an effect inside the palette
  // would already see cmdk's own auto-focused input as "the element that had focus".
  const focusBeforePalette = useRef<HTMLElement | null>(null);
  const openPalette = useCallback(() => {
    const active = document.activeElement;
    focusBeforePalette.current = active instanceof HTMLElement ? active : null;
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    focusBeforePalette.current?.focus();
    focusBeforePalette.current = null;
  }, []);
  // A fresh id per message, so two identical texts still read as two events.
  const showToast = useCallback((text: string, tone: ToastTone) => {
    setToast({ id: Date.now(), text, tone });
  }, []);
  const clearToast = useCallback(() => setToast(null), []);

  const mode = selectMode({ state, replay });
  // The one place that decides which projection is on screen: the live one, or the replayed
  // run as it stood at the cursor. Every view below reads this and never `state` directly.
  const visible = selectVisibleState({ state, replay });
  // Live runs follow the wall clock; a replay follows the events it is replaying.
  const now = useNow(mode !== "replay", tsAtSeq(replay.events, replay.cursorSeq));
  const run = visible.activeRunId === null ? undefined : visible.runs[visible.activeRunId];

  const [panicking, setPanicking] = useState(false);
  const panicTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(panicTimer.current), []);

  const onKillAll = useCallback(() => {
    // The flash is the button's own feedback: the kills take a moment to reach the drivers,
    // and a control that looks inert until they do reads as broken.
    setPanicking(true);
    window.clearTimeout(panicTimer.current);
    panicTimer.current = window.setTimeout(() => setPanicking(false), PANIC_FLASH_MS);
    void killAll().catch(report);
  }, []);
  const onKill = useCallback((pid: number) => {
    void killProc(pid).catch(report);
  }, []);
  const closeAgent = useCallback(() => setSelectedPid(null), [setSelectedPid]);

  const control = view === "control";
  const openMore = useCallback(() => setMoreOpen(true), []);
  const closeMore = useCallback(() => setMoreOpen(false), []);

  return (
    // `motion` animates through the Web Animations API, which the global CSS override in
    // globals.css cannot reach — this is what makes JS motion obey the same system setting.
    <MotionConfig reducedMotion="user">
      <Layout
        topBar={
          <TopBar
            mode={mode}
            meters={visible.meters}
            view={view}
            layout={layout}
            replayOnly={REPLAY_ONLY}
            onViewChange={setView}
            onKillAll={onKillAll}
            onOpenPalette={openPalette}
          />
        }
        bottom={mode === "replay" ? <Timeline /> : undefined}
        nav={
          layout === "mobile" ? (
            <BottomNav
              active={control ? pane : "more"}
              onPane={setPane}
              onMore={openMore}
            />
          ) : undefined
        }
      >
        <Suspense fallback={null}>
          {control ? (
            <ControlView
              layout={layout}
              pane={pane}
              visible={visible}
              run={run}
              now={now}
              replaying={mode === "replay"}
              selectedPid={selectedPid}
              onSelect={setSelectedPid}
              onKill={onKill}
              onCloseAgent={closeAgent}
              allProcs={allProcs}
              onShowAllChange={setAllProcs}
              panicking={panicking}
              onOpenPalette={REPLAY_ONLY ? undefined : openPalette}
            />
          ) : view === "munin" ? (
            <MuninBrowser />
          ) : (
            <RunsView />
          )}
        </Suspense>
      </Layout>
      {layout === "mobile" && (
        <MoreSheet
          open={moreOpen}
          replayOnly={REPLAY_ONLY}
          onClose={closeMore}
          onView={setView}
          onOpenPalette={openPalette}
          onKillAll={onKillAll}
        />
      )}
      <Suspense fallback={null}>
        {!REPLAY_ONLY && (
          <CommandPalette
            open={paletteOpen}
            onOpen={openPalette}
            onClose={closePalette}
            onToast={showToast}
          />
        )}
        {!booted && <BootScreen onDone={finishBoot} />}
      </Suspense>
      <Toast toast={toast} onDone={clearToast} />
    </MotionConfig>
  );
}

/** One stream for the whole shell, opened once and closed on unmount. */
function useEventStream(dispatch: (events: HEvent[]) => void, enabled: boolean): void {
  const connected = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    // StrictMode mounts every effect twice in development. Without this guard the second mount
    // would open a second EventSource and every event would arrive — and animate — twice.
    if (connected.current) return;
    connected.current = true;
    const disconnect = connectEvents({
      // A fresh shell wants this kernel's life, not every run the database ever stored.
      since: "boot",
      onBatch: dispatch,
      // The shell has no dedicated place for subsystem trouble yet; the kernel
      // log is the evidence of what arrived and what did not.
      onStatus: () => {},
    });
    return () => {
      connected.current = false;
      disconnect();
    };
  }, [dispatch, enabled]);
}

/**
 * What this machine can run right now. The palette gates its drivers on this, so it is loaded
 * on every start — the boot screen may be skipped, the gate may not be. A failed refresh keeps
 * the previous answer: not reaching the kernel is not the same as learning that a driver died.
 */
function useSystemStatus(setSystem: (system: SystemStatus) => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => {
      void getSystem()
        .then((system) => {
          if (live) setSystem(system);
        })
        .catch(report);
    };
    load();
    // A hidden tab has nobody to inform; the next visible tick brings it up to date.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, SYSTEM_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [setSystem, enabled]);
}

/** Seconds since the epoch, ticking once a second — but only while something can move. */
function useNow(live: boolean, frozen: number): number {
  const [wall, setWall] = useState(() => Date.now() / 1_000);

  useEffect(() => {
    if (!live) return;
    // No eager set: the first tick is at most a second away, and a cascading render is not
    // worth a second of precision on a clock that is only read for elapsed times.
    const timer = window.setInterval(() => setWall(Date.now() / 1_000), 1_000);
    return () => window.clearInterval(timer);
  }, [live]);

  return live ? wall : frozen;
}

function report(error: unknown): void {
  console.error("[hugin] Anfrage fehlgeschlagen:", error);
}
