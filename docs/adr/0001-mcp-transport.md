# ADR 0001 — Syscall transport: Streamable HTTP with a per-process bearer token

Status: accepted · 2026-09-06

## Context

Claude agents run as `claude -p` subprocesses and reach the kernel only through MCP. The spec
(§2.3) prefers one HTTP endpoint at `/mcp` with a per-pid bearer token in `--mcp-config`, with
a stdio bridge (`stdio_bridge.py` + `POST /internal/syscall`) as the fallback for the case
where `mcp` hides the HTTP request from a tool handler — a property of the installed SDK, so
it had to be checked rather than assumed.

## Decision

Streamable HTTP at `/mcp`, identity from the `Authorization: Bearer <token>` header. No stdio
bridge, no `/internal/syscall`, and `build_command`'s `{"type": "http", …}` config stands.

## Evidence (installed `mcp` 2.1.1)

- `mcp.server.fastmcp` is gone in 2.x (importing it raises with a migration hint); `FastMCP` is
  now `MCPServer`. We use the low-level `mcp.server.Server(name, on_list_tools=…,
  on_call_tool=…)` — 2.x registers handlers as constructor arguments, not as decorators.
- Handlers receive a `ServerRequestContext` whose `request` field is the Starlette `Request`.
  Both Streamable HTTP paths (`streamable_http.py`, `_streamable_http_modern.py`) set it via
  `ServerMessageMetadata(request_context=request)`, so `ctx.request.headers` is exactly the
  header access the fallback existed for — verified in `tests/syscalls/test_mcp_server.py`.
- Mounted as `Route("/mcp", endpoint=StreamableHTTPASGIApp(manager))`, as the SDK's own
  `streamable_http_app()` does; a `Mount` redirects `/mcp` to `/mcp/`, which the client reports
  as `Unexpected content type`.
- `manager.run()` (an anyio task group) nests inside the app lifespan; stateless mode,
  `json_response=True`, SDK localhost DNS-rebinding allow-list.

## Consequences

- `pyproject.toml` pins `mcp>=2.1,<3`: the 1.x API this was specced against would not import.
- Identity is a token, not a session: a reconnecting agent is the same caller, and an exited
  process's token still resolves, so a syscall in flight at exit still answers.
- A lifespan holding a task group must be entered and left in one task, so
  `tests/api/conftest.py` drives it in a task of its own.
- A token is a credential: it never enters an event or a log, and `/mcp` stays on 127.0.0.1.
