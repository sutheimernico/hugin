"""The driver's only way into the kernel: every sink call becomes an event or a syscall.

A driver holds a sink for exactly one process, so the sink carries the pid and never takes
one as an argument — a driver cannot speak for a process that is not its own.
"""

from typing import TYPE_CHECKING

from hugin.drivers.base import EventSink, SyscallError
from hugin.kernel.events import EventKind, ProcState, Usage

if TYPE_CHECKING:  # pragma: no cover - import cycle guard, the kernel imports this module
    from hugin.kernel.kernel import Kernel


class ProcessSink(EventSink):
    def __init__(self, kernel: "Kernel", pid: int):
        self._kernel = kernel
        self._pid = pid
        self._run_id = kernel.procs.get(pid).run_id

    async def _emit(self, kind: EventKind, data: dict) -> None:
        await self._kernel.emit(kind, run_id=self._run_id, pid=self._pid, data=data)

    async def text(self, delta: str) -> None:
        await self._emit(EventKind.PROC_TEXT, {"delta": delta})

    async def thinking(self, on: bool) -> None:
        await self._emit(EventKind.PROC_THINKING, {"on": on})

    async def state(self, state: ProcState) -> None:
        await self._kernel.set_state(self._pid, state)

    async def tool_call(self, call_id: str, tool: str, input_summary: str) -> None:
        await self._emit(
            EventKind.TOOL_CALL,
            {"call_id": call_id, "tool": tool, "input_summary": input_summary},
        )

    async def tool_result(self, call_id: str, ok: bool, output_summary: str, ms: int) -> None:
        await self._emit(
            EventKind.TOOL_RESULT,
            {"call_id": call_id, "ok": ok, "output_summary": output_summary, "ms": ms},
        )

    async def usage(self, usage: Usage) -> None:
        await self._kernel.report_usage(self._pid, usage)

    async def syscall(self, name: str, args: dict) -> dict:
        registry = self._kernel.syscalls
        if registry is None:
            raise SyscallError("no syscalls")
        return await registry.call(self._pid, name, args)
