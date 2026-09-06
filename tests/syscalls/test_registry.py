"""Syscalls: capability gating, schema validation, the seven handlers and the simulation.

Most tests run on a kernel whose scheduler starts nothing (`limits={"scripted": 0}`), so the
processes exist and hold their capabilities while no driver runs interference. The last test
is the opposite: the whole simulation, driven by the real scripts.
"""

import asyncio
import time

import pytest

from hugin.drivers.base import SyscallError
from hugin.kernel.events import EventKind

HELLO = "script:hello"


def _of_kind(kernel, kind: EventKind) -> list:
    return [event for event in kernel.collected if event.kind == kind]


async def _running(kernel, pid: int) -> None:
    """A syscall always reaches the kernel from a running process; a parked one is queued."""
    await kernel.set_state(pid, "spawning")
    await kernel.set_state(pid, "running")


@pytest.fixture
async def parked(make_kernel):
    """A kernel plus a run whose processes stay queued: `(kernel, run_id, spawn)`."""
    kernel = await make_kernel(limits={"scripted": 0})
    run_id = await kernel.create_run("Syscalls", driver="scripted")

    async def _spawn(program: str, ppid: int | None = None) -> int:
        return await kernel.spawn(run_id, program, HELLO, driver="scripted", ppid=ppid)

    return kernel, run_id, _spawn


# --- registry --------------------------------------------------------------------------


async def test_defs_and_tool_schemas_are_filtered_by_capability(parked):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")
    scout = await spawn("scout", ppid=planner)

    assert [d.name for d in kernel.syscalls.defs_for(planner)] == [
        "munin_search",
        "munin_write",
        "proc_spawn",
        "proc_send",
        "proc_wait",
        "artifact_write",
    ]
    assert [d.name for d in kernel.syscalls.defs_for(scout)] == [
        "munin_search",
        "munin_write",
        "mission_report",
    ]
    schemas = kernel.syscalls.tool_schemas(scout)
    assert [set(schema) for schema in schemas] == [{"name", "description", "input_schema"}] * 3
    assert schemas[0]["input_schema"]["properties"]["query"]["type"] == "string"
    assert schemas[0]["description"]


async def test_unknown_syscall_is_refused(parked):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")
    with pytest.raises(SyscallError, match="unknown syscall"):
        await kernel.syscalls.call(planner, "rm_rf", {})
    assert _of_kind(kernel, EventKind.SYS_RESULT)[-1].data["ok"] is False


async def test_a_missing_capability_is_refused_and_recorded(parked):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")
    scout = await spawn("scout", ppid=planner)

    with pytest.raises(SyscallError, match="proc.spawn"):
        await kernel.syscalls.call(scout, "proc_spawn", {"program": "judge", "task": "prüfen"})

    call = _of_kind(kernel, EventKind.SYS_CALL)[-1]
    result = _of_kind(kernel, EventKind.SYS_RESULT)[-1]
    assert (call.pid, call.data["syscall"]) == (scout, "proc_spawn")
    assert result.data["call_id"] == call.data["call_id"]
    assert result.data["ok"] is False
    assert "scout" in result.data["result_summary"]
    assert kernel.procs.get(planner).ppid is None  # nothing was spawned


async def test_a_successful_call_is_bracketed_by_sys_call_and_sys_result(parked):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")

    await kernel.syscalls.call(planner, "munin_search", {"query": "agentische Systeme"})

    call = _of_kind(kernel, EventKind.SYS_CALL)[-1]
    result = _of_kind(kernel, EventKind.SYS_RESULT)[-1]
    assert call.data["syscall"] == "munin_search"
    assert "agentische Systeme" in call.data["args_summary"]
    assert result.data["ok"] is True and result.data["ms"] >= 0
    assert call.seq < result.seq


