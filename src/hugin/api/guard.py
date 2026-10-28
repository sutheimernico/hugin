"""Loopback-only guard for `/api`: the same DNS-rebinding protection `/mcp` already has.

Binding to 127.0.0.1 keeps other machines out, not other *pages*. A web page the user visits
can point its own hostname at 127.0.0.1 (DNS rebinding) and then talk to the API as same-origin
— reading the event log, starting missions, killing processes. The browser still sends the
attacker's hostname in `Host` and `Origin`, so refusing anything that is not loopback closes it.
"""

from urllib.parse import urlsplit

from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
GUARDED_PREFIX = "/api"


def _is_loopback(authority: str) -> bool:
    """Whether a `Host` value or an `Origin` URL names this machine — any port, any scheme."""
    try:
        hostname = urlsplit(authority if "//" in authority else f"//{authority}").hostname
    except ValueError:
        return False
    return hostname in LOOPBACK_HOSTS


class LoopbackGuard:
    """Pure ASGI middleware (not `BaseHTTPMiddleware`: that one buffers SSE streams)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(GUARDED_PREFIX):
            await self.app(scope, receive, send)
            return
        headers = {
            key.decode("latin-1"): value.decode("latin-1") for key, value in scope["headers"]
        }
        if not _is_loopback(headers.get("host", "")):
            await PlainTextResponse("Invalid Host header", status_code=421)(scope, receive, send)
            return
        origin = headers.get("origin")
        if origin is not None and not _is_loopback(origin):
            await PlainTextResponse("Invalid Origin header", status_code=403)(scope, receive, send)
            return
        await self.app(scope, receive, send)
