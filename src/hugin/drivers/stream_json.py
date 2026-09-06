"""Translates one line of `claude -p --output-format stream-json --verbose` into driver ops.

The parser is deliberately **stateless**: a line goes in, a list of ops comes out, and nothing
is remembered in between. Everything that needs memory — which block index is a thinking
block, how many turns have run, how tokens accumulate — belongs to the driver, so this module
stays a pure function that tests can call with a single hand-written line.

It also never raises. A driver that dies on a stray byte in someone else's stream format is
worse than one that reports an unreadable line as `ignore` and keeps reading.
"""

import json
from dataclasses import dataclass
from typing import Any, Literal

OpKind = Literal[
    "init",
    "text",
    "thinking_delta",
    "block_start",
    "block_stop",
    "assistant_text",
    "tool_call",
    "tool_result",
    "usage",
    "result",
    "ignore",
]

INPUT_SUMMARY_LIMIT = 200
OUTPUT_SUMMARY_LIMIT = 300
RAW_LIMIT = 200


@dataclass
class Op:
    """One instruction for the driver. `data` is the payload the plan pins per kind."""

    kind: OpKind
    data: dict


def parse_line(line: str) -> list[Op]:
    """Map a single stream-json line to the ops it implies. Never raises; may return `[]`."""
    if not line.strip():
        return []
    try:
        event = json.loads(line)
    except (ValueError, TypeError):
        return [Op("ignore", {"raw": line[:RAW_LIMIT]})]
    if not isinstance(event, dict):
        return [Op("ignore", {"raw": line[:RAW_LIMIT]})]

    match event.get("type"):
        case "system":
            return _system(event)
        case "stream_event":
            return _stream_event(event)
        case "assistant":
            return _assistant(event)
        case "user":
            return _user(event)
        case "result":
            return _result(event)
        case other:
            # rate_limit_event and anything a future CLI version adds.
            return [Op("ignore", {"type": other})]


def _system(event: dict) -> list[Op]:
    subtype = event.get("subtype")
    if subtype != "init":
        return [Op("ignore", {"type": f"system/{subtype}"})]
    return [
        Op(
            "init",
            {
                "session_id": event.get("session_id", ""),
                "model": event.get("model", ""),
                # Absent means "unknown", not "none" — the driver refuses anything but "none",
                # so the default has to fail closed rather than look like a subscription login.
                "api_key_source": event.get("apiKeySource", "unknown"),
                "tools": list(event.get("tools") or []),
            },
        )
    ]


def _stream_event(event: dict) -> list[Op]:
    inner = event.get("event")
    if not isinstance(inner, dict):
        return [Op("ignore", {"type": "stream_event"})]

    match inner.get("type"):
        case "content_block_start":
            block = inner.get("content_block")
            block_type = block.get("type") if isinstance(block, dict) else None
            return [Op("block_start", {"index": inner.get("index"), "block_type": block_type})]
        case "content_block_delta":
            return _content_block_delta(inner)
        case "content_block_stop":
            return [Op("block_stop", {"index": inner.get("index")})]
        case other:
            # message_start / message_delta / message_stop.
            return [Op("ignore", {"type": other})]


def _content_block_delta(inner: dict) -> list[Op]:
    delta = inner.get("delta")
    if not isinstance(delta, dict):
        return [Op("ignore", {"type": "content_block_delta"})]
    match delta.get("type"):
        case "text_delta":
            return [Op("text", {"delta": delta.get("text", "")})]
        case "thinking_delta":
            return [Op("thinking_delta", {"delta": delta.get("thinking", "")})]
        case other:
            # input_json_delta (tool arguments arrive as partial JSON) and signature_delta:
            # the complete input shows up again in the `assistant` message, so drop them.
            return [Op("ignore", {"type": other})]


def _assistant(event: dict) -> list[Op]:
    message = event.get("message")
    if not isinstance(message, dict):
        return [Op("ignore", {"type": "assistant"})]

    ops: list[Op] = []
    for block in _blocks(message):
        match block.get("type"):
            case "tool_use":
                ops.append(
                    Op(
                        "tool_call",
                        {
                            "call_id": block.get("id", ""),
                            "tool": block.get("name", ""),
                            "input_summary": json.dumps(block.get("input", {}))[
                                :INPUT_SUMMARY_LIMIT
                            ],
                        },
                    )
                )
            case "text":
                ops.append(Op("assistant_text", {"text": block.get("text", "")}))

    usage = message.get("usage")
    if isinstance(usage, dict):
        ops.append(
            Op(
                "usage",
                {
                    "input_tokens": usage.get("input_tokens") or 0,
                    "output_tokens": usage.get("output_tokens") or 0,
                    "cache_read": usage.get("cache_read_input_tokens") or 0,
                    "cache_creation": usage.get("cache_creation_input_tokens") or 0,
                },
            )
        )
    return ops


def _user(event: dict) -> list[Op]:
    message = event.get("message")
    if not isinstance(message, dict):
        return [Op("ignore", {"type": "user"})]

    return [
        Op(
            "tool_result",
            {
                "call_id": block.get("tool_use_id", ""),
                "ok": not block.get("is_error", False),
                "output_summary": _flatten(block.get("content"))[:OUTPUT_SUMMARY_LIMIT],
            },
        )
        for block in _blocks(message)
        if block.get("type") == "tool_result"
    ]


def _result(event: dict) -> list[Op]:
    usage = event.get("usage")
    return [
        Op(
            "result",
            {
                "subtype": event.get("subtype"),
                "is_error": bool(event.get("is_error", False)),
                "num_turns": event.get("num_turns") or 0,
                "duration_ms": event.get("duration_ms") or 0,
                "total_cost_usd": event.get("total_cost_usd") or 0.0,
                "usage": usage if isinstance(usage, dict) else {},
                "text": event.get("result", ""),
            },
        )
    ]


def _blocks(message: dict) -> list[dict]:
    content = message.get("content")
    if not isinstance(content, list):
        return []
    return [block for block in content if isinstance(block, dict)]


def _flatten(content: Any) -> str:
    """A tool result carries either a plain string or a list of blocks; both collapse to text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            block["text"] if isinstance(block, dict) and isinstance(block.get("text"), str)
            else str(block)
            for block in content
        ]
        return "\n".join(parts)
    return str(content)
