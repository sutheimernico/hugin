"""The binding driver contract: what a driver may emit, and how the kernel runs it.

Drivers translate their own world (a JSON script, a `claude -p` subprocess, an Ollama chat
loop) into kernel events by calling an `EventSink`. A driver never touches the process table,
the scheduler or the event log — the sink is its only way out. Both protocols are structural,
so a driver just implements the methods; it does not inherit from anything here.
"""

from dataclasses import dataclass
from typing import Protocol

from hugin.kernel.events import ProcState, Usage
from hugin.kernel.process import AgentProcess


class SyscallError(Exception):
    """Raised by `EventSink.syscall` when the kernel refuses or fails a syscall."""


class EventSink(Protocol):
    async def text(self, delta: str) -> None: ...

    async def thinking(self, on: bool) -> None: ...

    async def state(self, state: ProcState) -> None:  # running / waiting_tool only
        ...

    async def tool_call(self, call_id: str, tool: str, input_summary: str) -> None: ...

    async def tool_result(self, call_id: str, ok: bool, output_summary: str, ms: int) -> None: ...

    async def usage(self, usage: Usage) -> None:  # cumulative
        ...

    async def syscall(self, name: str, args: dict) -> dict:  # raises SyscallError
        ...


@dataclass
class ExitInfo:
    reason: str  # "done" | "failed" | "driver_error" | "killed"
    usage: Usage
    stderr_tail: str | None = None


class AgentDriver(Protocol):
    name: str

    async def run(self, proc: AgentProcess, prompt: str, sink: EventSink) -> ExitInfo: ...

    async def kill(self, proc: AgentProcess) -> None: ...
