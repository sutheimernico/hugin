"""Append-only SQLite event log — the single source of truth the kernel is rebuilt from.

The database assigns `seq` (INTEGER PRIMARY KEY, so it is the rowid and autoincrements),
which makes it the one place where event order is decided. WAL mode keeps readers
(SSE backfill, replay) from blocking the writer.
"""

import json
import sqlite3
from pathlib import Path

from hugin.kernel.events import Event, EventKind

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    seq    INTEGER PRIMARY KEY,
    ts     REAL NOT NULL,
    run_id TEXT,
    pid    INTEGER,
    kind   TEXT NOT NULL,
    data   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
"""


class EventLog:
    def __init__(self, db_path: Path):
        db_path = Path(db_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        # isolation_level=None: every INSERT commits on its own, so no open transaction can
        # swallow events. synchronous=NORMAL is the WAL trade-off: committed events survive a
        # process crash, only an OS/power failure can lose the newest ones — FULL would fsync
        # per append and cost ~5 s per 10 000 appends.
        self._conn = sqlite3.connect(db_path, check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.executescript(_SCHEMA)

    def append(self, event: Event) -> Event:
        cursor = self._conn.execute(
            "INSERT INTO events (ts, run_id, pid, kind, data) VALUES (?, ?, ?, ?, ?)",
            (
                event.ts,
                event.run_id,
                event.pid,
                event.kind.value,
                json.dumps(event.data),
            ),
        )
        return event.model_copy(update={"seq": cursor.lastrowid})

    def since(self, seq: int, run_id: str | None = None, limit: int = 10_000) -> list[Event]:
        if run_id is None:
            rows = self._conn.execute(
                "SELECT seq, ts, run_id, pid, kind, data FROM events"
                " WHERE seq > ? ORDER BY seq LIMIT ?",
                (seq, limit),
            )
        else:
            rows = self._conn.execute(
                "SELECT seq, ts, run_id, pid, kind, data FROM events"
                " WHERE seq > ? AND run_id = ? ORDER BY seq LIMIT ?",
                (seq, run_id, limit),
            )
        return [_row_to_event(row) for row in rows]

    def for_run(self, run_id: str) -> list[Event]:
        rows = self._conn.execute(
            "SELECT seq, ts, run_id, pid, kind, data FROM events WHERE run_id = ? ORDER BY seq",
            (run_id,),
        )
        return [_row_to_event(row) for row in rows]

    def last_seq(self) -> int:
        row = self._conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()
        return int(row[0])

    def max_pid(self) -> int:
        """The highest pid this log has ever seen — 0 when it has seen none.

        A restarted kernel reads it so a new process can never reuse a pid an old event
        already names: the log is one timeline, and a pid in it must mean one process.
        """
        row = self._conn.execute("SELECT COALESCE(MAX(pid), 0) FROM events").fetchone()
        return int(row[0])

    def last_boot_seq(self) -> int:
        """The seq of the most recent `kernel.boot` event — 0 when the kernel never booted."""
        row = self._conn.execute(
            "SELECT COALESCE(MAX(seq), 0) FROM events WHERE kind = ?",
            (EventKind.KERNEL_BOOT.value,),
        ).fetchone()
        return int(row[0])

    def close(self) -> None:
        self._conn.close()


def _row_to_event(row: tuple) -> Event:
    seq, ts, run_id, pid, kind, data = row
    return Event(
        seq=seq,
        ts=ts,
        run_id=run_id,
        pid=pid,
        kind=EventKind(kind),
        data=json.loads(data),
    )
