"""The Claude Code driver: argv, env scrubbing and the API-key guard carry the whole promise.

No test here may touch the real `claude` binary. Every run goes through a fake spawn that
replays a captured stream-json fixture, so the driver's stdout loop is exercised end to end
while the machine stays offline and the subscription stays untouched.
"""

import json
from pathlib import Path

import pytest

from hugin.drivers.claude_code import (
    ClaudeCodeDriver,
    build_command,
    build_env,
    ensure_config_dir,
)
from hugin.kernel.events import BudgetSpec, Usage
from hugin.kernel.process import AgentProcess
from hugin.settings import Settings

from .conftest import RecordingSink

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "stream_json"

MCP_URL = "http://127.0.0.1:8770/mcp"
TOKEN = "0123456789abcdef0123456789abcdef"


class _Lines:
    """Stands in for `asyncio.StreamReader`: yields the fixture's lines as bytes."""

    def __init__(self, lines: list[bytes]) -> None:
        self._lines = list(lines)

    def __aiter__(self) -> "_Lines":
        return self

    async def __anext__(self) -> bytes:
        if not self._lines:
            raise StopAsyncIteration
        return self._lines.pop(0)


class _Stderr:
    def __init__(self, data: bytes) -> None:
        self._data = data

    async def read(self) -> bytes:
        return self._data


class FakeProcess:
    """A subprocess that only knows how to hand out fixture lines and record signals."""

    def __init__(self, lines: list[bytes], *, stderr: bytes = b"", exit_code: int = 0) -> None:
        self.stdout = _Lines(lines)
        self.stderr = _Stderr(stderr)
        self.pid = 4242
        self.returncode: int | None = None
        self.terminate_calls = 0
        self.kill_calls = 0
        self.wait_calls = 0
        self._exit_code = exit_code

    async def wait(self) -> int:
        self.wait_calls += 1
        self.returncode = self._exit_code
        return self._exit_code

    def terminate(self) -> None:
        self.terminate_calls += 1

    def kill(self) -> None:
        self.kill_calls += 1


class SpawnSpy:
    """Captures the argv and kwargs of the single spawn a run performs."""

    def __init__(self, process: FakeProcess) -> None:
        self.process = process
        self.calls = 0
        self.argv: list[str] = []
        self.kwargs: dict = {}

    async def __call__(self, *argv: str, **kwargs) -> FakeProcess:
        self.calls += 1
        self.argv = list(argv)
        self.kwargs = kwargs
        return self.process


class KillingSink(RecordingSink):
    """Kills the process from inside the first forwarded op, mid-stream."""

    def __init__(self, driver: ClaudeCodeDriver, proc: AgentProcess) -> None:
        super().__init__()
        self._driver = driver
        self._proc = proc

    async def thinking(self, on: bool) -> None:
        await super().thinking(on)
        await self._driver.kill(self._proc)


def _fixture_lines(name: str) -> list[bytes]:
    text = (FIXTURES / name).read_text(encoding="utf-8")
    return [f"{line}\n".encode() for line in text.splitlines() if line.strip()]


def _proc(tmp_path: Path) -> AgentProcess:
    return AgentProcess(
        pid=7,
        run_id="r1",
        ppid=None,
        program="scout",
        role="worker",
        driver="claude",
        model="claude-haiku-4-5-20251001",
        task="Find three candidates.",
        cwd=tmp_path / "cwd",
        capabilities=set(),
        allowed_tools=["mcp__hugin__munin_search"],
        budget=BudgetSpec(max_turns=6),
    )


def _driver(tmp_path: Path, spawn: SpawnSpy) -> ClaudeCodeDriver:
    settings = Settings(
        claude_config_dir=tmp_path / "claude-config",
        claude_bin="/opt/claude/bin/claude",
    )
    return ClaudeCodeDriver(
        settings,
        MCP_URL,
        token_for=lambda pid: f"token-{pid}",
        system_prompt_for=lambda pid: f"system prompt for {pid}",
        spawn=spawn,
        home=tmp_path / "home",
    )


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test starts from a scrubbed environment; the key is opt-in per test."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    monkeypatch.setenv("HOME", "/home/agent")
    monkeypatch.setenv("LANG", "C.UTF-8")
    monkeypatch.setenv("HUGIN_TEST_UNRELATED", "leak-me-not")


