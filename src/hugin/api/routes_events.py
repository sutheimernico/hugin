"""The live event stream — and the same events again, replayed from the log.

A client that reconnects with `since=<last seq>` must miss nothing, so the order here matters:
subscribe to the bus *first*, then read the backfill out of the log. Anything published in
between lands in the queue and is dropped again by the seq filter — the alternative order would
lose it silently.
"""

import asyncio
from collections.abc import AsyncIterator, Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sse_starlette import EventSourceResponse

from hugin.api.deps import KernelDep
from hugin.kernel.events import Event
from hugin.kernel.kernel import Kernel
from hugin.replay.player import SPEEDS, Player

HEARTBEAT_S = 15
BOOT_SINCE = "boot"

router = APIRouter(prefix="/api", tags=["events"])


def replay_speed(speed: int = Query(default=1)) -> int:
    """The playback speeds the shell offers — anything else is a client bug, not a 500.

    A `Literal` annotation would look tidier but pydantic refuses to coerce the query string
    to an int for it, so every request would be a 422.
    """
    if speed not in SPEEDS:
        raise HTTPException(
            status_code=422,
            detail=f"Tempo {speed}× gibt es nicht — erlaubt sind 1×, 2×, 4× und 8×.",
        )
    return speed


SpeedDep = Annotated[int, Depends(replay_speed)]


def resolve_since(kernel: Kernel, since: str) -> int:
    """Turn the `since` query into a seq to backfill after.

    `since=boot` is what a freshly loaded shell asks for: everything this kernel did since its
    own boot, and the boot event itself — so the shell knows which run belongs to this life of
    the kernel without replaying every run the database ever stored.
    """
    if since == BOOT_SINCE:
        return max(kernel.log.last_boot_seq() - 1, 0)
    try:
        seq = int(since)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"„since={since}“ ist weder eine Sequenznummer noch „{BOOT_SINCE}“.",
        ) from None
    if seq < 0:
        raise HTTPException(status_code=422, detail="„since“ darf nicht negativ sein.")
    return seq


@router.get("/events/stream")
async def stream_events(
    kernel: KernelDep,
    run_id: str | None = None,
    since: str = Query(default="0"),
) -> EventSourceResponse:
    backfill_after = resolve_since(kernel, since)
    queue: asyncio.Queue[Event] = asyncio.Queue()

    async def on_event(event: Event) -> None:
        if run_id is None or event.run_id == run_id:
            queue.put_nowait(event)

    unsubscribe = kernel.bus.subscribe(on_event)
    return EventSourceResponse(
        _stream(kernel, queue, unsubscribe, run_id, backfill_after), ping=HEARTBEAT_S
    )


async def _stream(
    kernel: Kernel,
    queue: asyncio.Queue[Event],
    unsubscribe: Callable[[], None],
    run_id: str | None,
    since: int,
) -> AsyncIterator[dict]:
    """Backfill from the log, then live from the bus until the client goes away.

    The disconnect is not polled: sse-starlette listens on the ASGI receive channel itself and
    closes this generator when the client is gone, which runs the `finally`. Calling
    `request.is_disconnected()` here would make a second consumer of that same channel.
    """
    last_seq = since
    try:
        for event in kernel.log.since(since, run_id):
            last_seq = event.seq or last_seq
            yield sse_message(event)
        while True:
            event = await queue.get()
            if event.seq is not None and event.seq <= last_seq:
                continue  # the backfill already delivered it
            last_seq = event.seq or last_seq
            yield sse_message(event)
    finally:
        unsubscribe()


def sse_message(event: Event) -> dict:
    """One SSE frame. Live and replay use it alike, so a client cannot tell them apart."""
    return {"id": str(event.seq), "event": event.kind.value, "data": event.model_dump_json()}


async def replay_messages(events: AsyncIterator[Event]) -> AsyncIterator[dict]:
    """Wrap a paced event stream into SSE frames; it ends when the replay is over."""
    async for event in events:
        yield sse_message(event)


@router.get("/runs/{run_id}/replay/stream")
async def stream_replay(
    run_id: str,
    kernel: KernelDep,
    speed: SpeedDep,
    from_seq: int = Query(default=0, ge=0),
) -> EventSourceResponse:
    """Replay a stored run: the same frames as the live stream, only paced by the player."""
    if run_id not in kernel.runs:
        raise HTTPException(status_code=404, detail=f"Run „{run_id}“ ist unbekannt.")
    player = Player(kernel.log)
    return EventSourceResponse(
        replay_messages(player.stream(run_id, speed, from_seq)), ping=HEARTBEAT_S
    )
