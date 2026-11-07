import { describe, expect, it } from "vitest";
import { breakpointOf } from "./breakpoint";

describe("breakpointOf", () => {
  it("switches at 720 and 900 px", () => {
    expect(breakpointOf(390)).toBe("mobile");
    expect(breakpointOf(719)).toBe("mobile");
    expect(breakpointOf(720)).toBe("tablet");
    expect(breakpointOf(899)).toBe("tablet");
    expect(breakpointOf(900)).toBe("desktop");
    expect(breakpointOf(2560)).toBe("desktop");
  });
});
