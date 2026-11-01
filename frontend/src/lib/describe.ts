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
