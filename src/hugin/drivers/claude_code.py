"""The zero-cost driver: `claude -p` as a supervised subprocess on the subscription login.

Three things here carry the whole promise of the project and are therefore built as small,
separately testable functions: the **argv** (tool whitelist, strict MCP config, no `--bare`),
the **environment** (only `PATH`/`HOME`/`LANG`/`CLAUDE_CONFIG_DIR` — an `ANTHROPIC_API_KEY`
would silently turn a free run into a billed one), and the **isolated config dir** (no user
hooks, no user MCP servers, no user CLAUDE.md, but the subscription credentials symlinked in).

The API-key guard sits in two places on purpose: `preflight` refuses before spawning, and the
`system/init` line is checked after spawning, because only the CLI can tell us which billing
source it actually picked.
"""

import asyncio
import json
import os
import secrets
import tempfile
import time
from collections.abc import Callable, Mapping, Sequence
from contextlib import suppress
from pathlib import Path

from hugin.drivers.base import EventSink, ExitInfo
from hugin.drivers.stream_json import Op, parse_line
from hugin.kernel.events import Usage
from hugin.kernel.process import AgentProcess
from hugin.settings import Settings

API_KEY_ENV = "ANTHROPIC_API_KEY"
CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR"
# Everything else is dropped: an agent needs to find its binary and write UTF-8, nothing more.
PASSTHROUGH_ENV = ("PATH", "HOME", "LANG")
HOOKS_OFF = {"disableAllHooks": True}
REFUSAL = "refusing: API key billing detected"
STDERR_TAIL_LIMIT = 500
TERMINATE_GRACE_S = 3.0
EXIT_GRACE_S = 5.0
STDERR_READ_TIMEOUT_S = 1.0
# One stream-json line carries a whole tool result, far past the reader's 64 KiB default.
STREAM_LIMIT = 8 * 1024 * 1024
MCP_SERVER_ALLOW = "mcp__hugin"  # allow-list token for every tool of the kernel's MCP server
STDERR_TAIL_BYTES = 4096
STDERR_CHUNK = 4096
# The file-reading tools. In a program's whitelist they mean "read inside the workspace", never
# "read anywhere": Claude Code applies a `Read(...)` path rule to Glob and Grep as well.
FILE_TOOLS = frozenset({"Read", "Glob", "Grep"})


def file_scope_rules(
    tools: Sequence[str], roots: Sequence[Path], denied: Sequence[str]
) -> tuple[list[str], list[str]]:
    """Path rules that confine a program's file tools: `(allow_rules, deny_rules)`.

    A bare `Read` in `--allowedTools` is permission to read the whole home directory — `.ssh`,
    browser profiles and the subscription credentials included — and a text guard on the
    mission goal cannot stop an agent that was told so by a web page. So the allow rule names
    the workspace roots (`//` is Claude Code's "absolute path" prefix) and the deny rules carve
    the secrets out of them again; deny wins over allow. Programs without file tools get none.
    """
    if not FILE_TOOLS & set(tools):
        return [], []
    allow = [f"Read(//{root.as_posix().strip('/')}/**)" for root in roots]
    deny = [f"Read({pattern})" for pattern in denied]
    return allow, deny


def mcp_config(url: str, token: str) -> str:
    return json.dumps(
        {
            "mcpServers": {
                "hugin": {
                    "type": "http",
                    "url": url,
                    "headers": {"Authorization": f"Bearer {token}"},
                }
            }
        }
    )


def write_mcp_config(directory: Path, pid: int, url: str, token: str) -> Path:
    """Put the per-process MCP config, bearer token included, into a private 0600 file.

    On the command line the token would be readable by every local user through
    `/proc/<pid>/cmdline` and `ps`. The directory lives outside the repository on purpose: an
    agent whose file tools reach the workspace must not be able to read another agent's token.
    """
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    path = directory / f"p{pid}-{secrets.token_hex(4)}.json"
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(mcp_config(url, token))
    return path


def _denied_paths(settings: Settings) -> list[str]:
    """What stays unreadable even inside the workspace: the hugin state and every `.env`.

    `claude_config_dir` holds the symlinked subscription credentials and `data_dir` the event
    log and munin — none of it is something an agent's file tool has any business reading.
    """
    root = settings.workspace_root.as_posix().strip("/")
    return [
        f"//{settings.claude_config_dir.as_posix().strip('/')}/**",
        f"//{settings.data_dir.as_posix().strip('/')}/**",
        f"//{root}/**/.env",
        f"//{root}/**/.env.*",
    ]


def default_mcp_dir() -> Path:
    return Path(tempfile.gettempdir()) / f"hugin-mcp-{os.getuid()}"


