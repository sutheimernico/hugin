# hugin v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build hugin v1 — a local agentic OS (Python kernel supervising AI agents as processes) with a futuristic, animated React shell that shows every agent live and can replay any run — exactly as specified in `docs/superpowers/specs/2026-09-05-hugin-agentic-os-design.md` (the spec is binding; this plan is the route).

**Architecture:** Event-sourced kernel (FastAPI, SQLite event log, async EventBus) → three interchangeable agent drivers (Scripted / Claude Code headless / Ollama) → capability-gated syscalls exposed to agents as MCP tools → React 19 shell that is a pure projection of the event stream (live SSE and replay feed the same reducer).

**Tech Stack:** Python 3.12 · uv · FastAPI · pydantic v2 · sqlite3 (WAL, FTS5) · httpx · PyYAML · `mcp` (official Python SDK) · sse-starlette · pytest + pytest-asyncio · ruff — React 19 · TypeScript · Vite · Tailwind v4 · motion · @xyflow/react · @dagrejs/dagre · cmdk · react-virtuoso · zustand · lucide-react · @fontsource fonts · vitest + testing-library.

---

## How to work this plan (read before any task)

1. **Read first, every task:** the spec (`docs/superpowers/specs/2026-09-05-hugin-agentic-os-design.md`), this plan's task text, `CLAUDE.md` and `AGENTS.md` in the repo root (exist after Task 1). Do not read other projects under `~/private/` unless a task says so.
2. **Branch:** all work on `autopilot/work` (created in Task 1 off `main`). Never commit to `main`. Never force-push. No remote exists.
3. **Gate before every commit:** `uv run pytest -q` green **and** `uv run ruff check .` clean; once `frontend/` exists additionally `npm --prefix frontend run check` clean **and** `npm --prefix frontend test -- --run` green. Never commit red.
4. **TDD:** write the failing test, run it (see it fail), implement, run it (see it pass), run the full gate, commit. One task = one or a few small commits (Conventional Commits, English, imperative).
5. **Binding contracts:** code blocks in this plan marked **BINDING** are exact interfaces (names, fields, signatures). Later tasks depend on them. Implement them verbatim. Everything else is described behaviour — implement the simplest code that satisfies the tests. No speculative abstractions.
6. **No network in tests.** No test may call `claude`, Ollama, or the internet. Use the fakes described in each task.
7. **Language:** code, identifiers, comments, commit messages, docs → English. UI copy (anything a user sees in the browser) → German. Note that the wordmark "hugin", program names (`planner`, `scout`, …) and state names stay as-is in the UI, with German labels next to them where the plan says so.
8. **Honesty:** never fake a value. Unavailable subsystem → explicit `warn`/`error` state. Mock or simulated data always carries the `SIMULATION` or `REPLAY` label.
9. **Never write outside the repo** except `~/private/AUTOPILOT.md` (Task 1, register entry). Never reference the company workspace. Never print or read `.env`.
10. **Done means:** the task's steps are all checked, gate green, committed, and the "Acceptance" line of the task holds. Report exactly what you verified and how.

### Repository file map (target state)

```
hugin/
├── PROJECT.md · PLAN.md · LOOP.md · CLAUDE.md · AGENTS.md · README.md · LICENSE · AUTOPILOT_LOG.md
├── pyproject.toml · uv.lock · .env.example · .gitignore · .python-version
├── scripts/serve.sh · scripts/record_demo.py
├── demo/recordings/*.jsonl
├── src/hugin/
│   ├── __init__.py · settings.py · app.py · cli.py
│   ├── kernel/ events.py · log.py · bus.py · process.py · budget.py · scheduler.py · kernel.py · sink.py
│   ├── drivers/ base.py · scripted.py · stream_json.py · claude_code.py · ollama.py · scripts/*.json
│   ├── syscalls/ registry.py · handlers.py · mcp_server.py
│   ├── munin/ store.py
│   ├── programs/ loader.py · contract.md · planner.yaml · scout.yaml · smith.yaml · judge.yaml · scribe.yaml
│   ├── missions/ service.py · templates.py
│   ├── replay/ player.py · recorder.py
│   ├── system/ status.py
│   └── api/ deps.py · routes_system.py · routes_runs.py · routes_procs.py · routes_munin.py · routes_events.py · routes_recordings.py
├── tests/ (mirrors src; fixtures/ under tests/fixtures/)
└── frontend/
    ├── package.json · vite.config.ts · tsconfig*.json · eslint.config.js · index.html
    └── src/
        ├── main.tsx · App.tsx · styles/tokens.css · styles/globals.css
        ├── lib/ api.ts · sse.ts · i18n.ts · format.ts
        ├── state/ types.ts · reducer.ts · store.ts · selectors.ts
        ├── components/ Panel.tsx · Chip.tsx · Meter.tsx · Button.tsx · Kbd.tsx · StateRing.tsx
        ├── features/boot/ BootScreen.tsx
        ├── features/shell/ TopBar.tsx · ModeChip.tsx · MissionBar.tsx · Layout.tsx
        ├── features/procs/ ProcessTable.tsx
        ├── features/log/ KernelLog.tsx
        ├── features/graph/ AgentGraph.tsx · AgentNode.tsx · MuninNode.tsx · PulseEdge.tsx · layout.ts
        ├── features/agent/ AgentWindow.tsx · ToolCallCard.tsx
        ├── features/palette/ CommandPalette.tsx · commands.ts
        ├── features/munin/ MuninBrowser.tsx
        └── features/replay/ RunsView.tsx · Timeline.tsx · replayMath.ts
```

---

# Milestone 0 — Scaffold

### Task 1: Python project scaffold + house docs + register entry

**Files:**
- Create: `pyproject.toml`, `.python-version` (`3.12`), `.gitignore`, `.env.example`, `LICENSE` (MIT, Copyright 2026 Nico Sutheimer), `README.md`, `PROJECT.md`, `PLAN.md`, `LOOP.md`, `CLAUDE.md`, `AGENTS.md`, `AUTOPILOT_LOG.md`
- Create: `src/hugin/__init__.py`, `src/hugin/settings.py`, `src/hugin/app.py`, `src/hugin/cli.py`, `scripts/serve.sh`
- Create: `tests/__init__.py`, `tests/test_settings.py`, `tests/test_app_health.py`
- Modify: `~/private/AUTOPILOT.md` §5 register (append one row for hugin)

Templates for the docs: `~/.claude/skills/project-bootstrap/references/templates.md` — read it, fill the placeholders from the spec (§0, §1, §3, §8 map onto PROJECT.md Part I; §9 onto §Decisions). PLAN.md's backlog = the milestone/task titles of this plan as `- [ ]` items (one line each). LOOP.md per the template with the gate below. CLAUDE.md: working method (Superpowers flow, orchestration, self-review) + locked decisions from spec §9 + doc hierarchy line ("PROJECT.md wins over CLAUDE.md; AGENTS.md = codebase ops"). AGENTS.md: stack, architecture summary (spec §2 headline), run/build/test commands, "best first edits". README: Status (Phase 0), honest framing paragraph (Simulation/Replay labels, zero-cost claim and how it is enforced), Quickstart, Stack, License.

- [ ] **Step 1: Create `pyproject.toml`** with:

```toml
[project]
name = "hugin"
version = "0.1.0"
description = "hugin — a local agentic OS: agents as supervised processes, with a live, replayable mission-control shell"
readme = "README.md"
requires-python = ">=3.12"
license = { text = "MIT" }
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.8",
  "pydantic-settings>=2.4",
  "httpx>=0.27",
  "pyyaml>=6.0",
  "sse-starlette>=2.1",
  "mcp>=1.2",
]

[project.scripts]
hugin-serve = "hugin.cli:main"

[dependency-groups]
dev = ["pytest>=8", "pytest-asyncio>=0.24", "ruff>=0.6", "anyio>=4"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/hugin"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "SIM"]
```

- [ ] **Step 2: `.gitignore`** (core set from the template) plus project-specific lines:

```
.venv/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
data/
runs/
.hugin/
.env
frontend/node_modules/
frontend/dist/
frontend/coverage/
docs/sessions/*.tmp
```
(`demo/recordings/` is **not** ignored — recordings are the offline demo.)

- [ ] **Step 3: Write failing test `tests/test_settings.py`**

```python
from hugin.settings import Settings

def test_defaults_bind_localhost_and_port_8770(monkeypatch, tmp_path):
    monkeypatch.setenv("HUGIN_DATA_DIR", str(tmp_path / "data"))
    s = Settings()
    assert s.host == "127.0.0.1"
    assert s.port == 8770
    assert s.data_dir == tmp_path / "data"
    assert s.max_concurrent == {"claude": 3, "ollama": 1, "scripted": 8}
    assert s.ollama_url == "http://127.0.0.1:11434"
    assert s.ollama_model == "qwen2.5:7b"
    assert s.claude_bin == "claude"
```

- [ ] **Step 4: Implement `src/hugin/settings.py`** **BINDING**

```python
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HUGIN_", env_file=".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 8770
    repo_root: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[2])
    data_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[2] / "data")
    runs_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[2] / "runs")
    claude_config_dir: Path = Field(
        default_factory=lambda: Path(__file__).resolve().parents[2] / ".hugin" / "claude-config"
    )
    recordings_dir: Path = Field(
        default_factory=lambda: Path(__file__).resolve().parents[2] / "demo" / "recordings"
    )
    claude_bin: str = "claude"
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:7b"
    max_concurrent: dict[str, int] = {"claude": 3, "ollama": 1, "scripted": 8}
    log_ring: int = 5000

    @property
    def db_path(self) -> Path:
        return self.data_dir / "hugin.db"
```

- [ ] **Step 5: Write failing test `tests/test_app_health.py`**

```python
import httpx
from hugin.app import create_app

async def test_health_ok(tmp_path, monkeypatch):
    monkeypatch.setenv("HUGIN_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("HUGIN_RUNS_DIR", str(tmp_path / "runs"))
    app = create_app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "name": "hugin"}
```

- [ ] **Step 6: Implement `src/hugin/app.py`** with `create_app(settings: Settings | None = None) -> FastAPI` that registers `GET /api/health` and stores `settings` on `app.state.settings`. `src/hugin/cli.py`: `main()` runs uvicorn with `create_app()` on `settings.host:settings.port`. `scripts/serve.sh`: `cd "$(dirname "$0")/.." && exec uv run hugin-serve`, executable.

- [ ] **Step 7: Run gate** — `uv sync` then `uv run pytest -q` (2 passed) and `uv run ruff check .` (clean).

- [ ] **Step 8: Write the docs** listed in Files from the templates. `.env.example` lists every `HUGIN_*` variable from Settings with a one-line comment. README Status line: "Phase 0 — Scaffold. Nothing runs agents yet."

- [ ] **Step 9: Register** in `~/private/AUTOPILOT.md` §5 — one row in the existing table format: path `~/private/hugin`, remote none, branch `autopilot/work`, gate `uv run pytest -q && uv run ruff check . && npm --prefix frontend run check && npm --prefix frontend test -- --run`, autonomy full (private), note "agentic OS showpiece; never spawn agents from the loop (usage), tests only".

- [ ] **Step 10: Commit on the new branch**

```bash
git switch -c autopilot/work
git add -A
git commit -m "chore: scaffold hugin — settings, FastAPI health, house docs, gate"
```

**Acceptance:** gate green on the skeleton; `scripts/serve.sh` starts and `curl 127.0.0.1:8770/api/health` returns ok (verify, then stop the server).

