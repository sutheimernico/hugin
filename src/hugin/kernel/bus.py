"""In-process async pub/sub over the event log.

`publish` writes to the log before it fans out, so every subscriber sees an event that
already carries its `seq` — SSE clients, the recorder and the budget watcher all agree
on the same ordering as a later replay.
"""

import logging
from collections.abc import Awaitable, Callable

from hugin.kernel.events import Event
from hugin.kernel.log import EventLog

logger = logging.getLogger(__name__)

Subscriber = Callable[[Event], Awaitable[None]]


class EventBus:
    def __init__(self, log: EventLog):
        self._log = log
        self._subscribers: list[Subscriber] = []

    def subscribe(self, fn: Subscriber) -> Callable[[], None]:
        self._subscribers.append(fn)

        def unsubscribe() -> None:
            if fn in self._subscribers:
                self._subscribers.remove(fn)

        return unsubscribe

    async def publish(self, event: Event) -> Event:
        stored = self._log.append(event)
        # Snapshot: a subscriber may unsubscribe (or subscribe) while being awaited.
        for fn in list(self._subscribers):
            try:
                await fn(stored)
            except Exception:
                logger.exception(
                    "event subscriber failed (kind=%s seq=%s)", stored.kind, stored.seq
                )
        return stored
