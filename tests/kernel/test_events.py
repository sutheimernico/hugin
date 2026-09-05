import pytest
from pydantic import ValidationError

from hugin.kernel.events import Event, EventKind, make_event


def test_kinds_are_closed_list():
    assert EventKind("proc.text") is EventKind.PROC_TEXT
    with pytest.raises(ValueError):
        EventKind("proc.unknown")


def test_make_event_validates_payload():
    e = make_event(EventKind.PROC_TEXT, run_id="r1", pid=1, data={"delta": "hi"}, ts=1.0)
    assert e.seq is None and e.kind == "proc.text" and e.data == {"delta": "hi"}
    with pytest.raises(ValidationError):
        make_event(EventKind.PROC_TEXT, run_id="r1", pid=1, data={"nope": 1}, ts=1.0)


def test_event_roundtrip_json():
    e = make_event(
        EventKind.KILL, run_id=None, pid=None, data={"target": "all", "by": "user"}, ts=2.0
    )
    e2 = Event.model_validate_json(e.model_dump_json())
    assert e2 == e
