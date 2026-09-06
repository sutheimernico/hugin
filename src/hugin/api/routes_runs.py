"""Missions, runs, their events and their artifacts.

A run object always carries the aggregate usage of its processes and the artifact names, so a
client never has to add up the process table itself to know what a run cost and produced.
"""

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from hugin.api.deps import KernelDep
from hugin.kernel.events import Event
from hugin.kernel.kernel import Kernel, RunInfo
from hugin.missions.service import start_mission
from hugin.missions.templates import TEMPLATES, Template
from hugin.syscalls.handlers import ARTIFACT_NAME

router = APIRouter(prefix="/api", tags=["runs"])


class MissionRequest(BaseModel):
    goal: str
    driver: Literal["claude", "ollama", "scripted"] = "scripted"
    template: str | None = None


@router.post("/missions", status_code=201)
async def create_mission(body: MissionRequest, kernel: KernelDep) -> dict[str, str]:
    run_id = await start_mission(kernel, body.goal, body.driver, body.template)
    return {"run_id": run_id}


@router.get("/templates")
async def list_templates() -> list[Template]:
    return list(TEMPLATES)


@router.get("/runs")
async def list_runs(kernel: KernelDep) -> list[dict]:
    return [_run_json(kernel, run) for run in kernel.runs.values()]


@router.get("/runs/{run_id}")
async def get_run(run_id: str, kernel: KernelDep) -> dict:
    return _run_json(kernel, _run_or_404(kernel, run_id))


@router.get("/runs/{run_id}/events")
async def get_run_events(
    run_id: str, kernel: KernelDep, since: int = Query(default=0, ge=0)
) -> list[Event]:
    _run_or_404(kernel, run_id)
    return kernel.log.since(since, run_id)


@router.get("/runs/{run_id}/artifacts")
async def list_artifacts(run_id: str, kernel: KernelDep) -> list[dict]:
    _run_or_404(kernel, run_id)
    directory = _artifact_dir(kernel, run_id)
    if not directory.is_dir():
        return []
    return [
        {"name": path.name, "bytes": path.stat().st_size}
        for path in sorted(directory.iterdir())
        if path.is_file()
    ]


@router.get("/runs/{run_id}/artifacts/{name}", response_class=PlainTextResponse)
async def read_artifact(run_id: str, name: str, kernel: KernelDep) -> str:
    _run_or_404(kernel, run_id)
    # Same name rule as `artifact_write`, so nothing the kernel refused to write can be read.
    if ".." in name or ARTIFACT_NAME.fullmatch(name) is None:
        raise HTTPException(status_code=404, detail=f"Artefakt „{name}“ gibt es nicht.")
    path = _artifact_dir(kernel, run_id) / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"Artefakt „{name}“ gibt es nicht.")
    return path.read_text(encoding="utf-8")


def _run_or_404(kernel: Kernel, run_id: str) -> RunInfo:
    run = kernel.runs.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run „{run_id}“ ist unbekannt.")
    return run


def _artifact_dir(kernel: Kernel, run_id: str) -> Path:
    return kernel.settings.runs_dir / run_id / "artifacts"


def _run_json(kernel: Kernel, run: RunInfo) -> dict:
    return {
        "id": run.id,
        "goal": run.goal,
        "driver": run.driver,
        "template": run.template,
        "state": run.state,
        "created_at": run.created_at,
        "done_at": run.done_at,
        "root_pid": run.root_pid,
        # The kernel's own aggregation on purpose: a run summary in the API and the one in the
        # `run.done` event must never disagree, and the kernel is where that sum is defined.
        "usage": kernel.run_usage(run.id).model_dump(),
        "artifacts": kernel.artifacts(run.id),
    }
