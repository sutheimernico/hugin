import { describe, expect, it } from "vitest";
import { goalText, modelLabel, syscallLabel, toolErrorText, toolLabel } from "./describe";

describe("goalText", () => {
  it("turns the program prefix into the role", () => {
    expect(goalText("program:scout Recherchiere Ollama")).toBe("Späher: Recherchiere Ollama");
  });

  it("keeps an unknown program name and a plain goal as they are", () => {
    expect(goalText("program:wizard Zaubere")).toBe("wizard: Zaubere");
    expect(goalText("Erstelle ein Briefing")).toBe("Erstelle ein Briefing");
  });
});

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

describe("toolErrorText", () => {
  it("turns a validation wrapper into one sentence naming the call", () => {
    const raw =
      "<tool_use_error>InputValidationError: mcp__hugin__munin_write was called with input that did not match";
    expect(toolErrorText(raw)).toBe(
      "Ungültige Eingabe für »Speicher beschreiben«, der Agent versucht es erneut",
    );
  });

  it("names a timeout and clips anything else", () => {
    expect(toolErrorText("The operation timed out.")).toBe("Zeitüberschreitung");
    expect(toolErrorText("x".repeat(200)).length).toBe(90);
  });
});

describe("modelLabel", () => {
  it("shows a name instead of an id", () => {
    expect(modelLabel("sonnet")).toBe("Sonnet");
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelLabel("sim")).toBe("Skript");
    expect(modelLabel("qwen2.5:7b")).toBe("qwen2.5:7b");
  });
});
