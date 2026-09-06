"""The free driver: a tool-calling loop against a local Ollama over `POST /api/chat`.

Where the Claude driver supervises a subprocess that runs its own agent loop, here *we* are
the loop: send the conversation, stream the answer, execute whatever tools the model asked
for through the kernel, append the results, send again. Everything the model may call is the
process's own syscall set — an Ollama agent is capability-gated exactly like a Claude one,
only the transport differs (in-process sink calls instead of MCP over HTTP).

Two details are load-bearing. The client is created once and shared: a client per request
would open a new connection pool for every turn of every agent. And `num_predict` is derived
from what is left of the process's output budget, so a local model cannot talk past a budget
the kernel would only notice after the fact.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from hugin.drivers.base import EventSink, ExitInfo, SyscallError
from hugin.kernel.events import Usage
from hugin.kernel.process import AgentProcess
from hugin.settings import Settings

# Claude aliases and model ids reach us whenever a program was written for the Claude driver
# and is then started on Ollama; sending them to Ollama would only ever be a 404.
CLAUDE_ALIASES = frozenset({"sonnet", "opus", "haiku"})
CLAUDE_PREFIX = "claude"
# A follow-up turn with a near-empty budget could not even name its failure; this floor buys
# it one honest sentence. The kernel's budget watcher stays the real limit.
MIN_PREDICT = 64
STDERR_TAIL_LIMIT = 500
CONNECT_TIMEOUT_S = 5.0
# Listing the installed models is instantaneous; the boot screen must never hang on it.
TAGS_TIMEOUT_S = 5.0
# A cold local model can take minutes for its first token, and that is normal, not a hang.
READ_TIMEOUT_S = 600.0
UNREACHABLE = "Nicht erreichbar"


def to_ollama_tools(schemas: list[dict]) -> list[dict]:
    """Translate the registry's tool schemas into Ollama's OpenAI-shaped function list."""
    return [
        {
            "type": "function",
            "function": {
                "name": schema["name"],
                "description": schema["description"],
                "parameters": schema["input_schema"],
            },
        }
        for schema in schemas
    ]


@dataclass
class _Progress:
    """Usage across the turns of one run.

    `prompt_eval_count` is the size of the context Ollama just evaluated, so the latest value
    wins; `eval_count` counts the tokens that turn produced, so it accumulates.
    """

    turns: int = 0
    input_tokens: int = 0
    output_tokens: int = 0

    def fold(self, chunk: dict, turn: int) -> None:
        # Counted on the final chunk only: a turn that never finished produced nothing, and
        # reporting it would overstate what the run actually cost.
        self.turns = turn
        self.input_tokens = chunk.get("prompt_eval_count") or 0
        self.output_tokens += chunk.get("eval_count") or 0

    def usage(self) -> Usage:
        return Usage(
            turns=self.turns,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
        )


class OllamaDriver:
    """Runs one agent as a chat loop against a local Ollama instance."""

    name = "ollama"

    def __init__(
        self,
        settings: Settings,
        registry_tools_for: Callable[[int], list[dict]],
        system_prompt_for: Callable[[int], str],
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._settings = settings
        self._registry_tools_for = registry_tools_for
        self._system_prompt_for = system_prompt_for
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(READ_TIMEOUT_S, connect=CONNECT_TIMEOUT_S)
        )
        self._killed: set[int] = set()

    async def run(self, proc: AgentProcess, prompt: str, sink: EventSink) -> ExitInfo:
        messages: list[dict] = [
            {"role": "system", "content": self._system_prompt_for(proc.pid)},
            {"role": "user", "content": prompt},
        ]
        tools = to_ollama_tools(self._registry_tools_for(proc.pid))
        progress = _Progress()
        try:
            return await self._loop(proc, messages, tools, sink, progress)
        except httpx.HTTPError as exc:
            # Unreachable, refused, timed out or a non-2xx answer: all the same to the kernel,
            # which reports the reason and lets the rest of the run continue.
            return ExitInfo(
                "driver_error", progress.usage(), stderr_tail=str(exc)[:STDERR_TAIL_LIMIT]
            )
        finally:
            self._killed.discard(proc.pid)

    async def kill(self, proc: AgentProcess) -> None:
        """Set the cancel flag; the loop checks it between chunks and between turns."""
        # Flagged unconditionally, like the Claude driver: a kill may land before the first
        # request goes out, and `run` prunes the flag on its way out.
        self._killed.add(proc.pid)

    async def available(self) -> tuple[bool, list[str], str]:
        """Ask Ollama for its installed models; the detail string is German UI copy."""
        try:
            response = await self._client.get(
                f"{self._base_url}/api/tags",
                timeout=httpx.Timeout(TAGS_TIMEOUT_S, connect=CONNECT_TIMEOUT_S),
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            return False, [], UNREACHABLE
        models = [
            entry["name"]
            for entry in payload.get("models") or []
            if isinstance(entry, dict) and entry.get("name")
        ]
        detail = "1 Modell" if len(models) == 1 else f"{len(models)} Modelle"
        return True, models, detail

    @property
    def _base_url(self) -> str:
        return self._settings.ollama_url.rstrip("/")

    def _model_for(self, proc: AgentProcess) -> str:
        model = (proc.model or "").strip()
        if not model or model in CLAUDE_ALIASES or model.startswith(CLAUDE_PREFIX):
            return self._settings.ollama_model
        return model

    async def _loop(
        self,
        proc: AgentProcess,
        messages: list[dict],
        tools: list[dict],
        sink: EventSink,
        progress: _Progress,
    ) -> ExitInfo:
        model = self._model_for(proc)
        for turn in range(proc.budget.max_turns):
            if proc.pid in self._killed:
                return ExitInfo("killed", progress.usage())
            body = {
                "model": model,
                "messages": messages,
                "tools": tools,
                "stream": True,
                # Greedy decoding: small models follow tool schemas far more reliably at
                # temperature 0 than when sampling (observed live with qwen2.5:7b).
                "options": {"num_predict": self._num_predict(proc, progress), "temperature": 0},
            }
            async with self._client.stream(
                "POST", f"{self._base_url}/api/chat", json=body
            ) as response:
                response.raise_for_status()
                streamed = await self._stream_turn(proc, response, sink, progress, turn + 1)
            if streamed is None:
                return ExitInfo("killed", progress.usage())
            content, tool_calls = streamed
            messages.append(_assistant_message(content, tool_calls))
            if not tool_calls:
                return ExitInfo("done", progress.usage())
            if not await self._run_tools(proc, tool_calls, messages, sink):
                return ExitInfo("killed", progress.usage())
        # Turn budget spent with a tool call still pending: the model gets no further turn, and
        # the run ends as done. Runaway loops are the kernel budget watcher's job, not ours.
        return ExitInfo("done", progress.usage())

    def _num_predict(self, proc: AgentProcess, progress: _Progress) -> int:
        remaining = proc.budget.max_output_tokens - progress.output_tokens
        return max(MIN_PREDICT, remaining)

    async def _stream_turn(
        self,
        proc: AgentProcess,
        response: httpx.Response,
        sink: EventSink,
        progress: _Progress,
        turn: int,
    ) -> tuple[str, list[dict]] | None:
        """Consume one NDJSON stream; returns (content, tool_calls), or `None` when killed."""
        parts: list[str] = []
        tool_calls: list[dict] = []
        async for line in response.aiter_lines():
            if proc.pid in self._killed:
                return None  # leaving the `async with` closes the stream and the connection
            chunk = _parse_chunk(line)
            if chunk is None:
                continue
            message = chunk.get("message") or {}
            delta = message.get("content") or ""
            if delta:
                parts.append(delta)
                await sink.text(delta)
            tool_calls.extend(message.get("tool_calls") or [])
            if chunk.get("done"):
                progress.fold(chunk, turn)
                await sink.usage(progress.usage())
        return "".join(parts), tool_calls

    async def _run_tools(
        self,
        proc: AgentProcess,
        tool_calls: list[dict],
        messages: list[dict],
        sink: EventSink,
    ) -> bool:
        """Execute every requested tool through the kernel; returns False when killed."""
        for call in tool_calls:
            if proc.pid in self._killed:
                return False
            function = call.get("function") or {}
            name = function.get("name") or ""
            args = _parse_arguments(function.get("arguments"))
            await sink.state("waiting_tool")
            try:
                result = await sink.syscall(name, args)
            except SyscallError as err:
                # A refusal is an answer, not a crash: the model reads it and can try something
                # else. Only the kernel decides that a process is finished.
                result = {"error": str(err)}
            messages.append({"role": "tool", "content": json.dumps(result, ensure_ascii=False)})
            await sink.state("running")
        return True


def _assistant_message(content: str, tool_calls: list[dict]) -> dict:
    message: dict = {"role": "assistant", "content": content}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return message


def _parse_chunk(line: str) -> dict | None:
    """One NDJSON line, or `None` for anything unparseable — a bad line never ends a run."""
    line = line.strip()
    if not line:
        return None
    try:
        chunk = json.loads(line)
    except json.JSONDecodeError:
        return None
    return chunk if isinstance(chunk, dict) else None


def _parse_arguments(arguments: object) -> dict:
    """Ollama sends a dict; some models (and older builds) send the JSON as a string."""
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str):
        try:
            parsed = json.loads(arguments)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}
