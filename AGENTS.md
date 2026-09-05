# AGENTS.md — hugin codebase operations

Read before changing code. Working method and locked decisions: `CLAUDE.md`.
Source of truth for spec and decisions: `PROJECT.md`.

## Agent stance

- The **kernel** orchestrates; drivers only translate their world into kernel events through an
  `EventSink`. A driver never touches the process table, the scheduler or the database.
- The **API layer** is thin: it validates, calls the kernel façade, and streams events. No
  business logic in routes.
- The **frontend is a pure projection** of the event stream. Live SSE and replay feed the *same*
  reducer; a component never derives state from anything but that store.
- **Pure logic does not live in adapters, routes or components.** Anything testable lives in
  `src/hugin/kernel/`, `src/hugin/munin/`, `src/hugin/replay/` or `frontend/src/state/` and is
  unit-tested with fixtures and fakes.
- **Never call a real LLM.** Tests use `ScriptedDriver`, fake subprocess factories and
  `httpx.MockTransport`. Live runs are supervised, never automated.

## Architecture

- `src/hugin/settings.py` — `Settings` (pydantic-settings, env prefix `HUGIN_`), all paths.
- `src/hugin/app.py` — `create_app(settings)` factory; `src/hugin/cli.py` — `hugin-serve`.
- `src/hugin/kernel/` — `events.py` (Event + closed kind list) · `log.py` (SQLite append-only) ·
  `bus.py` (async pub/sub) · `process.py` (AgentProcess + state machine) · `budget.py` ·
  `scheduler.py` · `kernel.py` (façade) · `sink.py` (driver → events).
- `src/hugin/drivers/` — `base.py` protocol · `scripted.py` · `stream_json.py` ·
  `claude_code.py` · `ollama.py` · `scripts/*.json` (deterministic scripts).
- `src/hugin/syscalls/` — `registry.py` · `handlers.py` · `mcp_server.py` (HTTP `/mcp`).
- `src/hugin/munin/store.py` — SQLite FTS5 memory. `src/hugin/programs/` — YAML agent definitions.
- `src/hugin/missions/`, `src/hugin/replay/`, `src/hugin/system/`, `src/hugin/api/`.
- `frontend/src/` — `state/` (types, reducer, store, selectors) · `lib/` (api, sse, i18n, format)
  · `components/` (primitives) · `features/` (boot, shell, procs, log, graph, agent, palette,
  munin, replay).
- `tests/` mirrors `src/`; fixtures in `tests/fixtures/` (captured stream-json is scrubbed).

## Run / build / test

- `uv sync` · `uv run pytest -q` · `uv run ruff check .`
- Start the API: `scripts/serve.sh` → http://127.0.0.1:8770 (health: `/api/health`).
- Frontend: `npm --prefix frontend run dev` → http://127.0.0.1:5177 (proxies `/api` to 8770) ·
  `npm --prefix frontend run check` · `npm --prefix frontend test -- --run`.

## Best first edits

- **New event kind** → add it to the closed list plus its payload model in
  `src/hugin/kernel/events.py`, then handle it in `frontend/src/state/reducer.ts` and its test.
- **New syscall** → `src/hugin/syscalls/registry.py` (name, capability, schema) + a handler in
  `handlers.py`; it becomes an MCP tool automatically. Add a capability test.
- **New agent program** → a YAML file in `src/hugin/programs/` (capabilities, tool whitelist,
  budget, prompt); it is loaded by `programs/loader.py`, no code change needed.
- **New route** → a `routes_*.py` module under `src/hugin/api/`, registered in `app.py`, tested
  with `httpx.AsyncClient(transport=ASGITransport(app=...))`.
- **New setting** → `src/hugin/settings.py` + a line in `.env.example`.
