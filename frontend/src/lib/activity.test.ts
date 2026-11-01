import { describe, expect, it } from "vitest";
import type { Proc, TranscriptItem } from "../state/types";
import { activityOf, stateLine } from "./activity";

function proc(over: Partial<Proc>): Proc {
  return { state: "running", thinking: false, transcript: [], exitReason: null, ...over } as Proc;
}

const tool = (name: string, ok?: boolean): TranscriptItem => ({
  t: "tool",
  callId: "c",
  tool: name,
  input: "",
  sys: false,
  ok,
});

describe("stateLine", () => {
  it("joins state and activity", () => {
    expect(stateLine(proc({ state: "done" }))).toBe("Fertig · Bericht abgegeben");
  });

  it("does not say a thing twice", () => {
    expect(stateLine(proc({ state: "queued" }))).toBe("Wartet auf einen Platz");
    expect(stateLine(proc({ state: "killed" }))).toBe("Gestoppt");
  });
});

describe("activityOf", () => {
  it("names the tool that is still out, in German", () => {
    expect(activityOf(proc({ transcript: [tool("mcp__hugin__munin_search")] }))).toBe(
      "Speicher durchsuchen",
    );
  });

  it("ignores calls that already returned", () => {
    expect(activityOf(proc({ transcript: [tool("WebSearch", true)] }))).toBe("Läuft");
  });

  it("says thinking while the model thinks", () => {
    expect(activityOf(proc({ thinking: true }))).toBe("Denkt nach");
  });

  it("says writing after prose", () => {
    expect(activityOf(proc({ transcript: [{ t: "text", text: "Hallo" }] }))).toBe("Schreibt");
  });

  it("covers the states around a run", () => {
    expect(activityOf(proc({ state: "queued" }))).toBe("Wartet auf einen Platz");
    expect(activityOf(proc({ state: "waiting_tool" }))).toBe("Wartet auf Werkzeug");
    expect(activityOf(proc({ state: "done" }))).toBe("Bericht abgegeben");
    expect(activityOf(proc({ state: "killed" }))).toBe("Gestoppt");
  });

  it("explains a failure with the kernel's reason", () => {
    expect(activityOf(proc({ state: "failed", exitReason: "budget:turns" }))).toBe(
      "Budget Runden überschritten",
    );
    expect(activityOf(proc({ state: "failed" }))).toBe("Fehlgeschlagen");
  });
});
