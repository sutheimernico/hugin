/** The mission ledger: the sums a reader wants next to the goal, derived from the projection. */

import { isActive, isAlive } from "../../state/selectors";
import type { Proc, Run } from "../../state/types";

export interface Ledger {
  elapsed: number;
  turns: number;
  outputTokens: number;
  /** While agents run, the figure counts finished turns only — a lower bound. */
  tokensAreFloor: boolean;
  procsAlive: number;
  procsTotal: number;
  artifacts: number;
  /** Highest budget fill among the living processes, 0…1. */
  budgetPct: number;
}

export function ledgerOf(run: Run, procs: Proc[], now: number): Ledger {
  const mine = procs.filter((proc) => proc.runId === run.id);
  const living = mine.filter(isAlive);
  const active = mine.filter(isActive);
  return {
    elapsed: Math.max(0, (run.doneAt ?? now) - run.createdAt),
    turns: mine.reduce((sum, proc) => sum + proc.usage.turns, 0),
    outputTokens: mine.reduce((sum, proc) => sum + proc.usage.output_tokens, 0),
    tokensAreFloor: living.length > 0,
    procsAlive: active.length,
    procsTotal: mine.length,
    artifacts: run.artifacts.length,
    budgetPct: living.reduce((top, proc) => Math.max(top, proc.budgetPct), 0),
  };
}
