"""The stress scripts are load, not a mission — this only proves they are runnable.

Running them would cost 20 s of wall time and thousands of events, which is exactly what a
browser session is for. What a test can guarantee cheaply is that the driver will not trip
over them: every op is one `ScriptedDriver` knows, with the arguments it reads.
"""

import json

import pytest

from hugin.drivers.scripted import DEFAULT_SCRIPTS_DIR, TASK_SCRIPT_PREFIX, interpolate

# Mirrors the `match` in `ScriptedDriver.run`: op name → the keys the driver reads.
REQUIRED_KEYS: dict[str, set[str]] = {
    "text": {"delta"},
    "thinking": {"on"},
    "tool_call": {"call_id", "tool", "input_summary"},
    "tool_result": {"call_id", "ok", "output_summary", "ms"},
    "usage": {"turns", "input_tokens", "output_tokens"},
    "syscall": {"name"},
    "exit": set(),
}

WORKER = "stress_worker"
# 4 workers × 25 text ops/s is the ~100 ops/s the polish pass is measured against.
TEXT_OPS_PER_WORKER = 250
WORKER_DELAY_MS = 40


def _ops(name: str) -> list[dict]:
    return json.loads((DEFAULT_SCRIPTS_DIR / f"{name}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", ["stress", WORKER])
def test_every_op_is_one_the_driver_knows(name):
    for op in _ops(name):
        kind = op.get("op")
        assert kind in REQUIRED_KEYS, f"{name}: unknown op {kind!r}"
        assert REQUIRED_KEYS[kind] <= set(op), f"{name}: {kind} is missing arguments"
        assert isinstance(op.get("delay_ms", 0), int)


def test_the_last_op_of_both_scripts_exits():
    for name in ("stress", WORKER):
        assert _ops(name)[-1] == {"op": "exit", "reason": "done"}


def test_the_planner_starts_six_workers_by_script_name():
    spawns = [
        op for op in _ops("stress") if op["op"] == "syscall" and op["name"] == "proc_spawn"
    ]
    assert len(spawns) == 6
    assert {spawn["args"]["task"] for spawn in spawns} == {f"{TASK_SCRIPT_PREFIX}{WORKER}"}
    # Four at a time is the kernel's fan-out limit, so the six run in two waves.
    waits = [op for op in _ops("stress") if op["op"] == "syscall" and op["name"] == "proc_wait"]
    assert len(waits) == 2


def test_the_worker_holds_the_intended_rate_for_ten_seconds():
    ops = _ops(WORKER)
    texts = [op for op in ops if op["op"] == "text"]
    paced = [op for op in texts if op.get("delay_ms") == WORKER_DELAY_MS]

    assert len(paced) == TEXT_OPS_PER_WORKER
    assert sum(op.get("delay_ms", 0) for op in ops) == pytest.approx(10_000, abs=600)


def test_the_worker_also_exercises_the_log_and_the_memory_hub():
    ops = _ops(WORKER)
    calls = [op["name"] for op in ops if op["op"] == "syscall"]

    assert calls.count("munin_write") == 10
    assert calls[-1] == "mission_report"
    assert len([op for op in ops if op["op"] == "tool_call"]) == 25


def test_placeholders_resolve_to_the_running_process():
    written = [
        interpolate(op, task="script:stress_worker", pid=42)
        for op in _ops(WORKER)
        if op["op"] == "syscall" and op["name"] == "munin_write"
    ]
    assert written[0]["args"]["title"] == "STRESS 42/25"
    assert "{pid}" not in json.dumps(written, ensure_ascii=False)
