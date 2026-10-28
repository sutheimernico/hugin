# hugin threat model

Scope: hugin running on one developer machine, bound to 127.0.0.1, driving `claude -p`
subprocesses (subscription login) and a local Ollama loop. There is no multi-user mode and no
authentication; the threats below are the ones that remain with a single, trusted human at the
keyboard.

## Assets

| Asset | Why it matters |
| --- | --- |
| Files outside the workspace (`~/.ssh`, browser profiles, other projects) | An agent with a file tool can read them and write the content into a report or into munin. |
| Claude subscription credentials (`.hugin/claude-config/.credentials.json`, symlinked login) | Reusing them is free compute for an attacker and a ban risk for the owner. |
| Per-process MCP bearer tokens | A token is the full identity of a process: its syscalls, its capabilities. |
| Budgets (turns, seconds, output tokens) | The only thing that bounds the cost of a run. |
| The run artifact (`report.md`) and munin | Output the user will trust and later agents will read as context. |
| The local API (`/api`) | It can start missions, kill processes and read the whole event log. |

## Trust boundaries

1. **Human to kernel** — the browser UI and `POST /api/missions`. Trusted, but a *web page* in the
   same browser is not (boundary 4).
2. **Kernel to agent** — a `claude -p` subprocess or the Ollama loop. The agent's *code* is
   trusted; its *behaviour* is not, because it follows whatever text is in its context.
3. **Untrusted content to agent** — web pages (`WebFetch`, `WebSearch`), file contents the agent
   reads, and munin memories written by earlier agents. All of it can contain instructions.
4. **Other local software to API** — any web page the user opens, any other local user.

## Threats and mitigations

| # | Threat | Mitigation | Where |
| --- | --- | --- | --- |
| T1 | **Prompt injection from a web page.** A fetched page tells the planner to read `~/.ssh/id_rsa`, spawn a worker with a huge budget, or overwrite the report. | Instructions are never the boundary; the kernel is. File tools are path-scoped (T2), spawn tasks are checked against the workspace root (T3), child budgets are capped (T4), the contract tells agents that web content is data. A reproducible test plays the attack against a "worst-case" planner that obeys it. | `tests/security/test_prompt_injection.py` |
| T2 | **Agent reads outside the workspace.** `smith` had bare `Read`, `Glob`, `Grep` and `Bash(cat *)`: the whole home directory. | No program holds a shell tool. For `Read`/`Glob`/`Grep` the driver does not pass the bare name to `--allowedTools` but `Read(//<workspace>/**)` rules, plus `--disallowedTools` for the hugin state directory, the Claude config dir and every `.env`. The root is the `HUGIN_WORKSPACE_ROOT` setting (default: this repository). | `drivers/claude_code.py: file_scope_rules`, `settings.py` |
| T3 | **Path guard bypass through `proc_spawn`.** The old check was a regex on the mission goal, hard-coded to one user's home, and a planner could hand any task to a child. | One check, `workspace.ensure_inside`, runs in `Kernel.spawn` — the single place every spawn path ends. It also rejects `../` paths. It is a text heuristic (a model can phrase a path in ways no regex sees), so it is a fast, readable refusal, not the boundary; T2 is. | `workspace.py`, `kernel/kernel.py` |
| T4 | **Budget escalation.** A planner passes `max_turns=1000000` to a child. | A child's budget is clamped to what its parent has *left* (turns, seconds, output tokens, measured at spawn); a parent with nothing left cannot spawn. Killing a parent kills its live children. | `syscalls/handlers.py: _bounded_budget` |
| T5 | **Stale credentials.** A killed planner keeps spawning or overwrites the report of a closed run. | The token is cleared the moment a process exits; syscalls from an exited pid are refused even by pid; `artifact_write` refuses a closed run. | `kernel/kernel.py: _finalize`, `syscalls/registry.py`, `handlers.py` |
| T6 | **Token disclosure.** The token was in `argv`, readable by every local user via `/proc/<pid>/cmdline`. | The MCP config (with the token) is written to a `0600` file in a `0700` directory outside the repository and deleted when the process ends; `argv` carries only the file path. | `drivers/claude_code.py: write_mcp_config` |
| T7 | **Cross-run exfiltration through munin.** An injected scout writes a payload into memory; a later scout reads it next to fresh web content. | `munin_search` marks results `untrusted` with an explicit notice and the contract forbids following instructions found in memories. T2 removes the main source of secrets to write there. This lowers the risk; it does not remove it (see R2). | `syscalls/handlers.py`, `programs/contract.md` |
| T8 | **DNS rebinding / cross-site requests against `/api`.** A web page resolves its own hostname to 127.0.0.1 and talks to the API as same-origin. | Middleware on `/api` refuses any `Host` that is not loopback (421) and any `Origin` that is not loopback (403) — the same rule `/mcp` already had. | `api/guard.py` |
| T9 | **Billing by accident.** An `ANTHROPIC_API_KEY` in the environment turns a free run into a billed one. | Agent environment is an allowlist (`PATH`, `HOME`, `LANG`, `CLAUDE_CONFIG_DIR`); the driver refuses to start when the key is in the kernel's own environment and re-checks the CLI's reported key source. | `drivers/claude_code.py` |
| T10 | **Unbounded resource use by the UI stream.** A stalled browser tab grows a queue forever. | Per-client queue is bounded; on overflow it is dropped and the client resyncs from the log (paged, no 10,000-event cap). | `api/routes_events.py` |

## Residual risks (accepted, stated plainly)

- **R1 — Live check of path rules.** The `Read(//…)` rules follow Claude Code's documented
  permission syntax and are asserted in the argv tests; whether the installed CLI version applies
  them to `Glob` and `Grep` exactly as documented has not been probed with a real run in this
  change. The failure mode of a mis-parsed rule is a denied tool, not an open one.
- **R2 — Injection is not solved.** A scout that reads a hostile page can still be talked into
  writing misleading text into its report or into munin. The kernel bounds what that agent can
  *do* (read, spawn, spend); it cannot make a model immune. Reports from web-reading workers are
  evidence for a human, not facts.
- **R3 — Same-user attackers.** The token file is `0600`, which keeps other users out but not
  another process of the same user (which could also read `/proc/<pid>/environ` or ptrace).
  hugin is not a sandbox against local malware.
- **R4 — Readable runs directory.** The default workspace root is the repository, which contains
  `runs/` (other agents' working directories and artifacts). The hugin database and Claude config
  are denied; other runs' files are not. Point `HUGIN_WORKSPACE_ROOT` at the project to analyse.
- **R5 — WebFetch is open.** `scout` may fetch any URL, so data it *can* see (task text, munin
  contents) can be sent out in a URL. Mitigation is limited to what the scout is told and what it
  can read.
- **R6 — Budget is per parent, not per tree.** Each child is capped by its parent's remainder at
  spawn time; four children can each take the full remainder. Total spend is bounded by
  fan-out (4) × depth, not by a single shared pool.
- **R7 — No authentication.** Anything on loopback that sends a loopback `Host` can use `/api`.
- **R8 — Synchronous log writes.** Every event is a synchronous SQLite insert on the event loop
  (WAL, `synchronous=NORMAL`). Fine at this scale, a latency risk at much higher event rates.