@pytest.mark.parametrize(
    ("name", "args", "match"),
    [
        ("munin_write", {"title": "T"}, "missing required argument 'body'"),
        ("munin_search", {"query": "x", "limit": 99}, "at most 20"),
        ("munin_search", {"query": 5}, "expected string"),
        ("munin_search", {"query": "x", "tiefe": 2}, "unknown argument"),
        ("munin_write", {"title": "T", "body": "B", "tags": [1]}, "expected string"),
        ("proc_wait", {"pids": "alle"}, "does not match"),
    ],
)
async def test_schema_violations_are_refused(parked, name, args, match):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")
    with pytest.raises(SyscallError, match=match):
        await kernel.syscalls.call(planner, name, args)
    assert _of_kind(kernel, EventKind.SYS_RESULT)[-1].data["ok"] is False


# --- munin -----------------------------------------------------------------------------


async def test_munin_write_then_search_carries_provenance(parked):
    kernel, run_id, spawn = parked
    planner = await spawn("planner")
    scout = await spawn("scout", ppid=planner)

    written = await kernel.syscalls.call(
        scout,
        "munin_write",
        {
            "title": "Lokale Modelle brauchen Quantisierung",
            "body": "Ein 7B-Modell passt in 8 GB VRAM erst als 4-Bit-Quantisierung.",
            "tags": ["ollama", "vram"],
        },
    )
    memory = kernel.syscalls.munin.get(written["id"])
    assert (memory.run_id, memory.pid, memory.program) == (run_id, scout, "scout")
    assert memory.tags == ["ollama", "vram"]
    assert _of_kind(kernel, EventKind.MUNIN_WRITE)[-1].data["memory_id"] == written["id"]

    found = await kernel.syscalls.call(planner, "munin_search", {"query": "Quantisierung"})
    assert [hit["id"] for hit in found["hits"]] == [written["id"]]
    assert found["hits"][0]["program"] == "scout"
    assert _of_kind(kernel, EventKind.MUNIN_READ)[-1].data == {
        "query": "Quantisierung",
        "hits": 1,
    }


# --- processes -------------------------------------------------------------------------


async def test_proc_spawn_creates_a_child_with_ppid_and_the_callers_driver(parked):
    kernel, run_id, spawn = parked
    planner = await spawn("planner")

    result = await kernel.syscalls.call(
        planner, "proc_spawn", {"program": "scout", "task": "Recherchiere Ollama-Modelle."}
    )
    child = kernel.procs.get(result["pid"])
    assert (child.ppid, child.run_id, child.program) == (planner, run_id, "scout")
    # The program's own default driver is `claude`; a child inherits the caller's instead.
    assert (child.driver, kernel.programs["scout"].driver) == ("scripted", "claude")
    assert _of_kind(kernel, EventKind.PROC_SPAWNED)[-1].data["task"].startswith("Recherchiere")


async def test_proc_spawn_applies_a_partial_budget_and_defaults_the_rest(parked):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")

    result = await kernel.syscalls.call(
        planner,
        "proc_spawn",
        {"program": "scout", "task": "Recherchiere kurz.", "budget": {"max_turns": 3}},
    )
    budget = kernel.procs.get(result["pid"]).budget
    assert budget.max_turns == 3
    # The caller named one limit; the other two are the model's defaults, not the program's.
    assert (budget.max_seconds, budget.max_output_tokens) == (300, 6000)


@pytest.mark.parametrize("budget", [{"max_turns": 0}, {"max_turns": "x"}])
async def test_proc_spawn_refuses_an_invalid_budget(parked, budget):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")

    with pytest.raises(SyscallError, match="budget"):
        await kernel.syscalls.call(
            planner, "proc_spawn", {"program": "scout", "task": "egal", "budget": budget}
        )
    assert kernel.procs.children(planner) == []
    assert _of_kind(kernel, EventKind.SYS_RESULT)[-1].data["ok"] is False


async def test_proc_spawn_refuses_a_second_planner(parked):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")
    with pytest.raises(SyscallError, match="planner"):
        await kernel.syscalls.call(
            planner, "proc_spawn", {"program": "planner", "task": "plane weiter"}
        )
    assert kernel.procs.children(planner) == []


async def test_proc_spawn_reports_an_unknown_program_as_a_syscall_error(parked):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")
    with pytest.raises(SyscallError, match="unknown program"):
        await kernel.syscalls.call(
            planner, "proc_spawn", {"program": "hacker", "task": "irgendwas"}
        )


