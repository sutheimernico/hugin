"""Missions, runs, artifacts and templates over HTTP."""

from tests.api.conftest import DEFAULT_GOAL

RUN_FIELDS = {
    "id",
    "goal",
    "driver",
    "template",
    "state",
    "created_at",
    "done_at",
    "root_pid",
    "usage",
    "artifacts",
}


async def test_mission_creates_a_visible_run(api, start_mission):
    run_id = await start_mission(api)

    listed = (await api.client.get("/api/runs")).json()
    assert [run["id"] for run in listed] == [run_id]
    run = listed[0]
    assert set(run) == RUN_FIELDS
    assert run["goal"] == DEFAULT_GOAL
    assert run["driver"] == "scripted"
    assert run["root_pid"] == 1
    assert set(run["usage"]) == {"turns", "input_tokens", "output_tokens", "cost_usd_equiv"}

    single = await api.client.get(f"/api/runs/{run_id}")
    assert single.status_code == 200
    assert single.json()["id"] == run_id


async def test_unknown_run_is_404(api):
    assert (await api.client.get("/api/runs/nope")).status_code == 404
    assert (await api.client.get("/api/runs/nope/events")).status_code == 404
    assert (await api.client.get("/api/runs/nope/artifacts")).status_code == 404


async def test_run_events_start_with_run_created(api, start_mission):
    run_id = await start_mission(api)

    events = (await api.client.get(f"/api/runs/{run_id}/events")).json()
    assert events[0]["kind"] == "run.created"
    assert events[0]["run_id"] == run_id
    assert events[0]["data"]["goal"] == DEFAULT_GOAL
    # `kernel.boot` carries no run, so a run's own stream never sees it.
    assert all(event["run_id"] == run_id for event in events)
    assert [event["seq"] for event in events] == sorted(event["seq"] for event in events)


async def test_run_events_honour_since(api, start_mission):
    run_id = await start_mission(api)
    events = (await api.client.get(f"/api/runs/{run_id}/events")).json()

    later = (
        await api.client.get(f"/api/runs/{run_id}/events", params={"since": events[0]["seq"]})
    ).json()
    assert later[0]["seq"] == events[1]["seq"]


async def test_finished_run_reports_usage_and_artifacts(api, start_mission, wait_for_run):
    run_id = await start_mission(api)
    run = await wait_for_run(api, run_id)

    assert run["state"] == "done"
    assert run["done_at"] is not None
    # The run aggregates every process, not just the root: planner 7 + 3 scouts à 4 + judge 2.
    assert run["usage"]["turns"] == 21
    assert run["artifacts"] == ["report.md"]


async def test_artifacts_are_listed_and_served(api, start_mission, wait_for_run):
    run_id = await start_mission(api)
    await wait_for_run(api, run_id)

    listing = (await api.client.get(f"/api/runs/{run_id}/artifacts")).json()
    assert [entry["name"] for entry in listing] == ["report.md"]
    assert listing[0]["bytes"] > 0

    artifact = await api.client.get(f"/api/runs/{run_id}/artifacts/report.md")
    assert artifact.status_code == 200
    assert artifact.headers["content-type"].startswith("text/plain")
    assert "SIMULATION" in artifact.text
    assert len(artifact.content) == listing[0]["bytes"]


async def test_unknown_or_escaping_artifact_is_404(api, start_mission, wait_for_run):
    run_id = await start_mission(api)
    await wait_for_run(api, run_id)

    assert (await api.client.get(f"/api/runs/{run_id}/artifacts/missing.md")).status_code == 404
    escaping = await api.client.get(
        f"/api/runs/{run_id}/artifacts/..%2F..%2Fdata%2Fhugin.db", follow_redirects=True
    )
    assert escaping.status_code == 404


async def test_empty_goal_is_rejected(api):
    response = await api.client.post("/api/missions", json={"goal": "   ", "driver": "scripted"})

    assert response.status_code == 422
    assert response.json()["detail"] == "Ziel darf nicht leer sein."
    assert (await api.client.get("/api/runs")).json() == []


async def test_path_outside_private_is_rejected(api):
    response = await api.client.post(
        "/api/missions", json={"goal": "Analysiere /etc/passwd", "driver": "scripted"}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Pfade müssen unter ~/private liegen."


async def test_path_inside_private_is_accepted(api, start_mission):
    run_id = await start_mission(api, "Analysiere das Repository unter ~/private/hugin.")

    run = (await api.client.get(f"/api/runs/{run_id}")).json()
    assert run["goal"].endswith("~/private/hugin.")


async def test_a_url_in_the_goal_is_not_a_path(api, start_mission):
    await start_mission(api, "Recherchiere https://example.com/docs/agents und fasse zusammen.")


async def test_a_driver_this_kernel_does_not_have_is_rejected(api):
    # The gate's other half — a driver that *is* registered but unavailable — is a 409 and
    # lives in `tests/api/test_system.py`, next to the subsystem report it reads.
    response = await api.client.post("/api/missions", json={"goal": "Test", "driver": "claude"})

    assert response.status_code == 422
    assert "claude" in response.json()["detail"]


async def test_templates_are_offered(api):
    templates = (await api.client.get("/api/templates")).json()

    assert [template["id"] for template in templates] == [
        "research_brief",
        "compare_options",
        "analyse_repo",
    ]
    assert templates[0]["title"] == "Recherche-Briefing"
    assert all(template["goal"] for template in templates)


async def test_template_is_recorded_on_the_run(api, start_mission):
    run_id = await start_mission(api, template="research_brief")

    assert (await api.client.get(f"/api/runs/{run_id}")).json()["template"] == "research_brief"
