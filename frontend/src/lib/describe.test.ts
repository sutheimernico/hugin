import { describe, expect, it } from "vitest";
import { syscallLabel, toolLabel } from "./describe";

describe("syscallLabel", () => {
  it("names the kernel's syscalls as actions", () => {
    expect(syscallLabel("proc_spawn")).toBe("Agent starten");
    expect(syscallLabel("mission_report")).toBe("Bericht abgeben");
  });

  it("shows an unknown syscall as it came", () => {
    expect(syscallLabel("brand_new")).toBe("brand_new");
  });
});

describe("toolLabel", () => {
  it("strips the MCP prefix of hugin's own tools", () => {
    expect(toolLabel("mcp__hugin__munin_search")).toBe("Speicher durchsuchen");
  });

  it("names the harness tools", () => {
    expect(toolLabel("WebSearch")).toBe("Websuche");
  });

  it("keeps an unknown tool verbatim", () => {
    expect(toolLabel("Teleport")).toBe("Teleport");
    expect(toolLabel("mcp__hugin__unknown")).toBe("unknown");
  });
});
