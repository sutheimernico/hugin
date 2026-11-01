import { describe, expect, it } from "vitest";
import type { Proc, Run } from "../../state/types";
import { ledgerOf } from "./ledger";

const run = { id: "r", createdAt: 100, doneAt: null, artifacts: ["report.md"] } as unknown as Run;

function proc(over: Partial<Proc> & { usage?: Partial<Proc["usage"]> }): Proc {
  return {
    runId: "r",
    state: "running",
    budgetPct: 0,
    ...over,
    usage: { turns: 0, output_tokens: 0, ...over.usage },
  } as Proc;
}

describe("ledgerOf", () => {
  it("sums turns and tokens over the run's processes only", () => {
    const ledger = ledgerOf(
      run,
      [
        proc({ usage: { turns: 2, output_tokens: 300 } }),
        proc({ state: "done", usage: { turns: 3, output_tokens: 500 } }),
        proc({ runId: "other", usage: { turns: 9, output_tokens: 9_000 } }),
      ],
      130,
    );
    expect(ledger).toMatchObject({ turns: 5, outputTokens: 800, procsAlive: 1, procsTotal: 2 });
  });

  it("follows the clock while running and stops at the end of a finished run", () => {
    expect(ledgerOf(run, [], 160).elapsed).toBe(60);
    expect(ledgerOf({ ...run, doneAt: 190 }, [], 999).elapsed).toBe(90);
  });

  it("reports the fullest budget among living processes", () => {
    const ledger = ledgerOf(
      run,
      [proc({ budgetPct: 0.2 }), proc({ budgetPct: 0.7 }), proc({ state: "done", budgetPct: 1 })],
      110,
    );
    expect(ledger.budgetPct).toBe(0.7);
  });

  it("counts artifacts", () => {
    expect(ledgerOf(run, [], 100).artifacts).toBe(1);
  });
});