def build_command(
    *,
    claude_bin: str,
    prompt: str,
    system_prompt: str,
    model: str,
    tools: list[str],
    max_turns: int,
    mcp_config_path: Path,
    read_roots: Sequence[Path] = (),
    denied_paths: Sequence[str] = (),
) -> list[str]:
    """The exact argv of a headless run; the order is pinned by tests."""
    whitelist = ",".join(tools) if tools else ""
    # `dontAsk` denies every tool that is not pre-approved, MCP tools included; the kernel's
    # own syscall server must therefore be allow-listed as a whole.
    allow_paths, deny_paths = file_scope_rules(tools, read_roots, denied_paths)
    granted = [tool for tool in tools if tool not in FILE_TOOLS] + allow_paths
    allowed = ",".join([*granted, MCP_SERVER_ALLOW])
    denied = ["--disallowedTools", ",".join(deny_paths)] if deny_paths else []
    return [
        claude_bin,
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
        "--tools",
        whitelist,
        "--allowedTools",
        allowed,
        *denied,
        "--strict-mcp-config",
        "--mcp-config",
        str(mcp_config_path),
        "--settings",
        json.dumps(HOOKS_OFF),
        "--max-turns",
        str(max_turns),
        "--model",
        model,
        "--append-system-prompt",
        system_prompt,
    ]


def build_env(base_env: Mapping[str, str], config_dir: Path) -> dict[str, str]:
    """An allowlist, never a blocklist: a new secret in the parent env cannot leak by default."""
    env = {name: base_env[name] for name in PASSTHROUGH_ENV if name in base_env}
    env[CONFIG_DIR_ENV] = str(config_dir)
    return env


def ensure_config_dir(config_dir: Path, home: Path) -> None:
    """Create the isolated Claude config dir and share the subscription login into it."""
    config_dir.mkdir(parents=True, exist_ok=True)
    settings_file = config_dir / "settings.json"
    if not settings_file.exists():
        settings_file.write_text(json.dumps(HOOKS_OFF), encoding="utf-8")
    _link(config_dir / ".credentials.json", home / ".claude" / ".credentials.json")
    _link(config_dir / ".claude.json", home / ".claude.json")


def _link(link: Path, target: Path) -> None:
    if not target.exists():
        # Nothing to share (fresh machine, CI): an empty slot is honest, a dangling symlink
        # would make the CLI fail with a confusing error instead.
        return
    if link.is_symlink():
        if link.resolve() == target.resolve():
            return
        link.unlink()  # a stale or broken symlink is ours to replace
    elif link.exists():
        return  # a regular file someone put there is never overwritten
    link.symlink_to(target)


class _Progress:
    """In-flight usage bookkeeping between the first line and the final `result`.

    Three traps live here. With `--include-partial-messages` the `assistant` event carries a
    usage *snapshot* taken when the message started (output ~1 token), so output tokens come
    from the stream's `message_delta`, which holds the final count — one per API turn. The
    `assistant` fallback below only serves streams without partial messages; there the same
    message arrives once per content block with identical numbers, which must not be summed.
    And `input_tokens` is a context size, not a counter: the latest value wins, cache reads
    and cache creation included.
    """

    def __init__(self) -> None:
        self.turns = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self._thinking: set[object] = set()
        self._saw_block_stop = False
        self._last_counted: tuple[int, int, int, int] | None = None
        self._streamed = False

    def usage(self) -> Usage:
        return Usage(
            turns=self.turns,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
        )

    def open_block(self, index: object, block_type: object) -> bool:
        """Remember a thinking block; returns True when the UI should show "denkt…"."""
        if block_type != "thinking":
            return False
        self._thinking.add(index)
        return True

    def close_block(self, index: object) -> bool:
        """Returns True when the block that closed was the thinking one."""
        self._saw_block_stop = True
        if index not in self._thinking:
            return False
        self._thinking.discard(index)
        return True

    def start_message(self, data: dict) -> None:
        """A streamed turn begins: its input side is the new context size."""
        self._streamed = True
        self.input_tokens = data["input_tokens"] + data["cache_read"] + data["cache_creation"]

    def end_message(self, output_tokens: int) -> bool:
        """A streamed turn ends with its final output count; always a new turn."""
        self._streamed = True
        self.turns += 1
        self.output_tokens += output_tokens
        return True

    def count(self, data: dict) -> bool:
        """Fold an `assistant` usage report in; returns True when it counted as a new turn."""
        if self._streamed:
            return False  # the streamed events already counted this turn, with exact numbers
        fingerprint = (
            data["input_tokens"],
            data["output_tokens"],
            data["cache_read"],
            data["cache_creation"],
        )
        # Context size follows every report, counted or not.
        self.input_tokens = data["input_tokens"] + data["cache_read"] + data["cache_creation"]
        if not self._saw_block_stop or fingerprint == self._last_counted:
            return False
        self._saw_block_stop = False
        self._last_counted = fingerprint
        self.turns += 1
        self.output_tokens += data["output_tokens"]
        return True


