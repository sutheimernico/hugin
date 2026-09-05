"""The one place a goal becomes a run.

The rules that make a mission legal live here, not in the route: a goal that says something, no
path outside the user's private tree, and a driver that can actually run. Everything after the
spawn emerges from the planner's own syscalls.
"""

import re
from pathlib import Path

from fastapi import HTTPException

from hugin.kernel.kernel import Kernel

ROOT_PROGRAM = "planner"
PRIVATE_ROOT = Path.home() / "private"

# URLs are stripped first: the "//host/path" of a URL would otherwise read as an absolute path.
_URL = re.compile(r"\b[a-z][a-z0-9+.-]*://\S+", re.IGNORECASE)
# An absolute or home path. The lookbehind keeps prose out — "und/oder" and "km/h" are not
# paths — and at least one name character must follow the slash, so a lone "/" is not either.
_PATH = re.compile(r"(?<![\w:.])(?:~/|/)[\w.~-]+(?:/[\w.~-]*)*")


async def start_mission(
    kernel: Kernel, goal: str, driver: str = "scripted", template: str | None = None
) -> str:
    """Validate the mission, create its run and spawn the planner as the run's root process."""
    goal = goal.strip()
    if not goal:
        raise HTTPException(status_code=422, detail="Ziel darf nicht leer sein.")
    _reject_foreign_paths(goal)
    _require_available_driver(kernel, driver)
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


def _require_available_driver(kernel: Kernel, driver: str) -> None:
    """Whether a driver can run at all. Task 21 replaces this with the live subsystem check
    (Claude logged in, Ollama reachable); the 409 contract it answers with is already here."""
    if driver not in kernel.drivers:
        raise HTTPException(
            status_code=409, detail=f"Driver „{driver}“ ist auf diesem Rechner nicht verfügbar."
        )
