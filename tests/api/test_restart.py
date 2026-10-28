"""After a restart the API still knows the runs of the previous life — replay included."""

import httpx

from hugin.app import create_app
from hugin.drivers.scripted import ScriptedDriver
from hugin.settings import Settings
from tests.api.conftest import BASE_URL, _lifespan, _no_sleep
from tests.conftest import FakeSystem


def _app(tmp_path):
    settings = Settings(
        data_dir=tmp_path / "data",
        runs_dir=tmp_path / "runs",
        recordings_dir=tmp_path / "recordings",
        max_concurrent={"scripted": 8},
    )
    return create_app(
        settings, drivers={"scripted": ScriptedDriver(clock_sleep=_no_sleep)}, system=FakeSystem()
    )


async def test_runs_and_their_replay_survive_a_restart(tmp_path, wait_for_run):
    first = _app(tmp_path)
    async with (
        _lifespan(first),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=first), base_url=BASE_URL) as client,
    ):
        run_id = (
            await client.post("/api/missions", json={"goal": "Briefing", "driver": "scripted"})
        ).json()["run_id"]

        class _Api:  # the fixture only needs `.client`
            pass

        api = _Api()
        api.client = client
        await wait_for_run(api, run_id)

    second = _app(tmp_path)
    async with (
        _lifespan(second),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=second), base_url=BASE_URL) as client,
    ):
        runs = (await client.get("/api/runs")).json()
        assert [run["id"] for run in runs] == [run_id]
        assert runs[0]["state"] == "done"
        assert runs[0]["artifacts"] == ["report.md"]
        assert (await client.get(f"/api/runs/{run_id}")).status_code == 200
        events = (await client.get(f"/api/runs/{run_id}/events")).json()
        assert events[0]["kind"] == "run.created"
        replay = await client.get(f"/api/runs/{run_id}/replay/stream?speed=8")
        assert replay.status_code == 200
        assert "run.done" in replay.text
