"""The subsystem report: what this machine can actually run, and how it says so.

No subprocess and no socket here. `run_cmd` and the Ollama driver are the two seams and both
are fakes, so the test never starts the real CLI and never talks to a real Ollama.
"""

from collections.abc import Callable
from pathlib import Path

import pytest

from hugin.kernel.kernel import Kernel
from hugin.system.status import SystemStatusService, subsystem_lines

VERSION_OUT = "2.1.261 (Claude Code)\n"
CONTRACT_KEYS = {"claude", "ollama", "munin", "programs", "kernel"}


class FakeOllama:
    """Stands in for the driver: `available()` is the only method the report uses."""

    def __init__(self, result: tuple[bool, list[str], str] = (True, ["a", "b"], "2 Modelle")):
        self.result = result
        self.calls = 0

    async def available(self) -> tuple[bool, list[str], str]:
        self.calls += 1
        return self.result


class FakeCli:
    """The `claude --version` seam: it records the argv and answers, or fails like a shell."""

    def __init__(self, result: tuple[int, str] = (0, VERSION_OUT), error: Exception | None = None):
        self.result = result
        self.error = error
        self.calls: list[list[str]] = []

    async def __call__(self, argv: list[str]) -> tuple[int, str]:
        self.calls.append(argv)
        if self.error is not None:
            raise self.error
        return self.result


class FakeClock:
    """The cache clock — monotonic seconds the test moves by hand."""

    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def home(tmp_path: Path) -> Path:
    """A home with a subscription login in it."""
    path = tmp_path / "home"
    (path / ".claude").mkdir(parents=True)
    (path / ".claude" / ".credentials.json").write_text("{}", encoding="utf-8")
    return path


@pytest.fixture
def empty_home(tmp_path: Path) -> Path:
    path = tmp_path / "empty-home"
    path.mkdir()
    return path


@pytest.fixture
def build(kernel: Kernel) -> Callable[..., SystemStatusService]:
    def _build(
        home: Path,
        *,
        cli: FakeCli | None = None,
        ollama: FakeOllama | None = None,
        env: dict[str, str] | None = None,
        clock: FakeClock | None = None,
    ) -> SystemStatusService:
        return SystemStatusService(
            kernel.settings,
            kernel.syscalls.munin,
            kernel,
            ollama or FakeOllama(),
            run_cmd=cli or FakeCli(),
            env=env if env is not None else {},
            home=home,
            clock=clock or FakeClock(),
        )

    return _build


async def test_subscription_login_is_reported_as_ok(build, home):
    cli = FakeCli()

    claude = (await build(home, cli=cli).snapshot())["claude"]

    assert claude == {"ok": True, "version": "2.1.261", "detail": "Abo-Login erkannt"}
    assert cli.calls == [["claude", "--version"]]


async def test_without_credentials_the_cli_is_not_logged_in(build, empty_home):
    claude = (await build(empty_home).snapshot())["claude"]

    assert claude["ok"] is False
    assert claude["detail"] == "Nicht angemeldet"
    assert claude["version"] == "2.1.261"  # the CLI is there, only the login is missing


@pytest.mark.parametrize(
    "cli",
    [
        FakeCli(result=(127, "")),
        FakeCli(error=FileNotFoundError("claude")),
    ],
    ids=["non-zero", "missing-binary"],
)
async def test_a_failing_cli_call_means_no_cli(build, home, cli):
    claude = (await build(home, cli=cli).snapshot())["claude"]

    assert claude == {"ok": False, "version": None, "detail": "CLI nicht gefunden"}


async def test_a_hanging_cli_is_not_reported_as_a_missing_one(build, home):
    claude = (await build(home, cli=FakeCli(error=TimeoutError())).snapshot())["claude"]

    assert claude == {"ok": False, "version": None, "detail": "CLI antwortet nicht"}


async def test_an_api_key_blocks_the_claude_driver(build, home):
    cli = FakeCli()

    claude = (await build(home, cli=cli, env={"ANTHROPIC_API_KEY": "x"}).snapshot())["claude"]

    assert claude["ok"] is False
    assert "API-Key" in claude["detail"]
    assert cli.calls == []  # the key is final: no point asking the CLI anything


async def test_ollama_is_whatever_the_driver_reports(build, home):
    reachable = await build(home, ollama=FakeOllama((True, ["a", "b"], "2 Modelle"))).snapshot()
    down = await build(home, ollama=FakeOllama((False, [], "Nicht erreichbar"))).snapshot()

    assert reachable["ollama"] == {"ok": True, "models": ["a", "b"], "detail": "2 Modelle"}
    assert down["ollama"] == {"ok": False, "models": [], "detail": "Nicht erreichbar"}


async def test_munin_programs_and_kernel_come_from_the_running_system(build, home, kernel):
    kernel.syscalls.munin.write(
        "Notiz", "Text", ["test"], run_id=None, pid=None, program=None, ts=1.0
    )

    snapshot = await build(home).snapshot()

    assert snapshot["munin"] == {"count": 1}
    assert snapshot["programs"] == sorted(kernel.programs)
    assert snapshot["kernel"]["version"] == kernel.version
    assert snapshot["kernel"]["procs"] == 0
    assert 0.0 <= snapshot["kernel"]["uptime_s"] < 60.0


async def test_the_snapshot_is_cached_for_ten_seconds(build, home):
    cli, ollama, clock = FakeCli(), FakeOllama(), FakeClock()
    service = build(home, cli=cli, ollama=ollama, clock=clock)

    await service.snapshot()
    clock.now += 9.0
    await service.snapshot()
    assert len(cli.calls) == 1
    assert ollama.calls == 1

    clock.now += 1.5
    await service.snapshot()
    assert len(cli.calls) == 2
    assert ollama.calls == 2


async def test_the_snapshot_matches_the_frontend_contract(build, home):
    snapshot = await build(home).snapshot()

    assert set(snapshot) == CONTRACT_KEYS
    assert set(snapshot["claude"]) == {"ok", "version", "detail"}
    assert set(snapshot["ollama"]) == {"ok", "models", "detail"}
    assert set(snapshot["munin"]) == {"count"}
    assert set(snapshot["kernel"]) == {"uptime_s", "procs", "version"}


async def test_subsystem_lines_translate_the_snapshot_for_the_boot_log(build, home, empty_home):
    ok = subsystem_lines(await build(home).snapshot())

    assert [line["name"] for line in ok] == ["claude", "ollama", "munin", "programs"]
    assert {line["status"] for line in ok} == {"ok"}
    assert ok[0]["detail"] == "Abo-Login erkannt"

    warned = subsystem_lines(await build(empty_home).snapshot())
    assert warned[0] == {"name": "claude", "status": "warn", "detail": "Nicht angemeldet"}


def test_a_kernel_without_programs_is_an_error_not_a_warning():
    lines = subsystem_lines(
        {
            "claude": {"ok": True, "version": "2.1.261", "detail": "Abo-Login erkannt"},
            "ollama": {"ok": False, "models": [], "detail": "Nicht erreichbar"},
            "munin": {"count": 0},
            "programs": [],
            "kernel": {"uptime_s": 0.0, "procs": 0, "version": "0.1.0"},
        }
    )

    by_name = {line["name"]: line for line in lines}
    assert by_name["ollama"]["status"] == "warn"
    assert by_name["programs"]["status"] == "error"
    assert by_name["munin"]["status"] == "ok"
