import { describe, expect, it } from "vitest";
import type { Proc } from "../../state/types";
import { treeRows } from "./tree";

function proc(pid: number, ppid: number | null): Proc {
  return { pid, ppid } as Proc;
}

describe("treeRows", () => {
  it("lists a planner and its scouts depth first, in spawn order", () => {
    const rows = treeRows([proc(3, 1), proc(1, null), proc(2, 1)]);
    expect(rows.map((row) => [row.proc.pid, row.depth])).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
    ]);
  });

  it("marks the last sibling so the rail can end there", () => {
    const rows = treeRows([proc(1, null), proc(2, 1), proc(3, 1)]);
    expect(rows.map((row) => row.last)).toEqual([true, false, true]);
  });

  it("carries the ancestors' last-ness for the rails of grandchildren", () => {
    const rows = treeRows([proc(1, null), proc(2, 1), proc(3, 1), proc(4, 2)]);
    const grandchild = rows.find((row) => row.proc.pid === 4);
    // Parent 2 has a younger sibling (3), so the rail through its level continues.
    expect(grandchild?.trail).toEqual([true, false]);
  });

  it("treats a process whose parent is unknown as a root", () => {
    const rows = treeRows([proc(5, 99)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].depth).toBe(0);
  });

  it("returns nothing for an empty table", () => {
    expect(treeRows([])).toEqual([]);
  });
});
