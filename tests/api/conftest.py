"""API fixtures: the real app on tmp dirs, driven through ASGI without a socket.

Three things need care here. First, `httpx.ASGITransport` never runs the lifespan, so the
kernel is booted explicitly — and by a task of its own (`_lifespan`), because the lifespan
holds task-affine resources (the MCP session manager's task group) that must be entered and
exited in the same task, which a pytest fixture's setup and teardown are not. Second, that
transport buffers the whole response body before it returns — fine for JSON, useless for a
stream that never ends — so SSE is driven through the raw ASGI callable by `_SseStream` below.
"""

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import pytest

from hugin.app import create_app
from hugin.drivers.scripted import ScriptedDriver
from hugin.kernel.kernel import Kernel
from hugin.settings import Settings
from tests.conftest import FakeSystem

DEFAULT_GOAL = "Erstelle ein Recherche-Briefing zu lokalen KI-Agenten."
BASE_URL = "http://hugin.test"


async def _no_sleep(_seconds: float) -> None:
    """Scripted pacing is free in tests: the driver awaits this instead of the clock."""


@dataclass
class Api:
    client: httpx.AsyncClient
    app: object

    @property
    def kernel(self) -> Kernel:
        return self.app.state.kernel

    @property
    def system(self) -> FakeSystem:
        return self.app.state.system


@contextlib.asynccontextmanager
async def _lifespan(app) -> AsyncIterator[None]:
    """Run the app's lifespan start-to-finish inside one task, the way a real server does.

    `AsyncExitStack.enter_async_context` would enter it in the fixture's setup task and leave
    it in the teardown task; anyio task groups (the MCP session manager owns one) refuse that.
    """
    started, stop = asyncio.Event(), asyncio.Event()

    async def _drive() -> None:
        async with app.router.lifespan_context(app):
            started.set()
            await stop.wait()

    task = asyncio.create_task(_drive(), name="hugin-test-lifespan")
    waiter = asyncio.ensure_future(started.wait())
    await asyncio.wait([task, waiter], return_when=asyncio.FIRST_COMPLETED)
    waiter.cancel()
    if task.done():  # startup failed — surface its exception instead of hanging
        await task
    try:
        yield
    finally:
        stop.set()
        await task


@pytest.fixture
async def make_api(tmp_path: Path):
    """Factory for booted apps, each on its own tmp dirs; all are torn down afterwards."""
    stack = contextlib.AsyncExitStack()
    built = 0

    async def _make(
        clock_sleep: Callable[[float], Awaitable[None]] = _no_sleep,
        limits: dict[str, int] | None = None,
        drivers: dict | None = None,
        system: FakeSystem | None = None,
    ) -> Api:
        nonlocal built
        root = tmp_path / f"api{built}"
        built += 1
        settings = Settings(
            data_dir=root / "data",
            runs_dir=root / "runs",
            max_concurrent=limits if limits is not None else {"scripted": 8},
        )
        app = create_app(
            settings,
            # Never the real table: a test app runs the simulation and reads a fake report, so
            # nothing here can start `claude` or reach for Ollama.
            drivers=drivers or {"scripted": ScriptedDriver(clock_sleep=clock_sleep)},
            system=system or FakeSystem(),
        )
        await stack.enter_async_context(_lifespan(app))
        client = await stack.enter_async_context(
            httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=BASE_URL)
        )
        return Api(client=client, app=app)

    async with stack:
        yield _make


@pytest.fixture
async def api(make_api) -> Api:
    return await make_api()


@pytest.fixture
def start_mission():
    async def _start(api: Api, goal: str = DEFAULT_GOAL, **extra) -> str:
        response = await api.client.post(
            "/api/missions", json={"goal": goal, "driver": "scripted", **extra}
        )
        assert response.status_code == 201, response.text
        return response.json()["run_id"]

    return _start


