from itertools import product
from pathlib import Path

import pytest

from hugin.kernel.events import BudgetSpec, ProcState, Usage
from hugin.kernel.process import (
    VALID_TRANSITIONS,
    AgentProcess,
    InvalidTransition,
    Message,
    ProcessTable,
)

TERMINAL = {"done", "failed", "killed"}


def _proc(
    pid: int = 1, *, run_id: str = "r1", ppid: int | None = None, **overrides
) -> AgentProcess:
    kwargs = dict(
        pid=pid,
        run_id=run_id,
        ppid=ppid,
        program="planner",
        role="planner",
        driver="scripted",
        model="scripted-1",
        task="plan the mission",
        cwd=Path("/tmp/hugin/p1"),
        capabilities={"munin.write"},
        allowed_tools=["Read"],
        budget=BudgetSpec(),
    )
    kwargs.update(overrides)
    return AgentProcess(**kwargs)


def test_defaults_of_a_fresh_process():
    proc = _proc()
    assert proc.state == "queued"
    assert proc.usage == Usage()
    assert proc.started_at is None and proc.exited_at is None and proc.exit_reason is None
    assert proc.mailbox == [] and proc.report is None


def test_mailbox_holds_messages():
    proc = _proc()
    proc.mailbox.append(Message(from_pid=2, text="status?", ts=1.0))
    assert proc.mailbox[0].from_pid == 2
    assert proc.mailbox[0].text == "status?"
    assert proc.mailbox[0].ts == 1.0


@pytest.mark.parametrize("src,dst", list(product(VALID_TRANSITIONS, repeat=2)))
def test_transition_matrix(src: ProcState, dst: ProcState):
    proc = _proc(state=src)
    if dst in VALID_TRANSITIONS[src]:
        assert proc.transition(dst) == src
        assert proc.state == dst
    else:
        with pytest.raises(InvalidTransition):
            proc.transition(dst)
        assert proc.state == src


def test_terminal_states_have_no_successors():
    assert {s for s, targets in VALID_TRANSITIONS.items() if not targets} == TERMINAL


@pytest.mark.parametrize("state", list(VALID_TRANSITIONS))
def test_alive_is_false_exactly_in_terminal_states(state: ProcState):
    assert _proc(state=state).alive is (state not in TERMINAL)


def test_next_pid_starts_at_one_and_increases():
    table = ProcessTable()
    assert [table.next_pid() for _ in range(3)] == [1, 2, 3]


def test_add_and_get():
    table = ProcessTable()
    proc = _proc(7)
    table.add(proc)
    assert table.get(7) is proc


def test_get_unknown_pid_raises_key_error():
    with pytest.raises(KeyError):
        ProcessTable().get(99)


def test_all_and_alive():
    table = ProcessTable()
    running, done = _proc(1), _proc(2, state="done")
    table.add(running)
    table.add(done)
    assert table.all() == [running, done]
    assert table.alive() == [running]


def test_children_returns_direct_children_only():
    table = ProcessTable()
    parent, child_a = _proc(1), _proc(2, ppid=1)
    child_b, grandchild = _proc(3, ppid=1), _proc(4, ppid=2)
    for proc in (parent, child_a, child_b, grandchild):
        table.add(proc)
    assert table.children(1) == [child_a, child_b]
    assert table.children(2) == [grandchild]
    assert table.children(3) == []


def test_for_run_filters_by_run_id():
    table = ProcessTable()
    a, b, other = _proc(1), _proc(2), _proc(3, run_id="r2")
    for proc in (a, b, other):
        table.add(proc)
    assert table.for_run("r1") == [a, b]
    assert table.for_run("r2") == [other]
    assert table.for_run("nope") == []
