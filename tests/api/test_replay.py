"""Replay over HTTP: run replay as SSE, plus exporting, listing and replaying recordings."""

import json

import pytest

from hugin.kernel.events import EventKind
from tests.api.conftest import payload

# Assembled at runtime so the repository never holds a contiguous credential-looking string.
FAKE_KEY = "sk-" + "ant-" + "A" * 24


async def _finished_run(api, start_mission, wait_for_run) -> str:
    run_id = await start_mission(api)
    await wait_for_run(api, run_id)
    return run_id


async def _export(api, run_id: str, slug: str = "demo-run"):
    return await api.client.post(f"/api/recordings/{run_id}", json={"slug": slug})


# --- run replay -------------------------------------------------------------------------


async def test_run_replay_streams_the_stored_events(api, start_mission, wait_for_run, sse):
    run_id = await _finished_run(api, start_mission, wait_for_run)

    async with sse(f"/api/runs/{run_id}/replay/stream?speed=8") as stream:
        first = await stream.message()
        exit_message = await stream.until(lambda m: m["event"] == "run.done")

    assert first["event"] == "run.created"
    assert payload(first)["data"]["driver"] == "scripted"
    assert int(first["id"]) < int(exit_message["id"])


async def test_run_replay_resumes_after_from_seq(api, start_mission, wait_for_run, sse):
    run_id = await _finished_run(api, start_mission, wait_for_run)
    events = (await api.client.get(f"/api/runs/{run_id}/events")).json()
    cut = events[1]["seq"]

    async with sse(f"/api/runs/{run_id}/replay/stream?speed=8&from_seq={cut}") as stream:
        first = await stream.message()

    assert int(first["id"]) == events[2]["seq"]


@pytest.mark.parametrize("speed", [3, 0, 16])
async def test_run_replay_rejects_an_unsupported_speed(api, start_mission, wait_for_run, speed):
    run_id = await _finished_run(api, start_mission, wait_for_run)

    response = await api.client.get(f"/api/runs/{run_id}/replay/stream?speed={speed}")

    assert response.status_code == 422


async def test_run_replay_of_an_unknown_run_is_404(api):
    response = await api.client.get("/api/runs/nope/replay/stream?speed=1")

    assert response.status_code == 404
    assert "nope" in response.json()["detail"]


# --- recordings -------------------------------------------------------------------------


async def test_export_returns_a_manifest_and_lists_it(api, start_mission, wait_for_run):
    run_id = await _finished_run(api, start_mission, wait_for_run)

    response = await _export(api, run_id)

    assert response.status_code == 201, response.text
    manifest = response.json()
    assert manifest["slug"] == "demo-run"
    assert manifest["run_id"] == run_id
    assert manifest["driver"] == "scripted"
    assert manifest["events"] > 0
    listed = (await api.client.get("/api/recordings")).json()
    assert [entry["slug"] for entry in listed] == ["demo-run"]


async def test_export_rejects_a_bad_slug(api, start_mission, wait_for_run):
    run_id = await _finished_run(api, start_mission, wait_for_run)

    response = await _export(api, run_id, slug="Nicht Erlaubt")

    assert response.status_code == 422


async def test_export_of_an_unknown_run_is_404(api):
    response = await _export(api, "nope")

    assert response.status_code == 404
    assert "nope" in response.json()["detail"]


async def test_export_refuses_a_run_that_carries_a_secret(api, start_mission, wait_for_run):
    run_id = await _finished_run(api, start_mission, wait_for_run)
    await api.kernel.emit(
        EventKind.PROC_TEXT, run_id=run_id, pid=1, data={"delta": f"key: {FAKE_KEY}"}
    )

    response = await _export(api, run_id)

    assert response.status_code == 400
    assert "anthropic_key" in response.json()["detail"]
    assert list(api.kernel.settings.recordings_dir.glob("*")) == []


async def test_recording_events_are_served_as_json(api, start_mission, wait_for_run):
    run_id = await _finished_run(api, start_mission, wait_for_run)
    await _export(api, run_id)

    events = (await api.client.get("/api/recordings/demo-run/events")).json()

    assert [event["seq"] for event in events] == list(range(1, len(events) + 1))
    assert events[0]["kind"] == "run.created"


async def test_unknown_recording_is_404(api):
    for url in ("/api/recordings/nope/events", "/api/recordings/nope/replay/stream"):
        response = await api.client.get(url)
        assert response.status_code == 404, url
        assert "nope" in response.json()["detail"]


async def test_recording_replay_streams_from_the_file(api, start_mission, wait_for_run, sse):
    run_id = await _finished_run(api, start_mission, wait_for_run)
    await _export(api, run_id)

    async with sse("/api/recordings/demo-run/replay/stream?speed=8") as stream:
        first = await stream.message()

    assert first["id"] == "1"
    assert first["event"] == "run.created"
    assert json.loads(first["data"])["kind"] == "run.created"
