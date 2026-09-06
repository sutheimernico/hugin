# ADR 0003 — Small-model tolerance in the kernel, not the model

Status: accepted · 2026-09-06

## Context

`OllamaDriver` runs `qwen2.5:7b` locally and free, but *is* the tool-calling loop itself rather
than a supervised CLI. Task 28's live runs exposed where a 7B model diverges from Claude's
tool-calling discipline, and where the kernel had to bend without giving up its own guarantees
(budgets, single writer, capability gate).

## Decision

Five kernel-side accommodations, scoped to syscall shape and scheduling, none to model output:

- `proc_wait` accepts `pids` as `"children"` **or** `["children"]` — qwen wraps the literal.
- `artifact_write` defaults a missing/falsy `name` to `report.md` instead of failing.
- Ollama requests run at `temperature: 0` (`ollama.py`) — more deterministic tool-call syntax
  than sampling, observed live.
- Ollama's kernel concurrency slot (`Settings.max_concurrent["ollama"]`) is **3**, not 1: a
  waiting planner occupies a slot too, so at 1 it starves its own children and deadlocks.
- Child budgets floor at 120 s / 3 turns (`MIN_CHILD_SECONDS`/`MIN_CHILD_TURNS` in
  `proc_spawn`) — a planner handing out 60 s budgets left no time for a CPU-bound tool call.
- `program:<name> <task>` (`missions/service.py`) runs one named program as mission root
  instead of the planner — the escape hatch when orchestration itself is the failure mode.

## Evidence

Five live planner attempts with `qwen2.5:7b` (Task 28), zero completed multi-agent runs: the
planner handed children 60 s budgets, wrote tool calls as plain text, or circled to the 900 s
mission budget (`exit_reason=budget:seconds`, run ends `failed`; documented in README). A
single `program:scout` run completed cleanly (462 events, 242 s) — the committed
`ollama-scout-brief` recording.

## Consequences

Ollama is a stable **worker** lane for 7B-class models — one program, one job, reporting back
— not an orchestrator. The planner role stays reserved for `claude` or `SIMULATION` until a
larger local model is tried; the five accommodations above stay in the kernel because they
cost nothing when the caller is `claude` and only help when it is not.
