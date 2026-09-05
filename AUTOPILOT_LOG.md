# hugin — autopilot log

One line per iteration. Newest last.

- 2026-09-05 — Task 1: Python scaffold (uv/hatchling/src-layout), Settings, FastAPI health, house docs, register entry. Gate: 2 passed, ruff clean.
- 2026-09-05 — Task 2: Frontend scaffold (Vite 8 · React 19 · TS · Tailwind v4 · vitest), design tokens, self-hosted fonts, /api proxy to 8770. Gate: 2 pytest, 1 vitest, ruff + tsc/eslint clean.
- 2026-09-05 — Task 3: Base UI components (Panel, Chip, Meter, Button, Kbd, StateRing) + BINDING formatters fmtTokens/fmtDuration/fmtUsd, glow and ring-spin keyframes. Gate: 2 pytest, 27 vitest, ruff + tsc/eslint clean.
- 2026-09-05 — Task 4: Event model — closed 24-kind `EventKind`, one strict pydantic payload per kind, `PAYLOADS` map and `make_event` validating payload into a plain `data` dict. Gate: 5 pytest, 27 vitest, ruff + tsc/eslint clean.
- 2026-09-05 — Task 5: EventLog (append-only SQLite, WAL, seq via INTEGER PRIMARY KEY, run_id index, since/for_run/last_seq) + async EventBus (log-first publish, ordered fan-out, isolated subscriber errors). 10 000 appends in 0.18 s. Gate: 15 pytest, 27 vitest, ruff + tsc/eslint clean.
- 2026-09-05 — Task 6: Process model — `AgentProcess` with validated state machine (`VALID_TRANSITIONS`, `transition` returns prev / raises `InvalidTransition`), `Message` mailbox entries, `ProcessTable` (pids from 1, add/get/all/alive/children/for_run) and pure `BudgetWatcher` (breach order turns → output_tokens → seconds, pct = max of the three dims). Gate: 89 pytest, 27 vitest, ruff + tsc/eslint clean.
