"""Fold the event log back into runs and processes — what makes the log the source of truth.

A restarted kernel starts with an empty process table, yet the log still holds everything every
earlier life of the kernel did. Replaying the lifecycle events through the same rules the live
kernel applies rebuilds `RunInfo` and `AgentProcess` for old runs, so `/api/runs`, usage totals
and replay keep working after a restart. Only lifecycle kinds are read: text, tool and budget
chatter are not needed to know what a run was and how it ended.
"""

from collections.abc import Iterable
from pathlib import Path

from hugin.kernel.events import BudgetSpec, Event, EventKind, Usage
from hugin.kernel.process import AgentProcess, RunInfo
from hugin.programs.loader import Program

RESTORE_KINDS = (
    EventKind.RUN_CREATED,
    EventKind.RUN_DONE,
    EventKind.RUN_FAILED,
    EventKind.PROC_SPAWNED,
    EventKind.PROC_STATE,
    EventKind.PROC_EXIT,
    EventKind.BUDGET_TICK,
)


def fold_log(
    events: Iterable[Event], programs: dict[str, Program], runs_dir: Path
) -> tuple[dict[str, RunInfo], list[AgentProcess]]:
    """Rebuild `(runs, processes)` from lifecycle events, in log order.

    Processes that never logged an exit come back still "alive": the caller decides what a
    process whose kernel vanished underneath it is — this function only reports what the log
    says. The bearer token is not part of any event, so every restored process has none.
    """
    runs: dict[str, RunInfo] = {}
    procs: dict[int, AgentProcess] = {}
    for event in events:
        data = event.data
        match event.kind:
            case EventKind.RUN_CREATED:
                assert event.run_id is not None
                runs[event.run_id] = RunInfo(
                    id=event.run_id,
                    goal=data["goal"],
                    driver=data["driver"],
                    template=data.get("template"),
                    created_at=event.ts,
                )
            case EventKind.RUN_DONE | EventKind.RUN_FAILED:
                run = runs.get(event.run_id or "")
                if run is not None:
                    run.state = "done" if event.kind == EventKind.RUN_DONE else "failed"
                    run.done_at = event.ts
            case EventKind.PROC_SPAWNED:
                assert event.run_id is not None and event.pid is not None
                spec = programs.get(data["program"])
                procs[event.pid] = AgentProcess(
                    pid=event.pid,
                    run_id=event.run_id,
                    ppid=data["ppid"],
                    program=data["program"],
                    role=data["role"],
                    driver=data["driver"],
                    model=data["model"],
                    task=data["task"],
                    cwd=runs_dir / event.run_id / f"p{event.pid}",
                    capabilities=set(spec.capabilities) if spec else set(),
                    allowed_tools=list(spec.tools) if spec else [],
                    budget=BudgetSpec.model_validate(data["budget"]),
                )
                run = runs.get(event.run_id)
                if run is not None and run.root_pid is None:
                    run.root_pid = event.pid
            case EventKind.PROC_STATE:
                proc = procs.get(event.pid or -1)
                if proc is not None:
                    proc.state = data["state"]
                    if data["state"] == "running" and proc.started_at is None:
                        proc.started_at = event.ts
            case EventKind.PROC_EXIT:
                proc = procs.get(event.pid or -1)
                if proc is not None:
                    proc.usage = Usage.model_validate(data["usage"])
                    proc.exit_reason = data["reason"]
                    proc.exited_at = event.ts
            case EventKind.BUDGET_TICK:
                proc = procs.get(event.pid or -1)
                if proc is not None and proc.exit_reason is None:
                    proc.usage = Usage(
                        turns=data["turns"],
                        input_tokens=data.get("input_tokens", 0),
                        output_tokens=data["output_tokens"],
                    )
    return runs, list(procs.values())
