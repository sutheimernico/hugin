"""Exporting a run into a committable recording: scrub first, write only if it is clean.

The fake secrets below are assembled at runtime on purpose — the repository must never contain
a contiguous string that looks like a real credential, not even in a test.
"""

import json
from pathlib import Path

import pytest

from hugin.kernel.events import Event, EventKind, Usage, make_event
from hugin.kernel.log import EventLog
from hugin.replay.recorder import Recorder, ScrubError, scrub

GOAL = "Erstelle ein Recherche-Briefing zu lokalen KI-Agenten."
HOME = Path("/home/someone")
REPO_ROOT = HOME / "private" / "hugin"

FAKE_SECRETS = [
    ("anthropic_key", "sk-" + "ant-" + "A" * 24),
    ("aws_access_key", "AKIA" + "1234567890ABCDEF"),
    ("github_token", "ghp_" + "b" * 24),
    ("jwt", "eyJ" + "a" * 24 + "." + "c" * 12),
    ("private_key", "-----BEGIN " + "RSA PRIVATE KEY-----"),
]


@pytest.fixture
def log(tmp_path: Path) -> EventLog:
    log = EventLog(tmp_path / "hugin.db")
    yield log
    log.close()


@pytest.fixture
def recordings(tmp_path: Path) -> Path:
    return tmp_path / "recordings"


def _text(delta: str, ts: float = 1.0) -> Event:
    return Event(seq=1, ts=ts, run_id="r1", pid=1, kind=EventKind.PROC_TEXT, data={"delta": delta})


def _seed_run(log: EventLog, run_id: str = "r1", text: str = "Ich lese die Quellen.") -> None:
    """Three events with known timestamps — a whole run in miniature."""
    log.append(
        make_event(
            EventKind.RUN_CREATED,
            run_id=run_id,
            pid=None,
            data={"goal": GOAL, "driver": "scripted", "template": None},
            ts=100.0,
        )
    )
    log.append(
        make_event(EventKind.PROC_TEXT, run_id=run_id, pid=1, data={"delta": text}, ts=101.5)
    )
    log.append(
        make_event(
            EventKind.RUN_DONE,
            run_id=run_id,
            pid=None,
            data={"usage": Usage(turns=2), "artifacts": [], "duration_s": 4.0},
            ts=104.0,
        )
    )


def _recorder(log: EventLog, recordings: Path) -> Recorder:
    return Recorder(log, recordings, REPO_ROOT, HOME)


# --- scrub ------------------------------------------------------------------------------


def test_scrub_rewrites_repo_and_home_paths_recursively():
    event = Event(
        seq=1,
        ts=1.0,
        run_id="r1",
        pid=1,
        kind=EventKind.TOOL_CALL,
        data={
            "call_id": "c1",
            "tool": "Read",
            "input_summary": f"{REPO_ROOT}/src/hugin/app.py",
            "context": {"files": [f"{HOME}/notes.md", 7, None], "cwd": str(REPO_ROOT)},
        },
    )

    [cleaned] = scrub([event], repo_root=REPO_ROOT, home=HOME)

    assert cleaned.data["input_summary"] == "/home/user/hugin/src/hugin/app.py"
    assert cleaned.data["context"]["files"] == ["/home/user/notes.md", 7, None]
    # The repo path lives inside the home path: the longer one must win.
    assert cleaned.data["context"]["cwd"] == "/home/user/hugin"
    assert event.data["context"]["cwd"] == str(REPO_ROOT), "the input events stay untouched"


@pytest.mark.parametrize(("name", "secret"), FAKE_SECRETS)
def test_scrub_refuses_events_that_still_carry_a_secret(name: str, secret: str):
    with pytest.raises(ScrubError) as error:
        scrub([_text(f"der Schlüssel ist {secret}")], repo_root=REPO_ROOT, home=HOME)

    assert error.value.pattern_name == name


# --- export / load / list ---------------------------------------------------------------


def test_export_writes_renumbered_jsonl_and_a_manifest(log: EventLog, recordings: Path):
    _seed_run(log)

    path = _recorder(log, recordings).export("r1", "demo-run")

    assert path == recordings / "demo-run.jsonl"
    events = [Event.model_validate_json(line) for line in path.read_text().splitlines()]
    assert [event.seq for event in events] == [1, 2, 3]
    assert [event.ts for event in events] == [100.0, 101.5, 104.0]
    manifest = json.loads((recordings / "demo-run.json").read_text())
    assert manifest["slug"] == "demo-run"
    assert manifest["run_id"] == "r1"
    assert manifest["goal"] == GOAL
    assert manifest["driver"] == "scripted"
    assert manifest["events"] == 3
    assert manifest["duration_s"] == 4.0
    assert manifest["exported_at"] > 0


def test_load_round_trips_the_exported_events(log: EventLog, recordings: Path):
    _seed_run(log, text=f"gelesen: {REPO_ROOT}/README.md")
    recorder = _recorder(log, recordings)
    recorder.export("r1", "demo-run")

    loaded = recorder.load("demo-run")

    assert [event.kind for event in loaded] == [
        EventKind.RUN_CREATED,
        EventKind.PROC_TEXT,
        EventKind.RUN_DONE,
    ]
    assert loaded[1].data["delta"] == "gelesen: /home/user/hugin/README.md"


def test_export_of_an_unknown_run_raises(log: EventLog, recordings: Path):
    with pytest.raises(KeyError):
        _recorder(log, recordings).export("nope", "demo-run")


@pytest.mark.parametrize("slug", ["Demo", "x", "-demo", "demo run", "demo/run", "d" * 65, ""])
def test_export_rejects_a_bad_slug(log: EventLog, recordings: Path, slug: str):
    _seed_run(log)

    with pytest.raises(ValueError, match="slug"):
        _recorder(log, recordings).export("r1", slug)


def test_export_writes_nothing_when_a_secret_survives(log: EventLog, recordings: Path):
    _seed_run(log, text="token: " + FAKE_SECRETS[0][1])

    with pytest.raises(ScrubError):
        _recorder(log, recordings).export("r1", "demo-run")

    assert not (recordings / "demo-run.jsonl").exists()
    assert not (recordings / "demo-run.json").exists()


def test_load_of_an_unknown_recording_raises(log: EventLog, recordings: Path):
    with pytest.raises(KeyError):
        _recorder(log, recordings).load("nothing-here")


def test_list_is_empty_before_anything_was_exported(log: EventLog, recordings: Path):
    assert _recorder(log, recordings).list() == []


def test_list_returns_manifests_newest_first(log: EventLog, recordings: Path):
    recordings.mkdir(parents=True)
    for slug, exported_at in (("older", 10.0), ("newest", 30.0), ("middle", 20.0)):
        (recordings / f"{slug}.json").write_text(
            json.dumps({"slug": slug, "exported_at": exported_at}), encoding="utf-8"
        )

    manifests = _recorder(log, recordings).list()

    assert [manifest["slug"] for manifest in manifests] == ["newest", "middle", "older"]
