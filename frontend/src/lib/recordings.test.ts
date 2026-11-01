import { describe, expect, it } from "vitest";
import type { ApiRecording } from "./api";
import { parseJsonl, pickShowcase } from "./recordings";

const rec = (slug: string, driver: string) => ({ slug, driver }) as ApiRecording;

describe("parseJsonl", () => {
  it("reads one event per line and skips blank lines", () => {
    const text = '{"seq":1,"kind":"run.created"}\n\n{"seq":2,"kind":"run.done"}\n';
    expect(parseJsonl(text).map((event) => event.seq)).toEqual([1, 2]);
  });

  it("throws on a broken line instead of dropping it", () => {
    expect(() => parseJsonl('{"seq":1}\nnot json')).toThrow();
  });
});

describe("pickShowcase", () => {
  it("prefers the real Claude run", () => {
    const list = [rec("sim", "scripted"), rec("real", "claude"), rec("local", "ollama")];
    expect(pickShowcase(list)?.slug).toBe("real");
  });

  it("falls back to the first recording", () => {
    expect(pickShowcase([rec("sim", "scripted")])?.slug).toBe("sim");
  });

  it("returns nothing for an empty list", () => {
    expect(pickShowcase([])).toBeUndefined();
  });
});
