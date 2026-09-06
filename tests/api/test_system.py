"""`GET /api/system` and the driver gate that reads it.

Every app here carries a fake status service (see `conftest.FakeSystem`), so the honesty the
gate enforces is tested without a CLI, a socket or a model on the machine.
"""

from hugin.drivers.scripted import ScriptedDriver
from tests.api.conftest import DEFAULT_GOAL
from tests.conftest import FakeSystem, fake_snapshot

SYSTEM_KEYS = {"claude", "ollama", "munin", "programs", "kernel"}
SUBSYSTEMS = {"claude", "ollama", "munin", "programs"}


def _drivers() -> dict:
    """A table that answers to all three names — the simulation stands in for the live two."""
    scripted = ScriptedDriver(clock_sleep=_instant)
    return {"scripted": scripted, "claude": scripted, "ollama": scripted}


async def _instant(_seconds: float) -> None:
    """No pacing in tests."""


async def test_system_reports_every_subsystem(api):
    response = await api.client.get("/api/system")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == SYSTEM_KEYS
    assert set(body["claude"]) == {"ok", "version", "detail"}
    assert set(body["ollama"]) == {"ok", "models", "detail"}
    assert set(body["munin"]) == {"count"}
    assert set(body["kernel"]) == {"uptime_s", "procs", "version"}
    assert isinstance(body["programs"], list)


async def test_boot_announces_every_subsystem_once(api):
    lines = [event for event in api.kernel.log.since(0) if event.kind == "kernel.subsystem"]

    assert {line.data["name"] for line in lines} == SUBSYSTEMS
    assert len(lines) == len(SUBSYSTEMS)
    claude = next(line for line in lines if line.data["name"] == "claude")
    assert claude.data == {"name": "claude", "status": "warn", "detail": "Nicht angemeldet"}


async def test_a_claude_mission_is_refused_while_claude_is_not_ok(make_api):
    api = await make_api(drivers=_drivers(), system=FakeSystem(fake_snapshot(claude_ok=False)))

    response = await api.client.post(
        "/api/missions", json={"goal": DEFAULT_GOAL, "driver": "claude"}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Claude nicht verfügbar: Nicht angemeldet"
    assert api.kernel.runs == {}


async def test_an_ollama_mission_is_refused_while_ollama_is_unreachable(make_api):
    api = await make_api(drivers=_drivers(), system=FakeSystem(fake_snapshot(ollama_ok=False)))

    response = await api.client.post(
        "/api/missions", json={"goal": DEFAULT_GOAL, "driver": "ollama"}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Ollama nicht verfügbar: Nicht erreichbar"


async def test_a_claude_mission_starts_once_the_subsystem_is_ok(make_api):
    api = await make_api(
        drivers=_drivers(),
        system=FakeSystem(fake_snapshot(claude_ok=True)),
        limits={"scripted": 8, "claude": 3},
    )

    response = await api.client.post(
        "/api/missions", json={"goal": DEFAULT_GOAL, "driver": "claude"}
    )

    assert response.status_code == 201, response.text
    run = api.kernel.runs[response.json()["run_id"]]
    assert run.driver == "claude"


async def test_the_gate_reads_the_live_report_not_a_boot_time_constant(make_api):
    system = FakeSystem(fake_snapshot(claude_ok=False))
    api = await make_api(drivers=_drivers(), system=system, limits={"scripted": 8, "claude": 3})
    before = system.calls

    system._snapshot = fake_snapshot(claude_ok=True)
    response = await api.client.post(
        "/api/missions", json={"goal": DEFAULT_GOAL, "driver": "claude"}
    )

    assert response.status_code == 201, response.text
    assert system.calls > before  # asked again at mission time, not once at boot


async def test_the_simulation_never_needs_the_report(api, start_mission):
    before = api.system.calls

    await start_mission(api)

    assert api.system.calls == before


async def test_an_unknown_driver_is_rejected_as_a_bad_request(api):
    response = await api.client.post(
        "/api/missions", json={"goal": DEFAULT_GOAL, "driver": "gpt"}
    )

    assert response.status_code == 422
