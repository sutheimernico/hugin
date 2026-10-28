"""The live event stream — and the same events again, replayed from the log.

A client that reconnects with `since=<last seq>` must miss nothing, so the order here matters:
subscribe to the bus *first*, then read the backfill out of the log. Anything published in
between lands in the queue and is dropped again by the seq filter — the alternative order would
lose it silently.
"""

import asyncio
from collections.abc import AsyncIterator
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


# Per-client buffer between the bus and a slow reader. Bounded on purpose: a stalled browser
# tab must cost a fixed amount of memory, not grow with every event the kernel ever emits.
CLIENT_QUEUE_MAX = 5000
_RESYNC = object()


class _Subscriber:
    """The bus side of one SSE client: a bounded queue that degrades to "read the log again".

    When the client falls so far behind that the queue is full, buffering more would only move
    the problem into memory. Everything is in the log already, so the buffer is dropped and a
    marker takes its place: the stream sees it, backfills from the last seq it delivered, and
    carries on — a slow client loses time, never events.
    """

    def __init__(self, run_id: str | None, queue_max: int) -> None:
        self.run_id = run_id
        self.queue: asyncio.Queue[object] = asyncio.Queue(maxsize=queue_max)
        self.resyncs = 0

    async def push(self, event: Event) -> None:
        if self.run_id is not None and event.run_id != self.run_id:
            return
        try:
            self.queue.put_nowait(event)
        except asyncio.QueueFull:
            while not self.queue.empty():
                self.queue.get_nowait()
            self.queue.put_nowait(_RESYNC)
            self.resyncs += 1


@router.get("/events/stream")
async def stream_events(
    kernel: KernelDep,
    run_id: str | None = None,
    since: str = Query(default="0"),
) -> EventSourceResponse:
    backfill_after = resolve_since(kernel, since)
    return EventSourceResponse(event_stream(kernel, run_id, backfill_after), ping=HEARTBEAT_S)


async def event_stream(
    kernel: Kernel, run_id: str | None, since: int, queue_max: int | None = None
) -> AsyncIterator[dict]:
    """Backfill from the log, then live from the bus until the client goes away.

    The subscription is opened *before* the backfill is read, so an event published in between
    sits in the queue and is dropped again by the seq filter. The disconnect is not polled:
    sse-starlette listens on the ASGI receive channel itself and closes this generator when the
    client is gone, which runs the `finally`. Calling `request.is_disconnected()` here would
    make a second consumer of that same channel.
    """
    subscriber = _Subscriber(run_id, queue_max or CLIENT_QUEUE_MAX)
    unsubscribe = kernel.bus.subscribe(subscriber.push)
    last_seq = since
    try:
        while True:
            # Paged: one capped read would silently end the backfill of a long run.
            for event in kernel.log.iter_since(last_seq, run_id):
                last_seq = event.seq or last_seq
                yield sse_message(event)
            while True:
                item = await subscriber.queue.get()
                if item is _RESYNC:
                    break  # fell behind: read the missed events out of the log
                assert isinstance(item, Event)
                if item.seq is not None and item.seq <= last_seq:
                    continue  # the backfill already delivered it
                last_seq = item.seq or last_seq
                yield sse_message(item)
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
