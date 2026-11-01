/**
 * The live agent graph: the process tree of the running mission, drawn as it grows.
 *
 * Everything here is derived — from the projection, never from its own state. A node exists
 * because a `proc.spawned` event created it, an edge brightens because one of its ends is
 * alive, a particle travels because a pulse is in flight. That is why the same component
 * renders a replay without knowing it is one.
 */

import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { isAlive } from "../../state/selectors";
import type { Pulse, State } from "../../state/types";
import { AgentNode, type AgentNodeType } from "./AgentNode";
import {
  buildGraph,
  HANDLE_IN,
  HANDLE_MEM,
  HANDLE_OUT,
  MUNIN_ID,
  pidOfNode,
  structureKey,
  treeEdgeId,
  muninEdgeId,
  type GEdge,
  type GNode,
} from "./layout";
import { MuninNode, type MuninNodeType } from "./MuninNode";
import { PulseEdge, type EdgePulse, type PulseEdgeType } from "./PulseEdge";

// Defined once, outside the component: a fresh object on every render makes xyflow rebuild its
// whole node cache and log a warning.
const NODE_TYPES: NodeTypes = { proc: AgentNode, munin: MuninNode };
const EDGE_TYPES: EdgeTypes = { pulse: PulseEdge };

/**
 * The one fit the graph ever performs — on a new node, and on a resized panel. The diagram is a
 * fixed sheet: it always shows the whole network, so there is no pan or zoom to get lost in
 * (and a page that scrolls past it on a tablet is never held hostage by it).
 */
const FIT = { padding: 0.08, maxZoom: 1.15, minZoom: 0.15, duration: 400 };

type GraphNode = AgentNodeType | MuninNodeType;

type AgentGraphProps = {
  state: State;
  runId: string | null;
  selectedPid: number | null;
  onSelect: (pid: number) => void;
  /** True for 300 ms after "Panik": the graph loses its colour while the kills propagate. */
  panicking: boolean;
};

export function AgentGraph(props: AgentGraphProps) {
  // The provider owns the viewport store, which `fitView` below reaches through.
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}

function Graph({ state, runId, selectedPid, onSelect, panicking }: AgentGraphProps) {
  const structure = structureKey(state, runId);
  const graph = useMemo(
    () => buildGraph(state, runId),
    // Deliberately keyed on the *shape* of the run, not on the state object: a state whose
    // structure key is unchanged always lays out identically, and re-running dagre on every
    // streamed token would relayout — and visibly re-fit — a graph that never moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structure],
  );
  const nodes = useMemo(() => toNodes(graph.nodes, state, selectedPid), [graph, state, selectedPid]);
  const edges = useMemo(() => toEdges(graph.edges, state), [graph, state]);

  const { fitView } = useReactFlow();
  const count = graph.nodes.length;
  const container = useRef<HTMLDivElement>(null);
  const measured = useMeasuredNodes();

  useEffect(() => {
    if (count === 0) return;
    void fitView(FIT);
  }, [measured, count, fitView]);

  useEffect(() => {
    const element = container.current;
    // The agent sheet takes the column's width away from the graph, and the window itself can
    // be resized — both change what "fits" means without changing a single event.
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => void fitView(FIT));
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitView]);

  const handleClick = useCallback(
    (_event: MouseEvent, node: { id: string }) => {
      const pid = pidOfNode(node.id);
      if (pid !== null) onSelect(pid);
    },
    [onSelect],
  );

  // Keyboard parity with the click: xyflow focuses its node wrappers, so the key press bubbles
  // up here carrying the node's `data-id` — the same id `onNodeClick` would have handed over.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const wrapper = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node");
      const pid = wrapper?.dataset.id === undefined ? null : pidOfNode(wrapper.dataset.id);
      if (pid === null) return;
      event.preventDefault();
      onSelect(pid);
    },
    [onSelect],
  );

  return (
    <div
      ref={container}
      data-testid="graph-surface"
      className={`relative h-full w-full ${panicking ? "hugin-panic" : ""}`}
      onKeyDown={handleKeyDown}
    >
      {count === 0 ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-muted">
          Noch keine Agenten — der Graph wächst mit der Mission.
        </div>
      ) : (
        <ReactFlow<GraphNode, PulseEdgeType>
          className="hugin-graph"
          colorMode="light"
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodeClick={handleClick}
          fitView
          fitViewOptions={FIT}
          minZoom={FIT.minZoom}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
        />
      )}
      {count > 0 && <LampLegend />}
    </div>
  );
}

