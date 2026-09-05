"""The live event stream.

A client that reconnects with `since=<last seq>` must miss nothing, so the order here matters:
subscribe to the bus *first*, then read the backfill out of the log. Anything published in
between lands in the queue and is dropped again by the seq filter — the alternative order would
lose it silently.
"""

import asyncio
from collections.abc import AsyncIterator, Callable

from fastapi import APIRouter, Query
from sse_starlette import EventSourceResponse

from hugin.api.deps import KernelDep
from hugin.kernel.events import Event
from hugin.kernel.kernel import Kernel

HEARTBEAT_S = 15

router = APIRouter(prefix="/api", tags=["events"])


@router.get("/events/stream")
async def stream_events(
    kernel: KernelDep,
    run_id: str | None = None,
    since: int = Query(default=0, ge=0),
) -> EventSourceResponse:
    queue: asyncio.Queue[Event] = asyncio.Queue()

    async def on_event(event: Event) -> None:
        if run_id is None or event.run_id == run_id:
            queue.put_nowait(event)

    unsubscribe = kernel.bus.subscribe(on_event)
    return EventSourceResponse(
        _stream(kernel, queue, unsubscribe, run_id, since), ping=HEARTBEAT_S
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
            yield _message(event)
        while True:
            event = await queue.get()
            if event.seq is not None and event.seq <= last_seq:
                continue  # the backfill already delivered it
            last_seq = event.seq or last_seq
            yield _message(event)
    finally:
        unsubscribe()


def _message(event: Event) -> dict:
    return {"id": str(event.seq), "event": event.kind.value, "data": event.model_dump_json()}
