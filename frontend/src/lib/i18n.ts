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
/**
 * Why a process stopped, in the kernel's own vocabulary (`_state_for` in `kernel/kernel.py`).
 * `done` keeps the "Beendet:" prefix so the three ways out of a run read as one family in the
 * agent window's footer.
 */
export const EXIT_REASON_LABEL: Record<string, string> = {
  done: "Beendet: fertig", failed: "Fehler", killed: "Beendet", driver_error: "Treiberfehler",
  "budget:turns": "Budget: Runden überschritten",
  "budget:seconds": "Budget: Zeit überschritten",
  "budget:output_tokens": "Budget: Tokens überschritten",
};

/** An unknown reason is shown verbatim: inventing a German sentence for it would be a lie. */
export function exitReasonLabel(reason: string): string {
  return EXIT_REASON_LABEL[reason] ?? reason;
}
