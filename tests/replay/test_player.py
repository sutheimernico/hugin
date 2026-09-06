"""Replay pacing: the player re-emits stored events with scaled, capped gaps.

Time never passes here — the injected `sleep` only records what it was asked to wait for, so
the delays themselves are the assertion.
"""

from pathlib import Path

import pytest

from hugin.kernel.events import Event, EventKind, make_event
from hugin.kernel.log import EventLog
from hugin.replay.player import Player


class FakeSleep:
    """Stands in for `asyncio.sleep`: records the delay instead of waiting for it."""

    def __init__(self) -> None:
        self.delays: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.delays.append(seconds)


@pytest.fixture
def log(tmp_path: Path) -> EventLog:
    log = EventLog(tmp_path / "hugin.db")
    yield log
    log.close()


def _event(seq: int, ts: float) -> Event:
    return Event(seq=seq, ts=ts, run_id="r1", pid=1, kind=EventKind.PROC_TEXT, data={"delta": "x"})


async def _drain(player: Player, events: list[Event], **kwargs) -> list[Event]:
    return [event async for event in player.stream_events(events, **kwargs)]


async def test_gaps_are_divided_by_speed_and_capped(log: EventLog):
    sleep = FakeSleep()
    player = Player(log, sleep=sleep)
    events = [_event(1, 0.0), _event(2, 1.0), _event(3, 11.0)]

    yielded = await _drain(player, events, speed=2.0)

    assert [event.seq for event in yielded] == [1, 2, 3]
    # First event immediate; 1 s / 2 = 0.5 s; 10 s / 2 = 5 s, capped at max_gap_s.
    assert sleep.delays == [0.5, 3.0]


async def test_higher_speed_halves_every_gap_again(log: EventLog):
    sleep = FakeSleep()
    player = Player(log, sleep=sleep)
    events = [_event(1, 0.0), _event(2, 1.0), _event(3, 11.0)]

    await _drain(player, events, speed=4.0)

    # At 4x the second gap is 2.5 s, so the cap no longer bites.
    assert sleep.delays == [0.25, 2.5]


async def test_from_seq_skips_and_the_first_delivered_event_is_immediate(log: EventLog):
    sleep = FakeSleep()
    player = Player(log, sleep=sleep)
    events = [_event(1, 0.0), _event(2, 1.0), _event(3, 3.0)]

    yielded = await _drain(player, events, speed=1.0, from_seq=2)

    assert [event.seq for event in yielded] == [3]
    assert sleep.delays == []


async def test_stream_reads_one_run_out_of_the_log(log: EventLog):
    for run_id, ts in (("r1", 0.0), ("r2", 0.5), ("r1", 2.0)):
        log.append(
            make_event(EventKind.PROC_TEXT, run_id=run_id, pid=1, data={"delta": run_id}, ts=ts)
        )
    sleep = FakeSleep()
    player = Player(log, sleep=sleep)

    yielded = [event async for event in player.stream("r1", speed=2.0)]

    assert [event.data["delta"] for event in yielded] == ["r1", "r1"]
    assert sleep.delays == [1.0]


async def test_max_gap_is_configurable(log: EventLog):
    sleep = FakeSleep()
    player = Player(log, sleep=sleep, max_gap_s=0.5)

    await _drain(player, [_event(1, 0.0), _event(2, 9.0)])

    assert sleep.delays == [0.5]
