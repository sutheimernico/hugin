/**
 * The graph's geometry, kept free of React so it can be unit-tested on plain state.
 *
 * The process tree is laid out by dagre (top down: a parent sits above the children it
 * spawned). The munin hub is *not* part of that layout — it is shared memory, not a step in
 * the tree, and letting dagre rank it would drag every writer onto its own row. It is placed
 * beside the tree instead, at the height of its middle.
 */

import { Graph, layout } from "@dagrejs/dagre";
import type { State } from "../../state/types";

/** Card size of an agent node — dagre reserves exactly this, so edges meet the cards. */
export const NODE_W = 180;
export const NODE_H = 64;
/** Diameter of the memory hub. */
export const HUB_SIZE = 72;
/** Horizontal air between the widest rank of the tree and the hub. */
const HUB_GAP = 96;

export const MUNIN_ID = "munin";

/**
 * Handle ids. A node carries more than one source handle (tree down, memory right), so every
 * edge has to name the handle it leaves from — otherwise xyflow guesses and warns.
 */
export const HANDLE_IN = "in";
export const HANDLE_OUT = "out";
export const HANDLE_MEM = "mem";

export interface GNode {
  id: string;
  kind: "proc" | "munin";
  pid?: number;
  x: number;
  y: number;
}

export interface GEdge {
  id: string;
  source: string;
  target: string;
  kind: "tree" | "munin";
}

export function nodeId(pid: number): string {
  return `p${pid}`;
}

/** The inverse of `nodeId`; the hub and anything unexpected are not a process. */
export function pidOfNode(id: string): number | null {
  const pid = Number(id.slice(1));
  return id.startsWith("p") && Number.isInteger(pid) ? pid : null;
}

/** Tree edges are addressed by both ends, so a pulse can find its edge in either direction. */
export function treeEdgeId(ppid: number, pid: number): string {
  return `e${ppid}-${pid}`;
}

export function muninEdgeId(pid: number): string {
  return `m${pid}`;
}

/**
 * The graph of one run: an agent per process, the spawn tree between them, and a link to the
 * memory hub for every process that has written to it.
 *
 * Positions are top-left corners (what xyflow wants), not dagre's centres.
 */
export function buildGraph(state: State, runId: string | null): { nodes: GNode[]; edges: GEdge[] } {
  if (runId === null) return { nodes: [], edges: [] };

  // Sorted by pid — that is spawn order, and it makes dagre's output deterministic.
  const procs = Object.values(state.procs)
    .filter((proc) => proc.runId === runId)
    .sort((a, b) => a.pid - b.pid);
  if (procs.length === 0) return { nodes: [], edges: [] };

  const known = new Set(procs.map((proc) => proc.pid));
  const graph = new Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 90 });
  graph.setDefaultEdgeLabel(() => ({}));

  const edges: GEdge[] = [];
  for (const proc of procs) {
    graph.setNode(nodeId(proc.pid), { width: NODE_W, height: NODE_H });
  }
  for (const proc of procs) {
    // A backfill can start mid-run, so a parent may be missing; then the child is a root.
    if (proc.ppid === null || !known.has(proc.ppid)) continue;
    graph.setEdge(nodeId(proc.ppid), nodeId(proc.pid));
    edges.push({
      id: treeEdgeId(proc.ppid, proc.pid),
      source: nodeId(proc.ppid),
      target: nodeId(proc.pid),
      kind: "tree",
    });
  }

  layout(graph);

  const nodes: GNode[] = procs.map((proc) => {
    const placed = graph.node(nodeId(proc.pid));
    return {
      id: nodeId(proc.pid),
      kind: "proc",
      pid: proc.pid,
      x: placed.x - NODE_W / 2,
      y: placed.y - NODE_H / 2,
    };
  });

  nodes.push({ id: MUNIN_ID, kind: "munin", ...hubPosition(nodes) });
  for (const proc of procs) {
    if (proc.muninWrites === 0) continue;
    edges.push({
      id: muninEdgeId(proc.pid),
      source: nodeId(proc.pid),
      target: MUNIN_ID,
      kind: "munin",
    });
  }

  return { nodes, edges };
}

/** Right of the widest rank, at the vertical middle of the tree. */
function hubPosition(nodes: GNode[]): { x: number; y: number } {
  const right = Math.max(...nodes.map((node) => node.x)) + NODE_W;
  const top = Math.min(...nodes.map((node) => node.y));
  const bottom = Math.max(...nodes.map((node) => node.y)) + NODE_H;
  return { x: right + HUB_GAP, y: (top + bottom) / 2 - HUB_SIZE / 2 };
}
