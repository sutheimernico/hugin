"""The syscall table: what an agent may ask the kernel to do, and under which capability.

Every syscall is declared once here — name, required capability, JSON schema, handler — so one
table answers three questions: which tools a process is offered (`tool_schemas`), whether a
call is allowed (`call`), and what its arguments must look like. Validation is hand-written
against the small schema subset the syscalls actually use; a JSON-schema library would be a
dependency for six keywords. Every call is bracketed by `sys.call` and `sys.result`, so a
refusal is as visible in the event log as a success.
"""

import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from hugin.drivers.base import SyscallError
from hugin.kernel.events import EventKind
from hugin.kernel.process import AgentProcess
from hugin.munin.store import MuninStore
from hugin.syscalls.handlers import (
    artifact_write,
    mission_report,
    munin_search,
    munin_write,
    proc_send,
    proc_spawn,
    proc_wait,
)

if TYPE_CHECKING:  # pragma: no cover - import cycle guard, the kernel constructs the registry
    from hugin.kernel.kernel import Kernel

logger = logging.getLogger(__name__)

SUMMARY_CHARS = 160
MAX_SEARCH_LIMIT = 20
MAX_WAIT_S = 600


@dataclass(frozen=True)
class SyscallDef:
    name: str
    capability: str
    description: str
    schema: dict  # JSON schema for args
    handler: Callable[["Kernel", int, dict], Awaitable[dict]]


SYSCALLS: tuple[SyscallDef, ...] = (
    SyscallDef(
        name="munin_search",
        capability="munin.read",
        description=(
            "Search munin, the shared memory of every hugin run, for facts an earlier run"
            " stored. Free text; all words must occur. Returns the matching memories."
        ),
        schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "maxLength": 500},
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_SEARCH_LIMIT,
                    "default": 10,
                },
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        handler=munin_search,
    ),
    SyscallDef(
        name="munin_write",
        capability="munin.write",
        description=(
            "Store one durable fact in munin, with provenance (run, pid, program). Facts a"
            " later run would want, not a summary of what you just did."
        ),
        schema={
            "type": "object",
            "properties": {
                "title": {"type": "string", "maxLength": 200},
                "body": {"type": "string", "maxLength": 4000},
                "tags": {
                    "type": "array",
                    "items": {"type": "string", "maxLength": 40},
                    "maxItems": 8,
                },
            },
            "required": ["title", "body"],
            "additionalProperties": False,
        },
        handler=munin_write,
    ),
    SyscallDef(
        name="proc_spawn",
        capability="proc.spawn",
        description=(
            "Start a child process running another program on a task of its own. At most four"
            " live children per parent. The task text must stand alone: the child sees it and"
            " nothing else of your context."
        ),
        schema={
            "type": "object",
            "properties": {
                "program": {"type": "string", "maxLength": 40},
                "task": {"type": "string", "maxLength": 4000},
                "budget": {
                    "type": "object",
                    "properties": {
                        "max_turns": {"type": "integer", "minimum": 1},
                        "max_seconds": {"type": "integer", "minimum": 1},
                        "max_output_tokens": {"type": "integer", "minimum": 1},
                    },
                    "additionalProperties": False,
                },
            },
            "required": ["program", "task"],
            "additionalProperties": False,
        },
        handler=proc_spawn,
    ),
    SyscallDef(
        name="proc_send",
        capability="proc.send",
        description=(
            "Deliver a short message to the mailbox of another process in this run — used to"
            " correct a worker that is still running."
        ),
        schema={
            "type": "object",
            "properties": {
                "to_pid": {"type": "integer", "minimum": 1},
                "text": {"type": "string", "maxLength": 2000},
            },
            "required": ["to_pid", "text"],
            "additionalProperties": False,
        },
        handler=proc_send,
    ),
    SyscallDef(
        name="proc_wait",
        capability="proc.wait",
        description=(
            "Block until those processes have exited and return their final reports. Pass the"
            ' string "children" instead of a list to wait for all of your live children.'
        ),
        schema={
            "type": "object",
            "properties": {
                "pids": {
                    "anyOf": [
                        {"type": "array", "items": {"type": "integer"}, "maxItems": 8},
                        {"type": "string", "enum": ["children"]},
                        # Small models tend to wrap the keyword in a list; accept that too.
                        {"type": "array", "items": {"type": "string", "enum": ["children"]}, "maxItems": 1},
                    ]
                },
                "timeout_s": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_WAIT_S,
                    "default": 300,
                },
            },
            "required": ["pids"],
            "additionalProperties": False,
        },
        handler=proc_wait,
    ),
    SyscallDef(
        name="mission_report",
        capability="report",
        description=(
            "Your single, final report to your parent process. Call it exactly once, then"
            " stop: no report means your work is lost."
        ),
        schema={
            "type": "object",
            "properties": {"summary": {"type": "string", "maxLength": 8000}},
            "required": ["summary"],
            "additionalProperties": False,
        },
        handler=mission_report,
    ),
    SyscallDef(
        name="artifact_write",
        capability="artifact.write",
        description=(
            "Write a file into the run's artifact directory. Single writer: only the run's root"
            " process holds this capability, and it writes the one artifact of the run."
        ),
        schema={
            "type": "object",
            "properties": {
                # Defaulted so a model that forgets the name still lands its one report.
                "name": {"type": "string", "maxLength": 64, "default": "report.md"},
                "content": {"type": "string", "maxLength": 200000},
            },
            "required": ["content"],
            "additionalProperties": False,
        },
        handler=artifact_write,
    ),
)


