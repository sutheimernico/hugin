# ADR 0002 — Claude Code headless isolation: no `--bare`, isolated config dir

Status: accepted · 2026-09-06

## Context

`ClaudeCodeDriver` spawns `claude -p` as a supervised subprocess (D2: no Agent SDK, which
requires an API key — cost). The subscription login has to carry into a sandboxed agent
process without also carrying the user's hooks, MCP servers (e.g. a Microsoft 365 connector)
or `CLAUDE.md` — any of which would change agent behaviour or blow up the prompt with context
the kernel cannot account for or budget.

## Decision

Run `claude -p` **without** `--bare`, inside an isolated `CLAUDE_CONFIG_DIR`
(`.hugin/claude-config/`) holding only `settings.json` (`{"disableAllHooks": true}`) plus
symlinks `.credentials.json → ~/.claude/.credentials.json` and `.claude.json → ~/.claude.json`
— sharing the login without sharing anything else. Add `--strict-mcp-config` so an agent sees
only the kernel's own `/mcp` server, and `--permission-mode dontAsk` with `--allowedTools`
listing the program's tool whitelist plus `mcp__hugin`. Env is an allow-list: `PATH`, `HOME`,
`LANG`, `CLAUDE_CONFIG_DIR` — never `ANTHROPIC_API_KEY`.

## Evidence

- `--bare` rejects the subscription login (verified 2026-09-05: exits with
  `terminal_reason=api_error` — it wants an API key, not a browser session).
- The symlinked, isolated config dir keeps `apiKeySource=none`, no user hooks, no user MCP
  servers, and cuts prompt overhead from ~40k to ~6.4k tokens per turn (verified 2026-09-05).
- `--permission-mode dontAsk` denies any tool absent from `--allowedTools`, MCP tools included:
  without `mcp__hugin` in that list, every kernel syscall was denied (verified live 2026-09-06,
  Task 28's first run).
- `ANTHROPIC_API_KEY` is refused twice: `preflight(os.environ)` before spawn, and the
  `system/init` line's `api_key_source` after spawn — only the CLI knows which billing source
  it actually picked, so the second check sits on top of the first (`claude_code.py`).

## Consequences

- Isolation is only as good as the symlink target: a compromised
  `~/.claude/.credentials.json` is a compromised hugin agent too — accepted for a local,
  single-user tool.
- A future `--bare` that accepts the subscription login would let this whole config-dir dance
  go away; worth revisiting if Claude Code adds it.
- Cost is subscription usage, not billing: `total_cost_usd` from the CLI's own `result` line is
  shown as an "API-Äquivalent" in the UI, never presented as money actually spent.