---

### Task 2: Frontend scaffold (Vite · React 19 · TS · Tailwind v4 · vitest) + fonts + proxy

**Files:**
- Create: `frontend/` via `npm create vite@latest frontend -- --template react-ts` (run from repo root, non-interactive), then adjust.
- Create: `frontend/src/styles/tokens.css`, `frontend/src/styles/globals.css`, `frontend/src/lib/i18n.ts`, `frontend/src/test/setup.ts`
- Test: `frontend/src/App.test.tsx`

- [ ] **Step 1: Scaffold and install** (exact versions: whatever `npm` resolves today; pin in package.json by removing `^` afterwards):

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm i motion @xyflow/react @dagrejs/dagre cmdk react-virtuoso zustand lucide-react @fontsource/space-grotesk @fontsource/inter @fontsource-variable/jetbrains-mono
npm i -D tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/node
```

- [ ] **Step 2: `vite.config.ts`** — plugins `react()`, `tailwindcss()`; `server.port = 5177`, `server.proxy = { "/api": { target: "http://127.0.0.1:8770", changeOrigin: true } }`; `test: { environment: "jsdom", setupFiles: "./src/test/setup.ts", globals: true }`. `package.json` scripts: `"dev": "vite"`, `"build": "tsc -b && vite build"`, `"lint": "eslint ."`, `"check": "tsc -b && eslint ."`, `"test": "vitest"`.

- [ ] **Step 3: `src/styles/tokens.css`** **BINDING** — Tailwind v4 `@theme` block exposing the spec palette and fonts:

```css
@import "tailwindcss";
@import "@fontsource/space-grotesk/500.css";
@import "@fontsource/space-grotesk/700.css";
@import "@fontsource/inter/400.css";
@import "@fontsource/inter/500.css";
@import "@fontsource-variable/jetbrains-mono";

@theme {
  --color-base: #08090C;
  --color-surface: #111318;
  --color-surface-2: #161920;
  --color-border: #22262E;
  --color-text: #E6E8EE;
  --color-muted: #8B92A5;
  --color-violet: #6E5BFF;
  --color-cyan: #22D3C7;
  --color-green: #3ECF8E;
  --color-amber: #F5A623;
  --color-red: #F5455C;
  --color-rose: #F472B6;
  --font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, monospace;
  --radius-panel: 10px;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}
