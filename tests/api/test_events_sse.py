"""The SSE event stream: backfill from the log, then live from the bus."""

from tests.api.conftest import payload


async def test_backfill_ids_equal_the_event_seq(api, start_mission, wait_for_run, sse):
    run_id = await start_mission(api)
    await wait_for_run(api, run_id)
    events = (await api.client.get(f"/api/runs/{run_id}/events")).json()

    async with sse(f"/api/events/stream?run_id={run_id}&since=0") as stream:
        assert stream.status == 200
        assert stream.headers["content-type"].startswith("text/event-stream")
        delivered = [await stream.message() for _ in range(5)]

    assert [message["id"] for message in delivered] == [str(e["seq"]) for e in events[:5]]
    assert [message["event"] for message in delivered] == [e["kind"] for e in events[:5]]
    assert delivered[0]["event"] == "run.created"
    assert payload(delivered[0]) == events[0]


async def test_since_skips_what_the_client_already_has(api, start_mission, wait_for_run, sse):
    run_id = await start_mission(api)
    await wait_for_run(api, run_id)
    events = (await api.client.get(f"/api/runs/{run_id}/events")).json()

    async with sse(f"/api/events/stream?run_id={run_id}&since={events[2]['seq']}") as stream:
        first = await stream.message()

    assert first["id"] == str(events[3]["seq"])


async def test_run_filter_delivers_only_that_run(api, start_mission, wait_for_run, sse):
    first_run = await start_mission(api, "Erste Mission.")
    await wait_for_run(api, first_run)
    second_run = await start_mission(api, "Zweite Mission.")
    await wait_for_run(api, second_run)

    async with sse(f"/api/events/stream?run_id={second_run}&since=0") as stream:
        delivered = [await stream.message() for _ in range(6)]

    assert all(payload(message)["run_id"] == second_run for message in delivered)


async def test_live_events_follow_the_backfill(api, start_mission, sse):
    async with sse("/api/events/stream?since=0") as stream:
        # The boot event is the whole backfill; reading it proves the subscription is live.
        first = await stream.message()
        assert first["event"] == "kernel.boot"

        run_id = await start_mission(api, "Live-Mission.")

        created = await stream.until(lambda message: message["event"] == "run.created")
        assert payload(created)["run_id"] == run_id
        assert payload(created)["data"]["goal"] == "Live-Mission."
        spawned = await stream.until(lambda message: message["event"] == "proc.spawned")
        assert payload(spawned)["data"]["program"] == "planner"
        assert int(spawned["id"]) > int(created["id"])


async def test_a_live_event_is_never_delivered_twice(api, start_mission, sse):
    async with sse("/api/events/stream?since=0") as stream:
        await stream.message()
        await start_mission(api, "Doppelte Mission.")
        delivered = [await stream.message() for _ in range(8)]

    seqs = [int(message["id"]) for message in delivered]
    assert seqs == sorted(seqs)
    assert len(set(seqs)) == len(seqs)


async def test_the_stream_unsubscribes_when_the_client_disconnects(api, sse):
    before = len(api.kernel.bus._subscribers)

    async with sse("/api/events/stream?since=0") as stream:
        await stream.message()
        assert len(api.kernel.bus._subscribers) == before + 1

    assert len(api.kernel.bus._subscribers) == before
