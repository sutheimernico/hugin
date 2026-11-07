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

describe("timetableRows — repeated lines", () => {
  const at = (seq: number, kind: string, pid: number, text: string, extra: Partial<LogLine> = {}): LogLine => ({
    seq,
    ts: seq,
    kind,
    pid,
    text,
    ...extra,
  });

  it("keeps one row per hugin tool call, not the tool and the syscall behind it", () => {
    const rows = timetableRows(
      [
        at(1, "tool.call", 3, "Prozess 3: Speicher beschreiben", { kernelTool: true }),
        at(2, "sys.call", 3, "Prozess 3: Speicher beschreiben"),
        at(3, "sys.result", 3, "Kernel-Aufruf erledigt in 0 ms"),
        at(4, "tool.result", 3, "Werkzeug fertig in 19 ms"),
      ],
      0,
    );
    expect(rows.map((row) => row.line.kind)).toEqual(["tool.call", "tool.result"]);
  });

  it("keeps the syscall rows of a driver that logs no tool call", () => {
    const rows = timetableRows(
      [at(1, "sys.call", 3, "Prozess 3: Bericht abgeben"), at(2, "sys.result", 3, "Kernel-Aufruf erledigt in 0 ms")],
      0,
    );
    expect(rows).toHaveLength(2);
  });

  it("hides the lamp flipping between running and tool active", () => {
    const rows = timetableRows(
      [
        at(1, "proc.state", 3, "Prozess 3: Läuft → Werkzeug aktiv"),
        at(2, "proc.state", 3, "Prozess 3: Werkzeug aktiv → Läuft"),
        at(3, "proc.state", 3, "Prozess 3: Läuft → Fertig"),
      ],
      0,
    );
    expect(rows.map((row) => row.line.text)).toEqual(["Prozess 3: Läuft → Fertig"]);
  });
});
