import { AnimatePresence, MotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "./components/Panel";
import { Toast, type ToastMessage, type ToastTone } from "./components/Toast";
import { AgentWindow } from "./features/agent/AgentWindow";
import { BootScreen } from "./features/boot/BootScreen";
import { hasBooted, markBooted } from "./features/boot/sequence";
import { AgentGraph } from "./features/graph/AgentGraph";
import { KernelLog } from "./features/log/KernelLog";
import { MuninBrowser } from "./features/munin/MuninBrowser";
import { CommandPalette } from "./features/palette/CommandPalette";
import { ProcessTable } from "./features/procs/ProcessTable";
import { tsAtSeq } from "./features/replay/replayMath";
import { RunsView } from "./features/replay/RunsView";
import { Timeline } from "./features/replay/Timeline";
import { Layout } from "./features/shell/Layout";
import { MissionBar } from "./features/shell/MissionBar";
import { TopBar } from "./features/shell/TopBar";
import { getSystem, killAll, killProc } from "./lib/api";
import { connectEvents } from "./lib/sse";
import { selectMode, selectProcs } from "./state/selectors";
import type { HEvent, SystemStatus } from "./state/types";
import { selectVisibleState, useHuginStore } from "./state/store";

/** How often the shell re-asks `/api/system` while the tab is visible. */
const SYSTEM_POLL_MS = 30_000;

/** Mission Control (spec §2.9, view 2): the shell is a pure projection of the event stream. */
export default function App() {
  const state = useHuginStore((store) => store.state);
  const replay = useHuginStore((store) => store.replay);
  const selectedPid = useHuginStore((store) => store.selectedPid);
  const setSelectedPid = useHuginStore((store) => store.setSelectedPid);
  const view = useHuginStore((store) => store.view);
  const setView = useHuginStore((store) => store.setView);
  const dispatch = useHuginStore((store) => store.dispatch);

  const setSystem = useHuginStore((store) => store.setSystem);

  useEventStream(dispatch);
  useSystemStatus(setSystem);

  // Once per browser session, and never in the way: the stream above is already connected
  // while the overlay is still counting subsystems.
  const [booted, setBooted] = useState(hasBooted);
  const finishBoot = useCallback(() => {
    markBooted();
    setBooted(true);
  }, []);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
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

  const onKillAll = useCallback(() => {
    void killAll().catch(report);
  }, []);
  const onKill = useCallback((pid: number) => {
    void killProc(pid).catch(report);
  }, []);
  const closeAgent = useCallback(() => setSelectedPid(null), [setSelectedPid]);

  // A selection survives its process, but not a reload of the run: an unknown pid selects nothing.
  const selected = selectedPid === null ? undefined : visible.procs[selectedPid];
  // Mission control is the only view built from columns; the others take the whole middle row.
  const control = view === "control";

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
            onViewChange={setView}
            onKillAll={onKillAll}
            onOpenPalette={openPalette}
          />
        }
        main={control ? undefined : view === "munin" ? <MuninBrowser /> : <RunsView />}
        left={
          control ? (
            <ProcessTable
              procs={selectProcs(visible)}
              now={now}
              selectedPid={selectedPid}
              onSelect={setSelectedPid}
              onKill={onKill}
            />
          ) : undefined
        }
        center={
          control ? (
            <Panel title="Graph" className="h-full" bodyClassName="min-h-0 p-0">
              <AgentGraph
                state={visible}
                runId={visible.activeRunId}
                selectedPid={selectedPid}
                onSelect={setSelectedPid}
              />
            </Panel>
          ) : undefined
        }
        right={
          // The sheet overlays the log rather than unmounting it, so the ticker keeps its scroll
          // position — and its exit animation has something to slide away from.
          control ? (
            <div className="relative h-full">
              <KernelLog lines={visible.log} />
              <AnimatePresence>
                {selected !== undefined && (
                  <AgentWindow
                    key={selected.pid}
                    proc={selected}
                    now={now}
                    onClose={closeAgent}
                    onKill={onKill}
                  />
                )}
              </AnimatePresence>
            </div>
          ) : undefined
        }
        bottom={mode === "replay" ? <Timeline /> : <MissionBar run={run} now={now} />}
      />
      <CommandPalette
        open={paletteOpen}
        onOpen={openPalette}
        onClose={closePalette}
        onToast={showToast}
      />
      <Toast toast={toast} onDone={clearToast} />
      {!booted && <BootScreen onDone={finishBoot} />}
    </MotionConfig>
  );
}

/** One stream for the whole shell, opened once and closed on unmount. */
function useEventStream(dispatch: (events: HEvent[]) => void): void {
  const connected = useRef(false);

  useEffect(() => {
    // StrictMode mounts every effect twice in development. Without this guard the second mount
    // would open a second EventSource and every event would arrive — and animate — twice.
    if (connected.current) return;
    connected.current = true;
    const disconnect = connectEvents({
      // A fresh shell wants this kernel's life, not every run the database ever stored.
      since: "boot",
      onBatch: dispatch,
      // Task 21 gives the shell a visible place for subsystem trouble; until then the kernel
      // log is the evidence of what arrived and what did not.
      onStatus: () => {},
    });
    return () => {
      connected.current = false;
      disconnect();
    };
  }, [dispatch]);
}

/**
 * What this machine can run right now. The palette gates its drivers on this, so it is loaded
 * on every start — the boot screen may be skipped, the gate may not be. A failed refresh keeps
 * the previous answer: not reaching the kernel is not the same as learning that a driver died.
 */
function useSystemStatus(setSystem: (system: SystemStatus) => void): void {
  useEffect(() => {
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
  }, [setSystem]);
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
