import logging

from hugin.kernel.bus import EventBus
from hugin.kernel.events import Event, EventKind, make_event
from hugin.kernel.log import EventLog


def _event(delta="hi"):
    return make_event(EventKind.PROC_TEXT, run_id="r1", pid=1, data={"delta": delta}, ts=1.0)


async def test_publish_appends_first_then_delivers_in_order(tmp_path):
    log = EventLog(tmp_path / "hugin.db")
    bus = EventBus(log)
    calls: list[str] = []

    async def first(event: Event) -> None:
        calls.append(f"first:{event.seq}")

    async def second(event: Event) -> None:
        calls.append(f"second:{event.seq}")

    bus.subscribe(first)
    bus.subscribe(second)
    published = await bus.publish(_event())

    assert published.seq == 1
    assert calls == ["first:1", "second:1"]
    assert [e.seq for e in log.since(0)] == [1]
    log.close()


async def test_raising_subscriber_does_not_stop_the_next(tmp_path, caplog):
    log = EventLog(tmp_path / "hugin.db")
    bus = EventBus(log)
    seen: list[int | None] = []

    async def boom(event: Event) -> None:
        raise RuntimeError("subscriber exploded")

    async def good(event: Event) -> None:
        seen.append(event.seq)

    bus.subscribe(boom)
    bus.subscribe(good)
    with caplog.at_level(logging.ERROR):
        await bus.publish(_event())

    assert seen == [1]
    assert "subscriber exploded" in caplog.text
    log.close()


async def test_unsubscribe_stops_delivery(tmp_path):
    log = EventLog(tmp_path / "hugin.db")
    bus = EventBus(log)
    seen: list[str] = []

    async def sub(event: Event) -> None:
        seen.append(event.data["delta"])

    unsubscribe = bus.subscribe(sub)
    await bus.publish(_event("a"))
    unsubscribe()
    await bus.publish(_event("b"))

    assert seen == ["a"]
    assert log.last_seq() == 2
    log.close()