```
`globals.css`: `html,body{background:var(--color-base);color:var(--color-text);font-family:var(--font-sans)}`, `.mono{font-family:var(--font-mono)}`, `@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}}`.

- [ ] **Step 4: `src/lib/i18n.ts`** **BINDING** — German labels used everywhere:

```ts
export const ROLE_LABEL: Record<string, string> = {
  planner: "Planer", scout: "Späher", smith: "Schmied", judge: "Richter", scribe: "Schreiber",
};
export const STATE_LABEL: Record<string, string> = {
  queued: "Wartet", spawning: "Startet", running: "Läuft", waiting_tool: "Werkzeug",
  done: "Fertig", failed: "Fehler", killed: "Beendet",
};
export const MODE_LABEL = {
  idle: "BEREIT", claude: "LIVE · CLAUDE", ollama: "LIVE · OLLAMA",
  scripted: "SIMULATION", replay: "REPLAY",
} as const;
export const DRIVER_LABEL: Record<string, string> = {
  claude: "Claude (Abo)", ollama: "Ollama (lokal, langsam)", scripted: "Simulation",
};
```

- [ ] **Step 5: Failing test `src/App.test.tsx`**: renders `<App />`, expects the text `hugin` (wordmark) and the chip text `BEREIT` to be in the document.

- [ ] **Step 6: Minimal `App.tsx`**: full-height dark page, wordmark `hugin` in `font-display`, a chip showing `MODE_LABEL.idle`. Delete Vite boilerplate (logo, counter, `App.css`, `index.css` → replaced by `styles/*`).

- [ ] **Step 7: Gate** — `npm --prefix frontend run check` clean, `npm --prefix frontend test -- --run` green, `uv run pytest -q` still green.

- [ ] **Step 8: Commit** — `git add frontend && git commit -m "feat(frontend): scaffold Vite React 19 shell with design tokens, fonts and vitest"`

**Acceptance:** `npm --prefix frontend run dev` serves on 5177 and shows the wordmark on the dark base (check once, then stop).

---

### Task 3: Base UI components

**Files:**
- Create: `frontend/src/components/Panel.tsx`, `Chip.tsx`, `Meter.tsx`, `Button.tsx`, `Kbd.tsx`, `StateRing.tsx`, `frontend/src/lib/format.ts`
- Test: `frontend/src/components/components.test.tsx`, `frontend/src/lib/format.test.ts`

Behaviour:
- `Panel({title?, right?, children, className?})` — surface bg, 1 px border, radius-panel, optional header row with `title` (font-display, 12 px, uppercase tracking) and a `right` slot.
- `Chip({tone: 'violet'|'cyan'|'green'|'amber'|'red'|'muted', pulse?: boolean, children})` — pill, hairline border tinted by tone; `pulse` adds a CSS glow animation (2.4 s loop) — glow only when `pulse`.
- `Meter({label, value, max, tone, format?})` — label + mono value + 4 px bar; width transition 400 ms ease-out-expo.
- `Button({variant: 'ghost'|'primary'|'danger', size?: 'sm'|'md'})`.
- `Kbd({children})` — for `⌘K`, `Esc`.
- `StateRing({state, size})` — 10 px ring coloured by state: queued/spawning muted, running violet with slow spin animation (CSS conic gradient), waiting_tool cyan, done green, failed red, killed muted with strike.
- `format.ts` **BINDING**: `fmtTokens(n:number):string` (`1234 → "1,2k"`, `987 → "987"`, `1_500_000 → "1,5M"` — German decimal comma), `fmtDuration(seconds:number):string` (`65 → "1:05"`, `3700 → "1:01:40"`), `fmtUsd(x:number|null):string` (`null → "–"`, `0.0432 → "≈ $0,04"`).

- [ ] **Step 1: Failing tests** — `format.test.ts` with the exact examples above; `components.test.tsx` renders each component once and asserts label/children text and, for `StateRing`, the `data-state` attribute.
- [ ] **Step 2: Implement** the components + `format.ts`.
- [ ] **Step 3: Gate + commit** — `git commit -m "feat(frontend): add base components and formatters"`

**Acceptance:** all component tests pass; no component imports from features.

---

# Milestone 1 — Kernel core

### Task 4: Event model

**Files:**
- Create: `src/hugin/kernel/__init__.py`, `src/hugin/kernel/events.py`
- Test: `tests/kernel/__init__.py`, `tests/kernel/test_events.py`

- [ ] **Step 1: Failing tests**

```python
import pytest
from pydantic import ValidationError
from hugin.kernel.events import Event, EventKind, make_event

def test_kinds_are_closed_list():
    assert "proc.text" in EventKind.__members__.values() or EventKind("proc.text")
    with pytest.raises(ValueError):
        EventKind("proc.unknown")

def test_make_event_validates_payload():
    e = make_event(EventKind.PROC_TEXT, run_id="r1", pid=1, data={"delta": "hi"}, ts=1.0)
    assert e.seq is None and e.kind == "proc.text" and e.data == {"delta": "hi"}
    with pytest.raises(ValidationError):
        make_event(EventKind.PROC_TEXT, run_id="r1", pid=1, data={"nope": 1}, ts=1.0)

def test_event_roundtrip_json():
    e = make_event(EventKind.KILL, run_id=None, pid=None, data={"target": "all", "by": "user"}, ts=2.0)
    e2 = Event.model_validate_json(e.model_dump_json())
    assert e2 == e
```

- [ ] **Step 2: Implement** **BINDING**

```python
from enum import StrEnum
from typing import Literal
from pydantic import BaseModel, ConfigDict


class EventKind(StrEnum):
    KERNEL_BOOT = "kernel.boot"; KERNEL_SUBSYSTEM = "kernel.subsystem"
    RUN_CREATED = "run.created"; RUN_DONE = "run.done"; RUN_FAILED = "run.failed"
    SCHED_QUEUED = "sched.queued"; SCHED_STARTED = "sched.started"; SCHED_BLOCKED = "sched.blocked"
    PROC_SPAWNED = "proc.spawned"; PROC_STATE = "proc.state"; PROC_TEXT = "proc.text"
    PROC_THINKING = "proc.thinking"; PROC_EXIT = "proc.exit"
    TOOL_CALL = "tool.call"; TOOL_RESULT = "tool.result"
    SYS_CALL = "sys.call"; SYS_RESULT = "sys.result"
    MSG_SENT = "msg.sent"; MUNIN_WRITE = "munin.write"; MUNIN_READ = "munin.read"
    ARTIFACT_WRITTEN = "artifact.written"
    BUDGET_TICK = "budget.tick"; BUDGET_EXCEEDED = "budget.exceeded"; KILL = "kill"


ProcState = Literal["queued", "spawning", "running", "waiting_tool", "done", "failed", "killed"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Usage(Strict):
    turns: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd_equiv: float | None = None


class BudgetSpec(Strict):
    max_turns: int = 12
    max_seconds: int = 300
    max_output_tokens: int = 6000


class KernelBoot(Strict): version: str; pid_counter: int
class KernelSubsystem(Strict): name: str; status: Literal["ok", "warn", "error"]; detail: str
class RunCreated(Strict): goal: str; driver: str; template: str | None = None
class RunDone(Strict): usage: Usage; artifacts: list[str]; duration_s: float
class RunFailed(Strict): reason: str
class SchedQueued(Strict): pass
class SchedStarted(Strict): pass
class SchedBlocked(Strict): reason: str; limit: int
class ProcSpawned(Strict):
    ppid: int | None; program: str; role: str; driver: str; model: str; budget: BudgetSpec; task: str
class ProcStateChange(Strict): state: ProcState; prev: ProcState
class ProcText(Strict): delta: str
class ProcThinking(Strict): on: bool
class ProcExit(Strict): reason: str; usage: Usage; stderr_tail: str | None = None
class ToolCall(Strict): call_id: str; tool: str; input_summary: str
class ToolResult(Strict): call_id: str; ok: bool; output_summary: str; ms: int
class SysCall(Strict): call_id: str; syscall: str; args_summary: str
class SysResult(Strict): call_id: str; ok: bool; result_summary: str; ms: int
class MsgSent(Strict): from_pid: int; to_pid: int; preview: str
class MuninWrite(Strict): memory_id: int; title: str
class MuninRead(Strict): query: str; hits: int
class ArtifactWritten(Strict): name: str; bytes: int
class BudgetTick(Strict): turns: int; output_tokens: int; seconds: float; pct: float
class BudgetExceeded(Strict): which: Literal["turns", "seconds", "output_tokens"]
class Kill(Strict): target: int | Literal["all"]; by: str


PAYLOADS: dict[EventKind, type[Strict]] = {
    EventKind.KERNEL_BOOT: KernelBoot, EventKind.KERNEL_SUBSYSTEM: KernelSubsystem,
    EventKind.RUN_CREATED: RunCreated, EventKind.RUN_DONE: RunDone, EventKind.RUN_FAILED: RunFailed,
    EventKind.SCHED_QUEUED: SchedQueued, EventKind.SCHED_STARTED: SchedStarted,
    EventKind.SCHED_BLOCKED: SchedBlocked, EventKind.PROC_SPAWNED: ProcSpawned,
    EventKind.PROC_STATE: ProcStateChange, EventKind.PROC_TEXT: ProcText,
    EventKind.PROC_THINKING: ProcThinking, EventKind.PROC_EXIT: ProcExit,
    EventKind.TOOL_CALL: ToolCall, EventKind.TOOL_RESULT: ToolResult,
    EventKind.SYS_CALL: SysCall, EventKind.SYS_RESULT: SysResult, EventKind.MSG_SENT: MsgSent,
    EventKind.MUNIN_WRITE: MuninWrite, EventKind.MUNIN_READ: MuninRead,
    EventKind.ARTIFACT_WRITTEN: ArtifactWritten, EventKind.BUDGET_TICK: BudgetTick,
    EventKind.BUDGET_EXCEEDED: BudgetExceeded, EventKind.KILL: Kill,
}


class Event(BaseModel):
    seq: int | None = None
    ts: float
    run_id: str | None
    pid: int | None
    kind: EventKind
    data: dict


def make_event(kind: EventKind, *, run_id: str | None, pid: int | None, data: dict, ts: float) -> Event:
    payload = PAYLOADS[kind].model_validate(data)
    return Event(ts=ts, run_id=run_id, pid=pid, kind=kind, data=payload.model_dump())
```

- [ ] **Step 3: Gate + commit** — `git commit -m "feat(kernel): add event model with closed kind list and payload schemas"`

**Acceptance:** every kind in the spec §2.1 list has a payload model; unknown kinds/fields fail validation.

---

### Task 5: EventLog (SQLite) + EventBus

**Files:**
- Create: `src/hugin/kernel/log.py`, `src/hugin/kernel/bus.py`
- Test: `tests/kernel/test_log.py`, `tests/kernel/test_bus.py`

**BINDING interfaces:**

```python
class EventLog:
    def __init__(self, db_path: Path): ...   # creates parent dirs, opens sqlite3 (check_same_thread=False), PRAGMA journal_mode=WAL, creates table+index
    def append(self, event: Event) -> Event  # assigns seq (autoincrement), returns copy with seq
    def since(self, seq: int, run_id: str | None = None, limit: int = 10_000) -> list[Event]  # seq > given
    def for_run(self, run_id: str) -> list[Event]
    def last_seq(self) -> int
    def close(self) -> None

Subscriber = Callable[[Event], Awaitable[None]]

class EventBus:
    def __init__(self, log: EventLog): ...
    def subscribe(self, fn: Subscriber) -> Callable[[], None]   # returns unsubscribe
    async def publish(self, event: Event) -> Event   # append to log FIRST (assign seq), then await each subscriber in order; a subscriber exception is logged (logging.exception) and does not stop others
```

Tests: seq strictly increasing across two appends; `since(0)` returns both, `since(1)` returns the second; `for_run` filters by run; `publish` delivers to two subscribers in order with `seq` set; a raising subscriber does not prevent delivery to the next; `since()` respects `run_id` filter; the table has an index on `run_id` (`PRAGMA index_list`).

- [ ] Steps: failing tests → implement → gate → `git commit -m "feat(kernel): add SQLite event log and async event bus"`

**Acceptance:** 10 000 appends complete in < 2 s in a test (WAL on; use `executemany`-free simple inserts, single connection).

---

### Task 6: AgentProcess, state machine, ProcessTable, Budget watcher

**Files:**
- Create: `src/hugin/kernel/process.py`, `src/hugin/kernel/budget.py`
- Test: `tests/kernel/test_process.py`, `tests/kernel/test_budget.py`

**BINDING:**

```python
# process.py
from dataclasses import dataclass, field
from hugin.kernel.events import BudgetSpec, ProcState, Usage

VALID_TRANSITIONS: dict[ProcState, set[ProcState]] = {
    "queued": {"spawning", "killed"},
    "spawning": {"running", "failed", "killed"},
    "running": {"waiting_tool", "done", "failed", "killed"},
    "waiting_tool": {"running", "done", "failed", "killed"},
    "done": set(), "failed": set(), "killed": set(),
}

@dataclass
class Message:
    from_pid: int; text: str; ts: float

@dataclass
class AgentProcess:
    pid: int; run_id: str; ppid: int | None; program: str; role: str; driver: str; model: str
    task: str; cwd: Path; capabilities: set[str]; allowed_tools: list[str]; budget: BudgetSpec
    state: ProcState = "queued"
    usage: Usage = field(default_factory=Usage)
    started_at: float | None = None; exited_at: float | None = None; exit_reason: str | None = None
    mailbox: list[Message] = field(default_factory=list)
    report: str | None = None        # final mission_report text (workers)
    def transition(self, new: ProcState) -> ProcState:  # returns prev; raises InvalidTransition
    @property
    def alive(self) -> bool  # state not in {done, failed, killed}

class InvalidTransition(Exception): ...

class ProcessTable:
    def __init__(self): ...
    def next_pid(self) -> int          # starts at 1
    def add(self, proc: AgentProcess) -> None
    def get(self, pid: int) -> AgentProcess   # KeyError if missing
    def all(self) -> list[AgentProcess]
    def alive(self) -> list[AgentProcess]
    def children(self, pid: int) -> list[AgentProcess]
    def for_run(self, run_id: str) -> list[AgentProcess]
```

```python
# budget.py
class BudgetWatcher:
    """Pure decision logic: given a process and now, which limit (if any) is breached."""
    @staticmethod
    def breach(proc: AgentProcess, now: float) -> Literal["turns", "seconds", "output_tokens"] | None
    @staticmethod
    def pct(proc: AgentProcess, now: float) -> float   # max over the three dims, 0..1 (may exceed 1)
```
`breach` order: turns, then output_tokens, then seconds. `seconds` counts from `started_at` (None → 0).

Tests: every valid transition passes and every invalid pairing raises; `alive`; pids start at 1 and increase; `children`/`for_run`; breach returns `None` under limits, the right dim at limit (`turns == max_turns` breaches), `pct` math (e.g., 6/12 turns, 1000/6000 tokens, 30/300 s → 0.5).

- [ ] Steps: failing tests → implement → gate → `git commit -m "feat(kernel): add process model, process table and budget watcher"`

---

### Task 7: Programs (YAML) + kernel contract

**Files:**
- Create: `src/hugin/programs/__init__.py`, `src/hugin/programs/loader.py`, `src/hugin/programs/contract.md`, `src/hugin/programs/planner.yaml`, `scout.yaml`, `smith.yaml`, `judge.yaml`, `scribe.yaml`
- Test: `tests/programs/test_loader.py`

**BINDING:**

```python
class Program(Strict):
    name: str; role: str; icon: str; accent: Literal["violet", "cyan", "amber", "green", "rose"]
    driver: Literal["claude", "ollama", "scripted"] = "claude"
    model: str = "sonnet"
    tools: list[str] = []
    capabilities: list[str] = []
    budget: BudgetSpec = BudgetSpec()
    system_prompt: str

KNOWN_CAPABILITIES = {"munin.read", "munin.write", "proc.spawn", "proc.send", "proc.wait", "report", "artifact.write"}

def load_programs(directory: Path | None = None) -> dict[str, Program]  # default: package dir; validates capabilities ⊆ KNOWN, name == file stem
def kernel_contract() -> str   # contents of contract.md
def full_system_prompt(program: Program) -> str  # program.system_prompt + "\n\n" + kernel_contract()
```

Program content (write real prompts, English, ≤ 25 lines each, second person, concrete):
- `planner`: role "Orchestrator", icon `compass`, accent violet, model `sonnet`, tools `[]`, capabilities `[munin.read, munin.write, proc.spawn, proc.wait, proc.send, artifact.write]`, budget `{max_turns: 20, max_seconds: 900, max_output_tokens: 12000}`. Prompt: decompose the goal into ≤ 4 independent worker tasks, spawn them with `proc_spawn` (program `scout` for research, `smith` for code/analysis, `scribe` for writing), `proc_wait` for them, optionally spawn one `judge` to critique the assembled result, then write exactly one artifact `report.md` with `artifact_write` and finish with a 3-sentence summary. Never do worker work yourself.
- `scout`: Researcher, `telescope`, cyan, tools `[WebSearch, WebFetch]`, caps `[munin.read, munin.write, report]`, budget default. Prompt: research the task, verify with ≥ 2 sources, store 1–3 durable facts with `munin_write`, end with `mission_report` (≤ 200 words, sources listed).
- `smith`: Engineer, `hammer`, amber, tools `[Read, Glob, Grep, Bash(ls *), Bash(cat *), Bash(wc *)]`, caps `[munin.read, munin.write, report]`. Prompt: analyse code/data in the working directory, never modify files, report findings with file references.
- `judge`: Reviewer, `scale`, rose, tools `[]`, caps `[munin.read, report]`, budget `{max_turns: 6, max_seconds: 240, max_output_tokens: 3000}`. Prompt: critique the given text for factual gaps, contradictions and unsupported claims; be specific; end with `mission_report`.
- `scribe`: Writer, `pen-line`, green, tools `[]`, caps `[munin.read, report]`. Prompt: turn inputs into clear German prose for a non-technical reader; end with `mission_report`.

`contract.md` (≤ 40 lines): you are process `{pid}` in hugin OS; available syscalls are MCP tools named `munin_search`, `munin_write`, `proc_spawn`, `proc_send`, `proc_wait`, `mission_report`, `artifact_write` — you only see the ones you are allowed; budget limits (turns/seconds/output tokens) end the process when exceeded; only the root process writes artifacts; workers must end with exactly one `mission_report`; keep tool inputs small; never claim work you did not do. (Kernel fills `{pid}` at spawn — see Task 9.)

Tests: all five load; `planner` has `proc.spawn`; a YAML with an unknown capability raises `ValueError` mentioning it; `full_system_prompt` contains both parts; contract ≤ 40 lines.

- [ ] Steps: failing tests → implement → gate → `git commit -m "feat(programs): add five agent programs, loader and kernel contract"`

---

### Task 8: Driver protocol + ScriptedDriver

**Files:**
- Create: `src/hugin/drivers/__init__.py`, `src/hugin/drivers/base.py`, `src/hugin/drivers/scripted.py`, `src/hugin/drivers/scripts/hello.json`
- Test: `tests/drivers/test_scripted.py`

**BINDING:**

```python
# base.py
class EventSink(Protocol):
    async def text(self, delta: str) -> None: ...
    async def thinking(self, on: bool) -> None: ...
    async def state(self, state: ProcState) -> None: ...            # running / waiting_tool only
    async def tool_call(self, call_id: str, tool: str, input_summary: str) -> None: ...
    async def tool_result(self, call_id: str, ok: bool, output_summary: str, ms: int) -> None: ...
    async def usage(self, usage: Usage) -> None: ...               # cumulative
    async def syscall(self, name: str, args: dict) -> dict: ...    # executes via kernel; raises SyscallError

class SyscallError(Exception): ...

@dataclass
class ExitInfo:
    reason: str            # "done" | "failed" | "driver_error" | "killed"
    usage: Usage
    stderr_tail: str | None = None

class AgentDriver(Protocol):
    name: str
    async def run(self, proc: AgentProcess, prompt: str, sink: EventSink) -> ExitInfo: ...
    async def kill(self, proc: AgentProcess) -> None: ...
```

`ScriptedDriver(scripts_dir: Path | None = None, clock_sleep = asyncio.sleep)`; the *script* to run is chosen by `proc.program` → `scripts/<program>.json`, unless `proc.task` starts with `script:<name>` (then `scripts/<name>.json`). Script format: `[{"delay_ms": 120, "op": "text", "delta": "…"}, {"op":"thinking","on":true}, {"op":"tool_call","call_id":"t1","tool":"WebSearch","input_summary":"…"}, {"op":"tool_result","call_id":"t1","ok":true,"output_summary":"…","ms":420}, {"op":"syscall","name":"munin_write","args":{...}}, {"op":"usage","turns":1,"input_tokens":800,"output_tokens":120}, {"op":"exit","reason":"done"}]`. `delay_ms` defaults 0. `kill` sets a flag; `run` checks it between ops and returns `ExitInfo("killed", …)`. A `syscall` op's result is ignored except that `SyscallError` → op `{"op":"syscall", ..., "expect_error": true}` passes, otherwise the run ends `failed`. `hello.json`: two text ops, one usage op, exit done.

Tests use a `RecordingSink` (in `tests/drivers/conftest.py`, records calls; `syscall` returns `{"ok": True}` or raises when `name == "forbidden"`): hello script yields the recorded ops in order and `ExitInfo.reason == "done"` with `usage.turns == 1`; kill flag mid-run → `"killed"`; `script:` prefix selects another script; `SyscallError` without `expect_error` → `"failed"`.

- [x] Steps: failing tests → implement → gate → `git commit -m "feat(drivers): add driver protocol and deterministic scripted driver"`

---

### Task 9: Kernel façade + Scheduler (with ScriptedDriver end-to-end)

**Files:**
- Create: `src/hugin/kernel/scheduler.py`, `src/hugin/kernel/sink.py`, `src/hugin/kernel/kernel.py`
- Test: `tests/kernel/test_kernel.py`, `tests/kernel/test_scheduler.py`, `tests/conftest.py`

**BINDING:**

```python
# scheduler.py
class Scheduler:
    def __init__(self, limits: dict[str, int]): ...
    def can_start(self, driver: str, running_by_driver: dict[str, int]) -> bool
    # pure FIFO helper; the Kernel owns the queue (deque[int] of pids) and calls this

# sink.py
class ProcessSink(EventSink):
    def __init__(self, kernel: "Kernel", pid: int): ...
    # each method publishes the matching event via kernel.emit(...) and updates the process
    # syscall() delegates to kernel.syscalls.call(pid, name, args)  (Task 11; until then raise SyscallError("no syscalls"))

# kernel.py
class Kernel:
    def __init__(self, settings: Settings, log: EventLog, bus: EventBus, programs: dict[str, Program],
                 drivers: dict[str, AgentDriver], clock: Callable[[], float] = time.time): ...
    version: str = "0.1.0"
    procs: ProcessTable
    runs: dict[str, RunInfo]            # RunInfo dataclass: id, goal, driver, template, created_at, done_at, state("running"|"done"|"failed"), root_pid
    syscalls: "SyscallRegistry | None" = None   # set in Task 11
    async def boot(self) -> None                       # emits kernel.boot; creates data/runs dirs
    async def emit(self, kind: EventKind, *, run_id, pid, data) -> Event
    async def create_run(self, goal: str, driver: str, template: str | None = None) -> str   # id = time-sortable 12-char base32/hex; emits run.created
    async def spawn(self, run_id: str, program: str, task: str, *, ppid: int | None = None,
                    driver: str | None = None, budget: BudgetSpec | None = None) -> int
    async def kill(self, pid: int, by: str = "user") -> None
    async def kill_all(self, by: str = "user") -> None
    async def send(self, from_pid: int, to_pid: int, text: str) -> None      # appends to mailbox, emits msg.sent (preview ≤ 80 chars)
    async def wait(self, pid: int, child_pids: list[int], timeout_s: float) -> list[dict]  # [{pid, state, report}] when all exited or timeout
    async def shutdown(self) -> None   # kill_all + cancel tasks
```

Spawn behaviour: resolve program (KeyError → `ValueError("unknown program")`); driver = explicit or program.driver; pid = next; cwd = `runs_dir/<run_id>/p<pid>/` (mkdir); capabilities/tools from program; process added with state `queued`; emit `proc.spawned`; if `ppid` given, the parent's fan-out is checked (> 4 alive children → `ValueError("fan-out limit")`); enqueue; `_pump()` starts as many queued processes as `Scheduler.can_start` allows (emit `sched.started` / `sched.blocked` with the limit); starting a process = transition `spawning`, `started_at = clock()`, `asyncio.create_task(self._run(pid))`.

`_run(pid)`: sink = `ProcessSink`; prompt = `full_system_prompt(program).replace("{pid}", str(pid))` **as system prompt** and `task` as the user prompt (drivers receive `prompt=task`; the system prompt is `proc`-accessible via `kernel.system_prompt_for(pid)`); transition `running`; `exit = await driver.run(proc, task, sink)` inside try/except → on exception `ExitInfo("driver_error", usage, stderr_tail=repr(exc)[:500])`; finalize: `usage` merged, `exited_at`, `exit_reason`, transition to `done`/`failed`/`killed` (`driver_error` → `failed`; `budget:*` → `killed`), emit `proc.exit`, `_pump()`, and if pid is the run's root: `run.done` (reason done) or `run.failed`.

Budget: a background task per running process ticks every 1 s (settings-overridable interval for tests via `Kernel(..., tick_s=0.01)`): emit `budget.tick` with `BudgetWatcher.pct`, and on breach emit `budget.exceeded` then `kill(pid, by=f"budget:{which}")` which sets `exit_reason=f"budget:{which}"`.

`kill(pid)`: if alive → emit `kill`, call `driver.kill(proc)`; the driver's `run` returns and finalization happens in `_run`; if the process is still `queued` (never started) → transition directly to `killed`, emit `proc.exit(reason="killed")`. `kill_all`: emit one `kill(target="all")`, then kill each alive pid.

Tests (`tests/conftest.py` provides `kernel` fixture: tmp dirs, `EventLog`, `EventBus`, programs loaded, drivers `{"scripted": ScriptedDriver(clock_sleep=no-op)}`, `collected: list[Event]` subscriber):
1. `spawn` → events in order: `run.created`, `proc.spawned`, `sched.started`, `proc.state(spawning)`, `proc.state(running)`, `proc.text`×2, `proc.exit(done)`, `proc.state(done)`, `run.done` (allow `budget.tick` interleaved; assert relative order of the named ones).
2. Concurrency: with limits `{"scripted": 1}` and two spawns, the second gets `sched.blocked` first and starts after the first exits.
3. Kill queued process → `killed` without ever `running`.
4. Budget: program budget `max_turns=1`, script emits usage turns=2 → `budget.exceeded(which="turns")`, exit reason `budget:turns`, state `killed`.
5. Fan-out: 5th child of one parent raises `ValueError`.
6. `send`/`wait`: send text to pid → mailbox has it + `msg.sent` preview ≤ 80; `wait` returns reports after children exit; times out with states.
7. Unknown program → `ValueError`.

- [ ] Steps: failing tests → implement → gate → `git commit -m "feat(kernel): add kernel façade, scheduler, process sink and budget enforcement"`

**Acceptance:** all seven behaviours tested; `uv run pytest -q` < 5 s total.

---

### Task 10: Munin memory store (SQLite FTS5)

**Files:**
- Create: `src/hugin/munin/__init__.py`, `src/hugin/munin/store.py`
- Test: `tests/munin/test_store.py`

**BINDING:**

```python
@dataclass
class Memory:
    id: int; title: str; body: str; tags: list[str]; run_id: str | None; pid: int | None; program: str | None; created_at: float

class MuninStore:
    def __init__(self, db_path: Path): ...   # same file as EventLog is fine; own connection; creates `memories` FTS5 table (title, body, tags UNINDEXED? -> index tags too) + `memories_meta`(id, run_id, pid, program, created_at)
    def write(self, title: str, body: str, tags: list[str], *, run_id, pid, program, ts: float) -> Memory
    def search(self, query: str, limit: int = 10) -> list[Memory]   # FTS MATCH with bm25 ordering; sanitize query: strip FTS operators, quote tokens
    def get(self, memory_id: int) -> Memory | None
    def recent(self, limit: int = 20) -> list[Memory]
    def count(self) -> int
```

Tests: write two, search finds the right one by a body word and by a tag; a query with `"` and `*` characters does not raise; `count`; `get` of unknown → None; `recent` ordering.

- [ ] Steps → `git commit -m "feat(munin): add FTS5 memory store with provenance"`

---

### Task 11: Syscalls — registry, handlers, capabilities, single writer

**Files:**
- Create: `src/hugin/syscalls/__init__.py`, `src/hugin/syscalls/registry.py`, `src/hugin/syscalls/handlers.py`
- Modify: `src/hugin/kernel/kernel.py` (attach `self.syscalls = SyscallRegistry(self, munin)`; constructor gains `munin: MuninStore`), `src/hugin/kernel/sink.py` (`syscall` delegates)
- Test: `tests/syscalls/test_registry.py`, update `tests/conftest.py` (munin in fixture)

**BINDING:**

```python
@dataclass(frozen=True)
class SyscallDef:
    name: str; capability: str; description: str; schema: dict   # JSON schema for args
    handler: Callable[["Kernel", int, dict], Awaitable[dict]]

class SyscallRegistry:
    def __init__(self, kernel: "Kernel", munin: MuninStore): ...
    def defs_for(self, pid: int) -> list[SyscallDef]          # only those whose capability the process holds
    def tool_schemas(self, pid: int) -> list[dict]            # [{"name","description","input_schema"}] for MCP/Ollama
    async def call(self, pid: int, name: str, args: dict) -> dict
    # emits sys.call before, sys.result after (ok/false, ms); raises SyscallError on unknown name, missing capability, schema violation, or handler error (message is user-readable, English)
```

Handlers (results are plain dicts):
- `munin_search{query:str, limit?:int≤20}` → `{"hits":[{id,title,body,tags,program}]}`; emits `munin.read`.
- `munin_write{title, body, tags?:list[str]}` → `{"id"}`; emits `munin.write`.
- `proc_spawn{program, task, budget?:{max_turns?,max_seconds?,max_output_tokens?}}` → `{"pid"}`; program must not be `planner` (no recursive planners in v1); kernel.spawn with `ppid=pid`, driver inherited from the caller's driver.
- `proc_send{to_pid, text}` → `{"delivered": true}`; to_pid must be in the same run.
- `proc_wait{pids:list[int], timeout_s?:int≤600}` → `{"results":[{pid,state,report}]}`; sets caller `waiting_tool` while waiting and back to `running`.
- `mission_report{summary}` → sets `proc.report`, sends the summary to the parent mailbox (if `ppid`), returns `{"ok": true}`.
- `artifact_write{name, content}` → only if `pid == runs[run_id].root_pid` (else `SyscallError("single-writer: only the root process may write artifacts")`); name sanitized (`[A-Za-z0-9._-]{1,64}`, no `..`); writes `runs/<run>/artifacts/<name>`; emits `artifact.written`; `{"path": "artifacts/<name>", "bytes": n}`.

Also add `src/hugin/drivers/scripts/planner.json`, `scout.json`, `judge.json` — the **Simulation** scripts (German text deltas; the demo story: goal "Recherche-Briefing"): planner thinks, `proc_spawn` scout ×3 with different tasks (each script instance is the same `scout.json`; vary nothing — fine), `proc_wait` them, `proc_spawn` judge, `proc_wait`, `artifact_write report.md` (≈ 25 lines German markdown), usage, exit. `scout.json`: thinking, a `tool_call/tool_result` pair (WebSearch), `munin_write`, text, `mission_report`, usage, exit. `judge.json`: text critique, `mission_report`, exit. Delays: total simulated run ≤ 15 s with real delays (sum of `delay_ms` per script ≤ 6 s; children run concurrently).

Tests: capability denial (`scout` calling `proc_spawn` → SyscallError, `sys.result ok=false`); schema violation; `artifact_write` by non-root denied; by root writes the file + event; `proc_spawn` from root creates child with `ppid`; `proc_wait` returns reports; `mission_report` lands in parent mailbox; end-to-end: spawn `planner` (scripted) → run completes with `run.done`, ≥ 5 processes, artifact `report.md` exists, `munin.count() >= 3`; the whole simulation with no-op sleep finishes < 3 s.

- [ ] Steps → `git commit -m "feat(syscalls): add capability-gated syscall registry, handlers and simulation scripts"`

**Acceptance:** the simulation end-to-end test passes; unit tests cover each syscall's happy and denied path.

---

# Milestone 2 — API, SSE and the Mission Control shell

### Task 12: FastAPI routes + SSE with backfill

**Files:**
- Create: `src/hugin/api/__init__.py`, `deps.py`, `routes_system.py` (health only for now; `/api/system` in Task 21), `routes_runs.py`, `routes_procs.py`, `routes_events.py`, `routes_munin.py`
- Create: `src/hugin/missions/__init__.py`, `service.py`, `templates.py`
- Modify: `src/hugin/app.py` (build Kernel in lifespan; `app.state.kernel`; mount routers; serve `frontend/dist` if it exists)
- Test: `tests/api/test_runs.py`, `tests/api/test_events_sse.py`, `tests/api/test_procs.py`, `tests/api/test_munin.py`

**BINDING JSON shapes:**

```
POST /api/missions  {goal: str, driver: "claude"|"ollama"|"scripted" = "scripted", template?: str}
  → 201 {run_id}    · 409 {detail} if driver unavailable (Task 21) · 422 on empty goal
GET  /api/runs → [{id, goal, driver, template, state, created_at, done_at, root_pid, usage:{turns,input_tokens,output_tokens,cost_usd_equiv}, artifacts:[name]}]
GET  /api/runs/{id} → same object (404 if unknown)
GET  /api/runs/{id}/events?since=0 → [Event]
GET  /api/runs/{id}/artifacts → [{name, bytes}] · GET /api/runs/{id}/artifacts/{name} → text/plain
GET  /api/procs → [{pid, run_id, ppid, program, role, driver, model, state, task, budget, usage, started_at, exited_at, exit_reason}]
POST /api/procs/{pid}/kill → 200 {ok:true} · 404
POST /api/kill-all → 200 {killed:[pid,...]}
GET  /api/programs → [{name, role, icon, accent, driver, model, tools, capabilities, budget}]
GET  /api/munin/search?q=&limit= → [{id,title,body,tags,run_id,pid,program,created_at}] · GET /api/munin/{id} · GET /api/munin/recent
GET  /api/events/stream?run_id=&since=  → text/event-stream; each message: `id: <seq>`, `event: <kind>`, `data: <Event JSON>`; first backfill `log.since(since, run_id)`, then live; heartbeat comment every 15 s
GET  /api/templates → [{id, title, goal}]
```

`templates.py`: three templates with German titles and English-or-German goals: `research_brief` ("Recherche-Briefing" — "Erstelle ein Recherche-Briefing zu: {topic}"), `compare_options` ("Optionen vergleichen"), `analyse_repo` ("Repo analysieren" — goal includes a path; `service.py` validates any path in the goal is under `~/private/` else 422).

SSE implementation: `sse_starlette.EventSourceResponse` over an async generator that first yields backfill, then subscribes to the bus with an `asyncio.Queue`, yields until the client disconnects (`request.is_disconnected()`), then unsubscribes.

Tests (ASGITransport; SSE tested by reading the streaming response for the first N messages with a timeout, then closing): mission create → run visible; events endpoint returns `run.created` first; SSE backfill delivers events with `id:` lines equal to seq; procs list after a scripted mission has ≥ 5 rows with states; kill-all on an empty kernel returns `{killed: []}`; munin search proxies store; artifacts served after the simulation; 422 for empty goal; 422 for a path outside `~/private`.

- [ ] Steps → `git commit -m "feat(api): add missions, runs, procs, munin and SSE event stream"`

**Acceptance:** `scripts/serve.sh` + `curl -N 'http://127.0.0.1:8770/api/events/stream'` in one terminal and `curl -X POST /api/missions -d '{"goal":"Test","driver":"scripted"}'` in another shows the live event flow (verify manually once).

---

### Task 13: Frontend state — types, reducer, SSE client, store

**Files:**
- Create: `frontend/src/state/types.ts`, `reducer.ts`, `store.ts`, `selectors.ts`, `frontend/src/lib/sse.ts`, `frontend/src/lib/api.ts`
- Test: `frontend/src/state/reducer.test.ts`, `frontend/src/lib/sse.test.ts`

**BINDING types:**

```ts
export type ProcState = 'queued'|'spawning'|'running'|'waiting_tool'|'done'|'failed'|'killed';
export type Driver = 'claude'|'ollama'|'scripted';
export type Mode = 'idle'|Driver|'replay';
export interface Usage { turns: number; input_tokens: number; output_tokens: number; cost_usd_equiv: number|null }
export interface Budget { max_turns: number; max_seconds: number; max_output_tokens: number }
export interface HEvent { seq: number; ts: number; run_id: string|null; pid: number|null; kind: string; data: Record<string, unknown> }
export type TranscriptItem =
  | { t: 'text'; text: string }
  | { t: 'thinking'; on: boolean }
  | { t: 'tool'; callId: string; tool: string; input: string; output?: string; ok?: boolean; ms?: number; sys: boolean };
export interface Proc {
  pid: number; runId: string; ppid: number|null; program: string; role: string; driver: Driver; model: string;
  task: string; state: ProcState; budget: Budget; usage: Usage; startedAt: number|null; exitedAt: number|null;
  exitReason: string|null; thinking: boolean; budgetPct: number; transcript: TranscriptItem[];
}
export interface Run { id: string; goal: string; driver: Driver; state: 'running'|'done'|'failed'; createdAt: number; doneAt: number|null; artifacts: string[]; usage: Usage }
export interface Pulse { id: string; from: number; to: number|'munin'; kind: 'msg'|'munin'|'spawn'; at: number }
export interface LogLine { seq: number; ts: number; kind: string; pid: number|null; text: string }
export interface Meters { activeProcs: number; tokensPerMin: number; budgetPct: number; totalTokens: number }
export interface State {
  lastSeq: number; runs: Record<string, Run>; procs: Record<number, Proc>; log: LogLine[];
  pulses: Pulse[]; meters: Meters; munin: { writes: number; reads: number; lastAt: number|null };
  activeRunId: string|null;
}
export const initialState: State;
export function applyEvent(state: State, e: HEvent, opts?: { logRing?: number }): State;   // pure, returns new object; ignores e.seq <= state.lastSeq (idempotent)
export function applyEvents(state: State, events: HEvent[]): State;
export function logText(e: HEvent): string;   // German one-liner per kind, e.g. "Prozess 3 (scout) gestartet", "Speicher: »Titel«", "Budget überschritten: turns"
```

Reducer rules: `proc.text` appends to the last `text` transcript item or creates one (coalescing); `tool.call`/`sys.call` push a `tool` item (`sys` = kind starts with `sys.`); `tool.result`/`sys.result` fill the matching `callId`; `msg.sent` → pulse `msg`; `munin.write` → pulse to `'munin'` + counter; `proc.spawned` with `ppid` → pulse `spawn` from ppid; pulses older than 1 200 ms are pruned on every apply (using `e.ts` — replay-safe); `budget.tick` → `budgetPct`; `proc.exit` merges usage; meters: `tokensPerMin` = output tokens from `usage`-bearing events in the last 60 s of event time; `log` is a ring buffer of `logRing` (default 5 000) — `proc.text`/`budget.tick` are **not** logged; `run.created` sets `activeRunId` if none active or the previous is finished.

`sse.ts`: `connectEvents({runId?, since, onBatch: (events: HEvent[]) => void, onStatus: (s: 'open'|'closed'|'error') => void}) => () => void`; uses `EventSource` with `?since=`; batches messages per `requestAnimationFrame` (fallback `setTimeout 16`) and calls `onBatch` once per frame; on error reconnects after 1 s with the last seen seq. Test with a fake `EventSource` class injected via a parameter (`{ EventSourceImpl }`).

`store.ts`: zustand store `{ state: State; mode: Mode; replay: {runId: string|null; playing: boolean; speed: 1|2|4|8; cursorSeq: number; events: HEvent[]} ; system: SystemStatus|null; dispatch(events: HEvent[]); setMode; ... }` — `mode` derived: `replay.runId ? 'replay' : (active run ? run.driver : 'idle')` via selector `selectMode`.

Tests (≥ 12 cases): idempotency on duplicate seq; proc lifecycle builds `Proc`; text coalescing; tool call/result pairing; pulses created and pruned; ring buffer bound; `logText` for 6 kinds; meters; `selectMode` for each mode; sse batching (3 messages in one frame → one `onBatch` with 3 events; reconnect uses last seq).

- [ ] Steps → `git commit -m "feat(frontend): add event reducer, SSE client and store"`

---

### Task 14: Shell layout — TopBar, ModeChip, meters, ProcessTable, KernelLog, MissionBar

**Files:**
- Create: `frontend/src/features/shell/Layout.tsx`, `TopBar.tsx`, `ModeChip.tsx`, `MissionBar.tsx`, `frontend/src/features/procs/ProcessTable.tsx`, `frontend/src/features/log/KernelLog.tsx`
- Modify: `frontend/src/App.tsx` (wire store + SSE + layout; center column placeholder "Graph" until Task 15)
- Test: `frontend/src/features/shell/shell.test.tsx`, `frontend/src/features/procs/ProcessTable.test.tsx`

Layout: CSS grid `grid-rows-[48px_1fr_40px]`, middle row `grid-cols-[320px_1fr_360px]` (collapses to stacked below 1100 px). TopBar: wordmark `hugin` (font-display, letter-spacing) + tagline muted "Gedanken ausschicken. Wissen zurückholen." · ModeChip (`MODE_LABEL[mode]`, tone: idle muted, claude violet, ollama amber, scripted cyan, replay rose; pulse when not idle) · meters `Aktive Prozesse`, `Tokens/min`, `Budget` (Meter components) · `⌘K` Kbd hint · red ghost button "Panik" → confirm popover ("Alle Prozesse beenden?") → `POST /api/kill-all`. ProcessTable: rows sorted by pid; columns `PID · Programm · Status(StateRing + STATE_LABEL) · Runden · Tokens · Zeit · ⏻`; row click → `selectPid` in store; live elapsed uses a 1 s interval **only in live mode** (replay uses event ts). KernelLog: `Virtuoso` with `followOutput="smooth"`, mono 12 px, kind→colour (proc.* violet, sys.*/tool.* cyan, munin.* green, budget.*/kill amber/red, run.* text), each line `HH:MM:SS  [pid]  text`. MissionBar: active run goal (ellipsis), elapsed, state chip; when idle shows "Keine aktive Mission — ⌘K".

