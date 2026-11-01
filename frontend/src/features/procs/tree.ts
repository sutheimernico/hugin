/**
 * The spawn tree as a flat, depth-first list: what the narrow-screen process tree draws.
 *
 * `trail` has one entry per ancestor level (nearest last) and says whether that ancestor was the
 * last of its siblings. A row draws its connector rails from it: a vertical track continues
 * through the levels where more siblings follow, and ends where they do not.
 */

import type { Proc } from "../../state/types";

export interface TreeRow {
  proc: Proc;
  depth: number;
  /** True when no sibling follows this process under the same parent. */
  last: boolean;
  /** For every ancestor level, deepest last: was that ancestor the last of its siblings? */
  trail: boolean[];
}

export function treeRows(procs: Proc[]): TreeRow[] {
  const known = new Set(procs.map((proc) => proc.pid));
  const children = new Map<number | null, Proc[]>();
  for (const proc of [...procs].sort((a, b) => a.pid - b.pid)) {
    // A backfill can start mid-run, so a parent may be unknown; then the child is a root.
    const parent = proc.ppid !== null && known.has(proc.ppid) ? proc.ppid : null;
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [proc]);
    else list.push(proc);
  }

  const rows: TreeRow[] = [];
  const walk = (parent: number | null, trail: boolean[]) => {
    const list = children.get(parent) ?? [];
    list.forEach((proc, index) => {
      const last = index === list.length - 1;
      rows.push({ proc, depth: trail.length, last, trail });
      walk(proc.pid, [...trail, last]);
    });
  };
  walk(null, []);
  return rows;
}
