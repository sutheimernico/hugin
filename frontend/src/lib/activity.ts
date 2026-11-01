/**
 * What a process is doing right now, as one short German phrase — the line under its name on a
 * graph node and in the narrow-screen process tree. Derived from the projection only.
 */

import type { Proc } from "../state/types";
import { toolLabel } from "./describe";
import { exitReasonShort, STATE_LABEL } from "./i18n";

/**
 * The state and the activity as one line ("Läuft · Websuche"), without saying a thing twice
 * when the activity already starts with the state ("Wartet · Wartet auf einen Platz").
 */
export function stateLine(proc: Proc): string {
  const label = STATE_LABEL[proc.state];
  const activity = activityOf(proc);
  return activity.startsWith(label) ? activity : `${label} · ${activity}`;
}

export function activityOf(proc: Proc): string {
  switch (proc.state) {
    case "queued":
      return "Wartet auf einen Platz";
    case "spawning":
      return "Startet";
    case "done":
      return "Bericht abgegeben";
    case "failed":
      return proc.exitReason === null ? "Fehlgeschlagen" : cap(exitReasonShort(proc.exitReason));
    case "killed":
      return "Gestoppt";
    case "running":
    case "waiting_tool":
      return liveActivity(proc);
  }
}

function liveActivity(proc: Proc): string {
  const open = proc.transcript.findLast((item) => item.t === "tool" && item.ok === undefined);
  if (open?.t === "tool") return toolLabel(open.tool);
  if (proc.state === "waiting_tool") return "Wartet auf Werkzeug";
  if (proc.thinking) return "Denkt nach";
  const last = proc.transcript.at(-1);
  if (last?.t === "text") return "Schreibt";
  return "Läuft";
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