Tests: ModeChip renders each label/tone; ProcessTable renders rows from a State with two procs and shows German state labels; Panik confirm calls the injected `onKillAll`; KernelLog renders given lines (mock Virtuoso to a plain list in tests via `vi.mock('react-virtuoso')`).

- [ ] Steps → `git commit -m "feat(frontend): add mission control layout with process table, kernel log and top bar"`

**Acceptance:** with the backend running and a scripted mission posted via curl, the table and log update live in the browser (verify once).

---

### Task 15: Live agent graph (xyflow + dagre) with pulses

**Files:**
- Create: `frontend/src/features/graph/layout.ts`, `AgentGraph.tsx`, `AgentNode.tsx`, `MuninNode.tsx`, `PulseEdge.tsx`
- Modify: `frontend/src/App.tsx` (center column)
- Test: `frontend/src/features/graph/layout.test.ts`

**BINDING `layout.ts`:**

```ts
export interface GNode { id: string; kind: 'proc'|'munin'; pid?: number; x: number; y: number }
export interface GEdge { id: string; source: string; target: string; kind: 'tree'|'munin' }
export function buildGraph(state: State, runId: string|null): { nodes: GNode[]; edges: GEdge[] }
// nodes: one per proc of the run (id `p<pid>`), plus `munin` hub if any proc has munin capability activity or always when ≥1 proc; tree edges ppid→pid; a `munin` edge from each proc that wrote to munin at least once (from state.pulses history counter per pid — add `muninWrites: number` to Proc in types.ts if missing)
// positions via dagre (rankdir 'TB', nodesep 40, ranksep 90); the munin hub is placed to the right of the widest rank at the middle height
```

