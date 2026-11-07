import { describe, expect, it } from "vitest";
import { fmtDec, fmtDuration, fmtInt, fmtMs, fmtTokens, fmtUsd } from "./format";

describe("fmtTokens", () => {
  it("keeps counts below a thousand as plain digits", () => {
    expect(fmtTokens(987)).toBe("987");
    expect(fmtTokens(0)).toBe("0");
  });

  it("abbreviates thousands with a German decimal comma", () => {
    expect(fmtTokens(1234)).toBe("1,2k");
    expect(fmtTokens(1000)).toBe("1,0k");
  });

  it("abbreviates millions with a German decimal comma", () => {
    expect(fmtTokens(1_500_000)).toBe("1,5M");
  });
});

describe("fmtDuration", () => {
  it("renders minutes and seconds below an hour", () => {
    expect(fmtDuration(65)).toBe("1:05");
    expect(fmtDuration(0)).toBe("0:00");
  });

  it("renders hours, minutes and seconds from an hour on", () => {
    expect(fmtDuration(3700)).toBe("1:01:40");
    expect(fmtDuration(3600)).toBe("1:00:00");
  });

  it("drops fractional seconds", () => {
    expect(fmtDuration(65.9)).toBe("1:05");
  });
});

describe("fmtUsd", () => {
  it("shows a dash when no cost is known", () => {
    expect(fmtUsd(null)).toBe("–");
  });

  it("marks costs as estimates with two German decimals", () => {
    expect(fmtUsd(0.0432)).toBe("≈ $0,04");
    expect(fmtUsd(12.5)).toBe("≈ $12,50");
  });
});

describe("fmtInt and fmtMs", () => {
  it("use the German thousands dot and decimal comma", () => {
    expect(fmtInt(7528)).toBe("7.528");
    expect(fmtInt(12)).toBe("12");
    expect(fmtMs(15)).toBe("15 ms");
    expect(fmtMs(6028)).toBe("6,0 s");
    expect(fmtMs(999.6)).toBe("1,0 s");
  });
});

describe("fmtDec", () => {
  it("uses the decimal comma", () => {
    expect(fmtDec(231.5)).toBe("231,5");
    expect(fmtDec(3, 2)).toBe("3,00");
  });
});
