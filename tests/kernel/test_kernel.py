"""Kernel lifecycle: spawn → schedule → run → exit, plus kill, budget, fan-out, send and wait."""

import asyncio
import json

import pytest

from hugin.drivers.base import ExitInfo
from hugin.kernel.events import BudgetSpec, EventKind, Usage
from hugin.kernel.process import AgentProcess

HELLO = "script:hello"


def _kinds(kernel, run_id: str) -> list[EventKind]:
    """Event kinds of one run, without the budget ticker's noise."""
    return [
        event.kind
        for event in kernel.collected
        if event.run_id == run_id and event.kind != EventKind.BUDGET_TICK
    ]


def _of_kind(kernel, kind: EventKind) -> list:
    return [event for event in kernel.collected if event.kind == kind]


class BoomDriver:
    """A driver that dies the way a real subprocess can: with an exception, mid-run."""

    name = "boom"

    async def run(self, proc: AgentProcess, prompt: str, sink) -> ExitInfo:
        raise RuntimeError("driver exploded")

    async def kill(self, proc: AgentProcess) -> None:
        return None


class SlowDriver:
    """A driver that stays alive until the test releases it, so the ticker has time to tick."""

    name = "slow"

    def __init__(self) -> None:
        self.release = asyncio.Event()

    async def run(self, proc: AgentProcess, prompt: str, sink) -> ExitInfo:
        usage = Usage(turns=1, input_tokens=10, output_tokens=10)
        await sink.usage(usage)
        await self.release.wait()
        return ExitInfo("done", usage)

    async def kill(self, proc: AgentProcess) -> None:
        self.release.set()


class TwiceOverBudgetDriver:
    """Reports the same over-budget usage twice before the kill flag reaches it."""

    name = "twice"

    def __init__(self) -> None:
        self.killed = asyncio.Event()

    async def run(self, proc: AgentProcess, prompt: str, sink) -> ExitInfo:
        usage = Usage(turns=5, input_tokens=10, output_tokens=10)
        await sink.usage(usage)
        await sink.usage(usage)
        await self.killed.wait()
        return ExitInfo("killed", usage)

    async def kill(self, proc: AgentProcess) -> None:
        self.killed.set()


async def test_boot_emits_the_kernel_boot_event(kernel):
    boot = _of_kind(kernel, EventKind.KERNEL_BOOT)
    assert len(boot) == 1
    assert boot[0].data == {"version": kernel.version, "pid_counter": 1}
    assert kernel.settings.runs_dir.is_dir()


async def test_spawn_runs_a_scripted_program_end_to_end(kernel, until):
    run_id = await kernel.create_run("Testlauf", driver="scripted")
    pid = await kernel.spawn(run_id, "scout", HELLO, driver="scripted")
    await until(lambda: kernel.runs[run_id].state == "done")

    assert _kinds(kernel, run_id) == [
        EventKind.RUN_CREATED,
        EventKind.PROC_SPAWNED,
        EventKind.SCHED_STARTED,
        EventKind.PROC_STATE,
        EventKind.PROC_STATE,
        EventKind.PROC_TEXT,
        EventKind.PROC_TEXT,
        EventKind.PROC_EXIT,
        EventKind.PROC_STATE,
        EventKind.RUN_DONE,
    ]
    assert [e.data["state"] for e in _of_kind(kernel, EventKind.PROC_STATE)] == [
        "spawning",
        "running",
        "done",
    ]
    proc = kernel.procs.get(pid)
    assert (proc.state, proc.exit_reason) == ("done", "done")
    assert proc.usage == Usage(turns=1, input_tokens=800, output_tokens=120)
    assert proc.cwd.is_dir() and proc.cwd.name == f"p{pid}"
    done = _of_kind(kernel, EventKind.RUN_DONE)[0]
    assert done.data["usage"]["output_tokens"] == 120
    assert done.data["artifacts"] == []


async def test_run_ids_are_unique_and_sort_by_creation_time(kernel):
    ids = [await kernel.create_run(f"Lauf {n}", driver="scripted") for n in range(5)]
    assert len(set(ids)) == 5
    assert all(len(run_id) == 12 for run_id in ids)
    assert ids == sorted(ids)


async def test_system_prompt_carries_the_contract_and_the_pid(kernel):
    run_id = await kernel.create_run("Prompt", driver="scripted")
    pid = await kernel.spawn(run_id, "scout", HELLO, driver="scripted")
    prompt = kernel.system_prompt_for(pid)
    assert "You are a research worker" in prompt
    assert f"You are process `{pid}`" in prompt
    assert "{pid}" not in prompt


