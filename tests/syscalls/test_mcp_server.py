"""The MCP syscall transport: a real server on a real localhost socket, a real MCP client.

This is the one test that cannot be faked away. The point of the transport is that an agent
process authenticates with nothing but a bearer token, so the header plumbing, the capability
gate and the error shape have to be exercised through the official client. The socket is on
127.0.0.1 and the driver is the scripted one — no network, no model, no subprocess.

`uvicorn` runs on a loop of this test's making in a background thread, so the fixture can put
kernel work onto that loop with `run_coroutine_threadsafe` instead of touching asyncio
primitives that belong to another loop.
"""

import asyncio
import concurrent.futures
import contextlib
import json
import socket
import threading
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx2
import pytest
import uvicorn
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import MCPError

from hugin.app import create_app
from hugin.drivers.scripted import ScriptedDriver
from hugin.kernel.events import EventKind
from hugin.kernel.kernel import Kernel
from hugin.settings import Settings

HELLO = "script:hello"
TIMEOUT_S = 10.0

SCOUT_TOOLS = ["mission_report", "munin_search", "munin_write"]
PLANNER_TOOLS = [
    "artifact_write",
    "munin_search",
    "munin_write",
    "proc_send",
    "proc_spawn",
    "proc_wait",
]


async def _no_sleep(_seconds: float) -> None:
    """Scripted pacing is free in tests: the driver awaits this instead of the clock."""


@dataclass
class Server:
    """A running hugin server: its `/mcp` URL, its kernel, and a way onto its event loop."""

    url: str
    kernel: Kernel
    loop: asyncio.AbstractEventLoop

    async def on_server_loop(self, coro: Awaitable[Any]) -> Any:
        return await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(coro, self.loop))

    async def create_run(self, goal: str) -> str:
        return await self.on_server_loop(self.kernel.create_run(goal, driver="scripted"))

    async def spawn(self, run_id: str, program: str) -> int:
        return await self.on_server_loop(
            self.kernel.spawn(run_id, program, HELLO, driver="scripted")
        )

    def token_for(self, pid: int) -> str:
        return self.kernel.token_for(pid)

    def events(self, kind: EventKind, pid: int) -> list:
        return [e for e in self.kernel.collected if e.kind == kind and e.pid == pid]


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


async def _await_health(base: str) -> None:
    async def _poll() -> None:
        async with httpx2.AsyncClient() as client:
            while True:
                with contextlib.suppress(Exception):  # the socket is simply not up yet
                    if (await client.get(f"{base}/api/health")).status_code == 200:
                        return
                await asyncio.sleep(0.02)

    await asyncio.wait_for(_poll(), TIMEOUT_S)


@pytest.fixture
async def server(tmp_path: Path) -> AsyncIterator[Server]:
    """The real app under uvicorn on a free localhost port, shut down afterwards."""
    settings = Settings(
        data_dir=tmp_path / "data", runs_dir=tmp_path / "runs", max_concurrent={"scripted": 8}
    )
    app = create_app(settings, drivers={"scripted": ScriptedDriver(clock_sleep=_no_sleep)})
    port = _free_port()
    uvicorn_server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    )

    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, name="hugin-test-server", daemon=True)
    thread.start()
    serving = asyncio.run_coroutine_threadsafe(uvicorn_server.serve(), loop)
    base = f"http://127.0.0.1:{port}"
    await _await_health(base)
    # The kernel's event stream is only reachable through the bus; the same handle the other
    # kernel tests use, attached here so assertions can read what the syscalls wrote.
    kernel = app.state.kernel
    kernel.collected = []
    kernel.bus.subscribe(_collector(kernel.collected))

    yield Server(url=f"{base}/mcp", kernel=kernel, loop=loop)

    uvicorn_server.should_exit = True
    with contextlib.suppress(concurrent.futures.TimeoutError):
        serving.result(timeout=TIMEOUT_S)
    loop.call_soon_threadsafe(loop.stop)
    thread.join(timeout=TIMEOUT_S)
    loop.close()


def _collector(sink: list) -> Callable[[Any], Awaitable[None]]:
    async def _collect(event: Any) -> None:
        sink.append(event)

    return _collect


@dataclass
class Agent:
    """One agent's view of the transport: an MCP session behind that agent's own token."""

    session: ClientSession

    async def tool_names(self) -> list[str]:
        return sorted(tool.name for tool in (await self.session.list_tools()).tools)

    async def call(self, name: str, args: dict) -> Any:
        return await self.session.call_tool(name, args)


