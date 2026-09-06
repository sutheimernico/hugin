"""The stream-json parser is the only place that knows Claude Code's wire format.

Two fixtures back these tests: `haiku_ok_isolated.jsonl` is real captured output (the ground
truth for field names), `synthetic_tool_use.jsonl` is hand-written to cover the shapes that
short real run never produced — thinking blocks, a tool_use/tool_result pair, two turns.
"""

import json
from pathlib import Path

from hugin.drivers.stream_json import Op, parse_line

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "stream_json"


def _parse_fixture(name: str) -> list[Op]:
    ops: list[Op] = []
    for line in (FIXTURES / name).read_text(encoding="utf-8").splitlines():
        ops.extend(parse_line(line))
    return ops


def _of_kind(ops: list[Op], kind: str) -> list[Op]:
    return [op for op in ops if op.kind == kind]


def test_real_capture_yields_one_init_one_result_and_usage():
    ops = _parse_fixture("haiku_ok_isolated.jsonl")

    (init,) = _of_kind(ops, "init")
    assert init.data["api_key_source"] == "none"
    assert init.data["session_id"] == "cfdf7088-e616-4ab8-8953-96999d4ad291"
    assert init.data["model"] == "claude-haiku-4-5-20251001"
    assert init.data["tools"] == []

    (result,) = _of_kind(ops, "result")
    assert result.data["is_error"] is False
    assert result.data["num_turns"] == 1
    assert result.data["total_cost_usd"] > 0
    assert result.data["subtype"] == "success"
    assert result.data["duration_ms"] == 1314
    assert result.data["text"] == "OK"
    assert result.data["usage"]["output_tokens"] == 38

    usages = _of_kind(ops, "usage")
    assert len(usages) >= 1
    assert usages[0].data == {
        "input_tokens": 10,
        "output_tokens": 3,
        "cache_read": 0,
        "cache_creation": 6409,
    }


def test_real_capture_ignores_the_rate_limit_event():
    ops = _parse_fixture("haiku_ok_isolated.jsonl")

    ignored = [op.data.get("type") for op in _of_kind(ops, "ignore")]
    assert "rate_limit_event" in ignored


def test_synthetic_capture_pairs_tool_call_and_tool_result_by_id():
    ops = _parse_fixture("synthetic_tool_use.jsonl")

    (call,) = _of_kind(ops, "tool_call")
    (result,) = _of_kind(ops, "tool_result")
    assert call.data["call_id"] == result.data["call_id"] == "toolu_01"
    assert call.data["tool"] == "mcp__hugin__munin_write"
    assert json.loads(call.data["input_summary"])["kind"] == "note"
    assert result.data["ok"] is True
    assert "m-42" in result.data["output_summary"]


def test_synthetic_capture_brackets_the_thinking_block():
    ops = _parse_fixture("synthetic_tool_use.jsonl")

    kinds = [(op.kind, op.data.get("block_type"), op.data.get("index")) for op in ops
             if op.kind in {"block_start", "block_stop"}]
    assert kinds[0] == ("block_start", "thinking", 0)
    assert kinds[1] == ("block_stop", None, 0)
    assert kinds[2] == ("block_start", "text", 1)
    assert ("block_start", "tool_use", 2) in kinds

    (thinking,) = _of_kind(ops, "thinking_delta")
    assert thinking.data["delta"].startswith("The note belongs in munin")


def test_synthetic_capture_streams_text_and_ignores_input_json_deltas():
    ops = _parse_fixture("synthetic_tool_use.jsonl")

    (text,) = _of_kind(ops, "text")
    assert text.data["delta"] == "Storing the note in munin."

    ignored = [op.data.get("type") for op in _of_kind(ops, "ignore")]
    assert "input_json_delta" in ignored
    assert "message_start" in ignored
    assert "message_stop" in ignored


def test_synthetic_capture_reports_both_assistant_turns():
    ops = _parse_fixture("synthetic_tool_use.jsonl")

    texts = [op.data["text"] for op in _of_kind(ops, "assistant_text")]
    assert texts == ["Storing the note in munin.", "Note stored in munin as m-42."]

    usages = _of_kind(ops, "usage")
    assert len(usages) == 2
    assert usages[1].data == {
        "input_tokens": 8,
        "output_tokens": 14,
        "cache_read": 6409,
        "cache_creation": 0,
    }

    (result,) = _of_kind(ops, "result")
    assert result.data["num_turns"] == 2


def test_empty_and_blank_lines_yield_nothing():
    assert parse_line("") == []
    assert parse_line("   \n") == []


