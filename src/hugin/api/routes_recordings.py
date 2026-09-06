"""Demo recordings: export a run, list what was exported, serve it and replay it.

A recording is the offline demo, so the export is the one route that can refuse: if the scrub
still finds something secret-shaped, nothing is written and the reason says which pattern hit.
Replaying a recording produces the very same SSE frames as a live run — the shell cannot tell
the two apart, which is exactly why replay needs no second reducer.
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse

from hugin.api.deps import KernelDep
from hugin.api.routes_events import HEARTBEAT_S, SpeedDep, replay_messages
from hugin.kernel.events import Event
from hugin.kernel.kernel import Kernel
from hugin.replay.player import Player
from hugin.replay.recorder import SLUG, Recorder, ScrubError

router = APIRouter(prefix="/api", tags=["recordings"])


class ExportRequest(BaseModel):
    # Same rule as the recorder's, one layer earlier: a bad slug is a 422, not a 500.
    slug: str = Field(pattern=SLUG.pattern)


@router.post("/recordings/{run_id}", status_code=201)
async def export_recording(run_id: str, body: ExportRequest, kernel: KernelDep) -> dict:
    recorder = _recorder(kernel)
    try:
        recorder.export(run_id, body.slug)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Run „{run_id}“ ist unbekannt.") from None
    except ValueError:
        # The body model rejects the same slugs; this is the backstop for the two regex
        # engines (pydantic's and `re`) ever disagreeing — a 500 would say nothing useful.
        raise HTTPException(
            status_code=422, detail=f"Slug „{body.slug}“ ist nicht erlaubt."
        ) from None
    except ScrubError as error:
        raise HTTPException(
            status_code=400,
            detail=f"Geheimnis-Muster {error.pattern_name} gefunden — Export verweigert.",
        ) from None
    return recorder.manifest(body.slug)


@router.get("/recordings")
async def list_recordings(kernel: KernelDep) -> list[dict]:
    return _recorder(kernel).list()


@router.get("/recordings/{slug}/events")
async def get_recording_events(slug: str, kernel: KernelDep) -> list[Event]:
    return _load_or_404(kernel, slug)


@router.get("/recordings/{slug}/replay/stream")
async def stream_recording(slug: str, kernel: KernelDep, speed: SpeedDep) -> EventSourceResponse:
    events = _load_or_404(kernel, slug)
    player = Player(kernel.log)
    return EventSourceResponse(
        replay_messages(player.stream_events(events, speed)), ping=HEARTBEAT_S
    )


def _recorder(kernel: Kernel) -> Recorder:
    return Recorder(
        kernel.log, kernel.settings.recordings_dir, kernel.settings.repo_root, Path.home()
    )


def _load_or_404(kernel: Kernel, slug: str) -> list[Event]:
    """An unknown *and* an invalid slug are the same answer: there is no such recording."""
    try:
        return _recorder(kernel).load(slug)
    except (KeyError, ValueError):
        raise HTTPException(status_code=404, detail=f"Aufnahme „{slug}“ ist unbekannt.") from None