@contextlib.asynccontextmanager
async def connect(server: Server, token: str | None) -> AsyncIterator[Agent]:
    """An initialised MCP session carrying `token` in its `Authorization` header.

    `token=None` sends no header at all — the shape of a client that was never told one.
    """
    headers = {} if token is None else {"Authorization": f"Bearer {token}"}
    async with (
        httpx2.AsyncClient(headers=headers) as http,
        streamable_http_client(server.url, http_client=http) as (read, write),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        yield Agent(session)


def text_of(result: Any) -> str:
    return "".join(block.text for block in result.content if block.type == "text")


@pytest.fixture
async def run(server: Server):
    """`(server, run_id, spawn)` — a run on the live server whose processes really run."""
    run_id = await server.create_run("MCP-Transport")

    async def _spawn(program: str) -> int:
        return await server.spawn(run_id, program)

    return server, run_id, _spawn


# --- what a token is allowed to see ------------------------------------------------------


async def test_a_scout_is_offered_exactly_its_three_syscalls(run):
    server, _run_id, spawn = run
    scout = await spawn("scout")

    async with connect(server, server.token_for(scout)) as agent:
        assert await agent.tool_names() == SCOUT_TOOLS


async def test_a_planner_is_offered_the_six_its_capabilities_grant(run):
    server, _run_id, spawn = run
    planner = await spawn("planner")

    async with connect(server, server.token_for(planner)) as agent:
        assert await agent.tool_names() == PLANNER_TOOLS


async def test_a_tool_carries_its_description_and_argument_schema(run):
    server, _run_id, spawn = run
    scout = await spawn("scout")

    async with connect(server, server.token_for(scout)) as agent:
        tools = {tool.name: tool for tool in (await agent.session.list_tools()).tools}
    write = tools["munin_write"]
    assert "munin" in (write.description or "")
    assert write.input_schema["required"] == ["title", "body"]


# --- what a token is allowed to do -------------------------------------------------------


async def test_a_syscall_over_mcp_reaches_the_kernel_and_is_logged_against_the_pid(run):
    server, _run_id, spawn = run
    scout = await spawn("scout")
    before = server.kernel.syscalls.munin.count()

    async with connect(server, server.token_for(scout)) as agent:
        result = await agent.call(
            "munin_write",
            {"title": "Ollama läuft lokal", "body": "qwen2.5:7b antwortet in ~2 s."},
        )

    assert result.is_error is not True
    assert "id" in json.loads(text_of(result))
    assert server.kernel.syscalls.munin.count() == before + 1
    calls = server.events(EventKind.SYS_CALL, scout)
    assert [event.data["syscall"] for event in calls] == ["munin_write"]
    assert server.events(EventKind.SYS_RESULT, scout)[-1].data["ok"] is True


async def test_a_syscall_the_caller_may_not_make_comes_back_as_a_tool_error(run):
    server, _run_id, spawn = run
    scout = await spawn("scout")

    async with connect(server, server.token_for(scout)) as agent:
        result = await agent.call("proc_spawn", {"program": "judge", "task": "prüfen"})
        assert result.is_error is True
        assert "capability" in text_of(result)
        # A refusal is a tool error, not a dead session: the same session keeps working.
        assert await agent.tool_names() == SCOUT_TOOLS
    assert server.events(EventKind.SYS_RESULT, scout)[-1].data["ok"] is False


async def test_bad_arguments_come_back_as_a_tool_error_too(run):
    server, _run_id, spawn = run
    scout = await spawn("scout")

    async with connect(server, server.token_for(scout)) as agent:
        result = await agent.call("munin_write", {"title": "ohne Body"})
    assert result.is_error is True
    assert "body" in text_of(result)


async def test_a_token_still_works_after_the_process_exited(run):
    server, _run_id, spawn = run
    scout = await spawn("scout")
    token = server.token_for(scout)

    async def _exited() -> None:
        while server.kernel.procs.get(scout).alive:
            await asyncio.sleep(0.01)

    await asyncio.wait_for(_exited(), TIMEOUT_S)
    async with connect(server, token) as agent:
        assert await agent.tool_names() == SCOUT_TOOLS


# --- what a token that is not one may do -------------------------------------------------


def _leaves(error: BaseException) -> list[BaseException]:
    """The client wraps a transport failure in its task groups; the refusal is a leaf."""
    if isinstance(error, BaseExceptionGroup):
        return [leaf for inner in error.exceptions for leaf in _leaves(inner)]
    return [error]


@pytest.mark.parametrize("token", ["0" * 32, "not-a-token", None])
async def test_a_token_the_kernel_never_issued_is_refused(run, token):
    server, _run_id, spawn = run
    await spawn("scout")

    with pytest.raises(BaseException) as caught:  # noqa: PT011 - the transport picks the type
        async with connect(server, token) as agent:
            await agent.tool_names()

    messages = [str(leaf) for leaf in _leaves(caught.value)]
    assert any(isinstance(leaf, MCPError) for leaf in _leaves(caught.value)), messages
    assert any("bearer token" in message for message in messages), messages
