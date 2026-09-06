import json
from pathlib import Path

from hugin.drivers.scripted import ScriptedDriver
from hugin.kernel.events import BudgetSpec, Usage
from hugin.kernel.process import AgentProcess

from .conftest import RecordingSink


def _proc(tmp_path: Path, *, program: str = "hello", task: str = "say hello") -> AgentProcess:
    return AgentProcess(
        pid=1,
        run_id="r1",
        ppid=None,
        program=program,
        role="worker",
        driver="scripted",
        model="scripted-1",
        task=task,
        cwd=tmp_path,
        capabilities=set(),
        allowed_tools=[],
        budget=BudgetSpec(),
    )


class _SleepSpy:
    """Stands in for `asyncio.sleep` so scripted delays cost no wall-clock time."""

    def __init__(self) -> None:
        self.seconds: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.seconds.append(seconds)


class _KillOnFirstTextSink(RecordingSink):
    """Kills the process from inside the first op, so `run` sees the flag before op two."""

    def __init__(self, driver: ScriptedDriver, proc: AgentProcess) -> None:
        super().__init__()
        self._driver = driver
        self._proc = proc

    async def text(self, delta: str) -> None:
        await super().text(delta)
        await self._driver.kill(self._proc)


def _write_script(tmp_path: Path, name: str, ops: list[dict]) -> None:
    (tmp_path / f"{name}.json").write_text(json.dumps(ops), encoding="utf-8")


async def test_hello_script_replays_its_ops_in_order(sink: RecordingSink, tmp_path: Path):
    driver = ScriptedDriver(clock_sleep=_SleepSpy())

    exit_info = await driver.run(_proc(tmp_path), "prompt", sink)

    assert sink.kinds == ["text", "text", "usage"]
    assert all(isinstance(call[1], str) and call[1] for call in sink.calls[:2])
    assert sink.calls[2][1] == Usage(turns=1, input_tokens=800, output_tokens=120)
    assert exit_info.reason == "done"
    assert exit_info.usage.turns == 1
    assert exit_info.stderr_tail is None


async def test_driver_name_is_scripted():
    assert ScriptedDriver().name == "scripted"


async def test_kill_flag_stops_the_run_between_ops(tmp_path: Path):
    driver = ScriptedDriver(clock_sleep=_SleepSpy())
    proc = _proc(tmp_path)
    sink = _KillOnFirstTextSink(driver, proc)

    exit_info = await driver.run(proc, "prompt", sink)

    assert sink.kinds == ["text"]
    assert exit_info.reason == "killed"


async def test_task_prefix_selects_another_script(sink: RecordingSink, tmp_path: Path):
    _write_script(tmp_path, "hello", [{"op": "text", "delta": "wrong script"}])
    _write_script(
        tmp_path,
        "worker",
        [
            {"op": "thinking", "on": True},
            {"op": "tool_call", "call_id": "t1", "tool": "WebSearch", "input_summary": "hugin"},
            {
                "op": "tool_result",
                "call_id": "t1",
                "ok": True,
                "output_summary": "3 hits",
                "ms": 420,
            },
            {"op": "exit", "reason": "done"},
        ],
    )
    driver = ScriptedDriver(scripts_dir=tmp_path, clock_sleep=_SleepSpy())

    exit_info = await driver.run(_proc(tmp_path, task="script:worker"), "prompt", sink)

    assert sink.calls == [
        ("thinking", True),
        ("tool_call", "t1", "WebSearch", "hugin"),
        ("tool_result", "t1", True, "3 hits", 420),
    ]
    assert exit_info.reason == "done"


async def test_syscall_error_without_expect_error_fails_the_run(
    sink: RecordingSink, tmp_path: Path
):
    _write_script(
        tmp_path,
        "hello",
        [
            {"op": "syscall", "name": "forbidden", "args": {"a": 1}},
            {"op": "text", "delta": "never reached"},
        ],
    )
    driver = ScriptedDriver(scripts_dir=tmp_path, clock_sleep=_SleepSpy())

    exit_info = await driver.run(_proc(tmp_path), "prompt", sink)

    assert sink.calls == [("syscall", "forbidden", {"a": 1})]
    assert exit_info.reason == "failed"
    assert exit_info.stderr_tail == "forbidden"


