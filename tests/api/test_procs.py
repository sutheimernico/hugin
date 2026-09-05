"""The process table, kill routes and the program catalogue over HTTP."""

import asyncio

PROC_FIELDS = {
    "pid",
    "run_id",
    "ppid",
    "program",
    "role",
    "driver",
    "model",
    "state",
    "task",
    "budget",
    "usage",
    "started_at",
    "exited_at",
    "exit_reason",
}


async def test_procs_list_after_a_scripted_mission(api, start_mission, wait_for_run):
    run_id = await start_mission(api)
    await wait_for_run(api, run_id)

    procs = (await api.client.get("/api/procs")).json()
    assert len(procs) >= 5
    assert set(procs[0]) == PROC_FIELDS
    assert [proc["program"] for proc in procs] == ["planner", "scout", "scout", "scout", "judge"]
    assert {proc["state"] for proc in procs} == {"done"}
    assert all(proc["run_id"] == run_id for proc in procs)
    assert procs[1]["ppid"] == procs[0]["pid"]
    # Budget and usage are nested objects, not flattened columns.
    assert set(procs[0]["budget"]) == {"max_turns", "max_seconds", "max_output_tokens"}
    assert set(procs[0]["usage"]) == {"turns", "input_tokens", "output_tokens", "cost_usd_equiv"}
    assert procs[0]["exit_reason"] == "done"
    assert procs[0]["exited_at"] >= procs[0]["started_at"]


async def test_kill_all_on_an_empty_kernel_returns_no_pids(api):
    response = await api.client.post("/api/kill-all")

    assert response.status_code == 200
    assert response.json() == {"killed": []}


async def test_kill_all_reports_the_pids_that_were_alive(make_api, start_mission):
    # A driver limit of zero parks the planner in `queued`, where it stays until it is killed —
    # so the answer must name it, and the call after it must name nobody.
    api = await make_api(limits={"scripted": 0})
    await start_mission(api)

    response = await api.client.post("/api/kill-all")

    assert response.json() == {"killed": [1]}
    assert (await api.client.get("/api/procs")).json()[0]["state"] == "killed"
    assert (await api.client.post("/api/kill-all")).json() == {"killed": []}


async def test_kill_unknown_proc_is_404(api):
    assert (await api.client.post("/api/procs/99/kill")).status_code == 404


async def test_kill_a_running_proc(make_api, start_mission):
    api = await make_api(clock_sleep=asyncio.sleep)
    await start_mission(api)

    response = await api.client.post("/api/procs/1/kill")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


async def test_programs_are_listed_without_their_system_prompt(api):
    programs = (await api.client.get("/api/programs")).json()

    assert {program["name"] for program in programs} >= {"planner", "scout", "judge"}
    assert set(programs[0]) == {
        "name",
        "role",
        "icon",
        "accent",
        "driver",
        "model",
        "tools",
        "capabilities",
        "budget",
    }
    assert all("system_prompt" not in program for program in programs)
