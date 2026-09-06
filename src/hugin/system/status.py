"""One honest answer to "what works on this machine right now".

The boot screen, the command palette and the mission gate all read the same snapshot, so a
driver the UI offers is a driver a mission can really get. Everything that touches the outside
world is a seam — the `claude --version` call and the Ollama driver — and both are faked in
tests. The snapshot is cached for ten seconds: it costs a subprocess and an HTTP round trip,
and no answer here changes faster than that.
"""

import asyncio
import os
import time
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Protocol

from hugin.kernel.kernel import Kernel
from hugin.munin.store import MuninStore
from hugin.settings import Settings

API_KEY_ENV = "ANTHROPIC_API_KEY"
CACHE_TTL_S = 10.0
VERSION_TIMEOUT_S = 5.0

CLAUDE_OK = "Abo-Login erkannt"
CLAUDE_NO_CLI = "CLI nicht gefunden"
CLAUDE_NO_ANSWER = "CLI antwortet nicht"
CLAUDE_LOGGED_OUT = "Nicht angemeldet"
CLAUDE_API_KEY = "API-Key gesetzt — blockiert"

RunCmd = Callable[[list[str]], Awaitable[tuple[int, str]]]


class OllamaProbe(Protocol):
    """The one method the report needs from the Ollama driver."""

    async def available(self) -> tuple[bool, list[str], str]: ...


async def run_cmd(argv: list[str]) -> tuple[int, str]:
    """The default seam: run a command and return its exit code and stdout.

    Failures stay failures — a missing binary raises `FileNotFoundError`, one that never
    answers is killed and raises `TimeoutError` — because the report says the two differently.
    """
    process = await asyncio.create_subprocess_exec(
        *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
    )
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(), VERSION_TIMEOUT_S)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise
    return process.returncode or 0, stdout.decode("utf-8", "replace")


class SystemStatusService:
    """Builds the subsystem report the frontend's `SystemStatus` type mirrors."""

    def __init__(
        self,
        settings: Settings,
        munin: MuninStore,
        kernel: Kernel,
        ollama_driver: OllamaProbe,
        *,
        run_cmd: RunCmd = run_cmd,
        env: Mapping[str, str] = os.environ,
        home: Path | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._settings = settings
        self._munin = munin
        self._kernel = kernel
        self._ollama = ollama_driver
        self._run_cmd = run_cmd
        self._env = env
        self._home = home or Path.home()
        self._clock = clock
        self._cached: dict | None = None
        self._cached_at = 0.0

    async def snapshot(self) -> dict:
        now = self._clock()
        if self._cached is not None and now - self._cached_at < CACHE_TTL_S:
            return self._cached
        ollama_ok, models, ollama_detail = await self._ollama.available()
        self._cached = {
            "claude": await self._claude(),
            "ollama": {"ok": ollama_ok, "models": models, "detail": ollama_detail},
            "munin": {"count": self._munin.count()},
            "programs": sorted(self._kernel.programs),
            "kernel": {
                "uptime_s": self._uptime_s(),
                "procs": len(self._kernel.procs.alive()),
                "version": self._kernel.version,
            },
        }
        self._cached_at = now
        return self._cached

    async def _claude(self) -> dict:
        # The key is checked first and is final: hugin runs Claude Code on the subscription
        # only (spec §1.1), so what the CLI would answer does not matter here.
        if API_KEY_ENV in self._env:
            return {"ok": False, "version": None, "detail": CLAUDE_API_KEY}
        try:
            version = await self._claude_version()
        except TimeoutError:  # a CLI that hangs is a different problem from a missing one
            return {"ok": False, "version": None, "detail": CLAUDE_NO_ANSWER}
        if version is None:
            return {"ok": False, "version": None, "detail": CLAUDE_NO_CLI}
        if not (self._home / ".claude" / ".credentials.json").exists():
            return {"ok": False, "version": version, "detail": CLAUDE_LOGGED_OUT}
        return {"ok": True, "version": version, "detail": CLAUDE_OK}

    async def _claude_version(self) -> str | None:
        """`claude --version` prints "2.1.261 (Claude Code)" — the first token is the version.

        `None` means there is no usable CLI. A timeout leaves through the caller instead, which
        reports it as its own failure: "not installed" and "not answering" are different truths.
        """
        try:
            code, stdout = await self._run_cmd([self._settings.claude_bin, "--version"])
        except TimeoutError:
            raise  # a subclass of OSError, so it has to escape before the catch below
        except OSError:
            return None  # not installed, not executable, not permitted
        if code != 0:
            return None
        first = stdout.split()
        return first[0] if first else None

    def _uptime_s(self) -> float:
        booted_at = self._kernel.booted_at
        if booted_at is None:
            return 0.0
        return max(0.0, self._kernel.clock() - booted_at)


def subsystem_lines(snapshot: dict) -> list[dict]:
    """The boot announcement: one `kernel.subsystem` payload per subsystem, German details.

    Amber, not red, for the two drivers — a machine without Ollama or without a Claude login
    still runs the simulation. A kernel without programs can run nothing at all.
    """
    programs = snapshot["programs"]
    count = snapshot["munin"]["count"]
    return [
        _line("claude", snapshot["claude"]["ok"], snapshot["claude"]["detail"]),
        _line("ollama", snapshot["ollama"]["ok"], snapshot["ollama"]["detail"]),
        {
            "name": "munin",
            "status": "ok",
            "detail": "1 Eintrag" if count == 1 else f"{count} Einträge",
        },
        {
            "name": "programs",
            "status": "ok" if programs else "error",
            "detail": f"{len(programs)} Programme" if programs else "Keine Programme geladen",
        },
    ]


def _line(name: str, ok: bool, detail: str) -> dict:
    return {"name": name, "status": "ok" if ok else "warn", "detail": detail}


__all__ = ["CACHE_TTL_S", "SystemStatusService", "run_cmd", "subsystem_lines"]
