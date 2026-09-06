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
import time
from collections.abc import Callable, Mapping
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


def build_command(
    *,
    claude_bin: str,
    prompt: str,
    system_prompt: str,
    model: str,
    tools: list[str],
    max_turns: int,
    mcp_url: str,
    mcp_token: str,
) -> list[str]:
    """The exact argv of a headless run; the order is part of the binding contract."""
    whitelist = ",".join(tools) if tools else ""
    mcp_config = json.dumps(
        {
            "mcpServers": {
                "hugin": {
                    "type": "http",
                    "url": mcp_url,
                    "headers": {"Authorization": f"Bearer {mcp_token}"},
                }
            }
        }
    )
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
        whitelist,
        "--strict-mcp-config",
        "--mcp-config",
        mcp_config,
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

    Two traps live here. The CLI reports usage per assistant message, and the same message
    arrives twice (once per content block) with *identical* numbers — summing those would
    double every count. And `input_tokens` is a context size, not a counter: the latest value
    wins, cache reads and cache creation included.
    """

    def __init__(self) -> None:
        self.turns = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self._thinking: set[object] = set()
        self._saw_block_stop = False
        self._last_counted: tuple[int, int, int, int] | None = None

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

    def count(self, data: dict) -> bool:
        """Fold one usage report in; returns True when it counted as a new turn."""
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
    ) -> None:
        self._settings = settings
        self._mcp_url = mcp_url
        self._token_for = token_for
        self._system_prompt_for = system_prompt_for
        self._spawn = spawn
        self._home = home or Path.home()
        self._children: dict[int, object] = {}
        self._killed: set[int] = set()

    def preflight(self, env: Mapping[str, str]) -> None:
        """Refuse to run at all while the kernel's own env could bill the account (spec §1.1)."""
        if API_KEY_ENV in env:
            raise RuntimeError(
                f"{API_KEY_ENV} is set — hugin runs Claude Code on the subscription only"
            )

    async def run(self, proc: AgentProcess, prompt: str, sink: EventSink) -> ExitInfo:
        config_dir = self._settings.claude_config_dir
        ensure_config_dir(config_dir, self._home)
        self.preflight(os.environ)
        argv = build_command(
            claude_bin=self._settings.claude_bin,
            prompt=prompt,
            system_prompt=self._system_prompt_for(proc.pid),
            model=proc.model,
            tools=proc.allowed_tools,
            max_turns=proc.budget.max_turns,
            mcp_url=self._mcp_url,
            mcp_token=self._token_for(proc.pid),
        )
        child = await self._spawn(
            *argv,
            cwd=proc.cwd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=build_env(os.environ, config_dir),
        )
        self._children[proc.pid] = child
        try:
            return await self._pump(proc, child, sink)
        finally:
            self._children.pop(proc.pid, None)

    async def kill(self, proc: AgentProcess) -> None:
        """SIGTERM, 3 s of grace, then SIGKILL. Safe to call twice, or after the run ended."""
        self._killed.add(proc.pid)
        child = self._children.get(proc.pid)
        if child is None or child.returncode is not None:
            return
        child.terminate()
        try:
            await asyncio.wait_for(child.wait(), timeout=TERMINATE_GRACE_S)
        except TimeoutError:
            child.kill()
            await child.wait()

    async def _pump(self, proc: AgentProcess, child, sink: EventSink) -> ExitInfo:
        progress = _Progress()
        started: dict[str, float] = {}
        async for raw in child.stdout:
            for op in parse_line(raw.decode("utf-8", errors="replace")):
                if proc.pid in self._killed:
                    await self._reap(proc, child)
                    return ExitInfo("killed", progress.usage())
                exit_info = await self._apply(op, proc, sink, progress, started)
                if exit_info is not None:
                    await self._reap(proc, child)
                    return exit_info
        await self._reap(proc, child)
        if proc.pid in self._killed:
            return ExitInfo("killed", progress.usage())
        # stdout closed without a `result` line: the CLI crashed, was cut off, or never started.
        tail = await self._stderr_tail(child)
        return ExitInfo("driver_error", progress.usage(), stderr_tail=tail)

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
            case "usage":
                if progress.count(op.data):
                    await sink.usage(progress.usage())
            case "result":
                return _result_exit(op.data)
        # thinking_delta, assistant_text and ignore carry nothing the kernel has not seen:
        # thinking text is never stored, and assistant text was already streamed as deltas.
        return None

    async def _reap(self, proc: AgentProcess, child) -> None:
        """Wait for the child so no zombie outlives the run; kill it if it overstays."""
        try:
            await asyncio.wait_for(child.wait(), timeout=EXIT_GRACE_S)
        except TimeoutError:
            await self.kill(proc)

    async def _stderr_tail(self, child) -> str:
        if child.stderr is None:
            return ""
        try:
            # The child is gone by now, so this returns at once; the timeout only guards
            # against a grandchild holding the pipe open forever.
            data = await asyncio.wait_for(child.stderr.read(), timeout=STDERR_READ_TIMEOUT_S)
        except TimeoutError:
            return ""
        return data.decode("utf-8", errors="replace")[-STDERR_TAIL_LIMIT:]


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