def test_build_command_matches_the_binding_argv():
    argv = build_command(
        claude_bin="/opt/claude/bin/claude",
        prompt="Find three candidates.",
        system_prompt="You are scout.",
        model="claude-haiku-4-5-20251001",
        tools=["mcp__hugin__munin_search", "mcp__hugin__munin_write"],
        max_turns=6,
        mcp_url=MCP_URL,
        mcp_token=TOKEN,
    )

    assert argv == [
        "/opt/claude/bin/claude",
        "-p",
        "Find three candidates.",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
        "--tools",
        "mcp__hugin__munin_search,mcp__hugin__munin_write",
        "--allowedTools",
        "mcp__hugin__munin_search,mcp__hugin__munin_write",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers": {"hugin": {"type": "http", "url": "http://127.0.0.1:8770/mcp",'
        ' "headers": {"Authorization": "Bearer 0123456789abcdef0123456789abcdef"}}}}',
        "--settings",
        '{"disableAllHooks": true}',
        "--max-turns",
        "6",
        "--model",
        "claude-haiku-4-5-20251001",
        "--append-system-prompt",
        "You are scout.",
    ]


def test_build_command_never_carries_bare_or_a_permission_bypass():
    argv = build_command(
        claude_bin="claude",
        prompt="p",
        system_prompt="s",
        model="m",
        tools=[],
        max_turns=1,
        mcp_url=MCP_URL,
        mcp_token=TOKEN,
    )

    # `--bare` rejects the subscription login (spec §9 D3); a permission bypass would undo
    # the tool whitelist. Neither may ever creep into the argv.
    assert "--bare" not in argv
    assert "--dangerously-skip-permissions" not in argv
    # An empty whitelist stays an explicit empty string, never a dropped flag.
    assert argv[argv.index("--tools") + 1] == ""
    assert argv[argv.index("--allowedTools") + 1] == ""


def test_build_env_keeps_only_the_minimal_variables(tmp_path: Path):
    env = build_env(
        {
            "PATH": "/usr/bin",
            "HOME": "/home/agent",
            "LANG": "C.UTF-8",
            "ANTHROPIC_API_KEY": "sk-should-never-travel",
            "AWS_SECRET_ACCESS_KEY": "nope",
            "PYTHONPATH": "/somewhere",
        },
        tmp_path / "claude-config",
    )

    assert env == {
        "PATH": "/usr/bin",
        "HOME": "/home/agent",
        "LANG": "C.UTF-8",
        "CLAUDE_CONFIG_DIR": str(tmp_path / "claude-config"),
    }


def test_build_env_skips_variables_the_parent_does_not_have(tmp_path: Path):
    env = build_env({"PATH": "/usr/bin"}, tmp_path / "cfg")

    assert env == {"PATH": "/usr/bin", "CLAUDE_CONFIG_DIR": str(tmp_path / "cfg")}


def _fake_home(tmp_path: Path) -> Path:
    home = tmp_path / "home"
    (home / ".claude").mkdir(parents=True)
    (home / ".claude" / ".credentials.json").write_text("{}", encoding="utf-8")
    (home / ".claude.json").write_text("{}", encoding="utf-8")
    return home


def test_ensure_config_dir_creates_settings_and_symlinks(tmp_path: Path):
    home = _fake_home(tmp_path)
    config_dir = tmp_path / "claude-config"

    ensure_config_dir(config_dir, home)

    assert json.loads((config_dir / "settings.json").read_text(encoding="utf-8")) == {
        "disableAllHooks": True
    }
    assert (config_dir / ".credentials.json").is_symlink()
    assert (config_dir / ".credentials.json").resolve() == home / ".claude" / ".credentials.json"
    assert (config_dir / ".claude.json").resolve() == home / ".claude.json"


def test_ensure_config_dir_is_idempotent_and_keeps_edited_settings(tmp_path: Path):
    home = _fake_home(tmp_path)
    config_dir = tmp_path / "claude-config"
    ensure_config_dir(config_dir, home)
    (config_dir / "settings.json").write_text('{"disableAllHooks": true, "edited": 1}', "utf-8")

    ensure_config_dir(config_dir, home)

    assert "edited" in (config_dir / "settings.json").read_text(encoding="utf-8")
    assert (config_dir / ".credentials.json").resolve() == home / ".claude" / ".credentials.json"