async def test_proc_send_delivers_inside_the_run_only(parked):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")
    scout = await spawn("scout", ppid=planner)
    other_run = await kernel.create_run("Anderer Lauf", driver="scripted")
    stranger = await kernel.spawn(other_run, "scout", HELLO, driver="scripted")

    assert await kernel.syscalls.call(
        planner, "proc_send", {"to_pid": scout, "text": "Prüfe die zweite Quelle."}
    ) == {"delivered": True}
    assert [m.text for m in kernel.procs.get(scout).mailbox] == ["Prüfe die zweite Quelle."]

    with pytest.raises(SyscallError, match="another run"):
        await kernel.syscalls.call(planner, "proc_send", {"to_pid": stranger, "text": "hallo"})
    with pytest.raises(SyscallError, match="no process"):
        await kernel.syscalls.call(planner, "proc_send", {"to_pid": 999, "text": "hallo"})


async def test_proc_wait_returns_the_reports_of_the_named_pids(parked):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")
    first = await spawn("scout", ppid=planner)
    second = await spawn("scout", ppid=planner)
    kernel.procs.get(first).report = "Erste Erkenntnis"
    await kernel.kill(first)
    await kernel.kill(second)
    await _running(kernel, planner)

    result = await kernel.syscalls.call(
        planner, "proc_wait", {"pids": [first, second], "timeout_s": 5}
    )
    assert result["results"] == [
        {"pid": first, "state": "killed", "report": "Erste Erkenntnis"},
        {"pid": second, "state": "killed", "report": None},
    ]
    assert kernel.procs.get(planner).state == "running"

    with pytest.raises(SyscallError, match="cannot address itself"):
        await kernel.syscalls.call(planner, "proc_wait", {"pids": [planner]})


async def test_proc_wait_children_blocks_until_every_live_child_is_gone(parked, until):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")
    first = await spawn("scout", ppid=planner)
    second = await spawn("scout", ppid=planner)
    await _running(kernel, planner)

    waiting = asyncio.create_task(
        kernel.syscalls.call(planner, "proc_wait", {"pids": "children", "timeout_s": 5})
    )
    await until(lambda: kernel.procs.get(planner).state == "waiting_tool")
    kernel.procs.get(first).report = "A"
    kernel.procs.get(second).report = "B"
    await kernel.kill(first)
    await kernel.kill(second)

    result = await asyncio.wait_for(waiting, 2)
    assert [entry["pid"] for entry in result["results"]] == [first, second]
    assert [entry["report"] for entry in result["results"]] == ["A", "B"]
    assert kernel.procs.get(planner).state == "running"


async def test_proc_wait_without_live_children_returns_nothing(parked):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")
    await _running(kernel, planner)
    assert await kernel.syscalls.call(planner, "proc_wait", {"pids": "children"}) == {
        "results": []
    }
    assert kernel.procs.get(planner).state == "running"


async def test_mission_report_lands_in_the_parent_mailbox(parked):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")
    scout = await spawn("scout", ppid=planner)

    summary = "Drei Quellen bestätigen die Zahl, eine widerspricht ihr."
    assert await kernel.syscalls.call(scout, "mission_report", {"summary": summary}) == {
        "ok": True
    }
    assert kernel.procs.get(scout).report == summary
    mailbox = kernel.procs.get(planner).mailbox
    assert [(m.from_pid, m.text) for m in mailbox] == [(scout, summary)]
    assert _of_kind(kernel, EventKind.MSG_SENT)[-1].data["to_pid"] == planner

    # The planner orchestrates and writes the artifact; reporting is a worker's job.
    with pytest.raises(SyscallError, match="report"):
        await kernel.syscalls.call(planner, "mission_report", {"summary": "fertig"})


# --- artifacts (single writer) ----------------------------------------------------------


async def test_only_the_root_process_may_write_an_artifact(parked):
    kernel, run_id, spawn = parked
    planner = await spawn("planner")
    scout = await spawn("scout", ppid=planner)
    kernel.procs.get(scout).capabilities.add("artifact.write")

    with pytest.raises(SyscallError, match="single-writer"):
        await kernel.syscalls.call(
            scout, "artifact_write", {"name": "report.md", "content": "# Heimlich"}
        )
    assert not (kernel.settings.runs_dir / run_id / "artifacts").exists()
    assert _of_kind(kernel, EventKind.ARTIFACT_WRITTEN) == []


