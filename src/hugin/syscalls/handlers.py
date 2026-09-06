"""The seven syscall handlers: everything an agent can make the kernel do.

Each handler takes the kernel, the calling pid and already-validated arguments, does one thing
and returns a plain dict. Anything the caller got wrong — a pid from another run, a name that
would escape the artifact directory, a program it may not spawn — becomes a `SyscallError`
whose message is written for the agent that has to read it, not for a log grep.
"""

import re
from typing import TYPE_CHECKING

from pydantic import ValidationError

from hugin.drivers.base import SyscallError
from hugin.kernel.events import BudgetSpec, EventKind
from hugin.kernel.process import AgentProcess

if TYPE_CHECKING:  # pragma: no cover - import cycle guard, the kernel calls these
    from hugin.kernel.kernel import Kernel

# A file name, nothing else: no separators, no traversal, and short enough to display.
ARTIFACT_NAME = re.compile(r"[A-Za-z0-9._-]{1,64}")
ALL_CHILDREN = "children"


async def munin_search(kernel: "Kernel", pid: int, args: dict) -> dict:
    proc = kernel.procs.get(pid)
    hits = kernel.syscalls.munin.search(args["query"], args["limit"])
    await kernel.emit(
        EventKind.MUNIN_READ,
        run_id=proc.run_id,
        pid=pid,
        data={"query": args["query"], "hits": len(hits)},
    )
    return {
        "hits": [
            {
                "id": memory.id,
                "title": memory.title,
                "body": memory.body,
                "tags": memory.tags,
                "program": memory.program,
            }
            for memory in hits
        ]
    }


async def munin_write(kernel: "Kernel", pid: int, args: dict) -> dict:
    proc = kernel.procs.get(pid)
    memory = kernel.syscalls.munin.write(
        args["title"],
        args["body"],
        args.get("tags", []),
        run_id=proc.run_id,
        pid=pid,
        program=proc.program,
        ts=kernel.clock(),
    )
    await kernel.emit(
        EventKind.MUNIN_WRITE,
        run_id=proc.run_id,
        pid=pid,
        data={"memory_id": memory.id, "title": memory.title},
    )
    return {"id": memory.id}


async def proc_spawn(kernel: "Kernel", pid: int, args: dict) -> dict:
    proc = kernel.procs.get(pid)
    program = args["program"]
    if program == "planner":
        raise SyscallError(
            "proc_spawn: a run has exactly one planner — spawn a worker program instead"
        )
    try:
        budget = BudgetSpec.model_validate(args["budget"]) if "budget" in args else None
    except ValidationError as err:
        raise SyscallError(
            "proc_spawn: budget takes positive max_turns, max_seconds and max_output_tokens only"
        ) from err
    try:
        # The child inherits the caller's driver, not the program's default: one mission runs
        # on one driver, so a SIMULATION planner never spawns a live `claude` worker.
        child = await kernel.spawn(
            proc.run_id, program, args["task"], ppid=pid, driver=proc.driver, budget=budget
        )
    except ValueError as err:
        raise SyscallError(f"proc_spawn: {err}") from err
    return {"pid": child}


async def proc_send(kernel: "Kernel", pid: int, args: dict) -> dict:
    proc = kernel.procs.get(pid)
    to_pid = args["to_pid"]
    _in_same_run(kernel, proc, to_pid, "proc_send")
    await kernel.send(pid, to_pid, args["text"])
    return {"delivered": True}


async def proc_wait(kernel: "Kernel", pid: int, args: dict) -> dict:
    """Block until those processes have exited, then hand back their final reports.

    `pids` may be the literal string `"children"`, meaning every live child of the caller. A
    planner that just spawned its workers means exactly that, and a static simulation script
    cannot name pids it will only learn at runtime.
    """
    proc = kernel.procs.get(pid)
    requested = args["pids"]
    if requested == ALL_CHILDREN or requested == [ALL_CHILDREN]:
        pids = [child.pid for child in kernel.procs.children(pid) if child.alive]
    else:
        pids = [_in_same_run(kernel, proc, target, "proc_wait").pid for target in requested]
    if not pids:
        return {"results": []}
    await kernel.set_state(pid, "waiting_tool")
    try:
        results = await kernel.wait(pid, pids, args["timeout_s"])
    finally:
        # A process killed while it waited is already terminal; only a live one goes back.
        if proc.alive:
            await kernel.set_state(pid, "running")
    return {"results": results}


async def mission_report(kernel: "Kernel", pid: int, args: dict) -> dict:
    proc = kernel.procs.get(pid)
    proc.report = args["summary"]
    if proc.ppid is not None:
        await kernel.send(pid, proc.ppid, args["summary"])
    return {"ok": True}


async def artifact_write(kernel: "Kernel", pid: int, args: dict) -> dict:
    proc = kernel.procs.get(pid)
    run = kernel.runs.get(proc.run_id)
    if run is None or run.root_pid != pid:
        raise SyscallError("single-writer: only the root process may write artifacts")
    name = args.get("name") or "report.md"
    if ".." in name or ARTIFACT_NAME.fullmatch(name) is None:
        raise SyscallError(
            f"artifact_write: invalid name {name!r} — 1 to 64 characters of A-Z a-z 0-9 . _ -,"
            " and no path separators"
        )
    directory = kernel.settings.runs_dir / proc.run_id / "artifacts"
    directory.mkdir(parents=True, exist_ok=True)
    content = args["content"].encode("utf-8")
    (directory / name).write_bytes(content)
    await kernel.emit(
        EventKind.ARTIFACT_WRITTEN,
        run_id=proc.run_id,
        pid=pid,
        data={"name": name, "bytes": len(content)},
    )
    return {"path": f"artifacts/{name}", "bytes": len(content)}


def _in_same_run(
    kernel: "Kernel", caller: AgentProcess, target: int, syscall: str
) -> AgentProcess:
    """A pid an agent passed is only addressable if it exists and belongs to the same run."""
    if target == caller.pid:
        raise SyscallError(f"{syscall}: a process cannot address itself")
    try:
        other = kernel.procs.get(target)
    except KeyError:
        raise SyscallError(f"{syscall}: no process with pid {target}") from None
    if other.run_id != caller.run_id:
        raise SyscallError(f"{syscall}: pid {target} belongs to another run")
    return other
