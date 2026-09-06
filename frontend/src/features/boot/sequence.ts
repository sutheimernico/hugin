/**
 * The boot sequence as data: its timing, the log it prints and the session flag that keeps it
 * from playing twice. No React — `BootScreen.tsx` only performs what this module decides.
 */

import type { SystemStatus } from "../../state/types";
import { BOOTED_KEY } from "../palette/commands";

/** How long one log line waits for the next. */
export const LINE_MS = 140;
export const WORDMARK_MS = 500;
export const HOLD_MS = 400;
export const LIFT_MS = 400;
/** Everything after the last log line: wordmark, hold, lift. */
export const SEQUENCE_TAIL_MS = WORDMARK_MS + HOLD_MS + LIFT_MS;
/** Reduced motion still shows the report, it just does not perform it. */
export const REDUCED_MS = 300;

export const WORDMARK = "hugin";
export const TAGLINE = "Gedanken ausschicken. Wissen zurückholen.";

export type Tone = "ok" | "warn" | "error";

export interface BootLine {
  key: string;
  label: string;
  detail: string;
  /** The status marker; an empty string for lines that only report a number. */
  mark: string;
  tone: Tone;
}

/**
 * The log, straight out of the snapshot. The German details are the kernel's own wording
 * (`system/status.py`), so the boot screen and the API never disagree about a subsystem.
 * `null` means the request failed — the one case where the kernel itself is the bad news.
 */
export function bootLines(system: SystemStatus | null): BootLine[] {
  if (system === null) {
    return [
      { key: "api", label: "api", detail: "nicht erreichbar", mark: "✗", tone: "error" },
      shellLine(),
    ];
  }
  const { claude, ollama, munin, programs, kernel } = system;
  return [
    { key: "kernel", label: "hugin kernel", detail: kernel.version, mark: "", tone: "ok" },
    {
      key: "claude",
      label: "claude",
      detail: claude.ok ? withVersion(claude.version, "Abo-Login") : claude.detail,
      mark: claude.ok ? "✓" : "⚠",
      tone: claude.ok ? "ok" : "warn",
    },
    {
      key: "ollama",
      label: "ollama",
      detail: ollama.detail,
      mark: ollama.ok ? "✓" : "⚠",
      tone: ollama.ok ? "ok" : "warn",
    },
    {
      key: "munin",
      label: "munin",
      detail: munin.count === 1 ? "1 Eintrag" : `${munin.count} Einträge`,
      mark: "",
      tone: "ok",
    },
    programsLine(programs),
    shellLine(),
  ];
}

/** A kernel without programs can run nothing at all — that is an error, not a warning. */
function programsLine(programs: string[]): BootLine {
  if (programs.length === 0) {
    return {
      key: "programs",
      label: "programs",
      detail: "Keine Programme geladen",
      mark: "✗",
      tone: "error",
    };
  }
  return { key: "programs", label: "programs", detail: programs.join(" "), mark: "", tone: "ok" };
}

function shellLine(): BootLine {
  return { key: "shell", label: "shell", detail: "bereit", mark: "", tone: "ok" };
}

function withVersion(version: string | null, text: string): string {
  return version === null ? text : `${version} · ${text}`;
}

/** Has this browser session already seen the boot sequence? */
export function hasBooted(): boolean {
  try {
    return window.sessionStorage.getItem(BOOTED_KEY) !== null;
  } catch {
    // Storage disabled: every load is a first load, which is the honest fallback.
    return false;
  }
}

/** Remember the boot for this browser session; "Boot erneut abspielen" clears it again. */
export function markBooted(): void {
  try {
    window.sessionStorage.setItem(BOOTED_KEY, "1");
  } catch {
    // Nothing to remember it with — the sequence simply plays again on the next load.
  }
}
