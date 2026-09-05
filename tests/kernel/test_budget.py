from pathlib import Path

from hugin.kernel.budget import BudgetWatcher
from hugin.kernel.events import BudgetSpec, Usage
from hugin.kernel.process import AgentProcess

START = 1000.0


def _proc(
    *,
    turns: int = 0,
    output_tokens: int = 0,
    started_at: float | None = START,
    budget: BudgetSpec | None = None,
) -> AgentProcess:
    return AgentProcess(
        pid=1,
        run_id="r1",
        ppid=None,
        program="planner",
        role="planner",
        driver="scripted",
        model="scripted-1",
        task="plan the mission",
        cwd=Path("/tmp/hugin/p1"),
        capabilities=set(),
        allowed_tools=[],
        budget=budget or BudgetSpec(max_turns=12, max_seconds=300, max_output_tokens=6000),
        state="running",
        usage=Usage(turns=turns, output_tokens=output_tokens),
        started_at=started_at,
    )


def test_no_breach_under_all_limits():
    proc = _proc(turns=11, output_tokens=5999)
    assert BudgetWatcher.breach(proc, START + 299) is None


def test_turns_at_limit_breaches():
    assert BudgetWatcher.breach(_proc(turns=12), START) == "turns"


def test_output_tokens_at_limit_breaches():
    assert BudgetWatcher.breach(_proc(output_tokens=6000), START) == "output_tokens"


def test_seconds_at_limit_breaches():
    assert BudgetWatcher.breach(_proc(), START + 300) == "seconds"


def test_turns_win_over_output_tokens_and_seconds():
    proc = _proc(turns=99, output_tokens=99_000)
    assert BudgetWatcher.breach(proc, START + 9_000) == "turns"


def test_output_tokens_win_over_seconds():
    proc = _proc(output_tokens=99_000)
    assert BudgetWatcher.breach(proc, START + 9_000) == "output_tokens"


def test_seconds_count_from_started_at_and_none_means_zero():
    not_started = _proc(started_at=None)
    assert BudgetWatcher.breach(not_started, START + 9_000) is None
    assert BudgetWatcher.pct(not_started, START + 9_000) == 0.0


def test_pct_is_the_max_over_the_three_dimensions():
    proc = _proc(turns=6, output_tokens=1000)
    assert BudgetWatcher.pct(proc, START + 30) == 0.5


def test_pct_may_exceed_one():
    proc = _proc(turns=24)
    assert BudgetWatcher.pct(proc, START) == 2.0