`AgentGraph`: `ReactFlow` with `nodeTypes {proc: AgentNode, munin: MuninNode}`, `edgeTypes {pulse: PulseEdge}`, `fitView` on node-count change (animated 400 ms), `panOnScroll`, no minimap, controls hidden, background `BackgroundVariant.Dots` gap 24 low-opacity. Node position changes animate through CSS `transition: transform 400ms var(--ease-out-expo)` on `.react-flow__node`. `AgentNode`: 180×64 card — role icon (lucide by `program.icon` map: compass/telescope/hammer/scale/pen-line), `program` (mono) + `ROLE_LABEL`, `StateRing`, `pid`, a 3 px context-fill bar (`usage.input_tokens / 200000`), glow (`box-shadow 0 0 24px <accent>40`) only while `running`/`waiting_tool`; `motion` `initial={{scale:0.6, opacity:0}} animate={{scale:1, opacity:1}}` spring on mount (the "bloom"). `MuninNode`: circular hub "munin" with counter of writes; flashes (scale 1→1.15→1, 600 ms) when `munin.writes` increments. `PulseEdge`: `BaseEdge` (smoothstep) + for every active `Pulse` whose from/to match this edge an SVG `<circle r=3>` travelling via `<animateMotion dur="0.8s" path=…>` (uses the edge path), colour by pulse kind (msg violet, munin green, spawn cyan); tree edges 1 px `--color-border`, brighter while either end is alive.

