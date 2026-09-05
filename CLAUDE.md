# hugin — Arbeitsweise & Locked Decisions

Globale persönliche Regeln (`~/.claude/CLAUDE.md`) gelten. Diese Datei ergänzt projekt-spezifisch.
Source of Truth: `PROJECT.md` — when this file and PROJECT.md disagree, PROJECT.md wins.
Codebase operations (stack, architecture, run/build/test): `AGENTS.md`.

Binding design: `docs/superpowers/specs/2026-09-05-hugin-agentic-os-design.md`.
Build route with the binding contracts: `docs/superpowers/plans/2026-09-05-hugin-v1-implementation.md`.

## Locked decisions (2026-09-05) — full register in PROJECT.md §Decisions

- **D1** Eigenes Repo `hugin`, keine Erweiterung von `leitstand` — leitstand hängt an
  Firmendaten und darf nie public werden, hugin ist der publizierbare Showpiece-Runtime.
- **D2** Rohe `claude -p`-Subprozesse statt Claude Agent SDK — das SDK braucht einen API-Key
  (= Kosten).
- **D3** Kein `--bare` (verweigert den Subscription-Login). Isolation über `CLAUDE_CONFIG_DIR`
  plus symlinkte Credentials.
- **D4** Event Sourcing ist das Rückgrat; Replay ist eine Projektion, kein Feature.
- **D5** Single-Writer-Regel für Artefakte: nur der Planner eines Runs schreibt.
- **D6** munin nutzt SQLite FTS5, keine Embeddings in v1.
- **D7** Frontend ohne shadcn, GSAP, 3D und Sound in v1.

## Wie Claude hier arbeitet

- **Flow:** Trivial → direkt. Sonst Superpowers: `brainstorming` → `writing-plans` (Go abwarten) →
  `executing-plans`/`subagent-driven-development` → `verification-before-completion`.
  Für den v1-Build ist der Plan bereits geschrieben und approved: Task-Text lesen, umsetzen,
  Gate, commit — keine neuen Tasks erfinden.
- **Orchestrierung:** Read/Recherche/Review/Sweeps an Subagents (nur Konklusion zurück).
  Write/Build mit Abhängigkeiten single-threaded inline.
- **Self-Review:** iterativ pro Arbeitsschritt, nicht erst vor dem PR.
- **BINDING-Blöcke** im Plan sind exakte Interfaces — wörtlich implementieren.

## Conventions

- Code, Bezeichner, Kommentare, Commits, Doku Englisch; Chat Deutsch.
  **UI-Copy im Browser Deutsch** — Wortmarke „hugin", Programmnamen (`planner`, `scout`, …) und
  State-Namen bleiben wie sie sind, deutsche Labels daneben.
- Conventional Commits. Nie direkt auf `main` — Arbeit läuft auf `autopilot/work`.
- Neue Logik kommt mit Test. Netz-/LLM-Code hinter Seam, in Tests gefakt: kein echter `claude`,
  kein echtes Ollama, kein Netz.
- Gate vor jedem Commit: `uv run pytest -q` grün + `uv run ruff check .` sauber (ab `frontend/`
  zusätzlich `npm --prefix frontend run check` + `npm --prefix frontend test -- --run`).
- Ehrlichkeit: keine erfundenen Zahlen; Simulation/Replay immer sichtbar gelabelt.
- Kein Firmenbezug im Repo — der Firmen-Workspace wird nie gemountet, gelesen oder erwähnt.

## Plan, spec & session docs

- Specs: `docs/superpowers/specs/YYYY-MM-DD-*.md` · Pläne: `docs/superpowers/plans/YYYY-MM-DD-*.md`
- Session-Handoffs: `docs/sessions/YYYY-MM-DD_HHMM_<topic>.md`
- Doku ist committed.
