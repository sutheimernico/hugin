"""Append-only SQLite event log — the single source of truth the kernel is rebuilt from.

The database assigns `seq` (INTEGER PRIMARY KEY, so it is the rowid and autoincrements),
which makes it the one place where event order is decided. WAL mode keeps readers
(SSE backfill, replay) from blocking the writer.
"""

import json
import sqlite3
from collections.abc import Iterator, Sequence
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

    def since(
        self,
        seq: int,
        run_id: str | None = None,
        limit: int = 10_000,
        kinds: Sequence[EventKind] | None = None,
    ) -> list[Event]:
        """One page of events after `seq`, in order. `iter_since` walks the whole log."""
        clauses = ["seq > ?"]
        params: list[int | str] = [seq]
        if run_id is not None:
            clauses.append("run_id = ?")
            params.append(run_id)
        if kinds is not None:
            clauses.append(f"kind IN ({', '.join('?' * len(kinds))})")
            params.extend(kind.value for kind in kinds)
        rows = self._conn.execute(
            "SELECT seq, ts, run_id, pid, kind, data FROM events"
            f" WHERE {' AND '.join(clauses)} ORDER BY seq LIMIT ?",
            (*params, limit),
        )
        return [_row_to_event(row) for row in rows]

    def iter_since(
        self,
        seq: int = 0,
        run_id: str | None = None,
        kinds: Sequence[EventKind] | None = None,
        page: int = 2_000,
    ) -> Iterator[Event]:
        """Every matching event after `seq`, fetched a page at a time.

        A single `since` call is capped, and a cap that silently ends a backfill is how a long
        run loses its tail in the UI. Paging by `seq` keeps memory flat and misses nothing.
        """
        cursor = seq
        while True:
            events = self.since(cursor, run_id, limit=page, kinds=kinds)
            yield from events
            if len(events) < page:
                return
            cursor = events[-1].seq or cursor

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
