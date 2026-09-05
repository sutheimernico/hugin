"""The process table, the kill routes and the program catalogue."""

from fastapi import APIRouter, HTTPException

from hugin.api.deps import KernelDep
from hugin.kernel.process import AgentProcess

router = APIRouter(prefix="/api", tags=["procs"])


@router.get("/procs")
async def list_procs(kernel: KernelDep) -> list[dict]:
    return [_proc_json(proc) for proc in kernel.procs.all()]


@router.post("/procs/{pid}/kill")
async def kill_proc(pid: int, kernel: KernelDep) -> dict:
    try:
        kernel.procs.get(pid)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Prozess {pid} ist unbekannt.") from None
    await kernel.kill(pid, by="user")
    return {"ok": True}


@router.post("/kill-all")
async def kill_all(kernel: KernelDep) -> dict:
    # Snapshot first: the answer is who was alive when the button was pressed.
    killed = [proc.pid for proc in kernel.procs.alive()]
    await kernel.kill_all(by="user")
    return {"killed": killed}


@router.get("/programs")
async def list_programs(kernel: KernelDep) -> list[dict]:
    # The system prompt is the program's inside; the catalogue is its outside.
    return [program.model_dump(exclude={"system_prompt"}) for program in kernel.programs.values()]


def _proc_json(proc: AgentProcess) -> dict:
    return {
        "pid": proc.pid,
        "run_id": proc.run_id,
        "ppid": proc.ppid,
        "program": proc.program,
        "role": proc.role,
        "driver": proc.driver,
        "model": proc.model,
        "state": proc.state,
        "task": proc.task,
        "budget": proc.budget.model_dump(),
        "usage": proc.usage.model_dump(),
        "started_at": proc.started_at,
        "exited_at": proc.exited_at,
        "exit_reason": proc.exit_reason,
    }
