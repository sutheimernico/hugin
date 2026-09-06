import { describe, expect, it } from "vitest";
import { fmtDateTimeDe, relativeTimeDe } from "./time";

const NOW = 1_757_000_000;

describe("relativeTimeDe", () => {
  it("calls the last minute 'gerade eben'", () => {
    expect(relativeTimeDe(NOW, NOW)).toBe("gerade eben");
    expect(relativeTimeDe(NOW - 60, NOW)).toBe("gerade eben");
  });

  it("counts whole minutes below an hour", () => {
    expect(relativeTimeDe(NOW - 61, NOW)).toBe("vor 1 Min.");
    expect(relativeTimeDe(NOW - 59 * 60, NOW)).toBe("vor 59 Min.");
  });

  it("counts whole hours below a day", () => {
    expect(relativeTimeDe(NOW - 3_600, NOW)).toBe("vor 1 Std.");
    expect(relativeTimeDe(NOW - 23 * 3_600, NOW)).toBe("vor 23 Std.");
  });

  it("counts days beyond that, in the German singular and plural", () => {
    expect(relativeTimeDe(NOW - 24 * 3_600, NOW)).toBe("vor 1 Tag");
    expect(relativeTimeDe(NOW - 3 * 86_400, NOW)).toBe("vor 3 Tagen");
  });

  it("never travels into the future when two clocks disagree", () => {
    expect(relativeTimeDe(NOW + 500, NOW)).toBe("gerade eben");
  });

  it("says nothing it does not know", () => {
    expect(relativeTimeDe(Number.NaN, NOW)).toBe("–");
  });
});

describe("fmtDateTimeDe", () => {
  it("prints day, month, year and a 24-hour clock", () => {
    // Constructed in local time and read back in local time — the assertion holds in any zone.
    const ts = new Date(2026, 8, 5, 7, 4).getTime() / 1_000;
    expect(fmtDateTimeDe(ts)).toBe("05.09.2026 07:04");
  });

  it("says nothing it does not know", () => {
    expect(fmtDateTimeDe(Number.NaN)).toBe("–");
  });
});
