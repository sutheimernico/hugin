"""Host guard for `/api`: the same DNS-rebinding protection `/mcp` already has.

Binding to 127.0.0.1 keeps other machines out, not other *pages*. A web page the user visits
can point its own hostname at 127.0.0.1 (DNS rebinding) and then talk to the API as same-origin
— reading the event log, starting missions, killing processes. The browser still sends the
attacker's hostname in `Host` and `Origin`, so refusing anything that is not loopback closes it.

Reaching the shell from another device (a phone over Tailscale, say) means naming that host on
purpose: `HUGIN_ALLOWED_HOSTS` adds exact hostnames to the allow-list, nothing else widens it.
"""

from collections.abc import Iterable
from urllib.parse import urlsplit

from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
GUARDED_PREFIX = "/api"


def _is_allowed(authority: str, allowed: frozenset[str]) -> bool:
    """Whether a `Host` value or an `Origin` URL names this machine — any port, any scheme."""
    try:
        hostname = urlsplit(authority if "//" in authority else f"//{authority}").hostname
    except ValueError:
        return False
    return hostname is not None and hostname in allowed


class LoopbackGuard:
    """Pure ASGI middleware (not `BaseHTTPMiddleware`: that one buffers SSE streams)."""

    def __init__(self, app: ASGIApp, allowed_hosts: Iterable[str] = ()) -> None:
        self.app = app
        # `urlsplit(...).hostname` is lower-case, so the configured names are folded the same way.
        self.allowed = LOOPBACK_HOSTS | {
            host.strip().lower() for host in allowed_hosts if host.strip()
        }

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(GUARDED_PREFIX):
            await self.app(scope, receive, send)
            return
        headers = {
            key.decode("latin-1"): value.decode("latin-1") for key, value in scope["headers"]
        }
        if not _is_allowed(headers.get("host", ""), self.allowed):
            await PlainTextResponse("Invalid Host header", status_code=421)(scope, receive, send)
            return
        origin = headers.get("origin")
        if origin is not None and not _is_allowed(origin, self.allowed):
            await PlainTextResponse("Invalid Origin header", status_code=403)(scope, receive, send)
            return
        await self.app(scope, receive, send)
