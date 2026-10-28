"""Capability hardening: revoked tokens, bounded child budgets, closed-run artifacts."""

import pytest

from hugin.drivers.base import ExitInfo, SyscallError
from hugin.kernel.events import BudgetSpec

HELLO = "script:hello"


@pytest.fixture
async def parked(make_kernel):
    kernel = await make_kernel(limits={"scripted": 0})
    run_id = await kernel.create_run("Security", driver="scripted")
    planner = await kernel.spawn(run_id, "planner", HELLO, driver="scripted")
    await kernel.set_state(planner, "spawning")
    await kernel.set_state(planner, "running")
    return kernel, run_id, planner


async def test_token_stops_authenticating_once_the_process_has_exited(parked):
    kernel, _run_id, planner = parked
    token = kernel.token_for(planner)
    assert kernel.pid_for(token) == planner

    await kernel._finalize(planner, ExitInfo("killed", kernel.procs.get(planner).usage))

    assert kernel.pid_for(token) is None


async def test_an_exited_process_cannot_make_syscalls_even_by_pid(parked):
    kernel, _run_id, planner = parked
    await kernel._finalize(planner, ExitInfo("killed", kernel.procs.get(planner).usage))

    with pytest.raises(SyscallError, match="has exited"):
        await kernel.syscalls.call(
            planner, "proc_spawn", {"program": "scout", "task": "x", "budget": {}}
        )


async def test_a_closed_run_refuses_artifact_writes(parked):
    kernel, run_id, planner = parked
    kernel.runs[run_id].state = "failed"

    with pytest.raises(SyscallError, match="closed"):
        await kernel.syscalls.call(planner, "artifact_write", {"content": "overwritten"})


async def test_child_budget_cannot_exceed_what_the_parent_has_left(parked):
    kernel, _run_id, planner = parked
    parent = kernel.procs.get(planner)
    huge = {"max_turns": 1_000_000, "max_seconds": 10**7, "max_output_tokens": 10**9}

    result = await kernel.syscalls.call(
        planner, "proc_spawn", {"program": "scout", "task": "x", "budget": huge}
    )

    child = kernel.procs.get(result["pid"]).budget
    assert child.max_turns <= parent.budget.max_turns
    assert child.max_seconds <= parent.budget.max_seconds
    assert child.max_output_tokens <= parent.budget.max_output_tokens
    assert result["budget"] == child.model_dump()


async def test_child_budget_shrinks_with_the_parents_consumption(parked):
    kernel, _run_id, planner = parked
    parent = kernel.procs.get(planner)
    parent.usage = parent.usage.model_copy(update={"turns": parent.budget.max_turns - 5})

    result = await kernel.syscalls.call(
        planner,
        "proc_spawn",
        {"program": "scout", "task": "x", "budget": {"max_turns": 1000}},
    )

    assert kernel.procs.get(result["pid"]).budget.max_turns == 5


async def test_a_default_child_budget_is_bounded_too(parked):
    kernel, _run_id, planner = parked
    parent = kernel.procs.get(planner)
    parent.budget = BudgetSpec(max_turns=4, max_seconds=100, max_output_tokens=100)

    result = await kernel.syscalls.call(planner, "proc_spawn", {"program": "scout", "task": "x"})

    child = kernel.procs.get(result["pid"]).budget
    assert (child.max_turns, child.max_seconds, child.max_output_tokens) == (4, 100, 100)


async def test_a_parent_without_budget_left_cannot_spawn(parked):
    kernel, _run_id, planner = parked
    parent = kernel.procs.get(planner)
    parent.usage = parent.usage.model_copy(update={"turns": parent.budget.max_turns})

    with pytest.raises(SyscallError, match="no turns left"):
        await kernel.syscalls.call(planner, "proc_spawn", {"program": "scout", "task": "x"})


async def test_killing_a_parent_kills_its_live_children(parked):
    kernel, _run_id, planner = parked
    result = await kernel.syscalls.call(planner, "proc_spawn", {"program": "scout", "task": "x"})
    child = kernel.procs.get(result["pid"])

    await kernel.kill(planner)

    assert not child.alive


def test_no_program_holds_a_shell_tool():
    from hugin.programs.loader import load_programs

    for program in load_programs().values():
        assert not any(tool.startswith("Bash") for tool in program.tools), program.name