class _StderrTail:
    """Reads the child's stderr in the background and keeps only the last few KiB of it.

    Draining concurrently is not a nicety: with `--verbose` the CLI can fill the pipe buffer,
    and a child blocked on writing stderr stops writing stdout — the run would hang with
    nobody at fault. Because the tail lives in memory, reading it after the exit costs nothing.
    """

    def __init__(self, stream) -> None:
        self._buffer = bytearray()
        self._task = asyncio.create_task(self._drain(stream))

    async def _drain(self, stream) -> None:
        if stream is None:
            return
        try:
            while True:
                chunk = await stream.read(STDERR_CHUNK)
                if not chunk:
                    return
                self._buffer.extend(chunk)
                del self._buffer[:-STDERR_TAIL_BYTES]
        except Exception:
            return  # a broken stderr must never be the thing that ends a run

    async def settle(self) -> str:
        """The child is gone: let the drain reach EOF, then hand out what it kept."""
        with suppress(TimeoutError, asyncio.CancelledError):
            await asyncio.wait_for(self._task, timeout=STDERR_READ_TIMEOUT_S)
        return self._buffer.decode("utf-8", errors="replace")[-STDERR_TAIL_LIMIT:]

    async def close(self) -> None:
        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task


class ClaudeCodeDriver:
    """Runs one `claude -p` subprocess per process and translates its stream into sink calls."""

    name = "claude"

    def __init__(
        self,
        settings: Settings,
        mcp_url: str,
        token_for: Callable[[int], str],
        system_prompt_for: Callable[[int], str],
        spawn=asyncio.create_subprocess_exec,
        home: Path | None = None,
        mcp_dir: Path | None = None,
    ) -> None:
        self._settings = settings
        self._mcp_url = mcp_url
        self._token_for = token_for
        self._system_prompt_for = system_prompt_for
        self._spawn = spawn
        self._home = home or Path.home()
        self._mcp_dir = mcp_dir or default_mcp_dir()
        self._children: dict[int, object] = {}
        self._killed: set[int] = set()

    def preflight(self, env: Mapping[str, str]) -> None:
        """Refuse to run at all while the kernel's own env could bill the account."""
        if API_KEY_ENV in env:
            raise RuntimeError(
                f"{API_KEY_ENV} is set — hugin runs Claude Code on the subscription only"
            )

    async def run(self, proc: AgentProcess, prompt: str, sink: EventSink) -> ExitInfo:
        config_dir = self._settings.claude_config_dir
        ensure_config_dir(config_dir, self._home)
        self.preflight(os.environ)
        config_path = write_mcp_config(
            self._mcp_dir, proc.pid, self._mcp_url, self._token_for(proc.pid)
        )
        try:
            return await self._run_child(proc, prompt, sink, config_dir, config_path)
        finally:
            config_path.unlink(missing_ok=True)  # the token must not outlive the process

    async def _run_child(
        self, proc: AgentProcess, prompt: str, sink: EventSink, config_dir: Path, config_path: Path
    ) -> ExitInfo:
        settings = self._settings
        argv = build_command(
            claude_bin=settings.claude_bin,
            prompt=prompt,
            system_prompt=self._system_prompt_for(proc.pid),
            model=proc.model,
            tools=proc.allowed_tools,
            max_turns=proc.budget.max_turns,
            mcp_config_path=config_path,
            read_roots=[settings.workspace_root, proc.cwd],
            denied_paths=_denied_paths(settings),
        )
        child = await self._spawn(
            *argv,
            cwd=proc.cwd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=build_env(os.environ, config_dir),
            limit=STREAM_LIMIT,
        )
        self._children[proc.pid] = child
        progress = _Progress()
        stderr = _StderrTail(child.stderr)
        try:
            return await self._pump(proc, child, sink, progress, stderr)
        except Exception as exc:
            # A driver may fail; it may never leave a `claude` process behind. Whatever the
            # pump raises — a sink error, an unreadable stream — becomes a reported exit.
            return ExitInfo(
                "driver_error", progress.usage(), stderr_tail=repr(exc)[:STDERR_TAIL_LIMIT]
            )
        finally:
            await self._force_stop(child)
            await stderr.close()
            self._children.pop(proc.pid, None)
            self._killed.discard(proc.pid)

    async def kill(self, proc: AgentProcess) -> None:
        """SIGTERM, 3 s of grace, then SIGKILL. Safe to call twice, or after the run ended."""
        # Flagged unconditionally: a kill can land before `run` has a child to signal, and the
        # pump checks the flag before it forwards anything. `run` prunes it on the way out.
        self._killed.add(proc.pid)
        child = self._children.get(proc.pid)
        if child is not None:
            await self._force_stop(child)

    async def _pump(
        self,
        proc: AgentProcess,
        child,
        sink: EventSink,
        progress: _Progress,
        stderr: _StderrTail,
    ) -> ExitInfo:
        started: dict[str, float] = {}
        while True:
            line = await _readline(child.stdout)
            if line is None:
                break
            for op in parse_line(line):
                if proc.pid in self._killed:
                    await self._reap(child)
                    return ExitInfo("killed", progress.usage())
                exit_info = await self._apply(op, proc, sink, progress, started)
                if exit_info is not None:
                    await self._reap(child)
                    return exit_info
        await self._reap(child)
        if proc.pid in self._killed:
            return ExitInfo("killed", progress.usage())
        # stdout closed without a `result` line: the CLI crashed, was cut off, or never started.
        return ExitInfo("driver_error", progress.usage(), stderr_tail=await stderr.settle())

    async def _apply(
        self,
        op: Op,
        proc: AgentProcess,
        sink: EventSink,
        progress: _Progress,
        started: dict[str, float],
    ) -> ExitInfo | None:
        """Forward one op; return an `ExitInfo` when it ends the run, otherwise `None`."""
        match op.kind:
            case "init":
                if op.data.get("api_key_source") != "none":
                    await self.kill(proc)
                    return ExitInfo("failed", progress.usage(), stderr_tail=REFUSAL)
            case "block_start":
                if progress.open_block(op.data.get("index"), op.data.get("block_type")):
                    await sink.thinking(True)
            case "block_stop":
                if progress.close_block(op.data.get("index")):
                    await sink.thinking(False)
            case "text":
                await sink.text(op.data["delta"])
            case "tool_call":
                call_id = op.data["call_id"]
                started[call_id] = time.monotonic()
                await sink.state("waiting_tool")
                await sink.tool_call(call_id, op.data["tool"], op.data["input_summary"])
            case "tool_result":
                call_id = op.data["call_id"]
                begin = started.pop(call_id, None)
                ms = int((time.monotonic() - begin) * 1000) if begin is not None else 0
                await sink.tool_result(call_id, op.data["ok"], op.data["output_summary"], ms)
                await sink.state("running")
            case "message_start":
                progress.start_message(op.data)
            case "message_end":
                if progress.end_message(op.data["output_tokens"]):
                    await sink.usage(progress.usage())
            case "usage":
                if progress.count(op.data):
                    await sink.usage(progress.usage())
            case "result":
                return _result_exit(op.data)
        # thinking_delta, assistant_text and ignore carry nothing the kernel has not seen:
        # thinking text is never stored, and assistant text was already streamed as deltas.
        return None

    async def _reap(self, child) -> None:
        """Wait for the child so no zombie outlives the run; force it down if it overstays."""
        try:
            await asyncio.wait_for(child.wait(), timeout=EXIT_GRACE_S)
        except TimeoutError:
            await self._force_stop(child)

    async def _force_stop(self, child) -> None:
        """SIGTERM, grace, SIGKILL, reap — the one path that guarantees no live child."""
        if child.returncode is not None:
            return
        with suppress(ProcessLookupError):  # it may have exited between the check and the signal
            child.terminate()
        try:
            await asyncio.wait_for(child.wait(), timeout=TERMINATE_GRACE_S)
        except TimeoutError:
            with suppress(ProcessLookupError):
                child.kill()
            await child.wait()


