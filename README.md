# hugin

A local **agentic operating system**: a Python kernel that runs AI agents as supervised
*processes* — PIDs, budgets, capabilities, a scheduler, IPC and a shared memory — behind an
animated React shell ("Mission Control") that shows every agent, message, tool call and memory
write live, and can replay any past run frame by frame.

Hugin and Munin are Odin's ravens: **hugin** ("thought") is the agent runtime, **munin**
("memory") its memory subsystem.

## Status

**Phase 0 — Scaffold. Nothing runs agents yet.** What exists today: the Python project (uv,
src-layout), typed settings, a FastAPI app with `GET /api/health` and the `hugin-serve` entry
point. Kernel, drivers, syscalls and the frontend are the next 29 tasks of
`docs/superpowers/plans/2026-09-05-hugin-v1-implementation.md`.

## Honest framing (what makes the numbers trustworthy)

- **Everything on screen is labelled.** A mode chip is always visible: `LIVE · CLAUDE`,
  `LIVE · OLLAMA`, `SIMULATION`, `REPLAY`. Simulated or replayed data is never shown as if it
  were a live run, and the offline demo runs on committed, scrubbed event logs that say so.
- **Usage numbers come from the driver's own reports**, never from an estimate. The USD figure
  Claude Code reports is displayed as "API-Äquivalent" — it is what the same work would have cost
  through the API, not a bill.
- **Zero extra cost, enforced in code.** Agents run on Claude Code headless on an existing
  subscription or on a local Ollama model. The kernel strips `ANTHROPIC_API_KEY` from every agent
  environment and refuses to spawn a Claude-driven process if that key is present in its own
  environment, so no run can silently fall back to a paid API path.
- **Failures are loud.** A crashed driver, a budget breach or an unreachable subsystem shows up as
  a red process state and a kernel log line — never as a plausible-looking blank.

## Scope

**v1:** event-sourced kernel, three interchangeable drivers (Simulation / Claude Code headless /
Ollama), capability-gated syscalls exposed to agents as MCP tools, an FTS5 memory, five agent
programs, missions, replay with recordings, and the shell (boot, process table, live graph,
kernel log, agent window, memory browser, replay timeline, ⌘K palette).

**Not in v1:** 3D view, sound, embeddings, scheduled missions, auth, mobile, Tauri.

## Quickstart (after `uv sync`)

```bash
uv sync
scripts/serve.sh          # http://127.0.0.1:8770
curl 127.0.0.1:8770/api/health
```

Configuration is optional — copy `.env.example` to `.env` to override any `HUGIN_*` setting.
The server binds to loopback only; there is no authentication by design.

Gate:

```bash
uv run pytest -q && uv run ruff check .
```

## Stack

Python 3.12 · uv · FastAPI · pydantic v2 · SQLite (WAL, FTS5) · httpx · PyYAML · MCP Python SDK ·
sse-starlette · pytest · ruff — React 19 · TypeScript · Vite · Tailwind v4 · motion ·
@xyflow/react · cmdk · zustand · vitest.

## License

MIT — see `LICENSE`.
