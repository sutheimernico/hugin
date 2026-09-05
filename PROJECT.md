# hugin — Project (Source of Truth)

hugin is a locally running **agentic operating system**: a Python kernel that runs AI agents as
supervised *processes* (PIDs, budgets, capabilities, scheduler, IPC, shared memory), exposed
through an animated React "shell" (Mission Control) that shows every agent, message, tool call
and memory write **live** — and can **replay** any past run frame by frame. Agents run on Claude
Code headless (Nico's subscription, zero extra cost) or on local Ollama (free); a deterministic
*Simulation* driver runs the whole system without any LLM (tests + offline demo). It is a
portfolio flagship: it has to impress in a two-minute demo *and* be honest engineering
underneath. Hugin and Munin are Odin's ravens — **hugin** ("thought") is the runtime, **munin**
("memory") its memory subsystem.

Binding design spec: `docs/superpowers/specs/2026-09-05-hugin-agentic-os-design.md`.
Build route: `docs/superpowers/plans/2026-09-05-hugin-v1-implementation.md`.

# Part I — Specification

## 1 · Vision & non-negotiables

A viewer starts a mission from the command palette, watches a planner agent spawn workers (the
graph blooms), sees messages pulse between agents, sees memory light up, sees an artifact appear —
and can scrub back through the whole run. Technical viewers see real process supervision, budgets,
kill switches, event sourcing and replay.

1. **Zero extra cost.** Claude Code headless on the subscription (never with `ANTHROPIC_API_KEY`),
   Ollama local, nothing paid. Enforced in code: the kernel strips `ANTHROPIC_API_KEY` from every
   agent environment and refuses to spawn a `claude` driver if the key is present in its own env.
2. **Honesty in the UI.** A mode chip is always visible: `LIVE · CLAUDE`, `LIVE · OLLAMA`,
   `SIMULATION`, `REPLAY`. Simulated or replayed data is never shown unlabeled. Usage numbers come
   from the driver's real reports; the USD figure from Claude Code is labelled "API-Äquivalent",
   never a bill. Failures are loud (red process state, kernel log line).
3. **Event-sourced.** Every state change is an immutable `Event` appended to a log. The UI is a
   pure projection of that stream; live and replay feed the *same* reducer. Replay falls out of
   the architecture instead of being bolted on.
4. **Sandboxed agents.** Own working directory per process under `runs/`, tool whitelist per
   program, capability-gated syscalls, isolated Claude config dir (no user hooks, no user MCP
   servers, no user CLAUDE.md), hard budgets (turns / seconds / output tokens), kill switch, no
   company paths — the company workspace is never mounted and never referenced.
5. **Single writer.** Only one process per run (the planner) writes the run's artifact; workers
   report back via IPC. Cheapest known guard against "two agents write inconsistent halves".
6. **Local & private, publishable later.** No remote until Nico decides; the repo never contains
   company data. `runs/`, `data/`, `.hugin/` are gitignored; committed demo recordings pass a
   scrub step.
7. **UI copy German; code, identifiers, comments, commits, docs English.**

## 2 · Architecture

Browser (React 19 shell) ⇄ SSE `/api/events/stream` + REST `/api/*` ⇄ FastAPI on port 8770:

- `api/` — REST routes and the SSE stream (backfill via `since=<seq>`).
- `kernel/` — `EventBus` → `EventLog` (SQLite, append-only) · `ProcessTable` · `Scheduler`
  (FIFO, per-driver concurrency) · `Budget` watcher · kill switch.
- `drivers/` — `ScriptedDriver` (deterministic) · `ClaudeCodeDriver` (`claude -p`, stream-json,
  isolated config dir) · `OllamaDriver` (tool-calling loop).
- `syscalls/` — capability-gated kernel calls, exposed to agents as MCP tools over HTTP `/mcp`.
- `munin/` — memory store (SQLite FTS5) · `programs/` — YAML agent definitions.
- `missions/` — planner → workers → report lifecycle · `replay/` — recorder + time-scaled player.

Agents are subprocesses (`claude -p …` with `cwd = runs/<run>/p<pid>/`) or HTTP calls to Ollama.
Full diagram and per-module contracts: spec §2.

## 3 · Scope

**v1:** kernel + three drivers + syscalls/MCP + munin FTS + five programs (`planner`, `scout`,
`smith`, `judge`, `scribe`) + missions + replay/recordings + six views + boot + honest mode chip
+ kill switch + demo recordings (one Simulation, one live Claude, one Ollama) + README with GIF.

**Later (not v1):** 3D constellation view, sound cues, embeddings lane in munin, scheduled
missions, multi-run comparison, PWA/mobile, auth, Tauri shell, a second MCP transport, per-run
git worktrees.

## 4 · Data model

- `data/hugin.db` — SQLite: `events`, `runs`, `processes` (final snapshot per exit), `memories`
  (FTS5), `recordings`. Gitignored.
- `runs/<run_id>/p<pid>/` — agent working dirs; `runs/<run_id>/artifacts/` — outputs. Gitignored.
- `.hugin/claude-config/` — isolated Claude config dir, created at boot. Gitignored.
- `demo/recordings/*.jsonl` — scrubbed event logs, committed (they *are* the offline demo).
- `src/hugin/programs/*.yaml`, `src/hugin/drivers/scripts/*.json` — committed content.
- `Event` = `{seq, ts, run_id, pid, kind, data}`; `seq` is assigned by the log, kinds are a
  closed, validated list (spec §2.1).

## 5 · Tech stack

Python 3.12 · uv · FastAPI · pydantic v2 + pydantic-settings · sqlite3 (WAL, FTS5) · httpx ·
PyYAML · `mcp` (official Python SDK) · sse-starlette · pytest + pytest-asyncio · ruff —
React 19 · TypeScript · Vite · Tailwind v4 · motion · @xyflow/react · @dagrejs/dagre · cmdk ·
react-virtuoso · zustand · lucide-react · @fontsource fonts · vitest + testing-library.

## 6 · Acceptance criteria (v1 done when all hold)

1. `scripts/serve.sh` starts the server on 8770; the browser boots with real subsystem checks in
   ≤ 2.5 s.
2. ⌘K → "Mission starten" with driver *Simulation* → within 20 s the graph shows planner + ≥ 3
   workers + judge, message particles travel, the munin hub pulses, an artifact appears, the run
   ends `done`.
3. The same mission with driver *Claude* completes end-to-end on the subscription
   (`apiKeySource=none` in the init event) and is exported as a demo recording; likewise one
   *Ollama* mission.
4. Opening a past run enters `REPLAY` mode; the scrubber seeks, speeds 1–8 work, ←/→ step.
5. Kill-all during a live run: all processes reach `killed` within 3 s.
6. The mode chip is always correct; no unlabeled simulated or replayed data anywhere.
7. Gate green; README has Status, Quickstart, honest framing, a GIF of the demo.
8. Repo contains no absolute personal paths, no company references, no secrets (scan passes).

# Part II — Plan & working method

## Status

**Phase 0 — Scaffold (in progress, 2026-09-05).** Task 1 of 30 done: Python project (uv,
hatchling, src-layout), `Settings`, FastAPI app factory with `GET /api/health`, `hugin-serve`
entry point, `scripts/serve.sh`, house docs, register entry. Gate green (2 tests). Nothing runs
agents yet — there is no kernel, no driver and no frontend. Work happens on `autopilot/work`;
no git remote exists.

## Roadmap

Milestones of `docs/superpowers/plans/2026-09-05-hugin-v1-implementation.md` (30 tasks); the
per-task backlog lives in `PLAN.md`.

- **M0 Scaffold** — Python project, frontend project, base UI components.
- **M1 Kernel core** — events, event log, bus, processes, budgets, programs, driver protocol,
  scheduler, munin, syscalls.
- **M2 API, SSE, shell** — routes, SSE with backfill, frontend state, layout, live graph, palette.
- **M3 Real drivers** — stream-json parser, ClaudeCodeDriver, MCP syscall transport, OllamaDriver,
  system status and driver gating.
- **M4 Agent window, Munin browser, Replay, Boot.**
- **M5 Polish, recordings, docs, privacy sweep.**

## Working method

Superpowers flow (`brainstorming` → `writing-plans` → `executing-plans` /
`subagent-driven-development` → `verification-before-completion`); details and conventions in
`CLAUDE.md`, codebase operations in `AGENTS.md`. Gate before every commit:
`uv run pytest -q` green **and** `uv run ruff check .` clean **and**
`npm --prefix frontend run check` clean **and** `npm --prefix frontend test -- --run` green.

## §Decisions (register — closed, dated)

- **D1 (2026-09-05)** — New repo `hugin`, not an extension of `leitstand`: leitstand is a company
  status cockpit bound to internal data and must never be public; hugin is a publishable showpiece
  with a real agent runtime.
- **D2 (2026-09-05)** — Raw `claude -p` subprocesses, not the Claude Agent SDK: the SDK requires
  an API key, which would cost money.
- **D3 (2026-09-05)** — No `--bare` (it rejects the subscription login). Isolation via
  `CLAUDE_CONFIG_DIR` plus symlinked credentials instead.
- **D4 (2026-09-05)** — Event sourcing is the spine; replay is a projection, not a feature.
- **D5 (2026-09-05)** — Single-writer rule for artifacts.
- **D6 (2026-09-05)** — munin uses SQLite FTS5, no embeddings, in v1.
- **D7 (2026-09-05)** — Frontend without shadcn, GSAP, 3D or sound in v1.

## §Open inputs (living — external facts Nico owns → "Needs Nico")

- **Git remote and visibility.** No remote exists. Before any first push: decide the remote and
  whether the repo goes public.
- **Publish checklist.** If it goes public: secret scan over the full history, doc sweep for
  personal data and company references, commit e-mails rewritten to the noreply address, MIT
  LICENSE in place, backup bundle before any history rewrite.
- **Windows shortcut / start entry** for `scripts/serve.sh` (WSL), so the demo starts without a
  terminal.
- **Live demo runs.** The Claude and Ollama demo recordings (acceptance criterion 3) need Nico's
  logged-in Claude Code and a running Ollama; the loop must never spawn live agents on its own.
