import pytest

from hugin.munin.store import MuninStore


@pytest.fixture
def store(tmp_path):
    store = MuninStore(tmp_path / "sub" / "hugin.db")
    yield store
    store.close()


def _write(store, title, body, tags, *, ts=1.0, run_id="r1", pid=1, program="scout"):
    return store.write(title, body, tags, run_id=run_id, pid=pid, program=program, ts=ts)


def test_search_finds_a_memory_by_a_word_in_its_body(store):
    hit = _write(store, "Solar", "Perovskite tandem cells hit 33 percent", ["energy"])
    _write(store, "Wind", "Offshore turbines grew to 15 megawatt", ["energy"])

    found = store.search("perovskite")

    assert [m.id for m in found] == [hit.id]
    assert found[0].title == "Solar"


def test_search_finds_a_memory_by_one_of_its_tags(store):
    _write(store, "Solar", "Perovskite tandem cells", ["energy", "hardware"])
    hit = _write(store, "Ledger", "Quarterly numbers", ["finance"])

    found = store.search("finance")

    assert [m.id for m in found] == [hit.id]


def test_search_survives_fts_operator_characters(store):
    _write(store, "Solar", "Perovskite tandem cells", ["energy"])

    for query in ['"solar', "solar*", 'cells" AND *(x):^-+', '"', "*", "-"]:
        assert isinstance(store.search(query), list)


def test_search_of_an_empty_query_returns_nothing(store):
    _write(store, "Solar", "Perovskite tandem cells", ["energy"])

    assert store.search("") == []
    assert store.search("   ") == []
    assert store.search('*"^') == []


def test_search_respects_the_limit(store):
    for i in range(5):
        _write(store, f"Note {i}", "shared keyword body", ["energy"], ts=float(i))

    assert len(store.search("shared", limit=2)) == 2
    assert len(store.search("shared")) == 5


def test_provenance_round_trips(store):
    written = _write(
        store,
        "Solar",
        "Perovskite tandem cells",
        ["energy", "hardware"],
        ts=1725500000.5,
        run_id="run-7",
        pid=42,
        program="scout",
    )

    stored = store.get(written.id)

    assert stored == written
    assert stored.tags == ["energy", "hardware"]
    assert (stored.run_id, stored.pid, stored.program) == ("run-7", 42, "scout")
    assert stored.created_at == 1725500000.5


def test_provenance_may_be_absent(store):
    written = store.write("Solar", "Cells", [], run_id=None, pid=None, program=None, ts=2.0)

    stored = store.get(written.id)

    assert (stored.run_id, stored.pid, stored.program, stored.tags) == (None, None, None, [])


def test_get_of_an_unknown_id_returns_none(store):
    assert store.get(404) is None


def test_count_counts_written_memories(store):
    assert store.count() == 0
    _write(store, "Solar", "Cells", ["energy"])
    _write(store, "Wind", "Turbines", ["energy"])

    assert store.count() == 2


def test_recent_returns_newest_first(store):
    old = _write(store, "Old", "Cells", ["energy"], ts=1.0)
    new = _write(store, "New", "Turbines", ["energy"], ts=3.0)
    middle = _write(store, "Middle", "Grid", ["energy"], ts=2.0)

    assert [m.id for m in store.recent()] == [new.id, middle.id, old.id]
    assert [m.id for m in store.recent(limit=1)] == [new.id]


def test_recent_breaks_ties_on_id_newest_first(store):
    first = _write(store, "First", "Cells", ["energy"], ts=5.0)
    second = _write(store, "Second", "Cells", ["energy"], ts=5.0)

    assert [m.id for m in store.recent()] == [second.id, first.id]


def test_ids_are_stable_and_shared_between_meta_and_index(store):
    first = _write(store, "Solar", "Perovskite", ["energy"])
    second = _write(store, "Wind", "Turbines", ["energy"])

    assert (first.id, second.id) == (1, 2)
    assert store.search("perovskite")[0] == store.get(first.id)


def test_the_store_shares_the_database_file_with_the_event_log(tmp_path):
    from hugin.kernel.events import EventKind, make_event
    from hugin.kernel.log import EventLog

    db_path = tmp_path / "hugin.db"
    log = EventLog(db_path)
    log.append(make_event(EventKind.PROC_TEXT, run_id="r1", pid=1, data={"delta": "hi"}, ts=1.0))
    store = MuninStore(db_path)

    written = _write(store, "Solar", "Perovskite", ["energy"])

    assert store.get(written.id) == written
    assert log.last_seq() == 1
    store.close()
    log.close()
