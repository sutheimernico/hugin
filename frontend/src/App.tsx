import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "./components/Panel";
import { AgentGraph } from "./features/graph/AgentGraph";
import { KernelLog } from "./features/log/KernelLog";
import { ProcessTable } from "./features/procs/ProcessTable";
import { Layout } from "./features/shell/Layout";
import { MissionBar } from "./features/shell/MissionBar";
import { TopBar } from "./features/shell/TopBar";
import { killAll, killProc } from "./lib/api";
import { connectEvents } from "./lib/sse";
import { selectMode, selectProcs } from "./state/selectors";
import type { HEvent } from "./state/types";
import { useHuginStore } from "./state/store";

/** Mission Control (spec §2.9, view 2): the shell is a pure projection of the event stream. */
export default function App() {
  const state = useHuginStore((store) => store.state);
  const replay = useHuginStore((store) => store.replay);
  const selectedPid = useHuginStore((store) => store.selectedPid);
  const setSelectedPid = useHuginStore((store) => store.setSelectedPid);
  const dispatch = useHuginStore((store) => store.dispatch);

  useEventStream(dispatch);

  const mode = selectMode({ state, replay });
  // Live runs follow the wall clock; a replay follows the events it is replaying.
  const now = useNow(mode !== "replay", state.log.at(-1)?.ts ?? 0);
  const run = state.activeRunId === null ? undefined : state.runs[state.activeRunId];

  const onKillAll = useCallback(() => {
    void killAll().catch(report);
  }, []);
  const onKill = useCallback((pid: number) => {
    void killProc(pid).catch(report);
  }, []);

  return (
    // `motion` animates through the Web Animations API, which the global CSS override in
    // globals.css cannot reach — this is what makes JS motion obey the same system setting.
    <MotionConfig reducedMotion="user">
      <Layout
        topBar={<TopBar mode={mode} meters={state.meters} onKillAll={onKillAll} />}
        left={
          <ProcessTable
            procs={selectProcs(state)}
            now={now}
            selectedPid={selectedPid}
            onSelect={setSelectedPid}
            onKill={onKill}
          />
        }
        center={
          <Panel title="Graph" className="h-full" bodyClassName="min-h-0 p-0">
            <AgentGraph
              state={state}
              runId={state.activeRunId}
              selectedPid={selectedPid}
              onSelect={setSelectedPid}
            />
          </Panel>
        }
        right={<KernelLog lines={state.log} />}
        bottom={<MissionBar run={run} now={now} />}
      />
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
      since: 0,
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
