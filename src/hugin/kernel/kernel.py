"""The kernel façade: the one object that starts, meters and stops agent processes.

Every state change goes through here and becomes an event before it becomes visible, so the
UI, the replay and a later audit all read the same story. Drivers reach the kernel only
through `ProcessSink`; the API, missions and syscalls only through the methods below.
"""

import asyncio
import contextlib
import hmac
import logging
import secrets
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from hugin.drivers.base import AgentDriver, ExitInfo
from hugin.kernel.budget import BudgetWatcher
from hugin.kernel.bus import EventBus
from hugin.kernel.events import BudgetSpec, Event, EventKind, ProcState, Usage, make_event
from hugin.kernel.log import EventLog
from hugin.kernel.process import AgentProcess, Message, ProcessTable
from hugin.kernel.scheduler import Scheduler
from hugin.kernel.sink import ProcessSink
from hugin.munin.store import MuninStore
from hugin.programs.loader import Program, full_system_prompt
from hugin.settings import Settings
from hugin.syscalls.registry import SyscallRegistry

logger = logging.getLogger(__name__)

FAN_OUT_LIMIT = 4
RUN_ID_LENGTH = 12
TOKEN_BYTES = 16  # 32 hex characters
_WAIT_POLL_S = 0.02


@dataclass
class RunInfo:
    id: str
    goal: str
    driver: str
    template: str | None
    created_at: float
    done_at: float | None = None
    state: Literal["running", "done", "failed"] = "running"
    root_pid: int | None = None


def _state_for(reason: str) -> ProcState:
    """The terminal state an exit reason lands in — the kernel's only reason→state mapping."""
    if reason == "done":
        return "done"
    if reason == "killed" or reason.startswith("budget:"):
        return "killed"
    return "failed"


def _merge_usage(current: Usage, reported: Usage) -> Usage:
    """Both sides are cumulative counters, so the larger one is the truthful one."""
    return Usage(
        turns=max(current.turns, reported.turns),
        input_tokens=max(current.input_tokens, reported.input_tokens),
        output_tokens=max(current.output_tokens, reported.output_tokens),
        cost_usd_equiv=reported.cost_usd_equiv
        if reported.cost_usd_equiv is not None
        else current.cost_usd_equiv,
    )