async def test_syscall_error_with_expect_error_continues(sink: RecordingSink, tmp_path: Path):
    _write_script(
        tmp_path,
        "hello",
        [
            {"op": "syscall", "name": "forbidden", "args": {}, "expect_error": True},
            {"op": "syscall", "name": "munin_write", "args": {"title": "t"}},
            {"op": "usage", "turns": 2, "input_tokens": 10, "output_tokens": 5},
        ],
    )
    driver = ScriptedDriver(scripts_dir=tmp_path, clock_sleep=_SleepSpy())

    exit_info = await driver.run(_proc(tmp_path), "prompt", sink)

    assert sink.kinds == ["syscall", "syscall", "usage"]
    assert exit_info.reason == "done"
    assert exit_info.usage == Usage(turns=2, input_tokens=10, output_tokens=5)


async def test_delay_ms_is_awaited_as_seconds(sink: RecordingSink, tmp_path: Path):
    _write_script(tmp_path, "hello", [{"delay_ms": 120, "op": "text", "delta": "spät"}])
    sleep = _SleepSpy()
    driver = ScriptedDriver(scripts_dir=tmp_path, clock_sleep=sleep)

    await driver.run(_proc(tmp_path), "prompt", sink)

    assert sleep.seconds == [0.12]


async def test_unknown_op_ends_the_run_as_driver_error(sink: RecordingSink, tmp_path: Path):
    _write_script(tmp_path, "hello", [{"op": "teleport"}])
    driver = ScriptedDriver(scripts_dir=tmp_path, clock_sleep=_SleepSpy())

    exit_info = await driver.run(_proc(tmp_path), "prompt", sink)

    assert sink.calls == []
    assert exit_info.reason == "driver_error"
    assert "teleport" in (exit_info.stderr_tail or "")


async def test_task_and_pid_are_interpolated_into_text_and_nested_args(
    sink: RecordingSink, tmp_path: Path
):
    _write_script(
        tmp_path,
        "hello",
        [
            {"op": "text", "delta": "Auftrag: {task}"},
            {"op": "tool_call", "call_id": "t1", "tool": "WebSearch", "input_summary": "{task}"},
            {"op": "tool_result", "call_id": "t1", "ok": True, "output_summary": "{task} ✓",
             "ms": 5},
            {
                "op": "syscall",
                "name": "munin_write",
                "args": {"title": "Befund: {task}", "body": "Prozess {pid}", "tags": ["{task}"]},
            },
        ],
    )
    driver = ScriptedDriver(scripts_dir=tmp_path, clock_sleep=_SleepSpy())

    await driver.run(_proc(tmp_path, task="VRAM-Grenzen"), "prompt", sink)

    assert sink.calls == [
        ("text", "Auftrag: VRAM-Grenzen"),
        ("tool_call", "t1", "WebSearch", "VRAM-Grenzen"),
        ("tool_result", "t1", True, "VRAM-Grenzen ✓", 5),
        (
            "syscall",
            "munin_write",
            {"title": "Befund: VRAM-Grenzen", "body": "Prozess 1", "tags": ["VRAM-Grenzen"]},
        ),
    ]


async def test_a_script_without_placeholders_is_left_untouched(
    sink: RecordingSink, tmp_path: Path
):
    """Braces in Markdown or JSON bodies must survive — this is not `str.format`."""
    _write_script(tmp_path, "hello", [{"op": "text", "delta": "{ \"a\": 1 } und {unbekannt}"}])
    driver = ScriptedDriver(scripts_dir=tmp_path, clock_sleep=_SleepSpy())

    await driver.run(_proc(tmp_path, task="egal"), "prompt", sink)

    assert sink.calls == [("text", '{ "a": 1 } und {unbekannt}')]
