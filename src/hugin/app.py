"""The FastAPI application.

One lifespan builds the whole stack — event log, bus, munin, programs, drivers, kernel — and
tears it down again, so the process has exactly one kernel and the routers stay thin lookups
on `app.state`. Tests build their own app with their own drivers instead of patching anything.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from hugin.api import routes_events, routes_munin, routes_procs, routes_runs, routes_system
from hugin.drivers.base import AgentDriver
from hugin.drivers.scripted import ScriptedDriver
from hugin.kernel.bus import EventBus
from hugin.kernel.kernel import Kernel
from hugin.kernel.log import EventLog
from hugin.munin.store import MuninStore
from hugin.programs.loader import load_programs
from hugin.settings import Settings

logger = logging.getLogger(__name__)

ROUTERS = (routes_system, routes_runs, routes_procs, routes_munin, routes_events)


def build_drivers(settings: Settings) -> dict[str, AgentDriver]:
    """The driver table the kernel runs on.

    `claude` (Task 18) and `ollama` (Task 20) are registered here once they exist. Until then
    the simulation is the only driver that is real — and a mission asking for another one is
    refused with a 409 rather than silently downgraded.
    """
    return {"scripted": ScriptedDriver()}


def create_app(
    settings: Settings | None = None, drivers: dict[str, AgentDriver] | None = None
) -> FastAPI:
    """Build the hugin FastAPI application.

    The settings object is kept on ``app.state`` so routes and background tasks resolve it
    through the app instead of re-reading the environment.
    """
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        log = EventLog(settings.db_path)
        bus = EventBus(log)
        munin = MuninStore(settings.db_path)  # the same database file as the event log
        table = build_drivers(settings) if drivers is None else drivers
        kernel = Kernel(settings, log, bus, load_programs(), table, munin)
        await kernel.boot()
        app.state.kernel = kernel
        try:
            yield
        finally:
            app.state.kernel = None
            await kernel.shutdown()
            munin.close()
            log.close()

    app = FastAPI(title="hugin", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.kernel = None
    for module in ROUTERS:
        app.include_router(module.router)
    _mount_shell(app, settings)
    return app


def _mount_shell(app: FastAPI, settings: Settings) -> None:
    """Serve the built shell at `/` — mounted after the routers, so every `/api/*` route wins."""
    dist = settings.repo_root / "frontend" / "dist"
    if not dist.is_dir():
        logger.info("no frontend/dist — serving the API only (npm --prefix frontend run build)")
        return
    app.mount("/", StaticFiles(directory=dist, html=True), name="shell")


__all__ = ["build_drivers", "create_app"]
