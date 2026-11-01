import { describe, expect, it } from "vitest";
import { budgetTone } from "./budget";

describe("budgetTone", () => {
  it("stays green until 60 %, amber until 85 %, then red", () => {
    expect(budgetTone(0)).toBe("green");
    expect(budgetTone(0.59)).toBe("green");
    expect(budgetTone(0.6)).toBe("amber");
    expect(budgetTone(0.84)).toBe("amber");
    expect(budgetTone(0.85)).toBe("red");
    expect(budgetTone(1.4)).toBe("red");
  });
});
