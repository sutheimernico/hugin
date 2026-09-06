"""Time-scaled playback of stored events.

The pacing is the whole job: an event stream replayed without its original gaps is a dump, one
replayed with them is unwatchable when an agent thought for half a minute. So gaps are divided
by `speed` and capped at `max_gap_s`. The clock is injected, which is what makes this testable:
a fake `sleep` records the delays instead of waiting for them.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable

from hugin.kernel.events import Event
from hugin.kernel.log import EventLog

MAX_GAP_S = 3.0
# The speeds the UI offers; the routes reject anything else with 422.
SPEEDS = (1, 2, 4, 8)


class Player:
    def __init__(
        self,
        log: EventLog,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        max_gap_s: float = MAX_GAP_S,
    ):
        self.log = log
        self._sleep = sleep
        self.max_gap_s = max_gap_s

    async def stream(
        self, run_id: str, speed: float = 1.0, from_seq: int = 0
    ) -> AsyncIterator[Event]:
        """Replay one run straight out of the log."""
        async for event in self.stream_events(self.log.for_run(run_id), speed, from_seq):
            yield event

    async def stream_events(
        self, events: list[Event], speed: float = 1.0, from_seq: int = 0
    ) -> AsyncIterator[Event]:
        """Replay a list of events — a recording read from a file takes the same route.

        The first *delivered* event is immediate, so resuming at `from_seq` does not begin with
        the wait that would have preceded the events the client already has.
        """
        previous_ts: float | None = None
        for event in events:
            if event.seq is not None and event.seq <= from_seq:
                continue
            if previous_ts is not None:
                await self._sleep(min((event.ts - previous_ts) / speed, self.max_gap_s))
            previous_ts = event.ts
            yield event
