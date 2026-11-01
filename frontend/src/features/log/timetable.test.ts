import { describe, expect, it } from "vitest";
import type { LogLine } from "../../state/types";
import { describeKind } from "./describe";
import { timetableRows } from "./timetable";

const line = (seq: number, ts: number, kind = "proc.state"): LogLine => ({
  seq,
  ts,
  kind,
  pid: null,
  text: "x",
});

describe("timetableRows", () => {
  it("counts departure from the start of the mission", () => {
    const rows = timetableRows([line(1, 100), line(2, 142.5)], 100);
    expect(rows.map((row) => row.at)).toEqual([0, 42.5]);
  });

  it("drops lines from before the mission began", () => {
    const rows = timetableRows([line(1, 50, "kernel.boot"), line(2, 100)], 100);
    expect(rows.map((row) => row.line.seq)).toEqual([2]);
  });

  it("starts at the first line when there is no mission", () => {
    const rows = timetableRows([line(1, 50), line(2, 60)], null);
    expect(rows.map((row) => row.at)).toEqual([0, 10]);
  });

  it("returns nothing for an empty log", () => {
    expect(timetableRows([], null)).toEqual([]);
  });
});

describe("describeKind", () => {
  it("picks the longest matching prefix", () => {
    expect(describeKind("proc.spawned").tone).toBe("blue");
    expect(describeKind("proc.state").tone).toBe("muted");
  });

  it("colours families the way the graph does", () => {
    expect(describeKind("tool.call").tone).toBe("teal");
    expect(describeKind("munin.write").tone).toBe("green");
    expect(describeKind("kill").tone).toBe("red");
  });

  it("has a neutral fallback", () => {
    expect(describeKind("something.new").tone).toBe("muted");
  });
});