Tests: `buildGraph` for a state with planner(1) → scout(2,3), judge(4): 5 nodes (incl. munin), 3 tree edges, positions distinct, ranks increase with depth; empty state → no nodes.

- [ ] Steps → `git commit -m "feat(frontend): add live agent graph with dagre layout, blooming nodes and message pulses"`

**Acceptance:** scripted mission in the browser: nodes bloom as processes spawn, particles travel on `msg.sent`/`munin.write`, hub flashes (verify once, note fps subjectively smooth).

---

### Task 16: Command palette (⌘K) + mission start

**Files:**
- Create: `frontend/src/features/palette/commands.ts`, `CommandPalette.tsx`
- Modify: `frontend/src/App.tsx` (global `⌘K`/`Ctrl+K` hotkey, Esc closes), `frontend/src/lib/api.ts` (`postMission`, `getTemplates`, `getPrograms`, `killAll`, `getRuns`)
- Test: `frontend/src/features/palette/commands.test.ts`

**BINDING `commands.ts`:**

```ts
export interface Command { id: string; group: 'Mission'|'Prozesse'|'Runs'|'Munin'; label: string; hint?: string; disabled?: string; run: () => void|Promise<void> }
export function buildCommands(ctx: {
  templates: {id: string; title: string; goal: string}[]; runs: Run[]; system: SystemStatus|null;
  driver: Driver; actions: { startMission(goal: string, driver: Driver): Promise<void>; killAll(): Promise<void>; openRun(id: string): void; openMunin(q: string): void }
}): Command[]
// includes: one "Mission starten: <template.title>" per template; "Alle Prozesse beenden"; one "Run öffnen: <goal>" per run (latest 8); "Munin durchsuchen…"
// disabled reason strings (German) when system says a driver is unavailable, e.g. "Claude nicht angemeldet", "Ollama nicht erreichbar"
```

`CommandPalette`: `cmdk` dialog (motion: scale .98→1 + fade, 150 ms), input placeholder "Was soll hugin tun?", free text → a synthetic top command "Mission starten: »<text>«"; a driver segmented control (`DRIVER_LABEL`, default `scripted`, disabled entries show the reason on hover), groups rendered with `cmdk` `Group` headings. `SystemStatus` type (defined here, used by Task 21): `{ claude: {ok: boolean; version: string|null; detail: string}; ollama: {ok: boolean; models: string[]; detail: string}; munin: {count: number}; programs: string[]; kernel: {uptime_s: number; procs: number; version: string} }`. Until `/api/system` exists (Task 21) `system` is `null` → all drivers enabled.

Tests: `buildCommands` yields template commands + kill-all + run commands; disabled reason when `system.claude.ok === false`.

- [ ] Steps → `git commit -m "feat(frontend): add command palette with mission templates and driver picker"`

**Acceptance (Milestone 2 gate, spec §8.2):** ⌘K → Simulation mission → within 20 s: planner + 3 scouts + judge visible, pulses travel, munin flashes, artifact listed in run, run `done`. Orchestrator verifies in a browser (screenshots) before Milestone 3 starts.

---

# Milestone 3 — Real drivers

### Task 17: stream-json parser

**Files:**
- Create: `src/hugin/drivers/stream_json.py`
- Test: `tests/drivers/test_stream_json.py` (uses `tests/fixtures/stream_json/haiku_ok_isolated.jsonl` — real captured output — and inline synthetic lines)

**BINDING:**

```python
OpKind = Literal["init", "text", "thinking_delta", "block_start", "block_stop", "assistant_text",
                 "tool_call", "tool_result", "usage", "result", "ignore"]

@dataclass
class Op:      # what the driver will forward to the sink; the parser is STATELESS (one line in, ops out)
    kind: OpKind
    data: dict

def parse_line(line: str) -> list[Op]
# system/init → Op("init", {"session_id", "model", "api_key_source": e["apiKeySource"], "tools": [...]})
# stream_event content_block_start → Op("block_start", {"index", "block_type": content_block.type})   # "text" | "thinking" | "tool_use"
# stream_event content_block_delta text_delta → Op("text", {"delta"}); thinking_delta → Op("thinking_delta", {"delta"}); input_json_delta → Op("ignore", {"type": "input_json_delta"})
# stream_event content_block_stop → Op("block_stop", {"index"})
#   (the DRIVER tracks which index is a thinking block and calls sink.thinking(True) on its start and sink.thinking(False) on its stop)
# assistant → per content block: tool_use → Op("tool_call", {"call_id": id, "tool": name, "input_summary": json.dumps(input)[:200]}); text → Op("assistant_text", {"text"}) (the driver ignores these when partial messages are streamed, to avoid double text); plus message.usage → Op("usage", {"input_tokens", "output_tokens", "cache_read", "cache_creation"})
# user → tool_result blocks → Op("tool_result", {"call_id": tool_use_id, "ok": not is_error, "output_summary": str(content)[:300]})
# result → Op("result", {"subtype", "is_error", "num_turns", "duration_ms", "total_cost_usd", "usage": {...}, "text": result})
# rate_limit_event / system status / system api_retry / message_start / message_delta / message_stop → Op("ignore", {"type": ...})
# malformed JSON → Op("ignore", {"raw": line[:200]})
```

Tests: fixture parses without error and yields exactly one `init` (with `api_key_source == "none"`), one `result` (`is_error False`, `num_turns 1`, `total_cost_usd > 0`), ≥ 1 `usage`; synthetic tool_use/tool_result pair round-trips ids; malformed line → ignore; thinking start/stop sequence.

- [ ] Steps → `git commit -m "feat(drivers): add stream-json parser for Claude Code headless output"`

---

### Task 18: ClaudeCodeDriver — command/env builders, isolated config dir, subprocess runner

**Files:**
- Create: `src/hugin/drivers/claude_code.py`
- Test: `tests/drivers/test_claude_code.py`

**BINDING:**

```python
def build_command(*, claude_bin: str, prompt: str, system_prompt: str, model: str, tools: list[str],
                  max_turns: int, mcp_url: str, mcp_token: str) -> list[str]
# exact argv:
# [claude_bin, "-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
#  "--no-session-persistence", "--permission-mode", "dontAsk", "--permission-prompts", "none",
#  "--tools", ",".join(tools) if tools else "", "--allowedTools", ",".join(tools) if tools else "",
#  "--strict-mcp-config", "--mcp-config", json.dumps({"mcpServers": {"hugin": {"type": "http", "url": mcp_url, "headers": {"Authorization": f"Bearer {mcp_token}"}}}}),
#  "--settings", json.dumps({"disableAllHooks": True}), "--max-turns", str(max_turns), "--model", model,
#  "--append-system-prompt", system_prompt]

def build_env(base_env: Mapping[str, str], config_dir: Path) -> dict[str, str]
# only PATH, HOME, LANG (if present) copied; plus CLAUDE_CONFIG_DIR=str(config_dir); never ANTHROPIC_API_KEY

def ensure_config_dir(config_dir: Path, home: Path) -> None
# mkdir -p; write settings.json {"disableAllHooks": true} if missing; symlink .credentials.json -> home/.claude/.credentials.json and .claude.json -> home/.claude.json (skip silently if target missing; replace broken symlinks)

class ClaudeCodeDriver:
    name = "claude"
    def __init__(self, settings: Settings, mcp_url: str, token_for: Callable[[int], str],
                 system_prompt_for: Callable[[int], str], spawn=asyncio.create_subprocess_exec, home: Path | None = None): ...
    async def run(self, proc, prompt, sink) -> ExitInfo
    async def kill(self, proc) -> None
    def preflight(self, env: Mapping[str, str]) -> None   # raises RuntimeError if "ANTHROPIC_API_KEY" in env (spec §1.1)
```

`run`: `ensure_config_dir`; `preflight(os.environ)`; start subprocess with `cwd=proc.cwd`, `stdin=DEVNULL`, `stdout=PIPE`, `stderr=PIPE`, env from `build_env`; read stdout line by line → `parse_line` → forward: `text`→`sink.text`, `thinking(on/off)`→`sink.thinking`, `tool_call`→`sink.state("waiting_tool")`+`sink.tool_call`, `tool_result`→`sink.tool_result`+`sink.state("running")`, `usage`→ accumulate turns (+1 per assistant message with usage) and tokens → `sink.usage(Usage(...))`, `init` → if `api_key_source != "none"` → kill process and return `ExitInfo("failed", stderr_tail="refusing: API key billing detected")`; `result` → final usage (from `result.usage` + `total_cost_usd` as `cost_usd_equiv`, `num_turns`), reason `done` if not `is_error` else `failed`. Non-zero exit without result → `driver_error` with the last 500 chars of stderr. `kill`: `terminate()`, wait 3 s, `kill()`.