class Kernel:
    version: str = "0.1.0"

    def __init__(
        self,
        settings: Settings,
        log: EventLog,
        bus: EventBus,
        programs: dict[str, Program],
        drivers: dict[str, AgentDriver],
        munin: MuninStore,
        clock: Callable[[], float] = time.time,
        tick_s: float = 1.0,
    ):
        self.settings = settings
        self.log = log
        self.bus = bus
        self.programs = programs
        self.drivers = drivers
        self.clock = clock
        self.procs = ProcessTable()
        self.runs: dict[str, RunInfo] = {}
        # Set by `boot()`; until then the kernel has no uptime to report, only an age.
        self.booted_at: float | None = None
        # The registry imports the kernel for type checking only, so this direction is safe.
        self.syscalls = SyscallRegistry(self, munin)
        self._scheduler = Scheduler(settings.max_concurrent)
        self._tick_s = tick_s
        self._run_stamp = ""
        self._run_seq = 0
        self._queue: deque[int] = deque()
        self._blocked: set[int] = set()
        self._tasks: dict[int, asyncio.Task] = {}
        self._budget_tasks: dict[int, asyncio.Task] = {}
        self._kill_reasons: dict[int, str] = {}
        # One pump at a time: without it two concurrent pumps could both see a free slot.
        self._pump_lock = asyncio.Lock()

    # --- lifecycle ---------------------------------------------------------------------

    async def boot(self) -> None:
        self.booted_at = self.clock()
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.settings.runs_dir.mkdir(parents=True, exist_ok=True)
        await self.emit(
            EventKind.KERNEL_BOOT,
            run_id=None,
            pid=None,
            data={"version": self.version, "pid_counter": self.procs.pid_counter},
        )

    async def shutdown(self) -> None:
        await self.kill_all(by="shutdown")
        tasks = [*self._budget_tasks.values(), *self._tasks.values()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        self._budget_tasks.clear()
        # A cancelled process never reached its own finalisation: the kernel writes the exit
        # itself, so no process is left claiming to be alive after the kernel is gone.
        for proc in self.procs.alive():
            await self._finalize(proc.pid, ExitInfo("killed", proc.usage))

    async def emit(
        self, kind: EventKind, *, run_id: str | None, pid: int | None, data: dict
    ) -> Event:
        return await self.bus.publish(
            make_event(kind, run_id=run_id, pid=pid, data=data, ts=self.clock())
        )

    # --- runs --------------------------------------------------------------------------

    async def create_run(self, goal: str, driver: str, template: str | None = None) -> str:
        run_id = self._new_run_id()
        self.runs[run_id] = RunInfo(
            id=run_id, goal=goal, driver=driver, template=template, created_at=self.clock()
        )
        await self.emit(
            EventKind.RUN_CREATED,
            run_id=run_id,
            pid=None,
            data={"goal": goal, "driver": driver, "template": template},
        )
        return run_id

    def _new_run_id(self) -> str:
        """Time-sortable: milliseconds in hex plus a counter, so ids of one millisecond
        still sort in creation order."""
        stamp = f"{int(self.clock() * 1000):x}"[-8:]
        if stamp == self._run_stamp:
            self._run_seq += 1
        else:
            self._run_stamp, self._run_seq = stamp, 0
        return f"{stamp}{self._run_seq:04x}"

    # --- processes ---------------------------------------------------------------------

    async def spawn(
        self,
        run_id: str,
        program: str,
        task: str,
        *,
        ppid: int | None = None,
        driver: str | None = None,
        budget: BudgetSpec | None = None,
    ) -> int:
        try:
            spec = self.programs[program]
        except KeyError:
            raise ValueError(f"unknown program: {program}") from None
        driver_name = driver or spec.driver
        if driver_name not in self.drivers:
            raise ValueError(f"unknown driver: {driver_name}")
        if ppid is not None:
            alive_children = [child for child in self.procs.children(ppid) if child.alive]
            if len(alive_children) >= FAN_OUT_LIMIT:
                raise ValueError(
                    f"fan-out limit: pid {ppid} already has {FAN_OUT_LIMIT} live children"
                )

        pid = self.procs.next_pid()
        cwd = self.settings.runs_dir / run_id / f"p{pid}"
        cwd.mkdir(parents=True, exist_ok=True)
        proc = AgentProcess(
            pid=pid,
            run_id=run_id,
            ppid=ppid,
            program=spec.name,
            role=spec.role,
            driver=driver_name,
            model=spec.model,
            task=task,
            cwd=cwd,
            capabilities=set(spec.capabilities),
            allowed_tools=list(spec.tools),
            budget=budget or spec.budget,
            token=secrets.token_hex(TOKEN_BYTES),
        )
        self.procs.add(proc)
        run = self.runs.get(run_id)
        if run is not None and run.root_pid is None:
            run.root_pid = pid
        await self.emit(
            EventKind.PROC_SPAWNED,
            run_id=run_id,
            pid=pid,
            data={
                "ppid": ppid,
                "program": proc.program,
                "role": proc.role,
                "driver": proc.driver,
                "model": proc.model,
                "budget": proc.budget,
                "task": task,
            },
        )
        self._queue.append(pid)
        await self._pump()
        return pid

    def token_for(self, pid: int) -> str:
        """The bearer token that identifies this process to the MCP syscall transport."""
        return self.procs.get(pid).token

    def pid_for(self, token: str) -> int | None:
        """The process a bearer token belongs to, or `None`.

        Every process is a candidate, exited ones included: an agent may still be finishing a
        syscall while the kernel already recorded its exit, and a token that stops working mid
        call would look like a kernel bug to the agent. The comparison runs over the whole
        table in constant time, so a wrong guess learns nothing from how long the answer took.
        """
        found: int | None = None
        for proc in self.procs.all():
            if proc.token and hmac.compare_digest(proc.token, token):
                found = proc.pid
        return found

    def system_prompt_for(self, pid: int) -> str:
        proc = self.procs.get(pid)
        return full_system_prompt(self.programs[proc.program]).replace("{pid}", str(pid))

    async def set_state(self, pid: int, state: ProcState) -> None:
        """The one place a process changes state — the transition is validated, then announced."""
        proc = self.procs.get(pid)
        if proc.state == state:
            return  # a driver re-announcing its current state is not a transition
        prev = proc.transition(state)
        await self.emit(
            EventKind.PROC_STATE, run_id=proc.run_id, pid=pid, data={"state": state, "prev": prev}
        )

    async def report_usage(self, pid: int, usage: Usage) -> None:
        """Usage is cumulative; every report is also a budget checkpoint."""
        proc = self.procs.get(pid)
        proc.usage = _merge_usage(proc.usage, usage)
        await self._enforce_budget(pid)

    async def send(self, from_pid: int, to_pid: int, text: str) -> None:
        proc = self.procs.get(to_pid)
        proc.mailbox.append(Message(from_pid=from_pid, text=text, ts=self.clock()))
        await self.emit(
            EventKind.MSG_SENT,
            run_id=proc.run_id,
            pid=from_pid,
            data={"from_pid": from_pid, "to_pid": to_pid, "preview": text[:80]},
        )

    async def wait(self, pid: int, child_pids: list[int], timeout_s: float) -> list[dict]:
        """Block until every child has exited, or until the timeout — then report their states."""
        if pid in child_pids:
            raise ValueError(f"pid {pid} cannot wait for itself")

        async def _all_exited() -> None:
            while any(self.procs.get(child).alive for child in child_pids):
                await asyncio.sleep(min(_WAIT_POLL_S, self._tick_s))

        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(_all_exited(), timeout_s)
        return [
            {
                "pid": child,
                "state": self.procs.get(child).state,
                "report": self.procs.get(child).report,
            }
            for child in child_pids
        ]

    async def kill(self, pid: int, by: str = "user") -> None:
        proc = self.procs.get(pid)
        if not proc.alive:
            return
        await self.emit(
            EventKind.KILL, run_id=proc.run_id, pid=pid, data={"target": pid, "by": by}
        )
        # A budget kill keeps its reason: the exit must say what ran out, not just "killed".
        self._kill_reasons[pid] = by if by.startswith("budget:") else "killed"
        if proc.state == "queued":
            # It never started, so no driver and no `_run` will ever finalise it.
            self._dequeue(pid)
            self._blocked.discard(pid)
            await self._finalize(pid, ExitInfo("killed", proc.usage))
            return
        await self.drivers[proc.driver].kill(proc)

    async def kill_all(self, by: str = "user") -> None:
        """Always available: it announces itself once and never waits on the scheduler."""
        await self.emit(EventKind.KILL, run_id=None, pid=None, data={"target": "all", "by": by})
        for proc in self.procs.alive():
            await self.kill(proc.pid, by=by)

    # --- scheduling --------------------------------------------------------------------

    def _dequeue(self, pid: int) -> None:
        """Take a pid out of the queue. `kill` and `_pump` both do it, and either may get there
        first, so the loser of that race is a no-op rather than a `ValueError`."""
        with contextlib.suppress(ValueError):
            self._queue.remove(pid)

    def _running_by_driver(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for proc in self.procs.alive():
            if proc.state != "queued":
                counts[proc.driver] = counts.get(proc.driver, 0) + 1
        return counts

    async def _pump(self) -> None:
        """Start every queued process its driver still has room for; announce the rest once."""
        async with self._pump_lock:
            counts = self._running_by_driver()
            for pid in list(self._queue):
                proc = self.procs.get(pid)
                if not proc.alive:
                    self._dequeue(pid)
                    continue
                if self._scheduler.can_start(proc.driver, counts):
                    self._dequeue(pid)
                    self._blocked.discard(pid)
                    counts[proc.driver] = counts.get(proc.driver, 0) + 1
                    await self._start(pid)
                elif pid not in self._blocked:
                    self._blocked.add(pid)
                    await self.emit(
                        EventKind.SCHED_BLOCKED,
                        run_id=proc.run_id,
                        pid=pid,
                        data={
                            "reason": f"driver {proc.driver} at concurrency limit",
                            "limit": self._scheduler.limit_for(proc.driver),
                        },
                    )

    async def _start(self, pid: int) -> None:
        proc = self.procs.get(pid)
        await self.emit(EventKind.SCHED_STARTED, run_id=proc.run_id, pid=pid, data={})
        proc.started_at = self.clock()
        await self.set_state(pid, "spawning")
        self._tasks[pid] = asyncio.create_task(self._run(pid), name=f"hugin-proc-{pid}")

    async def _run(self, pid: int) -> None:
        proc = self.procs.get(pid)
        driver = self.drivers[proc.driver]
        sink = ProcessSink(self, pid)
        await self.set_state(pid, "running")
        self._budget_tasks[pid] = asyncio.create_task(
            self._budget_loop(pid), name=f"hugin-budget-{pid}"
        )
        try:
            exit_info = await driver.run(proc, proc.task, sink)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # a driver crash is an exit reason, never a lost process
            logger.exception("driver %r failed for pid %s", proc.driver, pid)
            exit_info = ExitInfo("driver_error", proc.usage, stderr_tail=repr(exc)[:500])
        finally:
            await self._stop_budget_loop(pid)
            self._tasks.pop(pid, None)
        await self._finalize(pid, exit_info)

    async def _finalize(self, pid: int, exit_info: ExitInfo) -> None:
        proc = self.procs.get(pid)
        if not proc.alive:
            return
        reason = self._kill_reasons.pop(pid, None) or exit_info.reason
        proc.usage = _merge_usage(proc.usage, exit_info.usage)
        proc.exited_at = self.clock()
        proc.exit_reason = reason
        await self.emit(
            EventKind.PROC_EXIT,
            run_id=proc.run_id,
            pid=pid,
            data={
                "reason": reason,
                "usage": proc.usage,
                "stderr_tail": exit_info.stderr_tail,
            },
        )
        await self.set_state(pid, _state_for(reason))
        await self._pump()
        await self._close_run_if_root(proc, reason)

    async def _close_run_if_root(self, proc: AgentProcess, reason: str) -> None:
        run = self.runs.get(proc.run_id)
        if run is None or run.root_pid != proc.pid or run.state != "running":
            return
        run.done_at = self.clock()
        if reason == "done":
            run.state = "done"
            await self.emit(
                EventKind.RUN_DONE,
                run_id=run.id,
                pid=None,
                data={
                    "usage": self.run_usage(run.id),
                    "artifacts": self.artifacts(run.id),
                    "duration_s": run.done_at - run.created_at,
                },
            )
        else:
            run.state = "failed"
            await self.emit(
                EventKind.RUN_FAILED, run_id=run.id, pid=None, data={"reason": reason}
            )

    def run_usage(self, run_id: str) -> Usage:
        procs = self.procs.for_run(run_id)
        costs = [p.usage.cost_usd_equiv for p in procs if p.usage.cost_usd_equiv is not None]
        return Usage(
            turns=sum(p.usage.turns for p in procs),
            input_tokens=sum(p.usage.input_tokens for p in procs),
            output_tokens=sum(p.usage.output_tokens for p in procs),
            cost_usd_equiv=sum(costs) if costs else None,
        )

    def artifacts(self, run_id: str) -> list[str]:
        directory = self.settings.runs_dir / run_id / "artifacts"
        if not directory.is_dir():
            return []
        return sorted(path.name for path in directory.iterdir() if path.is_file())

    # --- budget ------------------------------------------------------------------------

    async def _budget_loop(self, pid: int) -> None:
        """One ticker per running process: it reports fill level and enforces the limits."""
        proc = self.procs.get(pid)
        while proc.alive:
            await asyncio.sleep(self._tick_s)
            if not proc.alive:
                return
            now = self.clock()
            elapsed = now - proc.started_at if proc.started_at is not None else 0.0
            await self.emit(
                EventKind.BUDGET_TICK,
                run_id=proc.run_id,
                pid=pid,
                data={
                    "turns": proc.usage.turns,
                    "output_tokens": proc.usage.output_tokens,
                    "seconds": elapsed,
                    "pct": BudgetWatcher.pct(proc, now),
                },
            )
            if await self._enforce_budget(pid):
                return

    async def _enforce_budget(self, pid: int) -> bool:
        """Kill the process if a limit is breached; returns whether it was."""
        proc = self.procs.get(pid)
        if not proc.alive:
            return False
        if pid in self._kill_reasons:
            # The ticker and a usage report can see the same breach before the process is gone;
            # a kill is already on its way, so this one is announced once, not once per observer.
            return True
        which = BudgetWatcher.breach(proc, self.clock())
        if which is None:
            return False
        await self.emit(
            EventKind.BUDGET_EXCEEDED, run_id=proc.run_id, pid=pid, data={"which": which}
        )
        await self.kill(pid, by=f"budget:{which}")
        return True

    async def _stop_budget_loop(self, pid: int) -> None:
        task = self._budget_tasks.pop(pid, None)
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
