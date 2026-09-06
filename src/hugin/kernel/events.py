"""Event model: the closed kind list and one pydantic payload schema per kind.

Every state change in hugin is an immutable event. `data` stays a plain dict on `Event`
so events serialise trivially to JSON and to SQLite; validation happens in `make_event`.
"""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class EventKind(StrEnum):
    KERNEL_BOOT = "kernel.boot"
    KERNEL_SUBSYSTEM = "kernel.subsystem"
    RUN_CREATED = "run.created"
    RUN_DONE = "run.done"
    RUN_FAILED = "run.failed"
    SCHED_QUEUED = "sched.queued"
    SCHED_STARTED = "sched.started"
    SCHED_BLOCKED = "sched.blocked"
    PROC_SPAWNED = "proc.spawned"
    PROC_STATE = "proc.state"
    PROC_TEXT = "proc.text"
    PROC_THINKING = "proc.thinking"
    PROC_EXIT = "proc.exit"
    TOOL_CALL = "tool.call"
    TOOL_RESULT = "tool.result"
    SYS_CALL = "sys.call"
    SYS_RESULT = "sys.result"
    MSG_SENT = "msg.sent"
    MUNIN_WRITE = "munin.write"
    MUNIN_READ = "munin.read"
    ARTIFACT_WRITTEN = "artifact.written"
    BUDGET_TICK = "budget.tick"
    BUDGET_EXCEEDED = "budget.exceeded"
    KILL = "kill"


ProcState = Literal["queued", "spawning", "running", "waiting_tool", "done", "failed", "killed"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Usage(Strict):
    turns: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd_equiv: float | None = None


class BudgetSpec(Strict):
    # A zero limit would divide by zero in `BudgetWatcher.pct`, so it is rejected at load time.
    max_turns: int = Field(default=12, gt=0)
    max_seconds: int = Field(default=300, gt=0)
    max_output_tokens: int = Field(default=6000, gt=0)


class KernelBoot(Strict):
    version: str
    pid_counter: int


class KernelSubsystem(Strict):
    name: str
    status: Literal["ok", "warn", "error"]
    detail: str


class RunCreated(Strict):
    goal: str
    driver: str
    template: str | None = None


class RunDone(Strict):
    usage: Usage
    artifacts: list[str]
    duration_s: float


class RunFailed(Strict):
    reason: str


class SchedQueued(Strict):
    pass


class SchedStarted(Strict):
    pass


class SchedBlocked(Strict):
    reason: str
    limit: int


class ProcSpawned(Strict):
    ppid: int | None
    program: str
    role: str
    driver: str
    model: str
    budget: BudgetSpec
    task: str


class ProcStateChange(Strict):
    state: ProcState
    prev: ProcState


class ProcText(Strict):
    delta: str


class ProcThinking(Strict):
    on: bool


class ProcExit(Strict):
    reason: str
    usage: Usage
    stderr_tail: str | None = None


class ToolCall(Strict):
    call_id: str
    tool: str
    input_summary: str


class ToolResult(Strict):
    call_id: str
    ok: bool
    output_summary: str
    ms: int


class SysCall(Strict):
    call_id: str
    syscall: str
    args_summary: str


class SysResult(Strict):
    call_id: str
    ok: bool
    result_summary: str
    ms: int


class MsgSent(Strict):
    from_pid: int
    to_pid: int
    preview: str


class MuninWrite(Strict):
    memory_id: int
    title: str


class MuninRead(Strict):
    query: str
    hits: int


class ArtifactWritten(Strict):
    name: str
    bytes: int


class BudgetTick(Strict):
    turns: int
    output_tokens: int
    seconds: float
    pct: float
    # Additive with a default, so recordings written before this field stay valid.
    input_tokens: int = 0


class BudgetExceeded(Strict):
    which: Literal["turns", "seconds", "output_tokens"]


class Kill(Strict):
    target: int | Literal["all"]
    by: str


PAYLOADS: dict[EventKind, type[Strict]] = {
    EventKind.KERNEL_BOOT: KernelBoot,
    EventKind.KERNEL_SUBSYSTEM: KernelSubsystem,
    EventKind.RUN_CREATED: RunCreated,
    EventKind.RUN_DONE: RunDone,
    EventKind.RUN_FAILED: RunFailed,
    EventKind.SCHED_QUEUED: SchedQueued,
    EventKind.SCHED_STARTED: SchedStarted,
    EventKind.SCHED_BLOCKED: SchedBlocked,
    EventKind.PROC_SPAWNED: ProcSpawned,
    EventKind.PROC_STATE: ProcStateChange,
    EventKind.PROC_TEXT: ProcText,
    EventKind.PROC_THINKING: ProcThinking,
    EventKind.PROC_EXIT: ProcExit,
    EventKind.TOOL_CALL: ToolCall,
    EventKind.TOOL_RESULT: ToolResult,
    EventKind.SYS_CALL: SysCall,
    EventKind.SYS_RESULT: SysResult,
    EventKind.MSG_SENT: MsgSent,
    EventKind.MUNIN_WRITE: MuninWrite,
    EventKind.MUNIN_READ: MuninRead,
    EventKind.ARTIFACT_WRITTEN: ArtifactWritten,
    EventKind.BUDGET_TICK: BudgetTick,
    EventKind.BUDGET_EXCEEDED: BudgetExceeded,
    EventKind.KILL: Kill,
}


class Event(BaseModel):
    seq: int | None = None
    ts: float
    run_id: str | None
    pid: int | None
    kind: EventKind
    data: dict


def make_event(
    kind: EventKind, *, run_id: str | None, pid: int | None, data: dict, ts: float
) -> Event:
    payload = PAYLOADS[kind].model_validate(data)
    return Event(ts=ts, run_id=run_id, pid=pid, kind=kind, data=payload.model_dump())