Tests with a fake subprocess (an object with `stdout` async iterator over fixture lines, `stderr` empty, `returncode 0`, `wait()`, `terminate()`, `kill()` flags): `build_command` equals the exact argv above for given inputs; `build_env` drops `ANTHROPIC_API_KEY` and unrelated vars; `ensure_config_dir` in `tmp_path` creates settings + symlinks pointing to the fake home files; run over the fixture yields sink calls in order and `ExitInfo.reason == "done"` with `usage.turns == 1`, `cost_usd_equiv > 0`; an init with `apiKeySource: "ANTHROPIC_API_KEY"` → `failed` and `terminate()` called; `preflight` raises when the key is set.

- [ ] Steps → `git commit -m "feat(drivers): add Claude Code headless driver with isolated config dir and API-key guard"`

**Acceptance:** unit tests only here; the live run happens in Task 28 under orchestrator supervision.

---

### Task 19: MCP syscall transport at /mcp (bearer → pid)

**Files:**
- Create: `src/hugin/syscalls/mcp_server.py`
- Modify: `src/hugin/app.py` (mount), `src/hugin/kernel/kernel.py` (`token_for(pid)`, `pid_for(token)` — random 32-hex per process at spawn, stored on the process as `proc.token`; add field to `AgentProcess`)
- Test: `tests/syscalls/test_mcp_server.py`