async def test_second_process_waits_for_the_driver_slot(make_kernel, until):
    kernel = await make_kernel(limits={"scripted": 1})
    run_a = await kernel.create_run("A", driver="scripted")
    run_b = await kernel.create_run("B", driver="scripted")
    pid_a = await kernel.spawn(run_a, "scout", HELLO, driver="scripted")
    pid_b = await kernel.spawn(run_b, "scout", HELLO, driver="scripted")

    blocked = _of_kind(kernel, EventKind.SCHED_BLOCKED)
    assert [e.pid for e in blocked] == [pid_b]
    assert blocked[0].data["limit"] == 1
    assert kernel.procs.get(pid_b).state == "queued"

    await until(lambda: kernel.runs[run_b].state == "done")
    assert [e.pid for e in _of_kind(kernel, EventKind.SCHED_STARTED)] == [pid_a, pid_b]
    exit_a = next(e.seq for e in _of_kind(kernel, EventKind.PROC_EXIT) if e.pid == pid_a)
    start_b = next(e.seq for e in _of_kind(kernel, EventKind.SCHED_STARTED) if e.pid == pid_b)
    assert start_b > exit_a
    # Blocking is announced once, not on every pump.
    assert len(_of_kind(kernel, EventKind.SCHED_BLOCKED)) == 1


async def test_killing_a_queued_process_never_runs_it(make_kernel):
    kernel = await make_kernel(limits={"scripted": 1})
    run_id = await kernel.create_run("Kill", driver="scripted")
    # No await between these calls yields to the event loop, so the first process still holds
    # the only slot when the second one is killed: the kill hits a process that never started.
    await kernel.spawn(run_id, "scout", HELLO, driver="scripted")
    queued = await kernel.spawn(run_id, "scout", HELLO, driver="scripted")
    await kernel.kill(queued)

    proc = kernel.procs.get(queued)
    assert (proc.state, proc.exit_reason, proc.started_at) == ("killed", "killed", None)
    states = [
        e.data["state"] for e in _of_kind(kernel, EventKind.PROC_STATE) if e.pid == queued
    ]
    assert states == ["killed"]
    assert [e.data["target"] for e in _of_kind(kernel, EventKind.KILL)] == [queued]
    assert [e.pid for e in _of_kind(kernel, EventKind.PROC_EXIT)] == [queued]


async def test_kill_all_announces_once_and_stops_every_live_process(kernel, until):
    run_id = await kernel.create_run("Alles", driver="scripted")
    pid_a = await kernel.spawn(run_id, "planner", HELLO, driver="scripted")
    pid_b = await kernel.spawn(run_id, "scout", HELLO, driver="scripted", ppid=pid_a)
    await kernel.kill_all(by="user")
    await until(lambda: not kernel.procs.alive())

    kills = _of_kind(kernel, EventKind.KILL)
    assert [e.data["target"] for e in kills] == ["all", pid_a, pid_b]
    assert all(e.data["by"] == "user" for e in kills)
    assert {p.state for p in kernel.procs.for_run(run_id)} == {"killed"}
    assert kernel.runs[run_id].state == "failed"


async def test_budget_breach_kills_the_process(make_kernel, tmp_path, until):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    (scripts / "burn.json").write_text(
        json.dumps(
            [
                {"op": "usage", "turns": 2, "input_tokens": 10, "output_tokens": 20},
                {"op": "text", "delta": "noch mehr"},
                {"op": "exit", "reason": "done"},
            ]
        ),
        encoding="utf-8",
    )
    kernel = await make_kernel(scripts_dir=scripts)
    run_id = await kernel.create_run("Budget", driver="scripted")
    pid = await kernel.spawn(
        run_id, "scout", "script:burn", driver="scripted", budget=BudgetSpec(max_turns=1)
    )
    await until(lambda: not kernel.procs.get(pid).alive)

    proc = kernel.procs.get(pid)
    assert (proc.state, proc.exit_reason) == ("killed", "budget:turns")
    exceeded = _of_kind(kernel, EventKind.BUDGET_EXCEEDED)
    assert [e.data["which"] for e in exceeded] == ["turns"]
    assert [e.data["by"] for e in _of_kind(kernel, EventKind.KILL)] == ["budget:turns"]
    assert _of_kind(kernel, EventKind.PROC_EXIT)[0].data["reason"] == "budget:turns"
    assert kernel.runs[run_id].state == "failed"


async def test_one_breach_seen_twice_is_killed_once(kernel, until):
    driver = TwiceOverBudgetDriver()
    kernel.drivers["twice"] = driver
    run_id = await kernel.create_run("Doppelt", driver="twice")
    pid = await kernel.spawn(
        run_id, "scout", "egal", driver="twice", budget=BudgetSpec(max_turns=1)
    )
    await until(lambda: not kernel.procs.get(pid).alive)

    assert [e.pid for e in _of_kind(kernel, EventKind.BUDGET_EXCEEDED)] == [pid]
    assert [e.data["target"] for e in _of_kind(kernel, EventKind.KILL)] == [pid]
    assert kernel.procs.get(pid).exit_reason == "budget:turns"


