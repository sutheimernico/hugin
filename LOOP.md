# hugin — LOOP (per-iteration prompt for the autonomous build agent)

You are a fresh headless agent. You do ONE high-value thing, verify it, commit it, and exit.
Progress lives on disk (this file, `PROJECT.md`/`PLAN.md`, git history, `AUTOPILOT_LOG.md`) —
never in context.

## Per-iteration protocol

1. Read `~/private/AUTOPILOT.md` (global rules), then this `LOOP.md`, then `PLAN.md`,
   `PROJECT.md`, `CLAUDE.md` and `AGENTS.md`.
2. Confirm you are on branch `autopilot/work` (the runner guarantees this; if not, stop).
3. Pick the SINGLE highest-value open `- [ ]` task in `PLAN.md` (top-to-bottom, earlier
   milestones first) and read its full task text in
   `docs/superpowers/plans/2026-09-05-hugin-v1-implementation.md`. If a milestone boundary is
   reached, run the once-per-milestone self-challenge/SOTA step first (write an ADR if it changes
   the plan).
4. Do that one task. Small, reviewable diff. Read existing code before writing; match
   conventions. Code blocks marked **BINDING** in the plan are implemented verbatim. New logic
   ships with a test; drivers and network stay behind their seams and are faked in tests.
5. Run the gate: `uv run pytest -q` green AND `uv run ruff check .` clean (plus
   `npm --prefix frontend run check` and `npm --prefix frontend test -- --run` once `frontend/`
   exists). If red, fix or revert.
6. On green: commit (Conventional Commits, English, imperative), check off the task in `PLAN.md`,
   append a one-line note to `AUTOPILOT_LOG.md`. Then exit.
7. If a task needs a paid resource, live usage or a Nico-only input: move it to "Needs Nico",
   pick another, or exit. Never sign up for anything paid. Never fake data or metrics.

## Project-specific hard constraints (never override)

- **Never spawn a live agent.** No `claude -p`, no Ollama call, no network — not in tests, not to
  "try it out". The Scripted driver and the committed fixtures are the only way to exercise the
  runtime. Live runs are Task 28 and orchestrator-supervised.
- **Zero extra cost.** `ANTHROPIC_API_KEY` is stripped from every agent environment; a `claude`
  driver refuses to spawn if the key is present. Never introduce a paid path.
- **No company data, ever.** The company workspace is never mounted, referenced or read. Agent
  path arguments are validated to this repo's `runs/` tree.
- **Honesty.** Simulated or replayed data carries the `SIMULATION` / `REPLAY` label; unavailable
  subsystems surface as `warn`/`error`, never as a plausible-looking number.
- **Pin new deps** with a one-line justification; simplest solution that meets the task (YAGNI).
- **Language:** code, identifiers, comments, commits, docs English; UI copy German.

## Gate (objective done-check)

`uv run pytest -q` green + `uv run ruff check .` clean (+ `npm --prefix frontend run check` and
`npm --prefix frontend test -- --run` once `frontend/` exists). Commit only a green gate.

## Where things are

- Spec: `docs/superpowers/specs/2026-09-05-hugin-agentic-os-design.md`
- Plan: `docs/superpowers/plans/2026-09-05-hugin-v1-implementation.md`
- Code: `src/hugin/` (one responsibility per file) · Tests: `tests/` (mirrors `src/`)
- Fixtures: `tests/fixtures/` · Frontend: `frontend/` · Shell scripts: `scripts/`
- Runtime state (gitignored): `data/` (SQLite), `runs/` (agent cwds), `.hugin/` (Claude config)
- Committed demo data: `demo/recordings/*.jsonl`
- Run locally: `scripts/serve.sh` → http://127.0.0.1:8770
