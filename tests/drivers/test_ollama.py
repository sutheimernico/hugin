"""The Ollama driver: a tool-calling loop over NDJSON, exercised entirely on MockTransport.

No test here may reach a real Ollama. Every request is answered by a scripted handler, so the
loop, the tool round-trip and the budget arithmetic are covered while the machine stays offline
and no model is ever loaded.
"""

import json
from pathlib import Path

import httpx
import pytest

from hugin.drivers.ollama import OllamaDriver, to_ollama_tools
from hugin.kernel.events import BudgetSpec, Usage
from hugin.kernel.process import AgentProcess
from hugin.settings import Settings

from .conftest import RecordingSink

OLLAMA_URL = "http://ollama.test:11434"
CHAT_URL = f"{OLLAMA_URL}/api/chat"
TAGS_URL = f"{OLLAMA_URL}/api/tags"

SCHEMAS = [
    {
        "name": "munin_search",
        "description": "Search the shared memory.",
        "input_schema": {
            "type": "object",
            "properties": {"q": {"type": "string"}},
            "required": ["q"],
        },
    },
    {
        "name": "forbidden",
        "description": "A syscall this process may not make.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


def _ndjson(*chunks: dict) -> bytes:
    return "".join(f"{json.dumps(chunk)}\n" for chunk in chunks).encode("utf-8")


def _text(delta: str) -> dict:
    return {"model": "qwen2.5:7b", "message": {"role": "assistant", "content": delta}}


def _done(
    *,
    prompt_eval_count: int = 0,
    eval_count: int = 0,
    tool_calls: list[dict] | None = None,
) -> dict:
    message: dict = {"role": "assistant", "content": ""}
    if tool_calls is not None:
        message["tool_calls"] = tool_calls
    return {
        "model": "qwen2.5:7b",
        "message": message,
        "done": True,
        "done_reason": "stop",
        "prompt_eval_count": prompt_eval_count,
        "eval_count": eval_count,
    }


def _tool_call(name: str, arguments) -> dict:
    return {"function": {"name": name, "arguments": arguments}}


class Chat:
    """A scripted `/api/chat` endpoint that records every request body it answered."""

    def __init__(self, *bodies: bytes) -> None:
        self._bodies = list(bodies)
        self.requests: list[dict] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert str(request.url) == CHAT_URL
        self.requests.append(json.loads(request.content))
        return httpx.Response(200, content=self._bodies.pop(0))


class KillingSink(RecordingSink):
    """Kills the process from inside the first streamed text delta, mid-stream."""

    def __init__(self, driver: OllamaDriver, proc: AgentProcess) -> None:
        super().__init__()
        self._driver = driver
        self._proc = proc

    async def text(self, delta: str) -> None:
        await super().text(delta)
        await self._driver.kill(self._proc)


def _proc(
    tmp_path: Path,
    *,
    model: str = "qwen2.5:7b",
    max_turns: int = 6,
    max_output_tokens: int = 6000,
) -> AgentProcess:
    return AgentProcess(
        pid=3,
        run_id="r1",
        ppid=None,
        program="scout",
        role="worker",
        driver="ollama",
        model=model,
        task="Find three candidates.",
        cwd=tmp_path / "cwd",
        capabilities={"munin.read"},
        allowed_tools=["munin_search"],
        budget=BudgetSpec(max_turns=max_turns, max_output_tokens=max_output_tokens),
    )


def _driver(handler) -> OllamaDriver:
    settings = Settings(ollama_url=OLLAMA_URL, ollama_model="qwen2.5:7b")
    return OllamaDriver(
        settings,
        registry_tools_for=lambda pid: SCHEMAS,
        system_prompt_for=lambda pid: f"system prompt for {pid}",
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )


def test_to_ollama_tools_wraps_every_schema_as_a_function():
    assert to_ollama_tools(SCHEMAS)[0] == {
        "type": "function",
        "function": {
            "name": "munin_search",
            "description": "Search the shared memory.",
            "parameters": SCHEMAS[0]["input_schema"],
        },
    }
    assert len(to_ollama_tools(SCHEMAS)) == 2
    assert to_ollama_tools([]) == []


async def test_run_streams_text_and_ends_after_one_turn(tmp_path: Path, sink: RecordingSink):
    done = _done(prompt_eval_count=100, eval_count=20)
    chat = Chat(_ndjson(_text("Hallo "), _text("Welt"), done))
    driver = _driver(chat)

    exit_info = await driver.run(_proc(tmp_path), "Sag Hallo.", sink)

    assert exit_info.reason == "done"
    assert exit_info.usage == Usage(turns=1, input_tokens=100, output_tokens=20)
    assert sink.calls == [
        ("text", "Hallo "),
        ("text", "Welt"),
        ("usage", Usage(turns=1, input_tokens=100, output_tokens=20)),
    ]
    assert len(chat.requests) == 1


async def test_run_sends_the_system_prompt_the_tools_and_a_streaming_request(
    tmp_path: Path, sink: RecordingSink
):
    chat = Chat(_ndjson(_done(prompt_eval_count=10, eval_count=1)))
    driver = _driver(chat)

    await driver.run(_proc(tmp_path), "Sag Hallo.", sink)

    body = chat.requests[0]
    assert body["model"] == "qwen2.5:7b"
    assert body["messages"] == [
        {"role": "system", "content": "system prompt for 3"},
        {"role": "user", "content": "Sag Hallo."},
    ]
    assert body["tools"] == to_ollama_tools(SCHEMAS)
    assert body["stream"] is True


async def test_run_executes_a_tool_call_and_feeds_the_result_back(
    tmp_path: Path, sink: RecordingSink
):
    chat = Chat(
        _ndjson(
            _text("Ich suche."),
            _done(
                prompt_eval_count=100,
                eval_count=20,
                tool_calls=[_tool_call("munin_search", {"q": "candidates"})],
            ),
        ),
        _ndjson(_text("Fertig."), _done(prompt_eval_count=180, eval_count=15)),
    )
    driver = _driver(chat)

    exit_info = await driver.run(_proc(tmp_path), "Suche.", sink)

    assert exit_info.reason == "done"
    assert exit_info.usage == Usage(turns=2, input_tokens=180, output_tokens=35)
    assert sink.calls == [
        ("text", "Ich suche."),
        ("usage", Usage(turns=1, input_tokens=100, output_tokens=20)),
        ("state", "waiting_tool"),
        ("syscall", "munin_search", {"q": "candidates"}),
        ("state", "running"),
        ("text", "Fertig."),
        ("usage", Usage(turns=2, input_tokens=180, output_tokens=35)),
    ]
    assert chat.requests[1]["messages"] == [
        {"role": "system", "content": "system prompt for 3"},
        {"role": "user", "content": "Suche."},
        {
            "role": "assistant",
            "content": "Ich suche.",
            "tool_calls": [_tool_call("munin_search", {"q": "candidates"})],
        },
        {"role": "tool", "content": json.dumps({"ok": True}, ensure_ascii=False)},
    ]


async def test_run_parses_tool_arguments_given_as_a_json_string(
    tmp_path: Path, sink: RecordingSink
):
    chat = Chat(
        _ndjson(_done(tool_calls=[_tool_call("munin_search", '{"q": "Grün"}')])),
        _ndjson(_done()),
    )
    driver = _driver(chat)

    exit_info = await driver.run(_proc(tmp_path), "Suche.", sink)

    assert exit_info.reason == "done"
    assert ("syscall", "munin_search", {"q": "Grün"}) in sink.calls


async def test_run_turns_a_refused_syscall_into_an_error_tool_message(
    tmp_path: Path, sink: RecordingSink
):
    chat = Chat(
        _ndjson(_done(tool_calls=[_tool_call("forbidden", {})])),
        _ndjson(_text("Verstanden."), _done()),
    )
    driver = _driver(chat)

    exit_info = await driver.run(_proc(tmp_path), "Mach das Verbotene.", sink)

    assert exit_info.reason == "done"  # a refused syscall informs the agent, it never ends the run
    assert chat.requests[1]["messages"][-1] == {
        "role": "tool",
        "content": json.dumps({"error": "forbidden"}, ensure_ascii=False),
    }
    assert ("text", "Verstanden.") in sink.calls


async def test_run_asks_only_for_the_remaining_output_budget(tmp_path: Path, sink: RecordingSink):
    chat = Chat(
        _ndjson(_done(eval_count=480, tool_calls=[_tool_call("munin_search", {"q": "x"})])),
        _ndjson(_done(eval_count=5)),
    )
    driver = _driver(chat)

    await driver.run(_proc(tmp_path, max_output_tokens=500), "Suche.", sink)

    assert chat.requests[0]["options"]["num_predict"] == 500
    # 500 - 480 = 20, below the floor that keeps a follow-up turn able to say anything at all.
    assert chat.requests[1]["options"]["num_predict"] == 64


@pytest.mark.parametrize(
    ("model", "expected"),
    [
        ("sonnet", "qwen2.5:7b"),
        ("opus", "qwen2.5:7b"),
        ("haiku", "qwen2.5:7b"),
        ("claude-haiku-4-5-20251001", "qwen2.5:7b"),
        ("llama3.1:8b", "llama3.1:8b"),
    ],
)
async def test_run_falls_back_to_the_configured_model_for_claude_names(
    tmp_path: Path, sink: RecordingSink, model: str, expected: str
):
    chat = Chat(_ndjson(_done()))
    driver = _driver(chat)

    await driver.run(_proc(tmp_path, model=model), "Sag Hallo.", sink)

    assert chat.requests[0]["model"] == expected


async def test_run_stops_at_the_turn_budget_while_tool_calls_are_still_pending(
    tmp_path: Path, sink: RecordingSink
):
    calling = _done(eval_count=3, tool_calls=[_tool_call("munin_search", {"q": "x"})])
    always_calling = _ndjson(calling)
    chat = Chat(always_calling, always_calling)
    driver = _driver(chat)

    exit_info = await driver.run(_proc(tmp_path, max_turns=2), "Suche.", sink)

    assert exit_info.reason == "done"  # the kernel's budget watcher is the real backstop
    assert exit_info.usage.turns == 2
    assert len(chat.requests) == 2


async def test_run_reports_a_driver_error_when_ollama_is_unreachable(
    tmp_path: Path, sink: RecordingSink
):
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    exit_info = await _driver(refuse).run(_proc(tmp_path), "Sag Hallo.", sink)

    assert exit_info.reason == "driver_error"
    assert "connection refused" in (exit_info.stderr_tail or "")
    assert exit_info.usage == Usage()  # a turn that never happened is never counted
    assert sink.calls == []


async def test_run_reports_a_driver_error_on_a_non_2xx_response(
    tmp_path: Path, sink: RecordingSink
):
    def not_found(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "model 'qwen2.5:7b' not found"})

    exit_info = await _driver(not_found).run(_proc(tmp_path), "Sag Hallo.", sink)

    assert exit_info.reason == "driver_error"
    assert "404" in (exit_info.stderr_tail or "")


async def test_kill_mid_stream_ends_the_run_as_killed(tmp_path: Path):
    chat = Chat(_ndjson(_text("Hal"), _text("lo"), _done(eval_count=2)))
    driver = _driver(chat)
    proc = _proc(tmp_path)
    sink = KillingSink(driver, proc)

    exit_info = await driver.run(proc, "Sag Hallo.", sink)

    assert exit_info.reason == "killed"
    assert sink.calls == [("text", "Hal")]  # the kill lands inside the first delta
    assert driver._killed == set()  # the finished run leaves no per-pid flag behind

    await driver.kill(proc)  # a second kill is a no-op, not a crash


async def test_available_reports_the_installed_models():
    def tags(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == TAGS_URL
        # The boot screen waits on this call, so it must carry the short timeout, not the
        # ten-minute one a cold model needs.
        assert request.extensions["timeout"]["read"] == 5.0
        return httpx.Response(
            200,
            json={
                "models": [
                    {"name": "qwen2.5:7b", "size": 4683087332},
                    {"name": "llama3.1:8b", "size": 4920753328},
                    {"name": "nomic-embed-text:latest", "size": 274302450},
                    {"name": "gemma2:2b", "size": 1629518495},
                ]
            },
        )

    ok, models, detail = await _driver(tags).available()

    assert ok is True
    assert models == ["qwen2.5:7b", "llama3.1:8b", "nomic-embed-text:latest", "gemma2:2b"]
    assert detail == "4 Modelle"


async def test_available_reports_a_single_model_in_the_singular():
    def tags(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"models": [{"name": "qwen2.5:7b"}]})

    ok, models, detail = await _driver(tags).available()

    assert (ok, models, detail) == (True, ["qwen2.5:7b"], "1 Modell")


async def test_available_reports_an_unreachable_ollama():
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    assert await _driver(refuse).available() == (False, [], "Nicht erreichbar")


async def test_available_reports_a_failing_ollama_as_unreachable():
    def broken(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    assert await _driver(broken).available() == (False, [], "Nicht erreichbar")
