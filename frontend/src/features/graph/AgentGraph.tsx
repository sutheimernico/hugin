/**
 * The live agent graph: the process tree of the running mission, drawn as it grows.
 *
 * Everything here is derived — from the projection, never from its own state. A node exists
 * because a `proc.spawned` event created it, an edge brightens because one of its ends is
 * alive, a particle travels because a pulse is in flight. That is why the same component
 * renders a replay without knowing it is one.
 */

import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
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

/** The one fit the graph ever performs — on a new node, and on a resized panel. */
const FIT = { padding: 0.2, maxZoom: 1.1, duration: 400 };

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
  // Flips to false whenever a node joins and back once it has been measured — which is exactly
  // when a re-fit is both needed and able to measure what it is fitting.
  const initialized = useNodesInitialized();
  const count = graph.nodes.length;
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialized || count === 0) return;
    void fitView(FIT);
  }, [initialized, count, fitView]);

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
      className={`h-full w-full ${panicking ? "hugin-panic" : ""}`}
      onKeyDown={handleKeyDown}
    >
      {count === 0 ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted">
          Noch keine Agenten — der Graph wächst mit der Mission.
        </div>
      ) : (
        <ReactFlow<GraphNode, PulseEdgeType>
          className="hugin-graph"
          colorMode="dark"
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodeClick={handleClick}
          fitView
          fitViewOptions={FIT}
          panOnScroll
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        </ReactFlow>
      )}
    </div>
  );
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
          data: { proc: state.procs[node.pid!] },
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
