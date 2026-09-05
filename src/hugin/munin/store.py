"""munin — the shared memory of hugin: durable facts with provenance, searchable full text.

Storage is two tables that share one id: an FTS5 virtual table `memories` holding the searchable
text, and a plain `memories_meta` row holding provenance. The meta row is written first, so its
`INTEGER PRIMARY KEY` decides the id, and the FTS row is inserted under that same rowid — an id
is therefore stable and means the same memory in both tables. No embeddings in v1 (D6).
"""

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS memories_meta (
    id         INTEGER PRIMARY KEY,
    run_id     TEXT,
    pid        INTEGER,
    program    TEXT,
    tags       TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories USING fts5(title, body, tags);
"""

_COLUMNS = (
    "SELECT memories_meta.id, memories.title, memories.body, memories_meta.tags,"
    " memories_meta.run_id, memories_meta.pid, memories_meta.program, memories_meta.created_at"
    " FROM memories JOIN memories_meta ON memories_meta.id = memories.rowid"
)

# Characters that carry meaning in the FTS5 query grammar. A user (or an agent) types prose, not
# a query expression, so they are removed rather than escaped — what is left is quoted verbatim.
_FTS_OPERATORS = str.maketrans({char: " " for char in '"*():^-+'})


@dataclass
class Memory:
    id: int
    title: str
    body: str
    tags: list[str]
    run_id: str | None
    pid: int | None
    program: str | None
    created_at: float


class MuninStore:
    def __init__(self, db_path: Path):
        db_path = Path(db_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        # Same trade-off as EventLog: autocommit, WAL, synchronous=NORMAL. The file may be the
        # event log's — this connection is its own and only ever touches the memory tables.
        self._conn = sqlite3.connect(db_path, check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        try:
            self._conn.executescript(_SCHEMA)
        except sqlite3.OperationalError as exc:
            if "fts5" not in str(exc).lower():
                raise
            self._conn.close()
            raise RuntimeError(
                "munin needs SQLite FTS5, which this Python's sqlite3 module was built without"
                f" (sqlite {sqlite3.sqlite_version}): {exc}"
            ) from exc

    def write(
        self,
        title: str,
        body: str,
        tags: list[str],
        *,
        run_id: str | None,
        pid: int | None,
        program: str | None,
        ts: float,
    ) -> Memory:
        tags = list(tags)
        cursor = self._conn.execute(
            "INSERT INTO memories_meta (run_id, pid, program, tags, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (run_id, pid, program, json.dumps(tags), ts),
        )
        memory_id = int(cursor.lastrowid)
        self._conn.execute(
            "INSERT INTO memories (rowid, title, body, tags) VALUES (?, ?, ?, ?)",
            (memory_id, title, body, " ".join(tags)),
        )
        return Memory(
            id=memory_id,
            title=title,
            body=body,
            tags=tags,
            run_id=run_id,
            pid=pid,
            program=program,
            created_at=ts,
        )

    def search(self, query: str, limit: int = 10) -> list[Memory]:
        match = _sanitize(query)
        if not match:
            return []
        rows = self._conn.execute(
            f"{_COLUMNS} WHERE memories MATCH ? ORDER BY bm25(memories) LIMIT ?",
            (match, limit),
        )
        return [_row_to_memory(row) for row in rows]

    def get(self, memory_id: int) -> Memory | None:
        row = self._conn.execute(
            f"{_COLUMNS} WHERE memories_meta.id = ?", (memory_id,)
        ).fetchone()
        return None if row is None else _row_to_memory(row)

    def recent(self, limit: int = 20) -> list[Memory]:
        rows = self._conn.execute(
            f"{_COLUMNS} ORDER BY memories_meta.created_at DESC, memories_meta.id DESC LIMIT ?",
            (limit,),
        )
        return [_row_to_memory(row) for row in rows]

    def count(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) FROM memories_meta").fetchone()
        return int(row[0])

    def close(self) -> None:
        self._conn.close()


def _sanitize(query: str) -> str:
    """Turn free text into a query FTS5 cannot choke on: every token quoted, implicit AND."""
    tokens = query.translate(_FTS_OPERATORS).split()
    return " ".join(f'"{token}"' for token in tokens)


def _row_to_memory(row: tuple) -> Memory:
    memory_id, title, body, tags, run_id, pid, program, created_at = row
    return Memory(
        id=memory_id,
        title=title,
        body=body,
        tags=json.loads(tags),
        run_id=run_id,
        pid=pid,
        program=program,
        created_at=created_at,
    )