/** What the lamps mean, in the diagram's own corner — the one piece of explanation it needs. */
function LampLegend() {
  const items: [string, string][] = [
    ["running", "Läuft"],
    ["waiting_tool", "Werkzeug aktiv"],
    ["queued", "Wartet"],
    ["killed", "Gestoppt"],
  ];
  return (
    <ul
      aria-label="Legende der Signale"
      className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 border border-text/20 bg-surface-2 px-3 py-1.5 text-[12px] text-muted"
    >
      {items.map(([state, label]) => (
        <li key={state} className="flex items-center gap-1.5">
          <span aria-hidden data-state={state} className="hugin-lamp size-2.5" />
          {label}
        </li>
      ))}
    </ul>
  );
}

/**
 * A signature of every node xyflow has *measured*, which is the moment a re-fit is both due
 * and able to measure what it is fitting.
 *
 * `useNodesInitialized` would read better but never turns true here — the hook also waits for
 * handle bounds, and these nodes hide their handles — so a fit gated on it never ran at all.
 * The measured sizes are the signal that hook is trying to derive, so this reads them directly.
 */
function useMeasuredNodes(): string {
  return useStore((state) => {
    let key = "";
    for (const [id, node] of state.nodeLookup) {
      key += `${id}:${node.measured?.width ?? 0}x${node.measured?.height ?? 0}|`;
    }
    return key;
  });
}

function toNodes(nodes: GNode[], state: State, selectedPid: number | null): GraphNode[] {
  return nodes.map((node) =>
    node.kind === "munin"
      ? ({
          id: node.id,
          type: "munin",
          position: { x: node.x, y: node.y },
          data: { writes: state.munin.writes },
          draggable: false,
          selectable: false,
        } satisfies MuninNodeType)
      : ({
          id: node.id,
          type: "proc",
          position: { x: node.x, y: node.y },
          data: {
            proc: state.procs[node.pid!],
            from: node.from === null ? null : { dx: node.from.x - node.x, dy: node.from.y - node.y },
          },
          // Read out by a screen reader on focus; the card itself is icons and numbers.
          ariaLabel: `${state.procs[node.pid!].program} · PID ${node.pid}`,
          selected: node.pid === selectedPid,
          draggable: false,
        } satisfies AgentNodeType),
  );
}

function toEdges(edges: GEdge[], state: State): PulseEdgeType[] {
  const traffic = pulsesByEdge(state.pulses, edges);
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.kind === "munin" ? HANDLE_MEM : HANDLE_OUT,
    targetHandle: HANDLE_IN,
    type: "pulse",
    data: {
      kind: edge.kind,
      alive: isEdgeAlive(edge, state),
      pulses: traffic.get(edge.id) ?? [],
    },
  }));
}

/**
 * Sorts the pulses in flight onto the edges they belong to. A message can travel either way —
 * a planner briefs a scout, a judge reports back — so an edge also learns the direction.
 */
function pulsesByEdge(pulses: Pulse[], edges: GEdge[]): Map<string, EdgePulse[]> {
  const known = new Set(edges.map((edge) => edge.id));
  const traffic = new Map<string, EdgePulse[]>();

  for (const pulse of pulses) {
    const route = routeOf(pulse, known);
    // A pulse without an edge (a message between siblings, a write from an exited process the
    // backfill never saw) is simply not drawn — the kernel log still carries it.
    if (route === null) continue;
    const list = traffic.get(route.id);
    const entry: EdgePulse = { id: pulse.id, kind: pulse.kind, reverse: route.reverse };
    if (list === undefined) traffic.set(route.id, [entry]);
    else list.push(entry);
  }
  return traffic;
}

function routeOf(pulse: Pulse, known: Set<string>): { id: string; reverse: boolean } | null {
  if (pulse.to === MUNIN_ID) {
    const id = muninEdgeId(pulse.from);
    return known.has(id) ? { id, reverse: false } : null;
  }
  const down = treeEdgeId(pulse.from, pulse.to);
  if (known.has(down)) return { id: down, reverse: false };
  const up = treeEdgeId(pulse.to, pulse.from);
  return known.has(up) ? { id: up, reverse: true } : null;
}

/** A hairline only brightens while there is still something moving at one of its ends. */
function isEdgeAlive(edge: GEdge, state: State): boolean {
  return [edge.source, edge.target].some((id) => {
    const pid = pidOfNode(id);
    const proc = pid === null ? undefined : state.procs[pid];
    return proc !== undefined && isAlive(proc);
  });
}
