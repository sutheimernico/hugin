"""The deterministic driver: replays a JSON script of ops through the sink.

This is what tests and SIMULATION mode run on. It is the only driver with no clock, no
network and no subprocess of its own — `clock_sleep` is injected so scripted pacing looks
real in the UI but costs nothing in tests.
"""

import asyncio
import json
from collections.abc import Awaitable, Callable
from pathlib import Path

from hugin.drivers.base import EventSink, ExitInfo, SyscallError
from hugin.kernel.events import Usage
from hugin.kernel.process import AgentProcess

DEFAULT_SCRIPTS_DIR = Path(__file__).parent / "scripts"
TASK_SCRIPT_PREFIX = "script:"


class ScriptedDriver:
    """Runs `scripts/<program>.json`, or `scripts/<name>.json` for a `script:<name>` task."""

    name = "scripted"

    def __init__(
        self,
        scripts_dir: Path | None = None,
        clock_sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._scripts_dir = scripts_dir or DEFAULT_SCRIPTS_DIR
        self._clock_sleep = clock_sleep
        self._killed: set[int] = set()

    async def run(self, proc: AgentProcess, prompt: str, sink: EventSink) -> ExitInfo:
        # The prompt is deliberately ignored: a scripted run must be reproducible.
        ops = json.loads(self._script_path(proc).read_text(encoding="utf-8"))
        usage = Usage()
        for op in ops:
            if proc.pid in self._killed:
                return ExitInfo("killed", usage)
            delay_ms = op.get("delay_ms", 0)
            if delay_ms:
                await self._clock_sleep(delay_ms / 1000)
            kind = op.get("op")
            match kind:
                case "text":
                    await sink.text(op["delta"])
                case "thinking":
                    await sink.thinking(op["on"])
                case "tool_call":
                    await sink.tool_call(op["call_id"], op["tool"], op["input_summary"])
                case "tool_result":
                    await sink.tool_result(
                        op["call_id"], op["ok"], op["output_summary"], op["ms"]
                    )
                case "usage":
                    usage = Usage(
                        turns=op["turns"],
                        input_tokens=op["input_tokens"],
                        output_tokens=op["output_tokens"],
                    )
                    await sink.usage(usage)
                case "syscall":
                    # Scripted syscalls run for real through the kernel; only the error path
                    # is scripted, because a refused syscall is what a script wants to assert.
                    try:
                        await sink.syscall(op["name"], op.get("args", {}))
                    except SyscallError as err:
                        if not op.get("expect_error", False):
                            return ExitInfo("failed", usage, stderr_tail=str(err))
                case "exit":
                    return ExitInfo(op.get("reason", "done"), usage)
                case _:
                    return ExitInfo("driver_error", usage, stderr_tail=f"unknown op: {kind!r}")
        return ExitInfo("done", usage)

    async def kill(self, proc: AgentProcess) -> None:
        self._killed.add(proc.pid)

    def _script_path(self, proc: AgentProcess) -> Path:
        task = proc.task or ""
        name = (
            task[len(TASK_SCRIPT_PREFIX) :].strip()
            if task.startswith(TASK_SCRIPT_PREFIX)
            else proc.program
        )
        return self._scripts_dir / f"{name}.json"
