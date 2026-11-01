import { describe, expect, it } from "vitest";
import { finalStamp, startsTermBeat } from "./stamp";

describe("finalStamp", () => {
  it("marks killed and failed processes and nothing else", () => {
    expect(finalStamp("killed")).toEqual({ word: "KILL", tone: "red" });
    expect(finalStamp("failed")).toEqual({ word: "FEHLER", tone: "red" });
    expect(finalStamp("done")).toBeNull();
    expect(finalStamp("running")).toBeNull();
  });
});

describe("startsTermBeat", () => {
  it("beats when a live process is killed", () => {
    expect(startsTermBeat("running", "killed")).toBe(true);
    expect(startsTermBeat("waiting_tool", "killed")).toBe(true);
  });

  it("does not beat on first sight of a stopped process", () => {
    expect(startsTermBeat(null, "killed")).toBe(false);
  });

  it("does not beat for a normal ending", () => {
    expect(startsTermBeat("running", "done")).toBe(false);
  });
});