class SyscallRegistry:
    """The kernel's syscall table: capability gate, argument check and event bracket."""

    def __init__(self, kernel: "Kernel", munin: MuninStore):
        self.kernel = kernel
        self.munin = munin
        self._defs: dict[str, SyscallDef] = {call.name: call for call in SYSCALLS}
        self._call_seq = 0

    def defs_for(self, pid: int) -> list[SyscallDef]:
        """Only the syscalls whose capability this process's program was granted."""
        capabilities = self.kernel.procs.get(pid).capabilities
        return [call for call in self._defs.values() if call.capability in capabilities]

    def tool_schemas(self, pid: int) -> list[dict]:
        """The same list in the shape MCP and Ollama both want for a tool definition."""
        return [
            {"name": call.name, "description": call.description, "input_schema": call.schema}
            for call in self.defs_for(pid)
        ]

    async def call(self, pid: int, name: str, args: dict) -> dict:
        proc = self.kernel.procs.get(pid)
        self._call_seq += 1
        call_id = f"sys{self._call_seq}"
        await self.kernel.emit(
            EventKind.SYS_CALL,
            run_id=proc.run_id,
            pid=pid,
            data={"call_id": call_id, "syscall": name, "args_summary": summarize(args)},
        )
        started = time.perf_counter()
        try:
            result = await self._dispatch(proc, name, args)
        except SyscallError as err:
            await self._emit_result(proc, call_id, False, str(err), started)
            raise
        except Exception as err:
            # A handler that breaks is a kernel bug, but the agent still gets one honest
            # sentence instead of a stack trace it cannot act on.
            logger.exception("syscall %r failed for pid %s", name, pid)
            message = f"{name} failed: {err}"
            await self._emit_result(proc, call_id, False, message, started)
            raise SyscallError(message) from err
        await self._emit_result(proc, call_id, True, summarize(result), started)
        return result

    async def _dispatch(self, proc: AgentProcess, name: str, args: dict) -> dict:
        definition = self._defs.get(name)
        if definition is None:
            offered = ", ".join(call.name for call in self.defs_for(proc.pid)) or "nothing"
            raise SyscallError(f"unknown syscall '{name}' — this process may call: {offered}")
        if definition.capability not in proc.capabilities:
            raise SyscallError(
                f"{name} needs the capability '{definition.capability}', which the program"
                f" '{proc.program}' does not hold"
            )
        checked = validate_args(name, definition.schema, args)
        return await definition.handler(self.kernel, proc.pid, checked)

    async def _emit_result(
        self, proc: AgentProcess, call_id: str, ok: bool, summary: str, started: float
    ) -> None:
        await self.kernel.emit(
            EventKind.SYS_RESULT,
            run_id=proc.run_id,
            pid=proc.pid,
            data={
                "call_id": call_id,
                "ok": ok,
                "result_summary": summary,
                "ms": int((time.perf_counter() - started) * 1000),
            },
        )


