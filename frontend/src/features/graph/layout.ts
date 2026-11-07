/**
 * The graph's geometry, kept free of React so it can be unit-tested on plain state.
 *
 * The process tree is drawn left to right, like track on a signal-box diagram: a parent sits to
 * the left of the children it spawned. Positions are *slots*, not a fit: a process takes the
 * next free row of its column when it spawns and keeps it for the rest of the run, and the
 * sheet reserves room for at least three rows and two columns up front. Nothing that is
 * already on the diagram ever moves when another agent joins — a signal box does not re-draw
 * its track plan when a train arrives.
 *
 * The munin hub is not part of the tree — it is shared memory, not a step in it. It sits to
 * the right of the last reserved column, at the height of the middle row.
 */

import type { Proc, State } from "../../state/types";

/** Card size of an agent node. */
export const NODE_W = 208;
export const NODE_H = 100;
/** The memory hub is a station of the same height as a card. */
export const HUB_W = 112;
export const HUB_H = NODE_H;
/** Air between two columns (where the track runs) and between two rows. */
export const COL_GAP = 60;
export const ROW_GAP = 28;
/** The sheet always has room for this many rows and columns, so a first spawn never re-fits it. */
const MIN_ROWS = 3;
const MIN_COLS = 2;

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
  /** Where the parent sits (top-left), so a new card can grow out of it. `null` for a root. */
  from: { x: number; y: number } | null;
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
 * Everything about a run that changes the *layout*: which processes exist, who spawned whom,
 * and which of them have written to munin (that is what adds a hub edge).
 *
 * Streaming text, usage and state changes rewrite `state.procs` many times a second. Running
 * the layout on each of them would relayout — and visibly re-fit — the graph while nothing about
 * its shape moved, so the graph is memoised on this key instead of on the state itself.
 */
export function structureKey(state: State, runId: string | null): string {
  if (runId === null) return "";
  return Object.values(state.procs)
    .filter((proc) => proc.runId === runId)
    .sort((a, b) => a.pid - b.pid)
    .map((proc) => `${proc.pid}>${proc.ppid ?? "-"}${proc.muninWrites > 0 ? "m" : ""}`)
    .join("|");
}

export interface GBounds {
  width: number;
  height: number;
}

/**
 * The graph of one run: an agent per process, the spawn tree between them, and a link to the
 * memory hub for every process that has written to it. `bounds` is the reserved sheet the
 * viewport fits — not the bounding box of what has spawned so far.
 *
 * Positions are top-left corners (what xyflow wants).
 */
export function buildGraph(
  state: State,
  runId: string | null,
): { nodes: GNode[]; edges: GEdge[]; bounds: GBounds } {
  const empty = { nodes: [], edges: [], bounds: reserved(MIN_COLS, MIN_ROWS) };
  if (runId === null) return empty;

  // Sorted by pid — that is spawn order, and slots are handed out in that order.
  const procs = Object.values(state.procs)
    .filter((proc) => proc.runId === runId)
    .sort((a, b) => a.pid - b.pid);
  if (procs.length === 0) return empty;

  const known = new Set(procs.map((proc) => proc.pid));
  const parentOf = new Map<number, number>();
  for (const proc of procs) {
    // A backfill can start mid-run, so a parent may be missing; then the child is a root.
    if (proc.ppid !== null && known.has(proc.ppid)) parentOf.set(proc.pid, proc.ppid);
  }

  const columns = new Map<number, Proc[]>();
  const depthOf = new Map<number, number>();
  for (const proc of procs) {
    // pids ascend, so a parent has always been placed before its child.
    const depth = (depthOf.get(parentOf.get(proc.pid) ?? -1) ?? -1) + 1;
    depthOf.set(proc.pid, depth);
    columns.set(depth, [...(columns.get(depth) ?? []), proc]);
  }

  const cols = Math.max(MIN_COLS, ...[...columns.keys()].map((depth) => depth + 1));
  const rows = Math.max(MIN_ROWS, ...[...columns.values()].map((column) => column.length));
  const bounds = reserved(cols, rows);
  const pitchX = NODE_W + COL_GAP;
  const pitchY = NODE_H + ROW_GAP;

  const slot = new Map<number, { x: number; y: number }>();
  for (const [depth, column] of columns) {
    // A lone root sits on the middle row; everything else fills its column from the top.
    const lone = depth === 0 && column.length === 1;
    column.forEach((proc, row) => {
      slot.set(proc.pid, {
        x: depth * pitchX,
        y: lone ? ((rows - 1) / 2) * pitchY : row * pitchY,
      });
    });
  }

  const edges: GEdge[] = [];
  for (const [pid, ppid] of parentOf) {
    edges.push({ id: treeEdgeId(ppid, pid), source: nodeId(ppid), target: nodeId(pid), kind: "tree" });
  }

  const nodes: GNode[] = procs.map((proc) => {
    const parent = parentOf.get(proc.pid);
    return {
      id: nodeId(proc.pid),
      kind: "proc",
      pid: proc.pid,
      ...slot.get(proc.pid)!,
      from: parent === undefined ? null : slot.get(parent)!,
    };
  });

  nodes.push({
    id: MUNIN_ID,
    kind: "munin",
    from: null,
    x: cols * pitchX,
    y: ((rows - 1) / 2) * pitchY + (NODE_H - HUB_H) / 2,
  });
  for (const proc of procs) {
    if (proc.muninWrites === 0) continue;
    edges.push({
      id: muninEdgeId(proc.pid),
      source: nodeId(proc.pid),
      target: MUNIN_ID,
      kind: "munin",
    });
  }

  return { nodes, edges, bounds };
}

function reserved(cols: number, rows: number): GBounds {
  return {
    width: cols * (NODE_W + COL_GAP) + HUB_W,
    height: rows * NODE_H + (rows - 1) * ROW_GAP,
  };
}
