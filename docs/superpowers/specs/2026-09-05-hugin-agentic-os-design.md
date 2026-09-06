# hugin — Agentic OS · Design Spec (binding)

Date: 2026-09-05 · Status: approved for planning · Owner: Nico Sutheimer

> Hugin and Munin are Odin's ravens: every dawn he sends them out over the world and they
> return with knowledge. **hugin** ("thought") is the agent runtime; **munin** ("memory") is
> its memory subsystem. The system sends agents out, watches them work, and keeps what they
> bring back.

## 0 · One-paragraph summary

hugin is a locally running **agentic operating system**: a Python kernel that runs AI agents
as supervised *processes* (with PIDs, budgets, capabilities, a scheduler, IPC and a shared
memory), exposed through a futuristic, animated React "shell" (Mission Control) that shows
every agent, message, tool call and memory write **live** — and can **replay** any past run
frame by frame. Agents run on Claude Code headless (Nico's subscription, zero extra cost) or
on local Ollama (fully free), and a deterministic *Simulation* driver lets the whole system run
without any LLM (tests + offline demo). Purpose: a portfolio flagship that impresses in a
two-minute demo *and* is honest engineering underneath.

## 1 · Vision & non-negotiables

**Goal.** A viewer watches a mission start from the command palette, sees a planner agent
spawn workers (the graph blooms), sees messages pulse between agents, sees memory light up,
sees an artifact appear — and can scrub back through the whole run. Technical viewers see
real process supervision, budgets, kill switches, event sourcing and replay.

Non-negotiables:

1. **Zero extra cost.** Claude Code headless on the subscription (never with `ANTHROPIC_API_KEY`),
   Ollama local, nothing paid. Enforced: the kernel strips `ANTHROPIC_API_KEY` from every agent
   environment and refuses to spawn a `claude` driver if the key is present in its own env.
2. **Honesty in the UI.** A mode chip is always visible: `LIVE · CLAUDE`, `LIVE · OLLAMA`,
   `SIMULATION`, `REPLAY`. Simulated or replayed data is never shown unlabeled. Token/usage
   numbers come from the driver's real reports; the USD figure from Claude Code is shown as
   "API-Äquivalent", never as a bill. Failures are loud (red process state, kernel log line).
3. **Event-sourced.** Every state change is an immutable `Event` appended to a log. The UI is a
   pure projection of the event stream; live and replay feed the *same* reducer. Replay is
   therefore not a feature bolted on — it falls out of the architecture.
4. **Sandboxed agents.** Own working directory per process under `runs/`, tool whitelist per
   program, capability-gated kernel syscalls, isolated Claude config dir (no user hooks, no
   user MCP servers, no user CLAUDE.md), hard budgets (turns / seconds / output tokens), kill
   switch, no company paths (the company workspace is never mounted, never referenced).
5. **Single writer.** Only one process per run (the planner) may write the run's artifact.
   Workers report back via IPC. This is the cheapest known guard against the classic
   multi-agent failure "two agents write inconsistent halves".
6. **Local & private, publishable later.** No remote until Nico decides; the repo must never
   contain company data. `runs/`, `data/`, `.hugin/` are gitignored. Demo recordings that are
   committed pass a scrub step (paths, secrets) — see §7.
7. **UI copy German; code, identifiers, comments, commits, docs English.**

## 2 · Architecture

```
┌──────────────────────────── Browser (React 19 "shell") ────────────────────────────┐
│ Boot · Mission Control (process table · live graph · kernel log · meters) · Agent   │
│ window · Munin browser · Runs & Replay (timeline scrubber) · ⌘K palette             │
│                     ▲ SSE /api/events/stream  · REST /api/*                          │
└─────────────────────┼───────────────────────────────────────────────────────────────┘
┌─────────────────────┼──────────── FastAPI (port 8770) — src/hugin ──────────────────┐
│ api/  ──────────────┘                                                                │
│ kernel/   EventBus → EventLog (SQLite)  · ProcessTable · Scheduler · Budgets · Kill  │
│ drivers/  ScriptedDriver · ClaudeCodeDriver (claude -p stream-json) · OllamaDriver  │
│ syscalls/ capability-gated kernel calls, exposed to agents as MCP tools (HTTP /mcp)  │
│ munin/    memory store (SQLite FTS5) · programs/ (YAML agent definitions)            │
│ missions/ planner→workers→report lifecycle · replay/ recorder + time-scaled player   │
└───────┬──────────────────────────────┬───────────────────────────────────────────────┘
        │ subprocess per agent          │ HTTP /api/chat (stream, tools)
   claude -p … (isolated config dir)   Ollama (qwen2.5:7b)
   cwd = runs/<run>/p<pid>/
```

### 2.1 Kernel (`src/hugin/kernel/`)

- **Event** (`events.py`): `{seq:int, ts:float, run_id:str|None, pid:int|None, kind:str, data:dict}`.
  `seq` is a monotonically increasing integer assigned by the log; `ts` is wall-clock seconds.
  Kinds (closed list, validated):
  `kernel.boot`, `kernel.subsystem`, `run.created`, `run.done`, `run.failed`,
  `sched.queued`, `sched.started`, `sched.blocked`,
  `proc.spawned`, `proc.state`, `proc.text`, `proc.thinking`, `proc.exit`,
  `tool.call`, `tool.result`, `sys.call`, `sys.result`,
  `msg.sent`, `munin.write`, `munin.read`, `artifact.written`,
  `budget.tick`, `budget.exceeded`, `kill`.
  Payload schemas per kind live next to the enum as pydantic models; unknown kinds are rejected.
- **EventBus** (`bus.py`): in-process async pub/sub; `publish(event)` appends to the EventLog
  first (assigns `seq`), then fans out to subscribers (SSE clients, recorder, budget watcher).
- **EventLog** (`log.py`): SQLite table `events(seq INTEGER PK, ts REAL, run_id TEXT, pid INT,
  kind TEXT, data TEXT)` with index on `run_id`. Append-only. Queries: `since(seq)`,
  `for_run(run_id)`.
- **AgentProcess** (`process.py`): `pid, run_id, ppid, program, role, driver, model, state,
  cwd, capabilities:set[str], allowed_tools:list[str], budget, usage, started_at, exited_at,
  exit_reason`. States: `queued → spawning → running ⇄ waiting_tool → done | failed | killed`.
  Transitions are validated; every transition emits `proc.state`.
- **Budget** (`budget.py`): `max_turns, max_seconds, max_output_tokens`. Watcher subscribes to
  usage updates and time; on breach emits `budget.exceeded` and asks the kernel to kill the
  process with `exit_reason="budget:<which>"`.
- **Scheduler** (`scheduler.py`): FIFO queue with per-driver concurrency limits
  (`claude: 3, ollama: 1, scripted: 8`, settings-overridable). Emits `sched.*`.
- **Kernel** (`kernel.py`) façade used by API, missions and syscalls:
  `boot()`, `spawn(program, prompt, run_id, ppid=None, driver=None) -> pid`,
  `send(from_pid, to_pid, text)`, `kill(pid, by)`, `kill_all(by)`, `report_usage(pid, usage)`,
  `mailbox(pid) -> list[Message]`. `spawn` creates `runs/<run_id>/p<pid>/`, resolves the
  program's capabilities and tool whitelist, and hands the process to the scheduler.

### 2.2 Drivers (`src/hugin/drivers/`)

`AgentDriver` protocol: `async run(proc: AgentProcess, prompt: str, sink: EventSink) -> ExitInfo`
plus `async kill(proc)`. Drivers translate their world into kernel events via the `sink`
(`text(delta)`, `thinking(on)`, `tool_call(...)`, `tool_result(...)`, `usage(...)`).

- **ScriptedDriver**: executes a JSON script `[{"delay_ms", "op", ...}]` with ops `text`,
  `thinking`, `tool_call`, `tool_result`, `syscall` (executed *for real* through the kernel —
  a scripted planner really spawns scripted workers), `exit`. Used in tests and as the
  `SIMULATION` mode. Scripts live in `src/hugin/drivers/scripts/*.json`.
- **ClaudeCodeDriver**: spawns
  `claude -p <prompt> --output-format stream-json --verbose --include-partial-messages
   --no-session-persistence --permission-mode dontAsk --permission-prompts none
   --tools <whitelist> --allowedTools <whitelist> --strict-mcp-config --mcp-config <inline json>
   --settings '{"disableAllHooks":true}' --max-turns N --model <model>
   --append-system-prompt <program system prompt + kernel contract>`
  with `cwd=runs/<run>/p<pid>/`, `stdin=/dev/null`, env = minimal (`PATH`, `HOME`, `LANG`,
  `CLAUDE_CONFIG_DIR=<repo>/.hugin/claude-config`) and **no** `ANTHROPIC_API_KEY`.
  The isolated config dir is created on kernel boot: `settings.json`
  (`{"disableAllHooks": true}`) plus symlinks `.credentials.json → ~/.claude/.credentials.json`
  and `.claude.json → ~/.claude.json` so the subscription login is shared (verified 2026-09-05:
  `apiKeySource=none`, no plugins, no user MCP servers, ~6.4k instead of ~40k prompt tokens).
  `--bare` is **not** used: it rejects subscription login (verified: `terminal_reason=api_error`).
  The stream-json parser (`stream_json.py`) is a pure function `line -> list[SinkOp]` covering
  `system/init`, `stream_event` deltas (`text_delta`, `thinking_delta`, `input_json_delta`),
  `assistant` (tool_use blocks, per-turn `usage`), `user` (tool_result), `result`
  (`total_cost_usd`, `usage`, `num_turns`, `duration_ms`, `is_error`, `subtype`).
  Kill: `terminate()` then `kill()` after 3 s.
- **OllamaDriver**: tool-calling loop against `POST /api/chat` (`stream: true`, `tools` =
  the process's syscalls as JSON-schema functions). Each streamed chunk → `text` ops; each
  `tool_calls` entry → executed through the kernel syscall handlers in-process → tool result
  message appended → next turn, until no tool call or `max_turns`. Model default
  `qwen2.5:7b`. Honest note in UI: CPU-only, slow (measured on this machine ~5 tok/s output).

### 2.3 Syscalls (`src/hugin/syscalls/`)

Capability-gated kernel calls agents may make. Registry (`registry.py`) declares name,
JSON-schema, required capability and handler:

| syscall | capability | effect |
|---|---|---|
| `munin_search(query, limit)` | `munin.read` | FTS search; emits `munin.read` |
| `munin_write(title, body, tags)` | `munin.write` | stores memory with provenance (run, pid, program); emits `munin.write` |
| `proc_spawn(program, task, budget?)` | `proc.spawn` | child process (ppid=caller), max fan-out 4 per parent; emits `proc.spawned` |
| `proc_send(to_pid, text)` | `proc.send` | mailbox delivery, emits `msg.sent` |
| `proc_wait(pids, timeout_s)` | `proc.wait` | blocks caller until children exit; returns their final reports |
| `mission_report(summary)` | `report` | worker's final report to parent mailbox |
| `artifact_write(name, content)` | `artifact.write` | writes `runs/<run>/artifacts/<name>`; **single writer**: only the run's root process holds it |

Transport for Claude agents: the kernel mounts an MCP server (official `mcp` Python package,
Streamable HTTP) at `/mcp`. Each process gets a per-pid bearer token in its `--mcp-config`
(`{"mcpServers":{"hugin":{"type":"http","url":"http://127.0.0.1:8770/mcp","headers":{"Authorization":"Bearer <token>"}}}}`).
The handler resolves token → pid, checks capability, executes, emits `sys.call`/`sys.result`.
Fallback if header-based identity proves unworkable in the `mcp` package: a stdio bridge
`python -m hugin.syscalls.stdio_bridge --pid P --token T` forwarding to `POST /internal/syscall`.
For Ollama and Scripted drivers the same handlers are called in-process (no MCP).

### 2.4 Munin (`src/hugin/munin/`)

SQLite (same file as the event log, `data/hugin.db`) with FTS5 virtual table
`memories(id, title, body, tags, run_id, pid, program, created_at)`. API: `search(q, limit)`,
`write(...)`, `get(id)`, `count()`. No embeddings in v1 (YAGNI; FTS5 answers "what did we learn
about X" well enough for a demo; an `ollama` embedding lane is a documented Later item).

### 2.5 Programs (`src/hugin/programs/*.yaml`)

```yaml
name: scout            # executable name (⌘K lists programs like binaries)
role: Researcher       # UI label (German label via i18n map in frontend)
icon: telescope        # lucide icon name
accent: cyan           # violet | cyan | amber | green | rose
driver: claude         # default driver; a mission may override
model: sonnet          # claude alias passed to --model; ollama: qwen2.5:7b
tools: [WebSearch, WebFetch, Read]          # Claude Code built-ins (whitelist)
capabilities: [munin.read, munin.write, proc.send, report]
budget: {max_turns: 12, max_seconds: 300, max_output_tokens: 6000}
system_prompt: |
  You are a research worker inside hugin OS ...
```

v1 programs: `planner` (orchestrator: `proc.spawn`, `proc.wait`, `artifact.write`, munin r/w),
`scout` (research), `smith` (code/analysis, `Read, Glob, Grep, Bash(ls *), Bash(cat *)` in cwd),
`judge` (review/critique, read-only), `scribe` (writing/synthesis). The kernel contract
(appended to every system prompt) explains the syscalls, the single-writer rule and the
budget, in ≤ 40 lines.

### 2.6 Missions (`src/hugin/missions/`)

`POST /api/missions {goal, driver?, template?}` → `run_id`; the service creates the run,
spawns `planner` with the goal, and returns. Everything else emerges from the planner's
syscalls. Templates (`templates.py`) are pre-written goals for the palette:
"Recherche-Briefing zu …", "Vergleiche Optionen …", "Analysiere Repo-Pfad …" (path must be
inside `~/private`, validated). `run.done` fires when the root process exits; the run summary
includes total usage across processes and the artifact list.

### 2.7 Replay (`src/hugin/replay/`)

Every run is already a fully ordered event log. `Player.stream(run_id, speed, from_seq)`
re-emits stored events over SSE with inter-event delays divided by `speed` (1/2/4/8, capped so
a gap never exceeds 3 s) using an injectable clock (tests use a fake clock). `recorder.py`
exports a run to `demo/recordings/<slug>.jsonl` after scrubbing: absolute paths rewritten to
`/home/user/hugin/…`, anything matching secret patterns rejected (export fails loudly).

### 2.8 API (`src/hugin/api/`)

| route | purpose |
|---|---|
| `GET /api/health` | liveness |
| `GET /api/system` | subsystem status used by the boot screen: `claude` (cli version, login ok, config-dir ok), `ollama` (reachable, models), `munin` (count), `programs` (names), `kernel` (uptime, procs) |
| `GET /api/events/stream?run_id=&since=` | SSE, live events (backfills from `since`, then live) |
| `POST /api/missions` · `GET /api/runs` · `GET /api/runs/{id}` · `GET /api/runs/{id}/events?since=` | missions & runs |
| `GET /api/runs/{id}/replay/stream?speed=&from_seq=` | SSE replay |
| `GET /api/procs` · `POST /api/procs/{pid}/kill` · `POST /api/kill-all` | process table & kill |
| `GET /api/programs` | program catalogue |
| `GET /api/munin/search?q=` · `GET /api/munin/{id}` | memory browser |
| `GET /api/runs/{id}/artifacts` · `GET /api/runs/{id}/artifacts/{name}` | artifacts |
| `POST /api/recordings/{run_id}` · `GET /api/recordings` | export / list demo recordings |
| `/mcp` | agent-facing syscall transport (bearer per pid) |

Single-user localhost; the API binds `127.0.0.1` only. FastAPI serves the built SPA from
`frontend/dist` at `/`.

### 2.9 Shell (frontend, `frontend/`)

Stack: React 19 · TypeScript · Vite · Tailwind v4 · `motion` (UI motion) · `@xyflow/react`
(graph) · `@dagrejs/dagre` (tree layout) · `cmdk` (palette) · `react-virtuoso` (log) ·
`lucide-react` · `zustand` (store) · `@fontsource/space-grotesk`, `@fontsource/inter`,
`@fontsource-variable/jetbrains-mono` (self-hosted fonts — the demo must survive without Wi-Fi).
Not in v1 (documented Later): 3D view, sound, charts library, shadcn.

**State**: a pure reducer `applyEvent(state, event): State` in `src/state/reducer.ts`
(unit-tested) derives `runs, processes, graph (nodes/edges), log ring buffer (5 000), meters
(tokens/min, active procs, budget pct), messages, munin activity`. The SSE client coalesces
events per animation frame before dispatching (streaming text can arrive at >100 events/s).

**Views**:
1. **Boot** — full-screen overlay: kernel log lines type in with *real* `/api/system` results
   ("claude 2.1.261 · Abo-Login ✓", "ollama · 4 Modelle", "munin · 128 Einträge"), then the
   wordmark assembles and the overlay lifts. ≤ 2.5 s, Esc skips, once per browser session,
   instant under `prefers-reduced-motion`.
2. **Mission Control** (default) — three columns: process table (htop-like: pid, program,
   state ring, turns, tokens, elapsed, kill), live graph (custom xyflow nodes: role icon,
   accent, state ring, context-fill meter; parent→child edges; message pulses travel along
   edges as SVG particles; the `munin` hub node glows on writes), kernel log ticker (mono,
   colour by kind, auto-follow with "stick to bottom"). Top bar: wordmark, mode chip,
   meters (Aktive Prozesse · Tokens/min · Budget), ⌘K hint, kill-all (Panik) button with
   confirm. Bottom: mission bar (goal, elapsed, state).
3. **Agent window** — clicking a node morphs it (`layoutId`) into a right-hand sheet:
   streaming transcript with blinking cursor, thinking indicator, expandable tool-call cards
   (input → output, duration), usage meters, kill button.
4. **Munin** — search field + result list + detail (provenance: run, pid, program, time).
5. **Runs & Replay** — run list; opening a past run switches the shell into `REPLAY` mode:
   bottom timeline scrubber (seek by seq, play/pause, speed 1/2/4/8, ←/→ step), same views.
6. **⌘K palette** — "Mission starten…" (free text + templates, driver picker with honest
   labels: Claude (Abo) · Ollama (lokal, langsam) · Simulation), "Programm starten",
   "Zu Run wechseln", "Alle Prozesse beenden", "Munin durchsuchen".

**Design language** ("premium dark glass with HUD accents"): base `#08090C`, surface
`#111318`, border `#22262E`; accents violet `#6E5BFF` (agents/control) and cyan `#22D3C7`
(data/signal); semantic green `#3ECF8E`, amber `#F5A623`, red `#F5455C`. Space Grotesk for
headings/wordmark, Inter for UI, JetBrains Mono for pids, numbers, logs. 8 px grid, radius
10 px, 1 px hairline borders, glow only on *live* elements, `backdrop-filter` on ≤ 2 layers.
Motion rules: 150–400 ms UI transitions with `cubic-bezier(0.16,1,0.3,1)`, 600–900 ms for
particles, one hero animation per view, everything respects `prefers-reduced-motion`.

## 3 · Scope

**v1 (this spec):** kernel + three drivers + syscalls/MCP + munin FTS + five programs +
missions + replay/recordings + the six views above + boot + honest mode chip + kill switch
+ demo recordings (one Simulation, one live Claude run, one Ollama run) + README with GIF.

**Later (not v1, listed so nobody re-invents them mid-build):** 3D constellation view,
sound cues, embeddings lane in munin, scheduled missions ("Nachtschicht"), multi-run
comparison, PWA/mobile, auth, Tauri shell, a second MCP transport, per-run git worktrees.

## 4 · Data & files

- `data/hugin.db` — SQLite: `events`, `runs`, `processes` (final snapshot per exit),
  `memories` (FTS5), `recordings`. Gitignored.
- `runs/<run_id>/p<pid>/` — agent working dirs; `runs/<run_id>/artifacts/` — outputs. Gitignored.
- `.hugin/claude-config/` — isolated Claude config dir (created at boot). Gitignored.
- `demo/recordings/*.jsonl` — scrubbed event logs, committed (they *are* the offline demo).
- `src/hugin/programs/*.yaml`, `src/hugin/drivers/scripts/*.json` — committed content.

## 5 · Error handling

- Driver crash / non-zero exit → `proc.exit(reason="driver_error", stderr_tail)` and
  `proc.state=failed`; the run continues if other processes live; root failure → `run.failed`.
- Budget breach → kill with `exit_reason="budget:<which>"`, visible in table and log.
- Ollama unreachable / Claude not logged in → `/api/system` reports it; palette disables the
  driver with a German reason; boot screen shows it in amber; missions with that driver are
  rejected with 409 and a message.
- SSE disconnect → client reconnects with `since=<last seq>`; the reducer is idempotent on
  duplicate `seq`.
- Syscall without capability → MCP error text explaining the denial; `sys.result(ok=false)`;
  planner budgets are the backstop against loops.
- Kill-all is always available and never waits on the scheduler.

## 6 · Testing

- Backend (pytest, no network, no real `claude`/Ollama): kernel lifecycle with Scripted
  driver (spawn tree, states, budgets, kill, ordering); stream-json parser against fixtures
  in `tests/fixtures/stream_json/` (real captured output, scrubbed); ClaudeCodeDriver with a
  fake subprocess factory; OllamaDriver with an `httpx.MockTransport`; syscall auth and
  capabilities; single-writer enforcement; munin FTS; replay timing with fake clock;
  recorder scrub (rejects secrets); API via `httpx.AsyncClient(app=…)`; SSE backfill.
- Frontend (vitest + testing-library): reducer (event → state, idempotency, ring buffer),
  layout helper, palette command list, mode-chip labels, replay scrubber math.
- E2E smoke (Playwright, optional in the plan's last milestone): boot → simulation mission →
  ≥ 4 nodes → replay scrubber seeks.
- Gate: `uv run pytest -q` · `uv run ruff check .` · `npm --prefix frontend run check` ·
  `npm --prefix frontend test -- --run`.

## 7 · Security & privacy

Bind 127.0.0.1 only · agents' cwd inside `runs/` · tool whitelist per program (`--tools` +
`--allowedTools`, `--permission-mode dontAsk`) · `--strict-mcp-config` so agents see only the
kernel's syscalls · isolated `CLAUDE_CONFIG_DIR` (no user hooks/MCP/CLAUDE.md) · env scrubbed
(`ANTHROPIC_API_KEY` removed; only `PATH`, `HOME`, `LANG`, `CLAUDE_CONFIG_DIR` passed) · path
arguments validated to `~/private/**` only · recordings scrubbed before export · no secrets
in repo · publish checklist before any remote.

**Implementation note (2026-09-06):** there are no syscalls that take a path argument, so
"path arguments validated to `~/private/**`" landed as two narrower, verified checks instead:
the mission goal is validated in `missions/service.py` (`_reject_foreign_paths`, 422 "Pfade
müssen unter ~/private liegen." for any absolute or home path outside it), and artifact
filenames are validated in `syscalls/handlers.py` (`ARTIFACT_NAME` regex, `1–64` chars of
`A-Z a-z 0-9 . _ -`, no `..`, no separators — `artifact_write` cannot escape its run directory).
Both are covered by tests; see ADR 0002 and 0003 for the driver- and kernel-side security
decisions this section otherwise summarises.

## 8 · Acceptance criteria (v1 done when all hold)

1. `scripts/serve.sh` starts the server on 8770; the browser boots with real subsystem checks in ≤ 2.5 s.
2. ⌘K → "Mission starten" with driver *Simulation* → within 20 s the graph shows planner +
   ≥ 3 workers + judge, message particles travel, munin hub pulses, an artifact appears, the run ends `done`.
3. Same mission with driver *Claude* completes end-to-end on the subscription (`apiKeySource=none`
   in the init event) and is exported as a demo recording; likewise one *Ollama* mission.
4. Opening a past run enters `REPLAY` mode; scrubber seeks, speeds 1–8 work, ←/→ step.
5. Kill-all during a live run: all processes reach `killed` within 3 s.
6. Mode chip always correct; no unlabeled simulated/replayed data anywhere.
7. Gate green; README has Status, Quickstart, honest framing, a GIF of the demo.
8. Repo contains no absolute personal paths, no company references, no secrets (scan passes).

## 9 · Decisions (closed, 2026-09-05)

- New repo `hugin`, not an extension of `leitstand` (leitstand is a company status cockpit
  bound to internal data and must never be public; hugin is a publishable showpiece with a
  real agent runtime).
- Raw `claude -p` subprocesses, not the Claude Agent SDK (SDK requires an API key → cost).
- No `--bare` (rejects subscription login). Isolation via `CLAUDE_CONFIG_DIR` + symlinked
  credentials instead.
- Event sourcing is the spine; replay is a projection, not a feature.
- Single-writer rule for artifacts.
- FTS5, no embeddings, in v1.
- Frontend without shadcn/GSAP/3D/sound in v1.