async def test_budget_ticker_reports_progress(kernel, until):
    slow = SlowDriver()
    kernel.drivers["slow"] = slow
    run_id = await kernel.create_run("Ticker", driver="slow")
    pid = await kernel.spawn(run_id, "scout", "warte", driver="slow")
    await until(lambda: bool(_of_kind(kernel, EventKind.BUDGET_TICK)))

    tick = _of_kind(kernel, EventKind.BUDGET_TICK)[0]
    assert tick.pid == pid
    assert tick.data["turns"] == 1
    assert 0.0 < tick.data["pct"] < 1.0

    slow.release.set()
    await until(lambda: not kernel.procs.get(pid).alive)
    assert kernel.procs.get(pid).state == "done"


async def test_fan_out_limit_rejects_the_fifth_child(kernel):
    run_id = await kernel.create_run("Fan-out", driver="scripted")
    parent = await kernel.spawn(run_id, "planner", HELLO, driver="scripted")
    for _ in range(4):
        await kernel.spawn(run_id, "scout", HELLO, driver="scripted", ppid=parent)
    with pytest.raises(ValueError, match="fan-out limit"):
        await kernel.spawn(run_id, "scout", HELLO, driver="scripted", ppid=parent)


async def test_send_delivers_to_the_mailbox_with_a_short_preview(kernel):
    run_id = await kernel.create_run("Post", driver="scripted")
    parent = await kernel.spawn(run_id, "planner", HELLO, driver="scripted")
    child = await kernel.spawn(run_id, "scout", HELLO, driver="scripted", ppid=parent)
    text = "Bitte prüfe die zweite Quelle noch einmal, sie widerspricht der ersten. " * 3
    await kernel.send(parent, child, text)

    mailbox = kernel.procs.get(child).mailbox
    assert len(mailbox) == 1
    assert mailbox[0].text == text and mailbox[0].from_pid == parent
    sent = _of_kind(kernel, EventKind.MSG_SENT)[0]
    assert sent.data["from_pid"] == parent and sent.data["to_pid"] == child
    assert 0 < len(sent.data["preview"]) <= 80
    assert text.startswith(sent.data["preview"])


async def test_wait_returns_the_child_reports(kernel):
    run_id = await kernel.create_run("Warten", driver="scripted")
    parent = await kernel.spawn(run_id, "planner", HELLO, driver="scripted")
    first = await kernel.spawn(run_id, "scout", HELLO, driver="scripted", ppid=parent)
    second = await kernel.spawn(run_id, "scout", HELLO, driver="scripted", ppid=parent)
    kernel.procs.get(first).report = "fertig"

    results = await kernel.wait(parent, [first, second], timeout_s=2.0)
    assert results == [
        {"pid": first, "state": "done", "report": "fertig"},
        {"pid": second, "state": "done", "report": None},
    ]


async def test_wait_times_out_with_the_current_states(make_kernel):
    kernel = await make_kernel(limits={"scripted": 0})
    run_id = await kernel.create_run("Blockiert", driver="scripted")
    parent = await kernel.spawn(run_id, "planner", HELLO, driver="scripted")
    child = await kernel.spawn(run_id, "scout", HELLO, driver="scripted", ppid=parent)

    results = await kernel.wait(parent, [child], timeout_s=0.05)
    assert results == [{"pid": child, "state": "queued", "report": None}]


async def test_wait_refuses_to_wait_for_itself(kernel):
    run_id = await kernel.create_run("Selbst", driver="scripted")
    pid = await kernel.spawn(run_id, "planner", HELLO, driver="scripted")
    with pytest.raises(ValueError, match="itself"):
        await kernel.wait(pid, [pid], timeout_s=0.01)


async def test_unknown_program_is_rejected(kernel):
    run_id = await kernel.create_run("X", driver="scripted")
    with pytest.raises(ValueError, match="unknown program"):
        await kernel.spawn(run_id, "does-not-exist", "task", driver="scripted")


async def test_unknown_driver_is_rejected(kernel):
    run_id = await kernel.create_run("X", driver="scripted")
    with pytest.raises(ValueError, match="unknown driver"):
        await kernel.spawn(run_id, "scout", "task", driver="nope")


async def test_driver_exception_fails_the_process_and_the_run(kernel, until, caplog):
    kernel.drivers["boom"] = BoomDriver()
    run_id = await kernel.create_run("Absturz", driver="boom")
    pid = await kernel.spawn(run_id, "scout", "egal", driver="boom")
    await until(lambda: kernel.runs[run_id].state == "failed")

    proc = kernel.procs.get(pid)
    assert (proc.state, proc.exit_reason) == ("failed", "driver_error")
    exited = _of_kind(kernel, EventKind.PROC_EXIT)[0]
    assert "driver exploded" in exited.data["stderr_tail"]
    assert _of_kind(kernel, EventKind.RUN_FAILED)[0].data["reason"] == "driver_error"
    assert "driver exploded" in caplog.text


async def test_shutdown_cancels_everything(make_kernel):
    kernel = await make_kernel(limits={"scripted": 1})
    run_id = await kernel.create_run("Ende", driver="scripted")
    await kernel.spawn(run_id, "planner", HELLO, driver="scripted")
    await kernel.spawn(run_id, "scout", HELLO, driver="scripted")
    await kernel.shutdown()
    assert kernel.procs.alive() == []
