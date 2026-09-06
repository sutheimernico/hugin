"""Exporting a run into a recording that may be committed.

A recording *is* the offline demo, so it leaves the machine it was recorded on: absolute paths
are rewritten to a neutral `/home/user/hugin`, and anything that still looks like a credential
stops the export loudly instead of being masked quietly — a silent mask would leave nobody
looking at what was almost published. Files are written last and atomically, so a refused
export leaves no half-written recording behind.
"""

# `Recorder.list` shadows the builtin inside the class body, which would break every
# `list[...]` annotation after it; deferred annotations keep the binding names intact.
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

from hugin.kernel.events import Event, EventKind
from hugin.kernel.log import EventLog

SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")

SECRET_PATTERNS = [
    r"sk-ant-[A-Za-z0-9_-]{10,}",
    r"AKIA[0-9A-Z]{16}",
    r"ghp_[A-Za-z0-9]{20,}",
    r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}",
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
]
# The names are what the API reports and what a human reads in the refusal.
SECRET_NAMES = ("anthropic_key", "aws_access_key", "github_token", "jwt", "private_key")
_SECRETS = [
    (name, re.compile(pattern)) for name, pattern in zip(SECRET_NAMES, SECRET_PATTERNS, strict=True)
]

REPO_MASK = "/home/user/hugin"
HOME_MASK = "/home/user"


class ScrubError(RuntimeError):
    """A secret pattern survived the path rewriting — the export must not happen."""

    def __init__(self, pattern_name: str):
        super().__init__(f"secret pattern {pattern_name} found")
        self.pattern_name = pattern_name


def scrub(events: list[Event], *, repo_root: Path, home: Path) -> list[Event]:
    """Rewrite machine paths inside the payloads, then refuse anything still secret-shaped."""
    # Longest first: the repo lives inside the home directory, so masking the home first would
    # leave the repo path unrecognisable and unmasked.
    replacements = sorted(
        ((str(repo_root), REPO_MASK), (str(home), HOME_MASK)),
        key=lambda pair: len(pair[0]),
        reverse=True,
    )
    cleaned = [
        event.model_copy(update={"data": _replace(event.data, replacements)}) for event in events
    ]
    for event in cleaned:
        # The whole serialised event, not just its strings: a secret in a key or an id counts.
        serialised = event.model_dump_json()
        for name, pattern in _SECRETS:
            if pattern.search(serialised):
                raise ScrubError(name)
    return cleaned


def _replace(value: Any, replacements: list[tuple[str, str]]) -> Any:
    if isinstance(value, str):
        for needle, mask in replacements:
            value = value.replace(needle, mask)
        return value
    if isinstance(value, dict):
        return {key: _replace(item, replacements) for key, item in value.items()}
    if isinstance(value, list):
        return [_replace(item, replacements) for item in value]
    return value


class Recorder:
    def __init__(self, log: EventLog, recordings_dir: Path, repo_root: Path, home: Path):
        self.log = log
        self.recordings_dir = Path(recordings_dir)
        self.repo_root = Path(repo_root)
        self.home = Path(home)

    def export(self, run_id: str, slug: str) -> Path:
        """Freeze one run into `<slug>.jsonl` plus its `<slug>.json` manifest."""
        _validate(slug)
        events = self.log.for_run(run_id)
        if not events:
            raise KeyError(run_id)
        cleaned = scrub(events, repo_root=self.repo_root, home=self.home)
        # Renumbered from 1, because a recording carries no history but its own; the original
        # timestamps stay, otherwise the replay would lose the run's rhythm.
        numbered = [
            event.model_copy(update={"seq": seq}) for seq, event in enumerate(cleaned, start=1)
        ]
        created = next((e for e in numbered if e.kind is EventKind.RUN_CREATED), None)
        manifest = {
            "slug": slug,
            "run_id": run_id,
            "goal": created.data.get("goal", "") if created else "",
            "driver": created.data.get("driver", "") if created else "",
            "events": len(numbered),
            "duration_s": numbered[-1].ts - numbered[0].ts,
            "exported_at": time.time(),
        }
        self.recordings_dir.mkdir(parents=True, exist_ok=True)
        body = "".join(f"{event.model_dump_json()}\n" for event in numbered)
        path = self._path(slug)
        _write_atomically(path, body)
        _write_atomically(self._manifest_path(slug), json.dumps(manifest, indent=2) + "\n")
        return path

    def list(self) -> list[dict]:
        """Every manifest, newest export first."""
        if not self.recordings_dir.is_dir():
            return []
        manifests = [
            json.loads(path.read_text(encoding="utf-8"))
            for path in sorted(self.recordings_dir.glob("*.json"))
        ]
        return sorted(manifests, key=lambda entry: entry.get("exported_at", 0.0), reverse=True)

    def manifest(self, slug: str) -> dict:
        path = self._manifest_path(slug)
        if not path.is_file():
            raise KeyError(slug)
        return json.loads(path.read_text(encoding="utf-8"))

    def load(self, slug: str) -> list[Event]:
        path = self._path(slug)
        if not path.is_file():
            raise KeyError(slug)
        return [
            Event.model_validate_json(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def _path(self, slug: str) -> Path:
        _validate(slug)
        return self.recordings_dir / f"{slug}.jsonl"

    def _manifest_path(self, slug: str) -> Path:
        _validate(slug)
        return self.recordings_dir / f"{slug}.json"


def _validate(slug: str) -> None:
    """The slug becomes a file name, so it is checked before it ever touches a path."""
    if SLUG.fullmatch(slug) is None:
        raise ValueError(f"invalid slug: {slug!r}")


def _write_atomically(path: Path, body: str) -> None:
    """Write beside the target, then rename — a reader never sees a half-written recording."""
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(body, encoding="utf-8")
    os.replace(temporary, path)
