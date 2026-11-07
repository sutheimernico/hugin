/**
 * Plain-language names for what an agent calls. The kernel speaks in identifiers
 * (`proc_spawn`, `mcp__hugin__munin_search`); a reader of the UI should never meet one.
 * An unknown name is shown as it came, because inventing a sentence for it would be a guess.
 */

/** The kernel's own syscalls, as an action ("Agent starten") rather than a noun. */
export const SYSCALL_LABEL: Record<string, string> = {
  proc_spawn: "Agent starten",
  proc_wait: "Auf Agent warten",
  mission_report: "Bericht abgeben",
  munin_search: "Speicher durchsuchen",
  munin_write: "Speicher beschreiben",
  artifact_write: "Ergebnis schreiben",
};

/** Tools of the agent's own harness (Claude Code), shown the same way. */
export const TOOL_LABEL: Record<string, string> = {
  WebSearch: "Websuche",
  WebFetch: "Seite abrufen",
  Read: "Datei lesen",
  Grep: "Dateien durchsuchen",
  Glob: "Dateien finden",
};

import { ROLE_LABEL } from "./i18n";

const MCP_PREFIX = "mcp__hugin__";

/**
 * A goal as the UI shows it. A mission started for one program is stored with the kernel's
 * `program:<name>` prefix; the reader gets the role instead ("Späher: Recherchiere …").
 */
export function goalText(goal: string): string {
  const match = /^program:(\w+)\s+(.*)$/s.exec(goal);
  if (match === null) return goal;
  return `${ROLE_LABEL[match[1]] ?? match[1]}: ${match[2]}`;
}

export function syscallLabel(name: string): string {
  return SYSCALL_LABEL[name] ?? name;
}

/**
 * A tool as the transcript names it: hugin's own MCP tools are syscalls under a prefix, the
 * rest come from the agent's harness.
 */
export function toolLabel(tool: string): string {
  if (tool.startsWith(MCP_PREFIX)) return syscallLabel(tool.slice(MCP_PREFIX.length));
  return TOOL_LABEL[tool] ?? SYSCALL_LABEL[tool] ?? tool;
}

/**
 * A tool error as one German sentence. Claude Code wraps validation failures in
 * `<tool_use_error>InputValidationError: <tool> was called with input that …`; the reader needs
 * to know which call failed, not the wrapper. Anything unrecognised is shown clipped, as it came.
 */
export function toolErrorText(raw: string, max = 90): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  if (/tool_use_error|InputValidationError/.test(flat)) {
    const tool = /(mcp__hugin__\w+|\b[A-Z][A-Za-z]+)\s+was called/.exec(flat)?.[1];
    return tool === undefined
      ? "Ungültige Eingabe, der Agent versucht es erneut"
      : `Ungültige Eingabe für »${toolLabel(tool)}«, der Agent versucht es erneut`;
  }
  if (/timed out|timeout/i.test(flat)) return "Zeitüberschreitung";
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** The model as a name, not an id: `sonnet` → `Sonnet`, `claude-haiku-4-5-2025…` → `Haiku 4.5`. */
export function modelLabel(model: string): string {
  if (model === "sim") return "Skript";
  const versioned = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model);
  if (versioned !== null) return `${capital(versioned[1])} ${versioned[2]}.${versioned[3]}`;
  return /^[a-z]+$/.test(model) ? capital(model) : model;
}

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * One-line summaries cut agent prose at a fixed length, so a markdown mark can be left open
 * (`**Archi`). Marks are dropped instead of rendered: a half-bold fragment helps nobody.
 */
export function plain(text: string): string {
  return text.replace(/\*\*|`/g, "").replace(/^#+\s+/, "");
}
