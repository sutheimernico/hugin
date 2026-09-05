"""Shared fakes for driver tests: a sink that records every call instead of emitting events."""

import pytest

from hugin.drivers.base import SyscallError
from hugin.kernel.events import ProcState, Usage


class RecordingSink:
    """An `EventSink` that appends every call as a tuple, so tests assert on order."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    async def text(self, delta: str) -> None:
        self.calls.append(("text", delta))

    async def thinking(self, on: bool) -> None:
        self.calls.append(("thinking", on))

    async def state(self, state: ProcState) -> None:
        self.calls.append(("state", state))

    async def tool_call(self, call_id: str, tool: str, input_summary: str) -> None:
        self.calls.append(("tool_call", call_id, tool, input_summary))

    async def tool_result(self, call_id: str, ok: bool, output_summary: str, ms: int) -> None:
        self.calls.append(("tool_result", call_id, ok, output_summary, ms))

    async def usage(self, usage: Usage) -> None:
        self.calls.append(("usage", usage))

    async def syscall(self, name: str, args: dict) -> dict:
        self.calls.append(("syscall", name, args))
        if name == "forbidden":
            raise SyscallError("forbidden")
        return {"ok": True}

    @property
    def kinds(self) -> list[str]:
        return [call[0] for call in self.calls]


@pytest.fixture
def sink() -> RecordingSink:
    return RecordingSink()