async def _readline(stdout) -> str | None:
    """One decoded line, `None` at EOF. An unreadable line is skipped, never fatal.

    `readline` raises `ValueError` for a line past the reader's limit and has already dropped
    the offending bytes by then, so the next call resumes with the following line. Letting
    that error escape would abandon a running child, which is the worse failure by far.
    """
    while True:
        try:
            raw = await stdout.readline()
        except (ValueError, asyncio.LimitOverrunError):
            continue  # `ValueError` covers `UnicodeDecodeError` too
        if not raw:
            return None
        return raw.decode("utf-8", errors="replace")


def _result_exit(data: dict) -> ExitInfo:
    """The `result` line is the CLI's own accounting — it wins over anything we counted."""
    reported = data.get("usage") or {}
    usage = Usage(
        turns=data.get("num_turns") or 0,
        input_tokens=(reported.get("input_tokens") or 0)
        + (reported.get("cache_read_input_tokens") or 0)
        + (reported.get("cache_creation_input_tokens") or 0),
        output_tokens=reported.get("output_tokens") or 0,
        cost_usd_equiv=data.get("total_cost_usd") or 0.0,
    )
    if data.get("is_error"):
        text = str(data.get("text") or "")[:STDERR_TAIL_LIMIT]
        return ExitInfo("failed", usage, stderr_tail=text)
    return ExitInfo("done", usage)