def test_ensure_config_dir_skips_missing_targets(tmp_path: Path):
    home = tmp_path / "home"
    home.mkdir()
    config_dir = tmp_path / "claude-config"

    ensure_config_dir(config_dir, home)

    assert (config_dir / "settings.json").exists()
    assert not (config_dir / ".credentials.json").exists()
    assert not (config_dir / ".credentials.json").is_symlink()


def test_ensure_config_dir_replaces_a_broken_symlink(tmp_path: Path):
    home = _fake_home(tmp_path)
    config_dir = tmp_path / "claude-config"
    config_dir.mkdir(parents=True)
    (config_dir / ".claude.json").symlink_to(tmp_path / "gone.json")

    ensure_config_dir(config_dir, home)

    assert (config_dir / ".claude.json").resolve() == home / ".claude.json"


def test_ensure_config_dir_never_overwrites_a_regular_file(tmp_path: Path):
    home = _fake_home(tmp_path)
    config_dir = tmp_path / "claude-config"
    config_dir.mkdir(parents=True)
    (config_dir / ".claude.json").write_text('{"mine": true}', encoding="utf-8")

    ensure_config_dir(config_dir, home)

    assert (config_dir / ".claude.json").read_text(encoding="utf-8") == '{"mine": true}'
    assert not (config_dir / ".claude.json").is_symlink()


def test_preflight_refuses_an_environment_with_an_api_key(tmp_path: Path):
    driver = _driver(tmp_path, SpawnSpy(FakeProcess([])))

    driver.preflight({"PATH": "/usr/bin"})  # no key: silent

    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        driver.preflight({"ANTHROPIC_API_KEY": "sk-live"})


async def test_run_over_the_real_capture_ends_done_with_the_result_usage(
    tmp_path: Path, sink: RecordingSink
):
    spawn = SpawnSpy(FakeProcess(_fixture_lines("haiku_ok_isolated.jsonl")))
    driver = _driver(tmp_path, spawn)
    proc = _proc(tmp_path)

    exit_info = await driver.run(proc, "Say OK.", sink)

    # This capture predates `--include-partial-messages`, so it carries no deltas at all —
    # the driver ignores the duplicated `assistant` text and reports only the final usage.
    assert sink.calls == []
    assert exit_info.reason == "done"
    assert exit_info.stderr_tail is None
    assert exit_info.usage.turns == 1
    assert exit_info.usage.cost_usd_equiv == 0.01396
    assert exit_info.usage.input_tokens == 10 + 6409  # input + cache_creation + cache_read
    assert exit_info.usage.output_tokens == 38
    assert spawn.process.wait_calls >= 1  # never leave a zombie behind


async def test_run_spawns_with_the_sandboxed_cwd_env_and_stdin(
    tmp_path: Path, sink: RecordingSink
):
    spawn = SpawnSpy(FakeProcess(_fixture_lines("haiku_ok_isolated.jsonl")))
    driver = _driver(tmp_path, spawn)
    proc = _proc(tmp_path)

    await driver.run(proc, "Say OK.", sink)

    assert spawn.calls == 1
    assert spawn.argv[0] == "/opt/claude/bin/claude"
    assert spawn.argv[2] == "Say OK."
    assert spawn.argv[spawn.argv.index("--model") + 1] == "claude-haiku-4-5-20251001"
    assert spawn.argv[spawn.argv.index("--max-turns") + 1] == "6"
    assert spawn.argv[spawn.argv.index("--tools") + 1] == "mcp__hugin__munin_search"
    assert "Bearer token-7" in spawn.argv[spawn.argv.index("--mcp-config") + 1]
    assert spawn.argv[-1] == "system prompt for 7"
    assert spawn.kwargs["cwd"] == proc.cwd
    assert spawn.kwargs["stdin"] == -3  # asyncio.subprocess.DEVNULL
    assert spawn.kwargs["env"] == {
        "PATH": "/usr/bin:/bin",
        "HOME": "/home/agent",
        "LANG": "C.UTF-8",
        "CLAUDE_CONFIG_DIR": str(tmp_path / "claude-config"),
    }
    # The isolated config dir is created before the process starts.
    assert (tmp_path / "claude-config" / "settings.json").exists()


