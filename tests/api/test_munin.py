"""The munin routes: a thin proxy in front of the memory store."""

MEMORY_FIELDS = {"id", "title", "body", "tags", "run_id", "pid", "program", "created_at"}


def _write(api, title: str, body: str, **extra):
    return api.kernel.syscalls.munin.write(
        title,
        body,
        extra.pop("tags", ["test"]),
        run_id=extra.pop("run_id", "r1"),
        pid=extra.pop("pid", 1),
        program=extra.pop("program", "scout"),
        ts=extra.pop("ts", 1_000.0),
    )


async def test_search_proxies_the_store(api):
    memory = _write(api, "VRAM-Grenze", "Ein 7B-Modell passt in 4 Bit auf 8 GB VRAM.")
    _write(api, "Anderes Thema", "Nichts mit Speicher zu tun.", ts=1_001.0)

    hits = (await api.client.get("/api/munin/search", params={"q": "VRAM"})).json()

    assert [hit["id"] for hit in hits] == [memory.id]
    assert set(hits[0]) == MEMORY_FIELDS
    assert hits[0]["title"] == "VRAM-Grenze"
    assert hits[0]["tags"] == ["test"]
    assert hits[0]["program"] == "scout"


async def test_search_honours_the_limit_and_survives_an_empty_query(api):
    for index in range(3):
        _write(api, f"Notiz {index}", "gemeinsames Stichwort", ts=1_000.0 + index)

    limited = (
        await api.client.get("/api/munin/search", params={"q": "Stichwort", "limit": 2})
    ).json()
    assert len(limited) == 2
    assert (await api.client.get("/api/munin/search", params={"q": ""})).json() == []


async def test_recent_returns_the_newest_first(api):
    _write(api, "Alt", "früh", ts=1_000.0)
    newest = _write(api, "Neu", "spät", ts=2_000.0)

    recent = (await api.client.get("/api/munin/recent")).json()

    assert recent[0]["id"] == newest.id
    assert recent[0]["created_at"] == 2_000.0


async def test_single_memory_and_404(api):
    memory = _write(api, "Einzeln", "Ein Eintrag.")

    found = await api.client.get(f"/api/munin/{memory.id}")
    assert found.status_code == 200
    assert found.json()["body"] == "Ein Eintrag."

    assert (await api.client.get("/api/munin/9999")).status_code == 404


async def test_a_scripted_mission_leaves_memories_behind(api, start_mission, wait_for_run):
    run_id = await start_mission(api)
    await wait_for_run(api, run_id)

    recent = (await api.client.get("/api/munin/recent")).json()
    assert len(recent) == 3
    assert all(memory["run_id"] == run_id for memory in recent)
    assert all(memory["program"] == "scout" for memory in recent)