@pytest.fixture
def wait_for_run():
    """Await a run leaving the `running` state — fails loudly instead of sleeping blindly."""

    async def _wait(api: Api, run_id: str, timeout: float = 10.0) -> dict:
        async def _poll() -> dict:
            while True:
                run = (await api.client.get(f"/api/runs/{run_id}")).json()
                if run["state"] != "running":
                    return run
                await asyncio.sleep(0.005)

        return await asyncio.wait_for(_poll(), timeout)

    return _wait


@pytest.fixture
def sse(api: Api):
    """Open an SSE endpoint and read it message by message."""

    @contextlib.asynccontextmanager
    async def _open(url: str):
        stream = _SseStream(api.app, url)
        await stream.start()
        try:
            yield stream
        finally:
            await stream.close()

    return _open


@dataclass
class _SseStream:
    """A minimal SSE client over the raw ASGI callable.

    It exists because `httpx.ASGITransport` waits for the response to complete, which an event
    stream never does. Disconnect is signalled the way a real client does it: an
    `http.disconnect` message on the receive channel.
    """

    app: object
    url: str
    status: int = 0
    headers: dict[str, str] = field(default_factory=dict)
    _chunks: asyncio.Queue = field(default_factory=asyncio.Queue)
    _buffer: str = ""
    _disconnect: asyncio.Event = field(default_factory=asyncio.Event)
    _task: asyncio.Task | None = None

    async def start(self, timeout: float = 5.0) -> None:
        parts = urlsplit(self.url)
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": parts.path,
            "raw_path": parts.path.encode(),
            "query_string": parts.query.encode(),
            "root_path": "",
            "headers": [(b"host", b"hugin.test"), (b"accept", b"text/event-stream")],
            "client": ("127.0.0.1", 123),
            "server": ("hugin.test", 80),
        }
        started = asyncio.Event()

        async def receive() -> dict:
            await self._disconnect.wait()
            return {"type": "http.disconnect"}

        async def send(message: dict) -> None:
            if message["type"] == "http.response.start":
                self.status = message["status"]
                self.headers = {k.decode(): v.decode() for k, v in message.get("headers", [])}
                started.set()
            elif message["type"] == "http.response.body":
                body = message.get("body", b"")
                if body:
                    self._chunks.put_nowait(body)
                if not message.get("more_body", False):
                    self._chunks.put_nowait(None)
                    started.set()

        self._task = asyncio.create_task(self.app(scope, receive, send), name="sse-test-stream")
        await asyncio.wait_for(started.wait(), timeout)

    async def message(self, timeout: float = 5.0) -> dict:
        """The next SSE message as `{id, event, data}`; heartbeat comments are skipped."""

        async def _next() -> dict:
            while True:
                message = self._take()
                if message is not None:
                    return message
                chunk = await self._chunks.get()
                if chunk is None:
                    raise AssertionError("event stream ended unexpectedly")
                self._buffer += chunk.decode()

        return await asyncio.wait_for(_next(), timeout)

    async def until(self, predicate: Callable[[dict], bool], timeout: float = 5.0) -> dict:
        """Read messages until one satisfies `predicate`, then return it."""

        async def _search() -> dict:
            while True:
                message = await self.message(timeout)
                if predicate(message):
                    return message

        return await asyncio.wait_for(_search(), timeout)

    def _take(self) -> dict | None:
        normalised = self._buffer.replace("\r\n", "\n")
        head, separator, tail = normalised.partition("\n\n")
        if not separator:
            self._buffer = normalised
            return None
        self._buffer = tail
        fields: dict[str, str] = {}
        for line in head.split("\n"):
            if not line or line.startswith(":"):
                continue  # heartbeat comment
            key, _, value = line.partition(":")
            fields[key] = value.removeprefix(" ")
        return fields or self._take()

    async def close(self) -> None:
        self._disconnect.set()
        if self._task is None:
            return
        with contextlib.suppress(TimeoutError, asyncio.CancelledError):
            await asyncio.wait_for(asyncio.shield(self._task), 1.0)
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task


def payload(message: dict) -> dict:
    """The `data:` field of an SSE message, parsed back into the event it carries."""
    return json.loads(message["data"])
