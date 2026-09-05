"""The in-memory process model: agents are processes with a validated state machine.

The kernel owns every state change, so `transition` only guards and records it — emitting
`proc.state` is the kernel's job, not the process's. Keeping the two apart lets the process
table stay a plain data structure that tests can drive without a bus or a database.
"""

from dataclasses import dataclass, field
from pathlib import Path

from hugin.kernel.events import BudgetSpec, ProcState, Usage

VALID_TRANSITIONS: dict[ProcState, set[ProcState]] = {
    "queued": {"spawning", "killed"},
    "spawning": {"running", "failed", "killed"},
    "running": {"waiting_tool", "done", "failed", "killed"},
    "waiting_tool": {"running", "done", "failed", "killed"},
    "done": set(),
    "failed": set(),
    "killed": set(),
}

_TERMINAL_STATES = {state for state, targets in VALID_TRANSITIONS.items() if not targets}


class InvalidTransition(Exception):
    """Raised when a state change is not allowed by `VALID_TRANSITIONS`."""


@dataclass
class Message:
    """One mailbox entry — an inter-agent message delivered by the kernel."""

    from_pid: int
    text: str
    ts: float


@dataclass
class AgentProcess:
    pid: int
    run_id: str
    ppid: int | None
    program: str
    role: str
    driver: str
    model: str
    task: str
    cwd: Path
    capabilities: set[str]
    allowed_tools: list[str]
    budget: BudgetSpec
    state: ProcState = "queued"
    usage: Usage = field(default_factory=Usage)
    started_at: float | None = None
    exited_at: float | None = None
    exit_reason: str | None = None
    mailbox: list[Message] = field(default_factory=list)
    report: str | None = None  # final mission_report text (workers)

    def transition(self, new: ProcState) -> ProcState:
        """Move to `new` and return the previous state; raise `InvalidTransition` if illegal."""
        prev = self.state
        if new not in VALID_TRANSITIONS[prev]:
            raise InvalidTransition(f"pid {self.pid}: {prev} -> {new} is not a valid transition")
        self.state = new
        return prev

    @property
    def alive(self) -> bool:
        return self.state not in _TERMINAL_STATES


class ProcessTable:
    """All processes of this kernel instance, keyed by pid, in creation order."""

    def __init__(self) -> None:
        self._procs: dict[int, AgentProcess] = {}
        self._next_pid = 1

    def next_pid(self) -> int:
        pid = self._next_pid
        self._next_pid += 1
        return pid

    def add(self, proc: AgentProcess) -> None:
        self._procs[proc.pid] = proc

    def get(self, pid: int) -> AgentProcess:
        return self._procs[pid]

    def all(self) -> list[AgentProcess]:
        return list(self._procs.values())

    def alive(self) -> list[AgentProcess]:
        return [proc for proc in self._procs.values() if proc.alive]

    def children(self, pid: int) -> list[AgentProcess]:
        return [proc for proc in self._procs.values() if proc.ppid == pid]

    def for_run(self, run_id: str) -> list[AgentProcess]:
        return [proc for proc in self._procs.values() if proc.run_id == run_id]
