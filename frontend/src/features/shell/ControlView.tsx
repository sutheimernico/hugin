import { AnimatePresence } from "motion/react";
import { lazy, Suspense, type ReactNode } from "react";
import type { Breakpoint } from "../../lib/breakpoint";
import { isActive, selectProcs } from "../../state/selectors";
import type { Pane } from "../../state/store";
import type { Proc, Run, State } from "../../state/types";
import { AgentWindow } from "../agent/AgentWindow";
import { OccupancyChart } from "../graph/OccupancyChart";
import { Timetable } from "../log/Timetable";
import { ProcessTable } from "../procs/ProcessTable";
import { ProcessTree } from "../procs/ProcessTree";
import { EmptyStage } from "./EmptyStage";
import { MissionLedger } from "./MissionLedger";

// The diagram pulls in xyflow, the heaviest part of the bundle: it loads with the
// first mission, not with the shell.
const AgentGraph = lazy(() =>
  import("../graph/AgentGraph").then((module) => ({ default: module.AgentGraph })),
);

type ControlViewProps = {
  layout: Breakpoint;
  pane: Pane;
  visible: State;
  run: Run | undefined;
  now: number;
  replaying: boolean;
  selectedPid: number | null;
  onSelect: (pid: number) => void;
  onKill: (pid: number) => void;
  onCloseAgent: () => void;
  allProcs: boolean;
  onShowAllChange: (showAll: boolean) => void;
  panicking: boolean;
  /** Absent in the replay-only build. */
  onOpenPalette?: () => void;
};

/**
 * Mission Control in its three layouts. The pieces are the same everywhere; only their
 * arrangement changes: three columns with the diagram in the middle, the diagram on top of two
 * columns, or one pane at a time with the diagram redrawn as a tree.
 */
export function ControlView(props: ControlViewProps) {
  const { layout, pane, visible, run, now, replaying, selectedPid, allProcs } = props;

  if (run === undefined) {
    return <EmptyStage onOpenPalette={props.onOpenPalette} />;
  }

  const runProcs = selectProcs(visible, run.id);
  const tableProcs = selectProcs(visible, allProcs ? null : visible.activeRunId);
  const selected = selectedPid === null ? undefined : visible.procs[selectedPid];

  const ledger = <MissionLedger run={run} procs={runProcs} now={now} replaying={replaying} />;
  const table = (
    <ProcessTable
      procs={tableProcs}
      now={now}
      selectedPid={selectedPid}
      onSelect={props.onSelect}
      onKill={props.onKill}
      showAll={allProcs}
      onShowAllChange={props.onShowAllChange}
    />
  );
  const timetable = <Timetable lines={visible.log} origin={run.createdAt} />;
  const agent = (
    <AnimatePresence>
      {selected !== undefined && (
        <AgentWindow
          key={selected.pid}
          proc={selected}
          now={now}
          onClose={props.onCloseAgent}
          onKill={props.onKill}
        />
      )}
    </AnimatePresence>
  );
  const occupancy = <OccupancyChart run={run} procs={runProcs} now={now} />;
  const diagram = (
    <Suspense fallback={<DiagramFallback />}>
      <AgentGraph
        state={visible}
        runId={visible.activeRunId}
        selectedPid={selectedPid}
        onSelect={props.onSelect}
        panicking={props.panicking}
      />
    </Suspense>
  );

  if (layout === "mobile") {
    return (
      <div className="h-full overflow-y-auto bg-surface">
        {pane === "mission" && (
          <>
            {ledger}
            <MobileTree procs={runProcs} selectedPid={selectedPid} onSelect={props.onSelect} />
          </>
        )}
        {pane === "log" && <div className="h-full">{timetable}</div>}
        {pane === "procs" && (
          <>
            <div className="h-[min(60%,420px)] min-h-[260px]">{table}</div>
            {occupancy}
          </>
        )}
        {agent}
      </div>
    );
  }

  if (layout === "tablet") {
    return (
      <div className="h-full overflow-y-auto">
        <section
          aria-label="Gleisbild"
          className="h-[min(56vh,560px)] min-h-[340px] bg-surface-2"
        >
          {diagram}
        </section>
        {occupancy}
        <div className="border-b border-text/20" />
        <div className="grid grid-cols-2">
          <div className="min-w-0 border-r border-text/20 bg-surface">
            {ledger}
            <div className="h-[420px]">{table}</div>
          </div>
          <div className="h-[560px] min-w-0 bg-surface">{timetable}</div>
        </div>
        {agent}
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)_256px] min-[1100px]:grid-cols-[minmax(290px,320px)_minmax(0,1fr)_minmax(300px,360px)] min-[1440px]:grid-cols-[330px_minmax(0,1fr)_380px]">
      <div className="flex min-h-0 flex-col border-r border-text/20 bg-surface">
        {ledger}
        <div className="min-h-0 flex-1">{table}</div>
      </div>
      <div className="flex min-h-0 flex-col bg-surface-2">
        <section aria-label="Gleisbild" className="min-h-0 flex-1">
          {diagram}
        </section>
        {occupancy}
      </div>
      <div className="relative min-h-0 border-l border-text/20 bg-surface">
        {timetable}
        {agent}
      </div>
    </div>
  );
}

function MobileTree(props: { procs: Proc[]; selectedPid: number | null; onSelect: (pid: number) => void }) {
  const alive = props.procs.filter(isActive).length;
  return (
    <section aria-label="Gleisbild" className="bg-surface-2 pb-4">
      <h2 className="font-display flex items-baseline justify-between border-b border-text/15 px-4 py-2.5 text-[19px] font-semibold text-text">
        Agenten
        <span className="text-[15px] text-muted tabular-nums">
          {alive} von {props.procs.length} aktiv
        </span>
      </h2>
      <ProcessTree {...props} />
    </section>
  );
}

function DiagramFallback(): ReactNode {
  return <div className="h-full bg-surface-2" />;
}