async def test_the_root_process_writes_the_artifact_and_announces_it(parked):
    kernel, run_id, spawn = parked
    planner = await spawn("planner")
    content = "# Briefing\n\nDrei Erkenntnisse.\n"

    result = await kernel.syscalls.call(
        planner, "artifact_write", {"name": "report.md", "content": content}
    )
    path = kernel.settings.runs_dir / run_id / "artifacts" / "report.md"
    assert path.read_text(encoding="utf-8") == content
    assert result == {"path": "artifacts/report.md", "bytes": len(content.encode("utf-8"))}
    assert _of_kind(kernel, EventKind.ARTIFACT_WRITTEN)[-1].data == {
        "name": "report.md",
        "bytes": result["bytes"],
    }


@pytest.mark.parametrize("name", ["../escape.md", "..", "sub/report.md", "a" * 65])
async def test_artifact_names_that_leave_the_directory_are_refused(parked, name):
    kernel, run_id, spawn = parked
    planner = await spawn("planner")
    with pytest.raises(SyscallError, match="name"):
        await kernel.syscalls.call(planner, "artifact_write", {"name": name, "content": "x"})
    assert not (kernel.settings.runs_dir / run_id / "artifacts").exists()


# --- the simulation ---------------------------------------------------------------------


async def test_the_simulation_runs_a_whole_mission_end_to_end(kernel, until):
    goal = "Recherche-Briefing zu lokalen KI-Agenten"
    started = time.perf_counter()
    run_id = await kernel.create_run(goal, driver="scripted")
    root = await kernel.spawn(run_id, "planner", goal, driver="scripted")
    await until(lambda: kernel.runs[run_id].state == "done", timeout=3.0)
    elapsed = time.perf_counter() - started

    procs = kernel.procs.for_run(run_id)
    assert len(procs) >= 5
    assert sorted(p.program for p in procs) == ["judge", "planner", "scout", "scout", "scout"]
    assert {p.state for p in procs} == {"done"}
    assert all(p.ppid == root for p in procs if p.pid != root)
    assert all(p.report for p in procs if p.pid != root)

    artifact = kernel.settings.runs_dir / run_id / "artifacts" / "report.md"
    assert artifact.is_file()
    assert len(artifact.read_text(encoding="utf-8").splitlines()) >= 20
    assert kernel.syscalls.munin.count() >= 3
    # Three scouts run the same script — only the task interpolation keeps their findings apart.
    scout_titles = [
        memory.title
        for memory in kernel.syscalls.munin.recent(limit=20)
        if memory.program == "scout"
    ]
    assert len(scout_titles) == 3
    assert len(set(scout_titles)) == 3
    assert all(title.startswith("Befund: ") for title in scout_titles)
    assert _of_kind(kernel, EventKind.RUN_DONE)[-1].data["artifacts"] == ["report.md"]
    assert [e.data["ok"] for e in _of_kind(kernel, EventKind.SYS_RESULT)].count(False) == 0
    assert elapsed < 3.0


async def test_proc_wait_accepts_the_children_keyword_wrapped_in_a_list(parked):
    kernel, _run_id, spawn = parked
    planner = await spawn("planner")
    kernel.procs.get(planner).transition("spawning")
    kernel.procs.get(planner).transition("running")
    args = {"pids": ["children"], "timeout_s": 5}
    result = await kernel.syscalls.call(planner, "proc_wait", args)
    assert result == {"results": []}


async def test_artifact_write_defaults_the_name_to_report_md(parked):
    kernel, run_id, spawn = parked
    planner = await spawn("planner")
    result = await kernel.syscalls.call(planner, "artifact_write", {"content": "# Bericht"})
    assert result["path"] == "artifacts/report.md"
    written = kernel.settings.runs_dir / run_id / "artifacts" / "report.md"
    assert written.read_text() == "# Bericht"
