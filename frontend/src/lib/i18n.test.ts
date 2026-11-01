import { describe, expect, it } from "vitest";
import { exitReasonLabel, exitReasonShort } from "./i18n";

describe("exitReasonLabel", () => {
  const cases: [string, string][] = [
    ["done", "Beendet: fertig"],
    ["failed", "Fehler"],
    ["killed", "Beendet"],
    ["driver_error", "Treiberfehler"],
    ["budget:turns", "Budget: Runden überschritten"],
    ["budget:seconds", "Budget: Zeit überschritten"],
    ["budget:output_tokens", "Budget: Tokens überschritten"],
  ];

  it.each(cases)("translates %s", (reason, label) => {
    expect(exitReasonLabel(reason)).toBe(label);
  });

  it("shows an unknown reason verbatim rather than inventing one", () => {
    expect(exitReasonLabel("budget:context")).toBe("budget:context");
  });
});

describe("exitReasonShort", () => {
  it("reads as the end of a sentence", () => {
    expect(exitReasonShort("done")).toBe("fertig");
    expect(exitReasonShort("budget:turns")).toBe("Budget Runden überschritten");
  });

  it("keeps an unknown reason verbatim", () => {
    expect(exitReasonShort("meteor")).toBe("meteor");
  });
});
