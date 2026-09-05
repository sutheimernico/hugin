"""Budget decision logic, kept pure so the kernel can ask it anywhere without side effects.

The watcher never kills and never emits: it answers "which limit is breached" and "how full
is this process". Acting on the answer (`budget.exceeded` plus a kill) belongs to the kernel.
"""

from typing import Literal

from hugin.kernel.process import AgentProcess

Dimension = Literal["turns", "seconds", "output_tokens"]


def _elapsed(proc: AgentProcess, now: float) -> float:
    """Seconds since the process started; a process that never started has spent none."""
    if proc.started_at is None:
        return 0.0
    return now - proc.started_at


class BudgetWatcher:
    """Pure decision logic: given a process and now, which limit (if any) is breached."""

    @staticmethod
    def breach(proc: AgentProcess, now: float) -> Dimension | None:
        budget = proc.budget
        if proc.usage.turns >= budget.max_turns:
            return "turns"
        if proc.usage.output_tokens >= budget.max_output_tokens:
            return "output_tokens"
        if _elapsed(proc, now) >= budget.max_seconds:
            return "seconds"
        return None

    @staticmethod
    def pct(proc: AgentProcess, now: float) -> float:
        budget = proc.budget
        return max(
            proc.usage.turns / budget.max_turns,
            proc.usage.output_tokens / budget.max_output_tokens,
            _elapsed(proc, now) / budget.max_seconds,
        )
