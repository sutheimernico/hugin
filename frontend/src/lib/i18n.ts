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
