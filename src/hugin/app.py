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

from hugin.api import (
    routes_events,
    routes_munin,
    routes_procs,
    routes_recordings,
    routes_runs,
    routes_system,
)
from hugin.drivers.base import AgentDriver
from hugin.drivers.claude_code import ClaudeCodeDriver
from hugin.drivers.ollama import OllamaDriver
from hugin.drivers.scripted import ScriptedDriver
from hugin.kernel.bus import EventBus
from hugin.kernel.events import EventKind
from hugin.kernel.kernel import Kernel
from hugin.kernel.log import EventLog
from hugin.munin.store import MuninStore
from hugin.programs.loader import load_programs
from hugin.settings import Settings
from hugin.syscalls.mcp_server import MCP_PATH, mount_syscall_mcp
from hugin.system.status import SystemStatusService, subsystem_lines

logger = logging.getLogger(__name__)

ROUTERS = (
    routes_system,
    routes_runs,
    routes_procs,
    routes_munin,
    routes_events,
    routes_recordings,
)


def build_drivers(settings: Settings) -> dict[str, AgentDriver]:
    """The table the kernel is built on. Only the simulation needs nothing but itself."""
    return {"scripted": ScriptedDriver()}


def add_live_drivers(table: dict[str, AgentDriver], settings: Settings, kernel: Kernel) -> None:
    """Register the two drivers that need the kernel — tokens, prompts and tool schemas.

    The kernel needs the driver table and both live drivers need the kernel, so the cycle is
    closed here, into the very dict the kernel already holds, instead of through a half-built
    kernel handed out during construction.
    """
    table["claude"] = ClaudeCodeDriver(
        settings,
        mcp_url=f"http://{settings.host}:{settings.port}{MCP_PATH}",
        token_for=kernel.token_for,
        system_prompt_for=kernel.system_prompt_for,
    )
    table["ollama"] = OllamaDriver(
        settings,
        registry_tools_for=kernel.syscalls.tool_schemas,
        system_prompt_for=kernel.system_prompt_for,
    )


async def announce_subsystems(kernel: Kernel, system: SystemStatusService) -> None:
    """One `kernel.subsystem` event per subsystem, so the log says what works before anything
    is started — and the boot screen has something to render even before it asks `/api/system`."""
    for line in subsystem_lines(await system.snapshot()):
        await kernel.emit(EventKind.KERNEL_SUBSYSTEM, run_id=None, pid=None, data=line)


def create_app(
    settings: Settings | None = None,
    drivers: dict[str, AgentDriver] | None = None,
    system: SystemStatusService | None = None,
) -> FastAPI:
    """Build the hugin FastAPI application.

    The settings object is kept on ``app.state`` so routes and background tasks resolve it
    through the app instead of re-reading the environment. A test that brings its own driver
    table brings its own status service too — the real one would probe the real machine.
    """
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        log = EventLog(settings.db_path)
        bus = EventBus(log)
        munin = MuninStore(settings.db_path)  # the same database file as the event log
        table = build_drivers(settings) if drivers is None else drivers
        kernel = Kernel(settings, log, bus, load_programs(), table, munin)
        if drivers is None:
            add_live_drivers(table, settings, kernel)
        app.state.system = system or SystemStatusService(
            settings, munin, kernel, table["ollama"]
        )
        await kernel.boot()
        app.state.kernel = kernel
        await announce_subsystems(kernel, app.state.system)
        try:
            # The MCP session manager owns a task group of its own, so `/mcp` is only alive
            # between these two lines — exactly as long as the kernel it speaks for.
            async with app.state.mcp.run():
                yield
        finally:
            app.state.kernel = None
            app.state.system = None
            await kernel.shutdown()
            munin.close()
            log.close()

    app = FastAPI(title="hugin", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.kernel = None
    app.state.system = None
    for module in ROUTERS:
        app.include_router(module.router)
    # Before the shell: the static mount at `/` swallows every path that reaches it.
    app.state.mcp = mount_syscall_mcp(app)
    _mount_shell(app, settings)
    return app


def _mount_shell(app: FastAPI, settings: Settings) -> None:
    """Serve the built shell at `/` — mounted last, so `/api/*` and `/mcp` win."""
    dist = settings.repo_root / "frontend" / "dist"
    if not dist.is_dir():
        logger.info("no frontend/dist — serving the API only (npm --prefix frontend run build)")
        return
    app.mount("/", StaticFiles(directory=dist, html=True), name="shell")


__all__ = ["add_live_drivers", "announce_subsystems", "build_drivers", "create_app"]
