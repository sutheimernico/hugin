"""The syscall transport for Claude agents: the kernel's syscalls as MCP tools over HTTP.

A `claude -p` subprocess reaches the kernel through exactly one door — a Streamable HTTP MCP
endpoint at `/mcp`, on 127.0.0.1 — and identifies itself with the bearer token the kernel
minted for its process at spawn. Token → pid is the whole authentication story: from the pid
the registry already knows which syscalls the process may see and which it may make, so this
module stays a translation layer and holds no policy of its own.

Two rules shape the code. A refusal is a *tool error*, not a transport error: an agent that
asks for a capability it does not hold gets one readable sentence back and keeps its session,
because a dead session would cost the run. And a token never appears in an event, a log line
or an error message — the event log names processes by pid, and only by pid.
"""

import json
import logging
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import mcp_types as types
from mcp.server import Server as McpServer
from mcp.server.context import ServerRequestContext
from mcp.server.streamable_http_manager import StreamableHTTPASGIApp, StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from mcp.shared.exceptions import MCPError
from starlette.routing import Route

from hugin.drivers.base import SyscallError

if TYPE_CHECKING:  # pragma: no cover - the app wires this up, the kernel never imports it
    from fastapi import FastAPI

    from hugin.kernel.kernel import Kernel

logger = logging.getLogger(__name__)

SERVER_NAME = "hugin"
MCP_PATH = "/mcp"
BEARER = "bearer "
NO_CALLER = "no usable bearer token — a hugin syscall needs the token of its own process"

# The transport is loopback-only, and DNS-rebinding protection is what keeps a page in the
# user's browser from talking to it. Same allow-list the SDK sets up for a localhost server.
LOOPBACK_SECURITY = TransportSecuritySettings(
    enable_dns_rebinding_protection=True,
    allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"],
    allowed_origins=["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"],
)

KernelSource = Callable[[], "Kernel | None"]


def caller_pid(kernel_source: KernelSource, ctx: ServerRequestContext) -> tuple["Kernel", int]:
    """Resolve the calling process from the request's `Authorization: Bearer <token>` header.

    Raises `MCPError` — the transport's 401 — when there is no token, or none the kernel ever
    issued. The message deliberately says nothing about the token it saw.
    """
    kernel = kernel_source()
    request = getattr(ctx, "request", None)
    header = request.headers.get("authorization", "") if request is not None else ""
    token = header[len(BEARER) :] if header.lower().startswith(BEARER) else ""
    pid = kernel.pid_for(token) if (kernel is not None and token) else None
    if kernel is None or pid is None:
        raise MCPError(types.INVALID_REQUEST, NO_CALLER)
    return kernel, pid


def build_server(kernel_source: KernelSource) -> McpServer:
    """An MCP server whose tool table is whatever the calling process is allowed to call."""

    async def on_list_tools(
        ctx: ServerRequestContext, _params: types.PaginatedRequestParams | None
    ) -> types.ListToolsResult:
        kernel, pid = caller_pid(kernel_source, ctx)
        return types.ListToolsResult(
            tools=[
                types.Tool(
                    name=schema["name"],
                    description=schema["description"],
                    input_schema=schema["input_schema"],
                )
                for schema in kernel.syscalls.tool_schemas(pid)
            ]
        )

    async def on_call_tool(
        ctx: ServerRequestContext, params: types.CallToolRequestParams
    ) -> types.CallToolResult:
        kernel, pid = caller_pid(kernel_source, ctx)
        arguments: dict[str, Any] = dict(params.arguments or {})
        try:
            result = await kernel.syscalls.call(pid, params.name, arguments)
        except SyscallError as err:
            return _tool_result(str(err), is_error=True)
        return _tool_result(json.dumps(result, ensure_ascii=False, default=str))

    return McpServer(SERVER_NAME, on_list_tools=on_list_tools, on_call_tool=on_call_tool)


def _tool_result(text: str, *, is_error: bool = False) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)], is_error=is_error
    )


def build_session_manager(kernel_source: KernelSource) -> StreamableHTTPSessionManager:
    """The Streamable HTTP transport: stateless, JSON responses, loopback-only.

    Stateless because a process's identity lives in its token, not in a session: an agent that
    reconnects mid-run is the same caller, and nothing on the server has to remember it.
    """
    return StreamableHTTPSessionManager(
        app=build_server(kernel_source),
        json_response=True,
        stateless=True,
        security_settings=LOOPBACK_SECURITY,
    )


def mount_syscall_mcp(app: "FastAPI", path: str = MCP_PATH) -> StreamableHTTPSessionManager:
    """Add the `/mcp` endpoint to `app` and hand back the manager its lifespan must run.

    A plain route, not a mount: `Mount("/mcp")` answers `/mcp` with a redirect to `/mcp/`,
    which an MCP client reads as a broken content type rather than as a redirect.
    """
    manager = build_session_manager(lambda: app.state.kernel)
    app.router.routes.append(Route(path, endpoint=StreamableHTTPASGIApp(manager)))
    return manager


__all__ = [
    "MCP_PATH",
    "build_server",
    "build_session_manager",
    "caller_pid",
    "mount_syscall_mcp",
]