def test_malformed_line_becomes_an_ignore_with_the_raw_text():
    (op,) = parse_line("not json at all {")

    assert op.kind == "ignore"
    assert op.data["raw"] == "not json at all {"


def test_non_dict_json_becomes_an_ignore_with_the_raw_text():
    (op,) = parse_line("[1, 2, 3]")

    assert op.kind == "ignore"
    assert op.data["raw"] == "[1, 2, 3]"


def test_raw_of_a_malformed_line_is_truncated_to_200_chars():
    (op,) = parse_line("{" * 500)

    assert len(op.data["raw"]) == 200


def test_unknown_top_level_type_becomes_an_ignore():
    (op,) = parse_line(json.dumps({"type": "future_event", "payload": 1}))

    assert op.kind == "ignore"
    assert op.data["type"] == "future_event"


def test_system_subtypes_other_than_init_are_ignored():
    (op,) = parse_line(json.dumps({"type": "system", "subtype": "api_retry", "attempt": 2}))

    assert op.kind == "ignore"
    assert op.data["type"] == "system/api_retry"


def test_init_without_an_api_key_source_does_not_read_as_none():
    # Fail closed: the driver refuses anything but "none", so a missing field must not pass.
    (op,) = parse_line(json.dumps({"type": "system", "subtype": "init", "model": "m"}))

    assert op.kind == "init"
    assert op.data["api_key_source"] != "none"


def test_tool_result_content_is_summarised_as_string_and_as_block_list():
    as_string = parse_line(json.dumps({
        "type": "user",
        "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_9", "content": "plain output"}
        ]},
    }))
    as_blocks = parse_line(json.dumps({
        "type": "user",
        "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_9", "content": [
                {"type": "text", "text": "first"}, {"type": "text", "text": "second"}
            ]}
        ]},
    }))

    assert as_string[0].data["output_summary"] == "plain output"
    assert "first" in as_blocks[0].data["output_summary"]
    assert "second" in as_blocks[0].data["output_summary"]
    # `is_error` absent means the call succeeded.
    assert as_string[0].data["ok"] is True


def test_tool_result_marked_as_error_is_not_ok():
    (op,) = parse_line(json.dumps({
        "type": "user",
        "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_9", "is_error": True,
             "content": "capability denied"}
        ]},
    }))

    assert op.data["ok"] is False
    assert op.data["output_summary"] == "capability denied"


def test_summaries_are_truncated():
    (call, _usage) = parse_line(json.dumps({
        "type": "assistant",
        "message": {"content": [
            {"type": "tool_use", "id": "toolu_1", "name": "t", "input": {"body": "x" * 400}}
        ], "usage": {}},
    }))
    (result,) = parse_line(json.dumps({
        "type": "user",
        "message": {"content": [
            {"type": "tool_result", "tool_use_id": "toolu_1", "content": "y" * 900}
        ]},
    }))

    assert len(call.data["input_summary"]) == 200
    assert len(result.data["output_summary"]) == 300


def test_usage_defaults_missing_cache_fields_to_zero():
    (usage,) = parse_line(json.dumps({
        "type": "assistant",
        "message": {"content": [], "usage": {"input_tokens": 5, "output_tokens": 7}},
    }))

    assert usage.data == {
        "input_tokens": 5,
        "output_tokens": 7,
        "cache_read": 0,
        "cache_creation": 0,
    }


def test_the_parser_never_raises_on_odd_input():
    odd = [
        "{}",
        json.dumps({"type": "stream_event"}),
        json.dumps({"type": "stream_event", "event": {"type": "content_block_delta"}}),
        json.dumps({"type": "stream_event", "event": {"type": "content_block_start"}}),
        json.dumps({"type": "assistant"}),
        json.dumps({"type": "assistant", "message": {"content": ["not a block"]}}),
        json.dumps({"type": "user", "message": {"content": None}}),
        json.dumps({"type": "result"}),
        json.dumps("just a string"),
        json.dumps(None),
        json.dumps({"type": "system", "subtype": "init", "tools": 123}),
        json.dumps({"type": "result", "total_cost_usd": "n/a"}),
        "[" * 100_000,
    ]

    for line in odd:
        assert isinstance(parse_line(line), list)


def test_result_defaults_are_safe_when_fields_are_missing():
    (op,) = parse_line(json.dumps({"type": "result"}))

    assert op.kind == "result"
    assert op.data["is_error"] is False
    assert op.data["num_turns"] == 0
    assert op.data["total_cost_usd"] == 0.0
    assert op.data["usage"] == {}
