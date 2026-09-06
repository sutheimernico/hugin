import sqlite3
import time

from hugin.kernel.events import EventKind, make_event
from hugin.kernel.log import EventLog


def _event(kind=EventKind.PROC_TEXT, *, run_id="r1", pid=1, data=None, ts=1.0):
    return make_event(kind, run_id=run_id, pid=pid, data=data or {"delta": "hi"}, ts=ts)


def test_seq_is_strictly_increasing(tmp_path):
    log = EventLog(tmp_path / "sub" / "hugin.db")
    first = log.append(_event())
    second = log.append(_event())
    assert first.seq == 1
    assert second.seq == 2
    log.close()


def test_since_returns_events_after_the_given_seq(tmp_path):
    log = EventLog(tmp_path / "hugin.db")
    first = log.append(_event(data={"delta": "a"}))
    second = log.append(_event(data={"delta": "b"}))

    assert [e.seq for e in log.since(0)] == [first.seq, second.seq]
    assert [e.seq for e in log.since(1)] == [second.seq]
    assert log.since(0)[0].data == {"delta": "a"}
    assert log.since(0)[0].kind is EventKind.PROC_TEXT
    log.close()


def test_since_filters_by_run_id(tmp_path):
    log = EventLog(tmp_path / "hugin.db")
    log.append(_event(run_id="r1"))
    other = log.append(_event(run_id="r2"))

    assert [e.seq for e in log.since(0, run_id="r2")] == [other.seq]
    log.close()


def test_for_run_returns_only_that_run_in_seq_order(tmp_path):
    log = EventLog(tmp_path / "hugin.db")
    a = log.append(_event(run_id="r1"))
    log.append(_event(run_id="r2"))
    b = log.append(_event(run_id="r1"))

    assert [e.seq for e in log.for_run("r1")] == [a.seq, b.seq]
    log.close()


def test_last_seq_starts_at_zero_and_follows_appends(tmp_path):
    log = EventLog(tmp_path / "hugin.db")
    assert log.last_seq() == 0
    log.append(_event())
    log.append(_event())
    assert log.last_seq() == 2
    log.close()


def test_events_table_has_an_index_on_run_id(tmp_path):
    db_path = tmp_path / "hugin.db"
    log = EventLog(db_path)
    log.append(_event())
    log.close()

    conn = sqlite3.connect(db_path)
    indexes = conn.execute("PRAGMA index_list('events')").fetchall()
    columns = {
        column[2]
        for index in indexes
        for column in conn.execute(f"PRAGMA index_info('{index[1]}')").fetchall()
    }
    conn.close()
    assert "run_id" in columns


def test_max_pid_is_zero_without_events_and_follows_appends(tmp_path):
    log = EventLog(tmp_path / "hugin.db")
    assert log.max_pid() == 0

    log.append(_event(pid=1))
    log.append(_event(pid=7))
    log.append(_event(pid=3))
    log.append(_event(pid=None))

    assert log.max_pid() == 7
    log.close()


def test_last_boot_seq_points_at_the_latest_boot_event(tmp_path):
    log = EventLog(tmp_path / "hugin.db")
    assert log.last_boot_seq() == 0

    boot = {"version": "0.1.0", "pid_counter": 1}
    log.append(_event(kind=EventKind.KERNEL_BOOT, run_id=None, pid=None, data=boot))
    log.append(_event())
    second_boot = log.append(_event(kind=EventKind.KERNEL_BOOT, run_id=None, pid=None, data=boot))
    log.append(_event())

    assert log.last_boot_seq() == second_boot.seq
    log.close()


def test_ten_thousand_appends_stay_under_two_seconds(tmp_path):
    log = EventLog(tmp_path / "hugin.db")
    event = _event()

    started = time.perf_counter()
    for _ in range(10_000):
        log.append(event)
    elapsed = time.perf_counter() - started

    assert log.last_seq() == 10_000
    assert elapsed < 2.0, f"10k appends took {elapsed:.2f}s"
    log.close()
