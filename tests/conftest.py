"""Kernel fixtures: a real kernel on tmp dirs, driven by the deterministic scripted driver.

The kernel is built exactly as production builds it — real event log, real bus, real programs —
only the clock the scripted driver sleeps on is a no-op, so a scripted run costs no wall time.
"""

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest

from hugin.drivers.scripted import ScriptedDriver
from hugin.kernel.bus import EventBus
from hugin.kernel.events import Event
from hugin.kernel.kernel import Kernel
from hugin.kernel.log import EventLog
from hugin.programs.loader import load_programs
from hugin.settings import Settings

TEST_TICK_S = 0.01


async def _no_sleep(_seconds: float) -> None:
    """Scripted pacing is free in tests: the driver awaits this instead of the clock."""


@pytest.fixture
async def make_kernel(tmp_path: Path):
    """Factory for kernels, each on its own tmp dirs; every kernel is shut down afterwards."""
    built: list[tuple[Kernel, EventLog]] = []

    async def _make(
        *,
        limits: dict[str, int] | None = None,
        scripts_dir: Path | None = None,
        tick_s: float = TEST_TICK_S,
    ) -> Kernel:
        root = tmp_path / f"k{len(built)}"
        settings = Settings(
            data_dir=root / "data",
            runs_dir=root / "runs",
            max_concurrent=limits if limits is not None else {"scripted": 8},
        )
        log = EventLog(settings.db_path)
        bus = EventBus(log)
        drivers = {"scripted": ScriptedDriver(scripts_dir=scripts_dir, clock_sleep=_no_sleep)}
        kernel = Kernel(settings, log, bus, load_programs(), drivers, tick_s=tick_s)
        collected: list[Event] = []

        async def _collect(event: Event) -> None:
            collected.append(event)

        bus.subscribe(_collect)
        # Test-only handle on the event stream; the kernel itself never reads it.
        kernel.collected = collected
        built.append((kernel, log))
        await kernel.boot()
        return kernel

    yield _make

    for kernel, log in built:
        await kernel.shutdown()
        log.close()


@pytest.fixture
async def kernel(make_kernel) -> Kernel:
    return await make_kernel()


@pytest.fixture
def until() -> Callable[..., Awaitable[None]]:
    """Await a predicate instead of a fixed sleep — fails loudly if it never becomes true."""

    async def _until(predicate: Callable[[], bool], timeout: float = 2.0) -> None:
        async def _poll() -> None:
            while not predicate():
                await asyncio.sleep(0.001)

        await asyncio.wait_for(_poll(), timeout)

    return _until