Implementation with the official `mcp` package: build a low-level `mcp.server.Server("hugin")` (or `FastMCP` if it allows per-request header access — check the installed version's API first: `uv run python -c "import mcp, inspect; print(mcp.__version__)"` and read `mcp/server/streamable_http_manager.py` + `mcp/server/fastmcp/server.py` in `.venv` for how to obtain the current HTTP request/headers inside `list_tools`/`call_tool`). Expose `list_tools` = `registry.tool_schemas(pid)` and `call_tool(name, args)` = `registry.call(pid, name, args)` where `pid` is resolved from the `Authorization: Bearer <token>` header of the current request (401-equivalent MCP error if missing/unknown). Mount the Streamable HTTP ASGI app at `/mcp` (stateless mode, `json_response=True`).

Integration test: start `uvicorn` for the app on a free port in a background thread (fixture), then use `mcp.client.streamable_http.streamablehttp_client(url, headers={"Authorization": f"Bearer {token}"})` + `ClientSession` to `list_tools()` (scout token → 3 tools: `munin_search`, `munin_write`, `mission_report`; planner token → 6) and `call_tool("munin_write", {...})` → store count increments and a `sys.call` event exists; wrong token → error. If header access proves impossible within 2 hours of trying, implement the spec's fallback (`stdio_bridge.py` + `POST /internal/syscall` with the token in the JSON body; `build_command` switches to a `"type": "stdio"` mcp-config) and document the decision in `docs/adr/0001-mcp-transport.md`.

- [ ] Steps → `git commit -m "feat(syscalls): expose kernel syscalls as MCP tools over HTTP with per-process tokens"`

---

### Task 20: OllamaDriver (tool-calling loop)

**Files:**
- Create: `src/hugin/drivers/ollama.py`
- Test: `tests/drivers/test_ollama.py`

**BINDING:**

```python
def to_ollama_tools(schemas: list[dict]) -> list[dict]   # [{"type":"function","function":{"name","description","parameters"}}]

class OllamaDriver:
    name = "ollama"
    def __init__(self, settings: Settings, registry_tools_for: Callable[[int], list[dict]], system_prompt_for: Callable[[int], str], client: httpx.AsyncClient | None = None): ...
    async def run(self, proc, prompt, sink) -> ExitInfo
    async def kill(self, proc) -> None      # sets a cancel flag; the loop checks between chunks
    async def available(self) -> tuple[bool, list[str], str]   # GET /api/tags → (ok, model names, detail)
```

Loop: messages `[system, user]`; for turn in range(max_turns): `POST {ollama_url}/api/chat` `{model, messages, tools, stream: true, options: {"num_predict": remaining_output_tokens}}`; parse NDJSON chunks: `message.content` deltas → `sink.text`; accumulate `message.tool_calls`; final chunk (`done: true`) carries `prompt_eval_count`/`eval_count` → `sink.usage` (turns=turn+1, cumulative tokens); if tool_calls: for each → `sink.state("waiting_tool")`, `result = await sink.syscall(name, args)` (SyscallError → tool message with `{"error": str}`), append `{"role":"tool","content": json.dumps(result)}`, `sink.state("running")`, continue; else break → `ExitInfo("done")`. HTTP error / connect error → `driver_error`.

Tests with `httpx.MockTransport` scripted responses (NDJSON bodies): text-only reply → one turn, text forwarded, usage tokens from counts; a tool call → `sink.syscall` invoked with parsed args, second request contains the tool message, exit `done` after 2 turns; connection error → `driver_error`; `to_ollama_tools` shape; `available()` parses `/api/tags`.

- [ ] Steps → `git commit -m "feat(drivers): add Ollama tool-calling driver"`

---

### Task 21: System status (`/api/system`) + driver gating

**Files:**
- Create: `src/hugin/system/__init__.py`, `src/hugin/system/status.py`, `src/hugin/api/routes_system.py` (extend)
- Modify: `src/hugin/missions/service.py` (409 when driver unavailable), `src/hugin/app.py` (wire real drivers: scripted, claude, ollama)
- Test: `tests/system/test_status.py`, `tests/api/test_system.py`

**BINDING JSON (matches frontend `SystemStatus`):**

```
GET /api/system → {
  claude: {ok: bool, version: str|null, detail: str},   # ok = `claude --version` succeeds (seam: run_cmd) AND ~/.claude/.credentials.json exists AND no ANTHROPIC_API_KEY in env; detail German e.g. "Abo-Login erkannt" / "Nicht angemeldet" / "API-Key gesetzt — blockiert"
  ollama: {ok: bool, models: [str], detail: str},        # via OllamaDriver.available(); detail e.g. "4 Modelle" / "Nicht erreichbar"
  munin: {count: int},
  programs: [str],
  kernel: {uptime_s: float, procs: int, version: str}
}
```

`status.py`: `SystemStatusService(settings, munin, kernel, ollama_driver, run_cmd=asyncio subprocess seam, env=os.environ, home=Path.home())` with `async snapshot() -> dict`, cached 10 s. Mission creation: `driver == "claude"` requires `claude.ok`, `"ollama"` requires `ollama.ok`, else `HTTPException(409, detail=<German reason>)`. Emit `kernel.subsystem` events at boot for each subsystem.

Tests: fake `run_cmd` returning "2.1.261 (Claude Code)"; fake home with/without credentials; env with key → `ok False` + detail contains "API-Key"; Ollama via MockTransport; 409 path on `POST /api/missions` with `driver: "claude"` when not ok.

- [ ] Steps → `git commit -m "feat(system): add subsystem status endpoint and honest driver gating"`

**Acceptance:** on this machine `/api/system` reports `claude.ok true` and `ollama.ok true` with 4 models (verify once with the server running).

---

# Milestone 4 — Agent window, Munin browser, Replay, Boot

### Task 22: Agent window (layoutId morph, streaming transcript, tool cards)

**Files:**
- Create: `frontend/src/features/agent/AgentWindow.tsx`, `ToolCallCard.tsx`
- Modify: `frontend/src/features/graph/AgentNode.tsx` (`layoutId={`proc-${pid}`}` on the card), `frontend/src/App.tsx` (right-hand sheet replaces the log column while a pid is selected; Esc/close returns)
- Test: `frontend/src/features/agent/AgentWindow.test.tsx`

Behaviour: header (icon, `program`, `ROLE_LABEL`, pid mono, StateRing + `STATE_LABEL`, model, driver chip), meters row (`Runden x/max`, `Tokens out x/max`, `Zeit m:ss/max`, `Kontext %`), transcript (Virtuoso, follow output): text items render as prose with a blinking block cursor on the last item while `running`; `thinking` shows a subtle "denkt…" shimmer; `ToolCallCard` collapsed = `[sys|tool] name · ms · ok/✗`, expanded (click) = input (mono, wrapped) → output; kill button "Prozess beenden" (disabled when not alive); footer shows `exitReason` German-mapped (`budget:turns` → "Budget: Runden überschritten"). The morph: `motion.div layoutId="proc-<pid>"` on both the node card and the sheet header block; `AnimatePresence` for enter/exit (280 ms).

Tests: renders transcript items and a tool card that expands on click; kill button disabled for a `done` proc; German exit reason mapping.

- [ ] Steps → `git commit -m "feat(frontend): add agent window with streaming transcript and tool-call cards"`

---

### Task 23: Munin browser view

**Files:**
- Create: `frontend/src/features/munin/MuninBrowser.tsx`
- Modify: `frontend/src/features/shell/TopBar.tsx` (view tabs: `Mission Control · Munin · Runs`), `frontend/src/App.tsx` (view routing via store `view: 'control'|'munin'|'runs'`)
- Test: `frontend/src/features/munin/MuninBrowser.test.tsx`

Behaviour: search input (debounced 250 ms → `/api/munin/search`), empty query shows `/api/munin/recent`; results list (title, tags as muted chips, program + pid, relative time); detail pane with body (pre-wrap) and provenance line "Geschrieben von scout · PID 3 · Run <id> · <Datum>"; the palette's "Munin durchsuchen…" opens this view with the query prefilled. Empty state: "Munin ist noch leer — starte eine Mission."

Tests: renders results from a mocked fetch; empty state text.

- [ ] Steps → `git commit -m "feat(frontend): add munin memory browser"`

---

### Task 24: Replay backend — Player, Recorder (scrub), recordings routes

**Files:**
- Create: `src/hugin/replay/__init__.py`, `player.py`, `recorder.py`, `src/hugin/api/routes_recordings.py`
- Modify: `src/hugin/api/routes_events.py` (add `GET /api/runs/{id}/replay/stream?speed=&from_seq=`), `app.py`
- Test: `tests/replay/test_player.py`, `tests/replay/test_recorder.py`, `tests/api/test_replay.py`

**BINDING:**

```python
class Player:
    def __init__(self, log: EventLog, sleep=asyncio.sleep, max_gap_s: float = 3.0): ...
    async def stream(self, run_id: str, speed: float = 1.0, from_seq: int = 0) -> AsyncIterator[Event]
    # yields events of the run with seq > from_seq; waits min((ts_i - ts_{i-1}) / speed, max_gap_s) between them; speed ∈ {1,2,4,8} validated by the route (422 otherwise)

SECRET_PATTERNS = [r"sk-ant-[A-Za-z0-9_-]{10,}", r"AKIA[0-9A-Z]{16}", r"ghp_[A-Za-z0-9]{20,}", r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"]

def scrub(events: list[Event], *, repo_root: Path, home: Path) -> list[Event]
# replaces str(repo_root) with "/home/user/hugin" and str(home) with "/home/user" everywhere inside data (recursively in strings); raises ScrubError if any SECRET_PATTERN matches after replacement

class Recorder:
    def __init__(self, log: EventLog, recordings_dir: Path, repo_root: Path, home: Path): ...
    def export(self, run_id: str, slug: str) -> Path      # writes <recordings_dir>/<slug>.jsonl (one Event JSON per line, seq renumbered from 1, ts kept) + <slug>.json manifest {slug, run_id, goal, driver, events, duration_s, exported_at}
    def list(self) -> list[dict]                            # manifests
    def load(self, slug: str) -> list[Event]
```

Routes: `POST /api/recordings/{run_id}` body `{slug}` → manifest (400 on ScrubError with the pattern name); `GET /api/recordings` → manifests; `GET /api/recordings/{slug}/replay/stream?speed=` → SSE from the file (same Player logic over a list — refactor `Player.stream_events(events, speed, from_seq)` and use it for both). Also a CLI `scripts/record_demo.py <run_id> <slug>` calling the Recorder.

Tests: fake sleep collects delays: gaps 1 s,10 s at speed 2 → `[0.5, 3.0]` (cap); `from_seq` skips; scrub rewrites paths and raises on a fake `sk-ant-…` token; export writes jsonl + manifest and `load` round-trips; route 422 for speed 3; SSE from a recording delivers the first event.

- [ ] Steps → `git commit -m "feat(replay): add time-scaled player, scrubbing recorder and recordings API"`

---

### Task 25: Runs & Replay view + timeline scrubber (REPLAY mode)

**Files:**
- Create: `frontend/src/features/replay/RunsView.tsx`, `Timeline.tsx`, `replayMath.ts`
- Modify: `frontend/src/state/store.ts` (replay slice actions: `enterReplay(runId|recordingSlug, events)`, `seek(seq)`, `play/pause`, `setSpeed`, `step(±1)`, `exitReplay`), `frontend/src/App.tsx`, `frontend/src/lib/api.ts` (`getRunEvents`, `getRecordings`, `getRecordingEvents` — add `GET /api/recordings/{slug}/events` to the backend in this task, returning the list)
- Test: `frontend/src/features/replay/replayMath.test.ts`, `frontend/src/state/replay.test.ts`

**BINDING `replayMath.ts`:**

```ts
export function stateAt(events: HEvent[], cursorSeq: number): State      // applyEvents(initialState, events.filter(e => e.seq <= cursorSeq))
export function seqAtFraction(events: HEvent[], f: number): number       // f∈[0,1] over time (ts), not index
export function fractionOfSeq(events: HEvent[], seq: number): number
export function nextTick(events: HEvent[], cursorSeq: number, speed: number, maxGapMs = 3000): { seq: number; delayMs: number } | null
```

Replay in the store is **client-side**: entering replay loads all events of the run/recording once, then `play` schedules `nextTick` with `setTimeout`, updating `cursorSeq`; the visible `State` is `stateAt(events, cursorSeq)` (memoised: keep the last cursor's state and only re-apply incrementally when moving forward; recompute from scratch when moving backward). While in replay, live SSE batches are buffered, not applied; `exitReplay` re-applies them.

`RunsView`: list of past runs (goal, driver chip, state, date, usage tokens, artifacts count) + section "Demo-Aufnahmen" (recordings) — each row has "Replay" → enters replay and switches to Mission Control with the `Timeline` docked at the bottom (replaces MissionBar): ▶/⏸, speed segmented 1×/2×/4×/8×, a scrubber (range input styled; markers for `proc.spawned` and `artifact.written`), time `mm:ss / mm:ss`, `←/→` step, `Esc` exits replay. ModeChip shows `REPLAY` (rose).

Tests: `seqAtFraction`/`fractionOfSeq` round-trip on uneven timestamps; `nextTick` cap; store: enter → mode replay; seek backwards recomputes; live batch buffered during replay and applied on exit.

- [ ] Steps → `git commit -m "feat(frontend): add runs view and replay timeline with client-side scrubbing"`

**Acceptance (spec §8.4):** open a finished simulation run → replay at 4× shows the same bloom; scrub back and forth works.

---

### Task 26: Boot sequence

**Files:**
- Create: `frontend/src/features/boot/BootScreen.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/lib/api.ts` (`getSystem`)
- Test: `frontend/src/features/boot/BootScreen.test.tsx`

Behaviour: on first load per browser session (`sessionStorage['hugin.booted']` absent) render a full-screen overlay: left-aligned mono log where lines appear every ~140 ms, built from the **real** `/api/system` response — `"hugin kernel 0.1.0"`, `"claude … 2.1.261 · Abo-Login ✓"` or `"claude … nicht angemeldet ⚠"` (amber), `"ollama … 4 Modelle ✓"`, `"munin … 128 Einträge"`, `"programs … planner scout smith judge scribe"`, `"shell … bereit"`; then the wordmark `hugin` assembles letter by letter (motion stagger 40 ms) with the tagline; overlay lifts (opacity+scale 1.02, 400 ms). Total ≤ 2.5 s; `Esc` or click skips; `prefers-reduced-motion` → overlay shows for 300 ms without animation. If `/api/system` fails → lines show `"api … nicht erreichbar ✗"` in red and the overlay still lifts. A "Boot erneut abspielen" command in the palette clears the flag and reloads.

Tests: renders lines from a given status object; calls `onDone` after the sequence (use fake timers); skip on Escape.

- [ ] Steps → `git commit -m "feat(frontend): add boot sequence with real subsystem checks"`

---

# Milestone 5 — Polish, recordings, docs, sweep

### Task 27: Motion & performance polish pass

**Files:**
- Modify: graph, table, log, top bar, sheet components as needed; `frontend/src/styles/globals.css`
- Create: `src/hugin/drivers/scripts/stress.json` (a scripted program emitting ~100 `text` ops/s for 20 s with 6 workers) and `tests/kernel/test_stress_script.py` (loads and validates the script only)

Checklist (each item verified in the browser with the simulation and the stress script):
1. Node bloom spring (`type: 'spring', stiffness 260, damping 22`), no overshoot on the munin hub.
2. Pulses: exactly one particle per `msg.sent`/`munin.write`, 800 ms, fades out; never more than 60 particles on screen (drop oldest).
3. Meter values tick (motion `animate` on a numeric value, 400 ms) — only on real change.
4. Kernel log keeps 60 fps with the stress script (throttle text-heavy repaint: transcript updates batched per frame already; ensure `KernelLog` rows are memoised).
5. Glow only on alive nodes and the active mode chip; no static glow elsewhere.
6. Panic button: on click the whole graph desaturates briefly (`filter: saturate(.3)`, 300 ms) while kills propagate.
7. `prefers-reduced-motion`: no particles, no bloom (instant), no boot animation.
8. Focus rings visible on all interactive controls (keyboard demo).
9. Fonts self-hosted (network tab shows no external requests).
10. Bundle: `npm run build` warns about nothing > 700 kB gzipped total (report the number in the commit body).

- [ ] Steps: implement items → gate → `git commit -m "feat(frontend): motion and performance polish (bloom, pulses, ticks, reduced motion)"`

---

### Task 28: Live runs + demo recordings (orchestrator-supervised)

This task **spends subscription usage** (one Claude mission) and CPU time (one Ollama mission). The orchestrator (main session) runs it, not a worker.

- [ ] Start the server, boot the UI, `⌘K` → mission "Erstelle ein Recherche-Briefing zu: Stand der Technik bei Agent-Betriebssystemen 2026 (AIOS, Letta, Claude Agent SDK) — 5 Kernaussagen mit Quellen" with driver **Claude**. Watch init events: `api_key_source == "none"` (assert via `/api/runs/{id}/events`). Wait for `run.done`. Export: `POST /api/recordings/{run_id} {"slug": "claude-research-brief"}`.
- [ ] Same goal, driver **Ollama** (expect several minutes; the planner may fan out less — fine). Export as `ollama-research-brief`. If Ollama's planner fails to use tools correctly after two attempts, record a **direct** `scout` program run instead (`POST /api/procs` is not in scope — use a mission whose goal starts with `program:scout ` handled by `missions/service.py`: spawn that program as root; add this small feature with a test) and document the limitation in README.
- [ ] Simulation run → export `simulation-research-brief`.
- [ ] Verify each `.jsonl` contains no `/home/<user>` path and no secret (`grep -c "/home/" demo/recordings/*.jsonl` → 0 apart from `/home/user`). Commit: `git commit -m "docs(demo): add three scrubbed demo recordings (claude, ollama, simulation)"`.

**Acceptance (spec §8.3):** all three recordings replay in the UI with the `REPLAY` chip.

---

### Task 29: README, GIF, PROJECT.md status, session doc

**Files:**
- Modify: `README.md`, `PROJECT.md` (§Status → v1 complete, §Open inputs), `PLAN.md` (check boxes), `AUTOPILOT_LOG.md`
- Create: `docs/media/demo.gif` (or `demo.webm` + PNG stills if GIF tooling is missing), `docs/sessions/2026-09-0X_<HHMM>_v1-build.md`

README sections: hero GIF; "Was ist hugin?" (German, 5 sentences, honest: what is real, what is simulated, what it costs — nothing extra); Architecture diagram (ASCII from spec §2); Quickstart (`uv sync`, `npm --prefix frontend ci && npm --prefix frontend run build`, `scripts/serve.sh`, open `http://127.0.0.1:8770`); Drivers table (Claude Abo / Ollama / Simulation) with requirements; Replay & recordings; Security model (spec §7 bullets); Development (gate); Status; Later; License. Capture the GIF with `playwright-cli` (skill available to the orchestrator) recording a 30 s simulation + replay; convert with `ffmpeg` if present (`ffmpeg -i demo.webm -vf "fps=15,scale=1200:-1" demo.gif`), else keep webm + 3 PNG stills.

- [ ] Steps → `git commit -m "docs: v1 README with demo, architecture, security model and status"`

---

### Task 30: Privacy & security sweep before any visibility change

- [ ] `git grep -nE "user|/home/[a-z]+/" -- . ':!*.lock'` → only `/home/user/…` in recordings allowed; fix anything else.
- [ ] `git grep -niE "sk-ant-|api[_-]?key\s*[:=]" -- .` → none except the guard code/tests with obviously fake values.
- [ ] Confirm `.gitignore` covers `data/ runs/ .hugin/ .env frontend/node_modules frontend/dist`; `git status --ignored | head` sanity check.
- [ ] Run `uv run ruff check .`, full gate, and `npm --prefix frontend audit --omit=dev` (report, do not auto-fix).
- [ ] Write `docs/adr/0001-mcp-transport.md` (if not written in Task 19) and `docs/adr/0002-claude-headless-isolation.md` (why no `--bare`, why symlinked credentials; evidence from 2026-09-05 spike).
- [ ] Commit: `git commit -m "chore: privacy sweep and ADRs for v1"`.

**Acceptance (spec §8.8):** greps clean; ADRs present; gate green; PLAN.md all v1 boxes checked; "Needs Nico" lists: git remote decision, publish checklist, Windows shortcut (`msedge --app=http://127.0.0.1:8770`), optional Tailscale.

---

## Orchestrator notes (main session)

- Worker model: **Opus** for every implementation task; **Sonnet** for the spec-compliance + code-quality review after each task (subagent-driven-development two-stage review). The orchestrator runs the gate itself after each task and spot-reads risky diffs (Tasks 9, 11, 18, 19, 24).
- Milestone gates the orchestrator verifies in a browser (playwright-cli screenshots): after Task 16 (simulation end-to-end), after Task 25 (replay), after Task 27 (polish). Failures go back as a follow-up task, not silently fixed inline.
- Waves: tasks are sequential unless marked; independent pairs that may run in parallel (different files): (2,4), (3,5), (10,13), (17,22), (20,23), (24,26).
- Never let a worker run `claude -p` or call Ollama. Only Task 28, by the orchestrator.
