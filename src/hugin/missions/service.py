"""The one place a goal becomes a run.

The rules that make a mission legal live here, not in the route: a goal that says something, no
path outside the user's private tree, and a driver that can actually run. Everything after the
spawn emerges from the planner's own syscalls.
"""

import re
from pathlib import Path

from fastapi import HTTPException

from hugin.kernel.kernel import Kernel
from hugin.system.status import SystemStatusService

ROOT_PROGRAM = "planner"
PRIVATE_ROOT = Path.home() / "private"
# The two drivers that need something outside hugin to work, and how the refusal names them.
LIVE_DRIVERS = {"claude": "Claude", "ollama": "Ollama"}

# URLs are stripped first: the "//host/path" of a URL would otherwise read as an absolute path.
_URL = re.compile(r"\b[a-z][a-z0-9+.-]*://\S+", re.IGNORECASE)
# An absolute or home path. The lookbehind keeps prose out — "und/oder" and "km/h" are not
# paths — and at least one name character must follow the slash, so a lone "/" is not either.
_PATH = re.compile(r"(?<![\w:.])(?:~/|/)[\w.~-]+(?:/[\w.~-]*)*")


async def start_mission(
    kernel: Kernel,
    system: SystemStatusService,
    goal: str,
    driver: str = "scripted",
    template: str | None = None,
) -> str:
    """Validate the mission, create its run and spawn the planner as the run's root process."""
    goal = goal.strip()
    if not goal:
        raise HTTPException(status_code=422, detail="Ziel darf nicht leer sein.")
    _reject_foreign_paths(goal)
    await _require_available_driver(kernel, system, driver)
    run_id = await kernel.create_run(goal, driver, template)
    await kernel.spawn(run_id, ROOT_PROGRAM, goal, driver=driver)
    return run_id


def _reject_foreign_paths(goal: str) -> None:
    """A mission may only point at the user's own private tree — see spec §7."""
    private_root = PRIVATE_ROOT.resolve()
    for match in _PATH.finditer(_URL.sub(" ", goal)):
        candidate = Path(match.group()).expanduser()
        if not candidate.is_absolute() or not candidate.resolve().is_relative_to(private_root):
            raise HTTPException(status_code=422, detail="Pfade müssen unter ~/private liegen.")


async def _require_available_driver(
    kernel: Kernel, system: SystemStatusService, driver: str
) -> None:
    """Whether this machine can really run the driver the mission asks for.

    A name the kernel does not know is a bad request (422). A known driver whose subsystem is
    down is a conflict (409) carrying the same German reason the boot screen shows — read from
    the live snapshot, so a Claude login or an Ollama restart takes effect without a restart.
    """
    if driver not in kernel.drivers:
        raise HTTPException(status_code=422, detail=f"Driver „{driver}“ ist unbekannt.")
    if driver not in LIVE_DRIVERS:
        return  # the simulation needs nothing but the kernel itself
    subsystem = (await system.snapshot())[driver]
    if not subsystem["ok"]:
        raise HTTPException(
            status_code=409,
            detail=f"{LIVE_DRIVERS[driver]} nicht verfügbar: {subsystem['detail']}",
        )