_JSON_TYPES: dict[str, type | tuple[type, ...]] = {
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "array": list,
    "object": dict,
}


def validate_args(name: str, schema: dict, args: dict) -> dict:
    """Check `args` against the schema and fill in declared defaults, or raise `SyscallError`.

    Supported keywords: `type`, `properties`, `required`, `enum`, `anyOf`, `minimum`, `maximum`,
    `maxLength`, `maxItems`, `items`, `default`. An unknown argument is always refused — a typo
    must fail loudly instead of being silently ignored.
    """
    properties = schema.get("properties", {})
    for key in schema.get("required", []):
        if key not in args:
            raise SyscallError(f"{name}: missing required argument '{key}'")
    unknown = sorted(set(args) - set(properties))
    if unknown:
        allowed = ", ".join(properties)
        raise SyscallError(
            f"{name}: unknown argument(s) {', '.join(unknown)} — allowed: {allowed}"
        )
    checked = {
        key: _check_value(f"{name}.{key}", properties[key], value) for key, value in args.items()
    }
    for key, spec in properties.items():
        if key not in checked and "default" in spec:
            checked[key] = spec["default"]
    return checked


def _check_value(label: str, spec: dict, value: object) -> object:
    if "anyOf" in spec:
        for branch in spec["anyOf"]:
            try:
                return _check_value(label, branch, value)
            except SyscallError:
                continue
        raise SyscallError(f"{label}: {value!r} does not match any accepted form")
    expected = spec.get("type")
    # `bool` is an `int` in Python, but `true` is not an integer an agent may pass for one.
    if expected is not None and (
        isinstance(value, bool) != (expected == "boolean")
        or not isinstance(value, _JSON_TYPES[expected])
    ):
        raise SyscallError(f"{label}: expected {expected}, got {type(value).__name__}")
    if "enum" in spec and value not in spec["enum"]:
        allowed = ", ".join(repr(option) for option in spec["enum"])
        raise SyscallError(f"{label}: {value!r} is not one of {allowed}")
    if isinstance(value, int) and not isinstance(value, bool):
        if "minimum" in spec and value < spec["minimum"]:
            raise SyscallError(f"{label}: must be at least {spec['minimum']}")
        if "maximum" in spec and value > spec["maximum"]:
            raise SyscallError(f"{label}: must be at most {spec['maximum']}")
    if isinstance(value, str) and "maxLength" in spec and len(value) > spec["maxLength"]:
        raise SyscallError(f"{label}: must be at most {spec['maxLength']} characters")
    if isinstance(value, list):
        if "maxItems" in spec and len(value) > spec["maxItems"]:
            raise SyscallError(f"{label}: must have at most {spec['maxItems']} entries")
        for index, item in enumerate(value):
            if "items" in spec:
                _check_value(f"{label}[{index}]", spec["items"], item)
    return value


def summarize(value: object) -> str:
    """One short line for the event log — arguments and results can be whole documents."""
    if isinstance(value, dict):
        text = ", ".join(f"{key}={summarize(item)}" for key, item in value.items())
    elif isinstance(value, str):
        text = value
    else:
        text = repr(value)
    return text[:SUMMARY_CHARS]
