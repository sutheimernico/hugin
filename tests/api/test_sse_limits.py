"""The event stream neither truncates a long backfill nor buffers without bound."""

import json

from hugin.api.routes_events import event_stream
from hugin.kernel.events import EventKind, make_event


def _seqs(frames: list[dict]) -> list[int]:
    return [json.loads(frame["data"])["seq"] for frame in frames]


async def test_backfill_is_not_capped_at_ten_thousand_events(make_kernel):
    kernel = await make_kernel()
    run_id = await kernel.create_run("Lang", driver="scripted")
    for _ in range(10_500):  # straight into the log: this test is about reading it back
        kernel.log.append(
            make_event(EventKind.PROC_TEXT, run_id=run_id, pid=1, data={"delta": "x"}, ts=0.0)
        )
    total = kernel.log.last_seq()

    stream = event_stream(kernel, None, 0)
    seen = []
    async for frame in stream:
        seen.append(frame)
        if json.loads(frame["data"])["seq"] == total:
            break
    await stream.aclose()

    assert len(seen) == total > 10_000
    assert _seqs(seen) == list(range(1, total + 1))
    assert len(list(kernel.log.iter_since(0, run_id))) > 10_000


async def test_a_slow_client_resyncs_from_the_log_instead_of_growing_a_queue(make_kernel):
    kernel = await make_kernel()
    run_id = await kernel.create_run("Schnell", driver="scripted")
    stream = event_stream(kernel, run_id, 0, queue_max=3)
    first = await anext(stream)  # backfill delivered, subscription is open

    for index in range(20):  # the client reads nothing while the kernel keeps emitting
        await kernel.emit(EventKind.PROC_TEXT, run_id=run_id, pid=None, data={"delta": str(index)})
    last = kernel.log.last_seq()

    frames = [first]
    while _seqs(frames)[-1] < last:
        frames.append(await anext(stream))
    await stream.aclose()

    # Nothing lost, nothing duplicated, in order — although the queue held at most three.
    assert _seqs(frames) == list(range(_seqs(frames)[0], last + 1))