async def test_run_over_the_synthetic_capture_forwards_ops_in_order(
    tmp_path: Path, sink: RecordingSink
):
    spawn = SpawnSpy(FakeProcess(_fixture_lines("synthetic_tool_use.jsonl")))
    driver = _driver(tmp_path, spawn)

    exit_info = await driver.run(_proc(tmp_path), "Store the note.", sink)

    assert sink.kinds == [
        "thinking",
        "thinking",
        "text",
        "state",
        "tool_call",
        "usage",
        "tool_result",
        "state",
    ]
    assert sink.calls[0] == ("thinking", True)
    assert sink.calls[1] == ("thinking", False)
    assert sink.calls[2] == ("text", "Storing the note in munin.")
    assert sink.calls[3] == ("state", "waiting_tool")
    kind, call_id, tool, input_summary = sink.calls[4]
    assert (call_id, tool) == ("toolu_01", "mcp__hugin__munin_write")
    assert input_summary.startswith('{"kind": "note"')
    # One counted turn: input is the latest context size, output the accumulated tokens.
    assert sink.calls[5] == ("usage", Usage(turns=1, input_tokens=12 + 6409, output_tokens=91))
    kind, call_id, ok, output_summary, ms = sink.calls[6]
    assert (call_id, ok) == ("toolu_01", True)
    assert output_summary == '{"id": "m-42", "ok": true}'
    assert ms >= 0
    assert sink.calls[7] == ("state", "running")

    assert exit_info.reason == "done"
    assert exit_info.usage == Usage(
        turns=2, input_tokens=20 + 6409 + 6409, output_tokens=105, cost_usd_equiv=0.0042
    )


async def test_run_refuses_a_session_billed_through_an_api_key(
    tmp_path: Path, sink: RecordingSink
):
    lines = _fixture_lines("synthetic_tool_use.jsonl")
    init = json.loads(lines[0])
    init["apiKeySource"] = "ANTHROPIC_API_KEY"
    lines[0] = (json.dumps(init) + "\n").encode()
    spawn = SpawnSpy(FakeProcess(lines))
    driver = _driver(tmp_path, spawn)

    exit_info = await driver.run(_proc(tmp_path), "Store the note.", sink)

    assert exit_info.reason == "failed"
    assert exit_info.stderr_tail == "refusing: API key billing detected"
    assert spawn.process.terminate_calls == 1
    assert sink.calls == []  # nothing from that session ever reaches the kernel


async def test_run_reports_a_driver_error_when_the_process_dies_without_a_result(
    tmp_path: Path, sink: RecordingSink
):
    noise = "claude: something went wrong\n" * 60
    lines = _fixture_lines("haiku_ok_isolated.jsonl")[:2]  # init + rate limit, then EOF
    spawn = SpawnSpy(FakeProcess(lines, stderr=noise.encode(), exit_code=1))
    driver = _driver(tmp_path, spawn)

    exit_info = await driver.run(_proc(tmp_path), "Say OK.", sink)

    assert exit_info.reason == "driver_error"
    assert len(exit_info.stderr_tail) == 500
    assert exit_info.stderr_tail == noise[-500:]


async def test_kill_mid_stream_stops_forwarding_and_is_idempotent(
    tmp_path: Path,
):
    spawn = SpawnSpy(FakeProcess(_fixture_lines("synthetic_tool_use.jsonl")))
    driver = _driver(tmp_path, spawn)
    proc = _proc(tmp_path)
    sink = KillingSink(driver, proc)

    exit_info = await driver.run(proc, "Store the note.", sink)

    assert exit_info.reason == "killed"
    assert sink.calls == [("thinking", True)]  # the kill lands inside the first op
    assert spawn.process.terminate_calls == 1
    assert spawn.process.kill_calls == 0  # the fake exits on terminate, no SIGKILL needed

    await driver.kill(proc)  # a second kill is a no-op, not a crash
    assert spawn.process.terminate_calls == 1


async def test_run_maps_an_error_result_to_failed_with_the_result_text(
    tmp_path: Path, sink: RecordingSink
):
    lines = _fixture_lines("synthetic_tool_use.jsonl")
    result = json.loads(lines[-1])
    result["is_error"] = True
    result["subtype"] = "error_max_turns"
    result["result"] = "Reached max turns before finishing."
    lines[-1] = (json.dumps(result) + "\n").encode()
    spawn = SpawnSpy(FakeProcess(lines))
    driver = _driver(tmp_path, spawn)

    exit_info = await driver.run(_proc(tmp_path), "Store the note.", sink)

    assert exit_info.reason == "failed"
    assert exit_info.stderr_tail == "Reached max turns before finishing."
    assert exit_info.usage.cost_usd_equiv == 0.0042
