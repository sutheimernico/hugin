# hugin — Plan (AUTOPILOT-driven build backlog)

**Source of truth for design:** `docs/superpowers/specs/2026-09-05-hugin-agentic-os-design.md`
**Route (task text, binding contracts):** `docs/superpowers/plans/2026-09-05-hugin-v1-implementation.md`
Personal rules (`~/.claude/CLAUDE.md`) + global loop rules (`~/private/AUTOPILOT.md`) apply.

This file is the binding backlog for the autonomous loop. Each iteration picks the SINGLE
highest-value open `- [ ]` task, does it on `autopilot/work`, runs the gate, commits only if
green, checks the box, and appends one line to `AUTOPILOT_LOG.md`. The task text in the
implementation plan is authoritative — never invent tasks that are not in it.

## Iron principles (never overridden)

- **Local & free only.** Claude Code headless on the subscription, local Ollama, SQLite. No paid
  API, no `ANTHROPIC_API_KEY`, no cloud. A task needing a paid resource or a Nico-only input goes
  to "Needs Nico", never faked.
- **Gate is objective:** `uv run pytest -q` green AND `uv run ruff check .` clean AND
  `npm --prefix frontend run check` clean AND `npm --prefix frontend test -- --run` green.
  Never commit red.
- **One change per iteration.** No bundling. No speculative abstractions (YAGNI).
- **New logic ships with a test.** No live network in tests, no real `claude`, no real Ollama —
  use the Scripted driver, fake subprocess factories and `httpx.MockTransport`.
- **The loop never spawns live agents.** Live Claude/Ollama runs cost usage and are
  orchestrator-supervised (Task 28) — tests and Simulation only.
- **Honesty guardrails.** Never fabricate a metric or a state. Unavailable subsystem → explicit
  `warn`/`error`. Simulated or replayed data always carries the `SIMULATION` / `REPLAY` label.
- **Binding contracts.** Code blocks marked **BINDING** in the implementation plan are exact
  interfaces — implement them verbatim; later tasks depend on them.

## Status

- [x] **Milestone 0 — Scaffold** (Tasks 1–3)
- [x] **Milestone 1 — Kernel core** (Tasks 4–11): events, log, bus, processes, budgets,
  programs, drivers, kernel façade, munin and the capability-gated syscalls
- [x] **Milestone 2 — API, SSE and the Mission Control shell** (Tasks 12–16): API and SSE,
  frontend state, shell layout, live graph and the ⌘K palette
- [x] **Milestone 3 — Real drivers** (Tasks 17–21): stream-json parser, Claude Code and Ollama
  drivers, MCP syscall transport, subsystem status and the driver gate
- [x] **Milestone 4 — Agent window, Munin browser, Replay, Boot** (Tasks 22–26): agent sheet,
  munin browser, replay backend and cursor, and the boot sequence
- [x] **Milestone 5 — Polish, recordings, docs, sweep** (Tasks 27–30): motion polish, live
  Claude/Ollama recordings, README/session docs, and the privacy & security sweep — **v1
  complete**

## Milestone 0 — Scaffold

- [x] Task 1: Python project scaffold + house docs + register entry
- [x] Task 2: Frontend scaffold (Vite · React 19 · TS · Tailwind v4 · vitest) + fonts + proxy
- [x] Task 3: Base UI components

## Milestone 1 — Kernel core

- [x] Task 4: Event model
- [x] Task 5: EventLog (SQLite) + EventBus
- [x] Task 6: AgentProcess, state machine, ProcessTable, Budget watcher
- [x] Task 7: Programs (YAML) + kernel contract
- [x] Task 8: Driver protocol + ScriptedDriver
- [x] Task 9: Kernel façade + Scheduler (with ScriptedDriver end-to-end)
- [x] Task 10: Munin memory store (SQLite FTS5)
- [x] Task 11: Syscalls — registry, handlers, capabilities, single writer

## Milestone 2 — API, SSE and the Mission Control shell

- [x] Task 12: FastAPI routes + SSE with backfill
- [x] Task 13: Frontend state — types, reducer, SSE client, store
- [x] Task 14: Shell layout — TopBar, ModeChip, meters, ProcessTable, KernelLog, MissionBar
- [x] Task 15: Live agent graph (xyflow + dagre) with pulses
- [x] Task 16: Command palette (⌘K) + mission start

## Milestone 3 — Real drivers

- [x] Task 17: stream-json parser
- [x] Task 18: ClaudeCodeDriver — command/env builders, isolated config dir, subprocess runner
- [x] Task 19: MCP syscall transport at /mcp (bearer → pid)
- [x] Task 20: OllamaDriver (tool-calling loop)
- [x] Task 21: System status (`/api/system`) + driver gating

## Milestone 4 — Agent window, Munin browser, Replay, Boot

- [x] Task 22: Agent window (layoutId morph, streaming transcript, tool cards)
- [x] Task 23: Munin browser view
- [x] Task 24: Replay backend — Player, Recorder (scrub), recordings routes
- [x] Task 25: Runs & Replay view + timeline scrubber (REPLAY mode)
- [x] Task 26: Boot sequence

## Milestone 5 — Polish, recordings, docs, sweep

- [x] Task 27: Motion & performance polish pass
- [x] Task 28: Live runs + demo recordings (orchestrator-supervised)
- [x] Task 29: README, GIF, PROJECT.md status, session doc
- [x] Task 30: Privacy & security sweep before any visibility change

## Standing mandate (per AUTOPILOT, once per phase — not per iteration)

- [ ] Milestone boundaries: run the self-challenge/SOTA step; write an ADR under `docs/adr/` if it
      changes the plan.

## Needs Nico (loop cannot do these itself)

- Git remote / public-visibility decision before any first push, plus the publish checklist.
- Live Claude and Ollama runs and their recordings (Task 28) — usage-relevant, supervised.
- Visual/motion sign-off on the README media (`docs/media/`, Task 29).
- Windows shortcut that starts `scripts/serve.sh` plus `msedge --app=http://127.0.0.1:8770`.
- Optional Tailscale, if the shell should be reachable from the phone.
